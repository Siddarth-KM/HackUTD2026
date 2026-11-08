"""Headless run: process a whole data pack and write the submission JSON (SUBMISSION_FORMAT.md).

    python -m backend.run --data data\\participant --out out\\sample.json --set sample --personas
    python -m backend.run --data D:\\hidden_pack --out out\\hidden.json --set hidden --until 2026-11-09T18:00-06:00

--personas  answer human requests with the scripted demo personas (otherwise requests simply stay pending, which is
            what happens when nobody answers: SLA alerts and escalations then fire as they would in production)
--drop-arrivals / --drop-folder  append a weekend drop (new deals AND new papers on existing deals) before running
"""
from __future__ import annotations
import argparse, datetime as dt, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from backend.engine.state import iso, parse_iso
from backend.ingest.gemini_client import get_client


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None, help="data pack folder (rules, contacts, history, sim, shared_folder)")
    ap.add_argument("--out", default="dealpilot_submission.json")
    ap.add_argument("--set", default="sample", dest="set_name")
    ap.add_argument("--until", default=None, help="stop the sim clock here (default: last arrival + 48h)")
    ap.add_argument("--personas", action="store_true")
    ap.add_argument("--drop-arrivals", default=None)
    ap.add_argument("--drop-folder", default=None)
    ap.add_argument("--no-memos", action="store_true", help="skip the Gemini stage memos at export")
    a = ap.parse_args()

    ds = Dataset.load(a.data)
    pipe = Pipeline(ds, personas=a.personas)
    if a.drop_folder:
        ds.extra_shared.append(Path(a.drop_folder))
    if a.drop_arrivals:
        pipe.load_arrivals([json.loads(l) for l in Path(a.drop_arrivals).read_text(encoding="utf-8").splitlines() if l.strip()])
    last = max((parse_iso(x["arrive_at"]) for x in ds.arrivals), default=pipe.now)
    end = parse_iso(a.until) if a.until else last + dt.timedelta(hours=48)
    step = dt.timedelta(hours=6)
    while pipe.now < end:
        pipe.advance(min(step, end - pipe.now))
        if pipe.stalled and not pipe.personas and pipe.errors and pipe.errors[-1].get("retryable"):
            print("Gemini unavailable (quota?) -> ingestion stalled:", pipe.errors[-1]["error"][:240], file=sys.stderr)
            break
    exp = pipe.export(a.set_name, with_memos=not a.no_memos)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(exp, indent=1, default=str), encoding="utf-8")
    flagged = [f for f, d in pipe.deals.items() if d.fraud.flagged]
    print(f"clock {iso(pipe.now)} | {len(pipe.deals)} deals | flagged {len(flagged)}: {flagged} | history_flags {pipe.history_flags}")
    print(f"gemini {get_client().status()}")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
