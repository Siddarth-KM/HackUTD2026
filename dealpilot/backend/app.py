"""FastAPI backend + static test frontend.   Run:  uvicorn backend.app:app --port 8000   (from dealpilot/)

Extraction uses Gemini (GEMINI_API_KEY in .env). For UI/engine development WITHOUT a key set
DEALPILOT_EXTRACTOR=fixture: it swaps in the test-only parser and the UI shows a loud FIXTURE MODE banner.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import re
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .dataset import Dataset
from .engine.pipeline import Pipeline
from .engine.state import iso, parse_iso
from .ingest.gemini_client import get_client

ROOT = config.ROOT
app = FastAPI(title="DealPilot")
LOCK = threading.RLock()
STATE: dict = {"pipe": None, "fixture": False}


def _extractor():
    if os.environ.get("DEALPILOT_EXTRACTOR") == "fixture":
        import sys
        sys.path.insert(0, str(ROOT))
        from tests.support.fixture_parser import fixture_extract
        STATE["fixture"] = True
        return fixture_extract
    return None  # default: Gemini


def pipe() -> Pipeline:
    if STATE["pipe"] is None:
        STATE["pipe"] = Pipeline(Dataset.load(), extractor=_extractor(), personas=False)
    return STATE["pipe"]


def parse_delta(s: str) -> dt.timedelta:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([mhd])\s*", s)
    if not m:
        raise HTTPException(400, "use e.g. 30m, 6h, 2d")
    n, u = float(m[1]), m[2]
    return dt.timedelta(minutes=n) if u == "m" else dt.timedelta(hours=n) if u == "h" else dt.timedelta(days=n)


class Advance(BaseModel):
    by: str = "1h"


class SetTime(BaseModel):
    t: str


class Answer(BaseModel):
    answer: str
    note: str = ""


class Override(BaseModel):
    code: str = ""          # a finding code to accept, or "reopen:<Stage>" to re-open a credit/committee gate


class Personas(BaseModel):
    enabled: bool


class Load(BaseModel):
    root: Optional[str] = None       # a data pack (rules/contacts/history/arrivals)
    arrivals: Optional[str] = None   # arrivals.jsonl to append (weekend drop)
    folder: Optional[str] = None     # extra shared_folder holding the dropped files
    replace: bool = False            # True: start a fresh pipeline on this pack


# ------------------------------------------------------------------ status / state
def _state() -> dict:
    p = pipe()
    pend = [r.dict() for r in p.requests if r.pending]
    return {
        "now": iso(p.now),
        "mode": "FIXTURE (test parser - NOT Gemini)" if STATE["fixture"] else ("Gemini " + config.GEMINI_MODEL if config.GEMINI_API_KEY else "NO GEMINI KEY"),
        "gemini_ready": bool(config.GEMINI_API_KEY) or STATE["fixture"],
        "personas": p.personas,
        "errors": p.errors[-5:],
        "stalled": p.stalled,
        "gemini": get_client().status(),
        "n_arrived": p.arr_idx, "n_total": len(p.ds.arrivals),
        "deals": [p.deal_view(d) for d in p.deals.values()],
        "pending": pend,
        "unanswered_info": [r.dict() for r in p.requests if r.type == "info_request"][-20:],
        "alerts": sorted((dict(a.dict(), deal_name=p.deals[f].facts.get("dba") or p.deals[f].facts.get("legal_name") or f)
                          for f, d in p.deals.items() for a in d.alerts), key=lambda a: a["at"] or "", reverse=True)[:80],
        "clusters": p.clusters,
        "history_flags": p.history_flags,
        "people": {k: {"name": v["name"], "role": v["role"], "notes": v.get("notes", "")} for k, v in p.ds.people.items()},
    }


@app.get("/api/state")
def state():
    with LOCK:
        return _state()


@app.post("/api/clock/advance")
def advance(body: Advance):
    with LOCK:
        pipe().advance(parse_delta(body.by))
        return _state()


@app.post("/api/clock/set")
def set_time(body: SetTime):
    with LOCK:
        t = parse_iso(body.t)
        if t < pipe().now:
            raise HTTPException(400, "cannot move the clock backwards; reset first")
        pipe().run_until(t)
        return _state()


@app.post("/api/clock/reset")
def reset():
    with LOCK:
        pipe().reset()
        return _state()


@app.post("/api/personas")
def personas(body: Personas):
    with LOCK:
        pipe().personas = body.enabled
        return _state()


@app.get("/api/deals/{folder:path}")
def deal(folder: str):
    with LOCK:
        d = pipe().deals.get(folder)
        if not d:
            raise HTTPException(404, "unknown deal")
        return pipe().deal_detail(d)


@app.post("/api/humans/{req_id}/answer")
def answer(req_id: int, body: Answer):
    with LOCK:
        try:
            r = pipe().answer(req_id, body.answer, body.note)
        except (KeyError, ValueError) as e:
            raise HTTPException(400, str(e))
        return {"request": r.dict(), "state": _state()}


@app.post("/api/deals/{folder:path}/override")
def override(folder: str, body: Override):
    with LOCK:
        p = pipe()
        d = p.deals.get(folder)
        if not d:
            raise HTTPException(404, "unknown deal")
        d.overrides.add(body.code)
        p._advance_stage(d, p.now)
        return p.deal_detail(d)


@app.post("/api/deals/{folder:path}/memos")
def memos(folder: str):
    """Ask Gemini to write the saw / decided / why note for every finished stage of one deal (one request)."""
    with LOCK:
        p = pipe()
        d = p.deals.get(folder)
        if not d:
            raise HTTPException(404, "unknown deal")
        ok = p.ensure_memos(d)
        out = p.deal_detail(d)
        out["memos_ok"] = ok
        return out


@app.get("/api/export")
def export(set: str = "sample"):
    with LOCK:
        return JSONResponse(pipe().export(set), headers={"Content-Disposition": f'attachment; filename="dealpilot_{set}.json"'})


@app.post("/api/dataset/load")
def load(body: Load):
    """Weekend drop / synthetic / hidden set. replace=True builds a fresh pipeline on a new pack; otherwise the
    arrivals (new deals AND new papers on existing deals) are appended to the running one."""
    with LOCK:
        if body.replace:
            STATE["pipe"] = Pipeline(Dataset.load(body.root, body.arrivals, body.folder), extractor=_extractor(), personas=pipe().personas)
            return _state()
        p = pipe()
        if body.folder:
            p.ds.extra_shared.append(Path(body.folder))
        if body.arrivals:
            rows = [json.loads(l) for l in Path(body.arrivals).read_text(encoding="utf-8").splitlines() if l.strip()]
            p.load_arrivals(rows)
        return _state()


@app.get("/api/health")
def health():
    return {"ok": True, "gemini_key": bool(config.GEMINI_API_KEY), "model": config.GEMINI_MODEL,
            "gemini_calls": get_client().calls, "cache_hits": get_client().cache_hits}


FRONT = ROOT / "frontend"


@app.get("/")
def index():
    return FileResponse(FRONT / "index.html")


app.mount("/static", StaticFiles(directory=FRONT), name="static")
