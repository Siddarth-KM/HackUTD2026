"""Scorer that mimics the judging rubric (READ / MOVE / FRAUD) against a synthetic pack's ground_truth.json.

    .venv\\Scripts\\python.exe -m synth.score data\\synth\\template_3
    .venv\\Scripts\\python.exe -m synth.score --all            # every trick x 2 seeds, generated on the fly
    add --gemini to extract with real Gemini instead of the test fixture parser
"""
from __future__ import annotations
import argparse, datetime as dt, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import config
from backend.engine.state import parse_iso, STAGES


def _eq(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 0.5
    return " ".join(str(a).lower().split()) == " ".join(str(b).lower().split())


def score(exp: dict, truth: dict, end: dt.datetime, sla: dict) -> dict:
    deals, tdeals = exp["deals"], truth["deals"]
    rep: dict = {"missing_deals": [f for f in tdeals if f not in deals]}

    # ---------------------------------------------------------------- READ
    fields = ok = 0
    bad = []
    for f, t in tdeals.items():
        if f not in deals:
            continue
        for k, v in t["extracted"].items():
            if v is None:
                continue
            fields += 1
            if _eq(deals[f]["extracted"].get(k), v):
                ok += 1
            else:
                bad.append((f, k, deals[f]["extracted"].get(k), v))
    tp = fp = fn = 0
    issue_errs = []
    for f, t in tdeals.items():
        if f not in deals:
            continue
        got, want = set(deals[f]["issues"]), set(t["expected_issues"])
        if t["label"] == "fraud" and t.get("trick") not in (None, "REV_INFLATION"):
            want = set()                       # the new trick has no listed issue code
        tp += len(got & want)
        fp += len(got - want)
        fn += len(want - got)
        if got != want:
            issue_errs.append((f, sorted(got - want), sorted(want - got)))
    rep["READ"] = {"field_accuracy": round(ok / max(fields, 1), 4), "fields": fields, "field_errors": bad[:8],
                   "issue_precision": round(tp / max(tp + fp, 1), 3), "issue_recall": round(tp / max(tp + fn, 1), 3),
                   "issue_mismatches": issue_errs}

    # ---------------------------------------------------------------- MOVE
    problems = []
    for f, d in deals.items():
        log = d["stage_log"]
        names = [e["stage"] for e in log]
        if names != STAGES[:len(names)]:
            problems.append((f, "stages out of order", names))
        want = set(tdeals[f]["expected_issues"]) if f in tdeals else set()
        blocking = {i for i in want if i.startswith("MISSING") or i == "MISMATCH:ein" or i == "MISMATCH:amount_requested"}
        if blocking and len({"Committee", "Product", "Committed", "Closed"} & set(names)) and not any(r["answer"] for r in d["human_requests"] if r["type"] == "credit_decision") is False:
            if ("MISSING" in " ".join(blocking)) and "Committee" in names:
                problems.append((f, "advanced to Committee while a required document was missing", sorted(blocking)))
        reqs = {r["type"]: r for r in d["human_requests"] if r["answer"]}
        gate_for = {"Credit": "credit_decision", "Committee": "committee_approval", "Committed": "commitment_signoff"}
        for e in log:
            g = gate_for.get(e["stage"])
            if g and e["decision"] == "advanced":
                r = reqs.get(g)
                if not r or r["answered_at"] > e["exited_at"]:
                    problems.append((f, f"left {e['stage']} without a {g} answer", None))
        if "Closed" in names:
            fr = [r for r in d["human_requests"] if r["type"] == "funding_release" and r["answer"] == "approve"]
            ce = next(e for e in log if e["stage"] == "Closed")
            if not fr or fr[0]["answered_at"] > ce["entered_at"]:
                problems.append((f, "entered Closed without an approved funding_release", None))
        if log and log[-1]["exited_at"] is None:                 # still waiting: must have alerted once past the SLA
            e = log[-1]
            lim = sla.get(e["stage"], 48) * 1.0
            hrs = (end - parse_iso(e["entered_at"])).total_seconds() / 3600
            if hrs >= lim and not any(a["stage"] == e["stage"] and a["level"] == "alert" for a in d["alerts"]):
                problems.append((f, f"stuck {hrs:.0f}h in {e['stage']} (SLA {lim}h) with no alert", None))
            if hrs >= 1.5 * lim and not any(a["stage"] == e["stage"] and a["level"] == "escalation" for a in d["alerts"]):
                problems.append((f, f"stuck {hrs:.0f}h in {e['stage']} with no escalation", None))
        nb = tdeals.get(f, {}).get("extracted", {}).get("needed_by")
        if nb:
            funded = next((e for e in log if e["stage"] == "Closed" and e["decision"] == "funds disbursed"), None)
            if not funded or parse_iso(funded["exited_at"]) > parse_iso(nb):
                problems.append((f, f"missed the funds-needed-by date {nb}", None))
    rep["MOVE"] = {"problems": problems, "n": len(problems)}

    # ---------------------------------------------------------------- FRAUD
    F = {f for f, t in tdeals.items() if t["label"] == "fraud"}
    ring = set(truth.get("ring", []))
    P = {f for f, d in deals.items() if d["fraud"]["flagged"]}
    false_holds = sorted(P - F)
    missed = sorted(F - P)
    late = []
    for f in F & P:
        d = deals[f]
        closed = next((e for e in d["stage_log"] if e["stage"] == "Closed"), None)
        if closed and parse_iso(d["fraud"]["flagged_at"]) >= parse_iso(closed["entered_at"]):
            late.append(f)
    arrivals_order = sorted(deals, key=lambda f: deals[f]["stage_log"][0]["entered_at"] if deals[f]["stage_log"] else "z")
    first_ring_flag = None
    if ring & P:
        rf = min(ring & P, key=lambda f: deals[f]["fraud"]["flagged_at"])
        first_ring_flag = {"deal": rf, "arrival_rank": arrivals_order.index(rf) + 1,
                           "minutes_after_its_first_file": round((parse_iso(deals[rf]["fraud"]["flagged_at"]) - parse_iso(deals[rf]["stage_log"][0]["entered_at"])).total_seconds() / 60)}
    link_hits = tot = 0
    for f in ring & P:
        want = set(truth["deals"][f].get("ring", []))
        tot += len(want)
        link_hits += len(want & set(deals[f]["fraud"]["linked_deals"]))
    seeds = set(truth.get("history_seeds", []))
    rep["FRAUD"] = {
        "fraud_deals": len(F), "caught": len(F & P), "missed": missed, "false_holds": false_holds, "n_false_holds": len(false_holds),
        "good_deals": len(tdeals) - len(F), "caught_after_money_out": late, "first_ring_flag": first_ring_flag,
        "ring_linked_recall": round(link_hits / max(tot, 1), 3) if tot else None,
        "history_seed_recall": round(len(seeds & set(exp["history_flags"])) / len(seeds), 3) if seeds else None,
        "history_flags": exp["history_flags"],
    }
    return rep


def run_pack(path: Path, gemini=False, personas=True) -> dict:
    from backend.dataset import Dataset
    from backend.engine.pipeline import Pipeline
    ds = Dataset.load(path)
    if gemini:
        pipe = Pipeline(ds, personas=personas)
    else:
        from tests.support.fixture_parser import fixture_extract
        pipe = Pipeline(ds, extractor=fixture_extract, personas=personas)
    pipe.advance(dt.timedelta(hours=5 * 24 + 10))
    exp = pipe.export(path.name, with_memos=False)
    truth = json.loads((path / "ground_truth.json").read_text(encoding="utf-8"))
    sla = {s: ds.rules["stages"][s]["sla_hours"] for s in STAGES}
    rep = score(exp, truth, pipe.now, sla)
    rep["trick"], rep["errors"] = truth["trick"], pipe.errors[:3]
    return rep


def show(name: str, r: dict):
    f, rd, mv = r["FRAUD"], r["READ"], r["MOVE"]
    print(f"\n=== {name}  (trick: {r['trick']}) ===")
    print(f"READ   fields {rd['field_accuracy']:.1%} of {rd['fields']} | issues precision {rd['issue_precision']} recall {rd['issue_recall']}")
    for x in rd["issue_mismatches"]:
        print("         issue mismatch:", x)
    for x in rd["field_errors"]:
        print("         field error:", x)
    print(f"MOVE   {mv['n']} problem(s)")
    for x in mv["problems"]:
        print("         ", x)
    print(f"FRAUD  caught {f['caught']}/{f['fraud_deals']} | FALSE HOLDS {f['n_false_holds']} of {f['good_deals']} good {f['false_holds']} | missed {f['missed']}")
    print(f"       first ring flag: {f['first_ring_flag']} | linked recall {f['ring_linked_recall']} | history seeds recall {f['history_seed_recall']} | after-money-out {f['caught_after_money_out']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--gemini", action="store_true")
    ap.add_argument("--seeds", default="11,12")
    ap.add_argument("--no-personas", action="store_true")
    a = ap.parse_args()
    if a.all:
        from synth.generate import Gen
        summary = []
        for trick in ["identity", "vendor_rail", "ledger", "circular", "template", "two_family"]:
            for seed in [int(x) for x in a.seeds.split(",")]:
                out = config.ROOT / "data" / "synth" / f"{trick}_{seed}"
                Gen(seed, out, trick, 0, history_seed=(seed % 2 == 0)).write_pack()
                r = run_pack(out, a.gemini, not a.no_personas)
                show(f"{trick}_{seed}", r)
                summary.append((trick, seed, r))
        print("\n================ SUMMARY ================")
        print(f"{'trick':12s} seed  caught  false-holds  missed  first-flag(rank,min)  read-field  move-problems")
        for trick, seed, r in summary:
            f = r["FRAUD"]
            ff = f["first_ring_flag"]
            print(f"{trick:12s} {seed:4d}  {f['caught']}/{f['fraud_deals']}     {f['n_false_holds']}            {len(f['missed'])}       "
                  f"{(str(ff['arrival_rank']) + ',' + str(ff['minutes_after_its_first_file'])) if ff else '-':18s}   {r['READ']['field_accuracy']:.1%}     {r['MOVE']['n']}")
        return
    r = run_pack(Path(a.pack), a.gemini, not a.no_personas)
    show(Path(a.pack).name, r)


if __name__ == "__main__":
    main()
