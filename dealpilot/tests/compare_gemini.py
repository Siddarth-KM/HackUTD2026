"""Dev tool: run REAL Gemini extraction (the batched path the pipeline uses) on sample folders and diff the result
against the test fixture parser. Results are cached by file hash, so re-runs are free.

    .venv\\Scripts\\python.exe tests\\compare_gemini.py "Ridgeway Freight Logistics" "Westfield Print & Sign"
    .venv\\Scripts\\python.exe tests\\compare_gemini.py --all
"""
from __future__ import annotations
import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.dataset import Dataset
from backend.ingest.extract import extract_batch
from backend.ingest.gemini_client import get_client
from tests.support.fixture_parser import fixture_extract

# fields where the fixture is weaker than Gemini or the wording legitimately varies: not compared
SKIP = {"notes", "confidence", "legible", "pages_seen", "contract_currencies", "purpose", "collateral", "industry", "naics",
        "employees", "entity_type", "organizer", "file_number", "vendor_address", "preparer_ptin", "email",
        "affiliated_businesses", "net_income", "total_liabilities", "tax_year", "balance_sheet_date", "subject_name",
        "notice_text", "transactions"}


def norm(v):
    if isinstance(v, str):
        return " ".join(v.lower().replace("—", "").replace("tx ", "").split())
    if isinstance(v, float):
        return round(v, 2)
    return v


def diff(g, f):
    out = []
    gd, fd = g.model_dump(), f.model_dump()
    for k in gd:
        if k in SKIP:
            continue
        a, b = norm(gd[k]), norm(fd[k])
        if a == b or (a in (None, "") and b in (None, "")):
            continue
        out.append((k, gd[k], fd[k]))
    ga = sorted((round(t.amount, 2), t.balance) for t in g.transactions)
    fa = sorted((round(t.amount, 2), t.balance) for t in f.transactions)
    if ga != fa:
        out.append(("transactions", f"{len(ga)} rows", f"{len(fa)} rows"))
    if sorted(g.pages_seen or []) != sorted(f.pages_seen or []):
        out.append(("pages_seen", g.pages_seen, f.pages_seen))
    return out


def main():
    ds = Dataset.load()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rows = [a for a in ds.arrivals if "--all" in sys.argv or a["path"].split("/")[0] in args]
    by_folder: dict[str, list] = {}
    for a in rows:
        by_folder.setdefault(a["path"].split("/")[0], []).append(a)
    n_ok = n_bad = 0
    t0 = time.time()
    for folder, fr in by_folder.items():
        res = extract_batch([(ds.resolve(a["path"]), a["path"], a["arrive_at"]) for a in fr])
        for a in fr:
            g = res[a["path"]]
            if isinstance(g, Exception):
                print(f"ERROR  {a['path']}: {type(g).__name__}: {str(g)[:260]}")
                n_bad += 1
                continue
            f = fixture_extract(ds.resolve(a["path"]), a["path"], a["arrive_at"])
            d = diff(g.doc, f.doc)
            tag = "OK   " if not d and g.doc.doc_type == f.doc.doc_type else "DIFF "
            n_ok += tag == "OK   "
            n_bad += tag == "DIFF "
            print(f"{tag} {a['path']}  [{g.doc.doc_type}{'' if g.doc.doc_type == f.doc.doc_type else ' vs fixture ' + f.doc.doc_type}] warn={g.warnings}")
            for k, x, y in d:
                print(f"        {k}: gemini={x!r}  fixture={y!r}")
    print(f"\n{n_ok} identical, {n_bad} differ/errored | {time.time() - t0:.0f}s | {get_client().status()}")


if __name__ == "__main__":
    main()
