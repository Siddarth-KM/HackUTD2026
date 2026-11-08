"""PDF metadata + text layer (pypdf). Metadata is real evidence (Producer/Creator/CreationDate)."""
from __future__ import annotations
import hashlib, re
from dataclasses import dataclass, asdict
from pathlib import Path
from pypdf import PdfReader


@dataclass
class PdfMeta:
    producer: str = ""
    creator: str = ""
    creation_date: str = ""
    pages: int = 0
    sha256: str = ""
    text: str = ""          # layout-mode text, used ONLY to sanity-check Gemini's numbers
    text_chars: int = 0
    layout_sig: str = ""       # fingerprint of the document's label structure (same template => same sig)

    def dict(self):
        d = asdict(self)
        d.pop("text")
        return d


def _pdf_date(s: str) -> str:
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?", s or "")
    if not m:
        return s or ""
    y, mo, d, hh, mm, ss = (g or "00" for g in m.groups())
    return f"{y}-{mo}-{d}T{hh}:{mm}:{ss}"


def layout_signature(text: str) -> str:
    """Hash of the SHAPE of a document: the ordered label column (digits stripped), ignoring the values.
    Two documents built from the same template share it; honest borrowers use many different tools/templates."""
    labels = []
    for line in text.splitlines():
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) >= 2:
            labels.append(re.sub(r"[\d$,.\-/]+", "#", parts[0].lower())[:40])
    if len(labels) < 3:
        return ""
    return hashlib.sha1("|".join(labels).encode()).hexdigest()[:10]


def read_pdf_meta(path: Path) -> PdfMeta:
    b = Path(path).read_bytes()
    m = PdfMeta(sha256=hashlib.sha256(b).hexdigest())
    try:
        r = PdfReader(str(path))
        md = r.metadata or {}
        m.producer = str(md.get("/Producer") or "")
        m.creator = str(md.get("/Creator") or "")
        m.creation_date = _pdf_date(str(md.get("/CreationDate") or ""))
        m.pages = len(r.pages)
        m.text = "\n".join((p.extract_text(extraction_mode="layout") or "") for p in r.pages)
        m.text_chars = len(m.text)
        m.layout_sig = layout_signature(m.text)
    except Exception as e:  # corrupt / scanned PDF: Gemini still sees the bytes
        m.text = ""
        m.producer = m.producer or f"UNREADABLE:{type(e).__name__}"
    return m


def numbers_in(text: str) -> set[float]:
    """All money-like numbers in the raw text layer (used to catch LLM mis-transcription)."""
    out = set()
    for tok in re.findall(r"-?\$?\d[\d,]*\.\d{2}\b|-?\$?\d{1,3}(?:,\d{3})+\b", text):
        try:
            out.add(abs(float(tok.replace("$", "").replace(",", ""))))
        except ValueError:
            pass
    return out
