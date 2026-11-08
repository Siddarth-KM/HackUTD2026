"""Dev harness: run the whole sim week on the sample pack with the TEST fixture extractor (no Gemini key needed).

    .venv\\Scripts\\python.exe tests\\run_sample.py [--no-personas] [--hours N]
"""
from __future__ import annotations
import argparse, datetime as dt, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from backend.engine.state import iso
from tests.support.fixture_parser import fixture_extract


def build(personas=True, data=None, arrivals=None, gemini=False) -> Pipeline:
    ds = Dataset.load(data, arrivals)
    return Pipeline(ds, extractor=None if gemini else fixture_extract, personas=personas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-personas", action="store_true")
    ap.add_argument("--hours", type=float, default=5 * 24 + 10)
    ap.add_argument("--json", default="")
    ap.add_argument("--gemini", action="store_true", help="use REAL Gemini extraction instead of the test fixture")
    a = ap.parse_args()
    p = build(personas=not a.no_personas, gemini=a.gemini)
    p.advance(dt.timedelta(hours=a.hours))
    print("NOW", iso(p.now), "| extraction errors:", p.errors[:3])
    for f, d in p.deals.items():
        v = p.deal_view(d)
        print(f"\n== {f:30s} stage={v['stage']} status={v['status']} flagged={d.fraud.flagged} held={d.fraud.held}")
        print("   issues:", v["issues"])
        if d.fraud.flagged:
            print("   FRAUD @", iso(d.fraud.flagged_at), "stage", d.fraud.stage_at_flag, "sources", d.fraud.sources, "linked", d.fraud.linked_deals)
        for e in d.log:
            print(f"   {e.stage:10s} {iso(e.entered_at)} -> {iso(e.exited_at)}  {e.decision}")
        print("   requests:", [(r.type, r.to, r.answer) for r in d.requests])
        print("   alerts:", [(iso(x.at), x.level, x.to, x.kind) for x in d.alerts])
        if d.watch:
            print("   watch:", d.watch)
    print("\nHISTORY FLAGS:", p.history_flags)
    if a.json:
        Path(a.json).write_text(json.dumps(p.export(), indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
