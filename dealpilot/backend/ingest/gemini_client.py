"""Gemini wrapper: structured JSON extraction, text generation, sha256 cache, rate limit, quota-aware retries,
model fallback chain.

Design rule: Gemini READS and WRITES; arithmetic/validation is done in Python on its output.
There is deliberately NO regex fallback for extraction (project decision): without a working key/quota the
extractor raises GeminiUnavailable and the deal is left un-ingested rather than guessed at.

Operational lessons baked in (found the hard way on a free-tier key):
  * the SDK defaults to API 'v1', which rejects JSON-schema mode  -> pin 'v1beta'
  * free tier = a few dozen requests PER DAY PER MODEL            -> classify 429s: a DAILY quota is never retried,
    the model is parked until its reset and the next model in GEMINI_MODELS is used
  * only transient errors (429 per-minute, 5xx, network) are retried; 400/404 fail fast
  * the cache key does NOT include the model, so a result from any model in the chain is reused
"""
from __future__ import annotations
import hashlib, re, sqlite3, threading, time
from typing import Optional, Type, TypeVar
from pydantic import BaseModel
from .. import config

T = TypeVar("T", bound=BaseModel)
PROMPT_VERSION = "v2"


class GeminiUnavailable(RuntimeError):
    pass


class QuotaExhausted(GeminiUnavailable):
    pass


class _RateLimiter:
    def __init__(self, rpm: int):
        self.interval = 60.0 / max(rpm, 1)
        self.lock = threading.Lock()
        self.next_ok = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            delay = max(0.0, self.next_ok - now)
            self.next_ok = max(now, self.next_ok) + self.interval
        if delay:
            time.sleep(delay)


class Cache:
    def __init__(self, path=None):
        path = path or config.CACHE_DB
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = str(path)
        self.lock = threading.Lock()
        with self._conn() as c:
            c.execute("CREATE TABLE IF NOT EXISTS g (k TEXT PRIMARY KEY, v TEXT)")

    def _conn(self):
        return sqlite3.connect(self.path, timeout=30)

    def get(self, k: str) -> Optional[str]:
        with self.lock, self._conn() as c:
            r = c.execute("SELECT v FROM g WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def put(self, k: str, v: str) -> None:
        with self.lock, self._conn() as c:
            c.execute("INSERT OR REPLACE INTO g VALUES (?,?)", (k, v))


def _classify(e: Exception) -> tuple[str, float]:
    """-> (kind, retry_after_seconds).  kind: quota_day | rate | transient | model_gone | fatal"""
    s = str(e)
    code = getattr(e, "code", None) or (int(m.group(1)) if (m := re.match(r"\s*(\d{3})", s)) else None)
    delay = 0.0
    if m := re.search(r"retry in ([\d.]+)s", s, re.I) or re.search(r"retryDelay'?\"?:\s*'?\"?(\d+(?:\.\d+)?)s", s):
        delay = float(m.group(1))
    elif m := re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", s, re.I):
        delay = float(m.group(1) or 0) * 3600 + float(m.group(2) or 0) * 60 + float(m.group(3))
    if code == 429:
        if re.search(r"PerDay|per day|daily", s, re.I) or delay > 120:
            return "quota_day", delay or 3600.0
        return "rate", delay or 5.0
    if code in (500, 502, 503, 504) or code is None:
        return "transient", delay or 3.0
    if code == 404:
        return "model_gone", 0.0
    return "fatal", 0.0


class GeminiClient:
    def __init__(self):
        self._client = None
        self.cache = Cache()
        self.limiter = _RateLimiter(config.GEMINI_RPM)
        self.calls = 0
        self.cache_hits = 0
        self.lock = threading.Lock()
        self.blocked: dict[str, float] = {}      # model -> epoch seconds until which it is parked
        self.last_error = ""
        self.last_model = ""
        self.model_calls: dict[str, int] = {}

    @property
    def available(self) -> bool:
        return bool(config.GEMINI_API_KEY)

    def status(self) -> dict:
        now = time.time()
        return {"key": self.available, "models": config.GEMINI_MODELS, "calls": self.calls, "cache_hits": self.cache_hits,
                "per_model_calls": dict(self.model_calls),
                "parked": {m: round((t - now) / 60) for m, t in self.blocked.items() if t > now},
                "last_error": self.last_error, "last_model": self.last_model}

    def _c(self):
        if not self.available:
            raise GeminiUnavailable("GEMINI_API_KEY is not set (put it in dealpilot/.env). No fallback extractor by design.")
        if self._client is None:
            from google import genai
            from google.genai import types
            self._client = genai.Client(api_key=config.GEMINI_API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
        return self._client

    def _key(self, *parts: str) -> str:
        h = hashlib.sha256()
        for p in (PROMPT_VERSION, *parts):          # NOTE: model deliberately excluded
            h.update(p.encode("utf-8", "ignore"))
            h.update(b"\x00")
        return h.hexdigest()

    def _generate(self, contents, schema: Optional[Type[BaseModel]]) -> str:
        from google.genai import types
        cfg = dict(temperature=0.0)
        if schema is not None:
            cfg.update(response_mime_type="application/json", response_schema=schema)
        tried_any = False
        for model in config.GEMINI_MODELS:
            if self.blocked.get(model, 0) > time.time():
                continue
            tried_any = True
            for attempt in range(4):
                try:
                    self.limiter.wait()
                    r = self._c().models.generate_content(model=model, contents=contents, config=types.GenerateContentConfig(**cfg))
                    if not r.text:
                        raise RuntimeError("empty Gemini response")
                    with self.lock:
                        self.calls += 1
                        self.model_calls[model] = self.model_calls.get(model, 0) + 1
                        self.last_model = model
                    return r.text
                except GeminiUnavailable:
                    raise
                except Exception as e:
                    kind, delay = _classify(e)
                    self.last_error = f"{model}: {kind}: {str(e)[:160]}"
                    if kind == "quota_day":
                        self.blocked[model] = time.time() + delay
                        break                                   # next model in the chain
                    if kind == "model_gone":
                        self.blocked[model] = time.time() + 86400
                        break
                    if kind == "fatal":
                        raise RuntimeError(f"Gemini rejected the request ({model}): {str(e)[:300]}")
                    time.sleep(min(max(delay, 2 ** attempt), 60))   # rate / transient
            else:
                continue
        if not tried_any or all(self.blocked.get(m, 0) > time.time() for m in config.GEMINI_MODELS):
            soonest = min((self.blocked.get(m, 0) for m in config.GEMINI_MODELS), default=0)
            mins = max(0, round((soonest - time.time()) / 60))
            raise QuotaExhausted(f"Gemini quota exhausted on every configured model ({', '.join(config.GEMINI_MODELS)}); "
                                 f"earliest reset in ~{mins} min. Enable billing on the key's project or wait. Last error: {self.last_error}")
        raise RuntimeError(f"Gemini failed after retries. Last error: {self.last_error}")

    # ------------------------------------------------------------------ cache helpers
    def cached(self, key_parts: tuple, schema: Type[T]) -> Optional[T]:
        hit = self.cache.get(self._key(*key_parts))
        if hit:
            self.cache_hits += 1
            return schema.model_validate_json(hit)
        return None

    def store(self, key_parts: tuple, obj: BaseModel) -> None:
        self.cache.put(self._key(*key_parts), obj.model_dump_json())

    @staticmethod
    def file_key(file_bytes: bytes, prompt: str, schema: Type[BaseModel]) -> tuple:
        return (hashlib.sha256(file_bytes).hexdigest(), prompt, schema.__name__)

    # ------------------------------------------------------------------ calls
    def extract(self, file_bytes: bytes, mime: str, prompt: str, schema: Type[T]) -> T:
        """Structured extraction from a PDF/image, cached by (file sha256, prompt)."""
        kp = self.file_key(file_bytes, prompt, schema)
        hit = self.cached(kp, schema)
        if hit:
            return hit
        from google.genai import types
        obj = schema.model_validate_json(self._generate([types.Part.from_bytes(data=file_bytes, mime_type=mime), prompt], schema))
        self.store(kp, obj)
        return obj

    def extract_many(self, files: list[tuple[bytes, str]], prompt: str, item_schema: Type[T], batch_schema: Type[BaseModel]) -> list[T]:
        """ONE request for several documents. Returns one item per file, in order. Raises ValueError if the model
        returns the wrong number of items (the caller then falls back to single-file calls)."""
        from google.genai import types
        parts: list = []
        for i, (b, mime) in enumerate(files, 1):
            parts.append(f"DOCUMENT {i} of {len(files)}:")
            parts.append(types.Part.from_bytes(data=b, mime_type=mime))
        parts.append(prompt + f"\n\nThere are exactly {len(files)} documents above. Return `documents` with EXACTLY {len(files)} items, "
                              "in the same order, one per document. Never merge or skip documents.")
        batch = batch_schema.model_validate_json(self._generate(parts, batch_schema))
        items = list(batch.documents)  # type: ignore[attr-defined]
        if len(items) != len(files):
            raise ValueError(f"expected {len(files)} documents, got {len(items)}")
        return items

    def extract_text(self, text: str, prompt: str, schema: Type[T]) -> T:
        kp = (hashlib.sha256(text.encode()).hexdigest(), prompt, schema.__name__)
        hit = self.cached(kp, schema)
        if hit:
            return hit
        obj = schema.model_validate_json(self._generate([prompt + "\n\n---\n" + text], schema))
        self.store(kp, obj)
        return obj

    def write(self, prompt: str) -> str:
        """Free-text generation (memos, plain-words requests), cached."""
        key = self._key("write", prompt)
        hit = self.cache.get(key)
        if hit:
            self.cache_hits += 1
            return hit
        out = self._generate([prompt], None).strip()
        self.cache.put(key, out)
        return out


_singleton: Optional[GeminiClient] = None


def get_client() -> GeminiClient:
    global _singleton
    if _singleton is None:
        _singleton = GeminiClient()
    return _singleton
