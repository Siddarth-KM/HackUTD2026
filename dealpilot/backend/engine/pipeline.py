"""DealPilot orchestrator: one minute-by-minute simulation loop.

Per tick:  ingest landed files -> validate dirty deals -> cross-deal fraud refresh -> auto-answer (optional personas)
           -> walk each deal through its stage -> SLA / deadline / nudge alerts.

Division of labour (project rule): Gemini READS documents and WRITES memos; deterministic Python makes every
decision (is a document missing, did arithmetic reconcile, may the deal advance, who must be asked).
"""
from __future__ import annotations
import datetime as dt
import re
import statistics
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

from .. import config
from ..dataset import Dataset
from ..fraud.anomaly import AnomalyModel
from ..fraud.features import history_profile, live_profile, known_vendor_accounts
from ..fraud.graph import RingGraph
import time
from ..ingest.extract import DocRecord, extract_batch
from ..ingest.gemini_client import GeminiUnavailable, get_client
from ..validate.completeness import find_missing
from ..validate.consistency import check_consistency, annualised_deposits
from ..validate.facts import merge_facts, statements, current
from ..validate.findings import Finding
from ..validate.old_tricks import run_old_tricks, shell_street_keys
from ..validate.textnorm import entity_match, norm_entity, parse_date
from . import personas as personas_mod
from .memo import write_deal_memos, write_credit_memo
from .routing import Router
from .sla import check_sla
from .state import (ANSWER_OPTIONS, Alert, Deal, Fraud, HumanRequest, StageEntry, STAGES, TZ, iso, parse_iso)

Extractor = Callable[[Path, str, str], DocRecord]            # one file -> DocRecord (tests inject this)
BatchExtractor = Callable[[list], dict]                        # [(abs, rel, arrive)] -> {rel: DocRecord | Exception}
DISBURSE_MINUTES = 15
START = "2026-11-02T08:00"


def money(x) -> str:
    return f"${x:,.0f}" if isinstance(x, (int, float)) else "n/a"


class Pipeline:
    def __init__(self, ds: Dataset, extractor: Optional[Extractor] = None, personas: bool = False,
                 batch_extractor: Optional[BatchExtractor] = None):
        self.ds = ds
        if batch_extractor is None and extractor is not None:      # per-file extractor (tests): adapt to the batch interface
            def batch_extractor(items, _ex=extractor):
                out = {}
                for a, rel, arr in items:
                    try:
                        out[rel] = _ex(a, rel, arr)
                    except Exception as e:
                        out[rel] = e
                return out
        self.batch_extractor: BatchExtractor = batch_extractor or extract_batch
        self._retry_at = 0.0
        self.router = Router(ds)
        self.personas = personas
        # ---- history-derived baselines (computed once)
        self.history_profiles = [history_profile(r, ds.deposits.get(r["deal_id"], [])) for r in ds.history]
        self.known_vendors = known_vendor_accounts(ds.history)
        self.shell_streets = shell_street_keys(ds.history)
        self.known_eins = [(r["ein"], r["legal_name"], r["deal_id"]) for r in ds.history if r.get("ein")]
        self.hist_by_id = {r["deal_id"]: r for r in ds.history}
        self.anomaly = AnomalyModel().fit(self.history_profiles)
        self.medians = self._stage_medians()
        self.reset()

    # ================================================================== lifecycle
    def reset(self, start: str = START):
        self.now = parse_iso(start)
        self.deals: dict[str, Deal] = {}
        self.arr_idx = 0
        self.prefetched: dict[str, DocRecord] = {}
        self.errors: list[dict] = []
        self.rid = 0
        self.requests: list[HumanRequest] = []
        self.fraud_dirty = False
        self.stalled = False
        self.confirmed_bad: set[str] = set()
        self.history_flags: list[str] = []
        self.clusters: list[dict] = []
        self.log: list[str] = []

    def load_arrivals(self, arrivals: list[dict]):
        """Weekend drop / extra files: append to the schedule (new deals AND new papers on existing deals)."""
        known = {a["path"] for a in self.ds.arrivals}
        self.ds.arrivals = sorted(self.ds.arrivals + [a for a in arrivals if a["path"] not in known],
                                  key=lambda a: a["arrive_at"])
        seen = {r.rel_path for d in self.deals.values() for r in d.records} | {p for p, r in self.prefetched.items() if r is None}
        self.arr_idx = 0
        while self.arr_idx < len(self.ds.arrivals) and self.ds.arrivals[self.arr_idx]["path"] in seen                 and parse_iso(self.ds.arrivals[self.arr_idx]["arrive_at"]) <= self.now:
            self.arr_idx += 1

    # ================================================================== clock
    def advance(self, delta: dt.timedelta) -> dt.datetime:
        target = self.now + delta
        self._prefetch(target)
        while self.now < target:
            self.now += dt.timedelta(minutes=1)
            self._tick(self.now)
        return self.now

    def run_until(self, target: dt.datetime) -> dt.datetime:
        if target > self.now:
            self.advance(target - self.now)
        return self.now

    # ================================================================== ingest
    def _prefetch(self, upto: dt.datetime):
        """Extract every file landing before `upto`, grouped per folder so Gemini sees several documents per request.
        This runs AHEAD of sim time but each result is only applied at its file's arrive_at, so nothing leaks early.
        A quota / availability failure leaves the file un-fetched (ingestion stalls and retries); only a permanent
        per-file failure (unreadable file) is skipped and reported."""
        todo = [a for a in self.ds.arrivals[self.arr_idx:] if parse_iso(a["arrive_at"]) <= upto and a["path"] not in self.prefetched]
        if not todo:
            return
        groups: dict[str, list] = defaultdict(list)
        for a in todo:
            groups[a["path"].replace("\\", "/").split("/")[0]].append((self.ds.resolve(a["path"]), a["path"], a["arrive_at"]))

        def work(items):
            try:
                return self.batch_extractor(items)
            except Exception as e:
                return {rel: e for _, rel, _ in items}

        with ThreadPoolExecutor(max_workers=max(1, config.GEMINI_WORKERS)) as ex:
            for res in ex.map(work, groups.values()):
                for rel, rec in res.items():
                    if isinstance(rec, GeminiUnavailable):
                        msg = f"{type(rec).__name__}: {rec}"
                        if not self.errors or self.errors[-1].get("error") != msg:
                            self.errors.append({"path": rel, "error": msg, "retryable": True})
                    elif isinstance(rec, Exception):
                        self.prefetched[rel] = None
                        self.errors.append({"path": rel, "error": f"{type(rec).__name__}: {rec}"})
                    else:
                        self.prefetched[rel] = rec

    def _ingest_due(self, t: dt.datetime):
        while self.arr_idx < len(self.ds.arrivals) and parse_iso(self.ds.arrivals[self.arr_idx]["arrive_at"]) <= t:
            a = self.ds.arrivals[self.arr_idx]
            if a["path"] not in self.prefetched:
                if time.time() >= self._retry_at:                  # extraction failed transiently (e.g. quota): retry, throttled
                    self._retry_at = time.time() + 30
                    self._prefetch(t)
                if a["path"] not in self.prefetched:
                    self.stalled = True
                    return                                          # stall: the file has not (yet) been read
            self.stalled = False
            self.arr_idx += 1
            rec = self.prefetched.get(a["path"])
            if rec is None:
                continue                                            # permanently unreadable: skipped, reported in errors
            folder = rec.folder
            d = self.deals.get(folder)
            at = parse_iso(a["arrive_at"])
            if d is None:
                d = self.deals[folder] = Deal(folder, first_seen=at)
                d.intake_owner = self.router.intake_owner(folder)
            d.records.append(rec)
            d.last_arrival = at
            d.dirty = True
            if rec.doc.doc_type == "collections_notice":
                self._handle_collections(rec, t)

    def _handle_collections(self, rec: DocRecord, t: dt.datetime):
        """A Collections notice names a deal that went bad: treat it as a CONFIRMED seed and go find the rest."""
        subj = rec.doc.subject_name or rec.doc.legal_name or ""
        text = f"{subj} {rec.doc.notice_text or ''}"
        for hid in re.findall(r"H-\d{4}-\d{3}", text):
            if hid in self.hist_by_id:
                self.confirmed_bad.add(hid)
        for r in self.ds.history:
            if subj and entity_match(subj, r["legal_name"]):
                self.confirmed_bad.add(r["deal_id"])
        for d in self.deals.values():
            if subj and entity_match(subj, d.facts.get("legal_name") or "", d.facts.get("dba")):
                self.confirmed_bad.add(d.folder)
        self.fraud_dirty = True

    # ================================================================== tick
    def _tick(self, t: dt.datetime):
        self._ingest_due(t)
        for d in self.deals.values():
            # "Settling" only defers judgement on a folder's FIRST landing (files trickle in over ~20 minutes, so a
            # document is not 'missing' until the folder has been quiet). Once settled it stays settled: a later new
            # paper must be re-evaluated immediately and must never make known gaps vanish while the folder re-settles.
            if not d.settled and d.last_arrival is not None and t >= d.last_arrival + dt.timedelta(minutes=config.SETTLE_MINUTES):
                d.settled, d.dirty = True, True
            if d.dirty:
                self._revalidate(d, t)
        if self.fraud_dirty:
            self._refresh_fraud(t)
        if self.personas:
            self._auto_answer(t)
        for d in self.deals.values():
            self._advance_stage(d, t)
        for d in self.deals.values():
            check_sla(d, t, self.router, d.facts.get("dba") or d.facts.get("legal_name") or d.folder)
        if t.minute == 0 or t.minute == 30:
            self._tick_deadline(t)
        self._tick_nudges(t)

    # ================================================================== validation
    def _revalidate(self, d: Deal, t: dt.datetime):
        d.dirty = False
        d.facts = merge_facts(d.records)
        found = check_consistency(d.records, d.facts)
        if d.settled:
            found = find_missing(d.records, d.facts, t.date()) + found
        d.findings = found
        others = [(o.facts.get("ein"), o.facts.get("legal_name"), o.folder) for o in self.deals.values()
                  if o is not d and o.facts.get("ein") and o.facts.get("legal_name")]
        d.old_tricks = run_old_tricks(d.records, d.facts, self.known_eins + others, self.shell_streets)
        d.vendor_status = self._vendor_status(d)
        self.fraud_dirty = True

    def _vendor_status(self, d: Deal) -> str:
        q = current(d.records, "equipment_quote")
        if not q:
            return "n/a"
        name = norm_entity(q.doc.vendor_name)
        known = self.known_vendors.get(name)
        if known is None:
            return "new"
        return "known" if q.doc.vendor_account_last4 in known else "lookalike"

    def issues(self, d: Deal) -> list[str]:
        out = []
        for f in d.findings + d.old_tricks:
            if f.code not in out:
                out.append(f.code)
        return out

    def blockers(self, d: Deal, stage: str) -> list[Finding]:
        return [f for f in d.findings if f.stage == stage and f.blocks and f.code not in d.overrides]

    # ================================================================== human "accept this issue and continue"
    @staticmethod
    def _stage_idx(stage: Optional[str]) -> int:
        return STAGES.index(stage) if stage in STAGES else 0

    def accept(self, d: Deal, codes: list[str], t: dt.datetime, by: str = "console") -> dict:
        """A human accepts one or more blocking issues. An accepted issue stops blocking its stage; if that stage is
        LATER than where the deal is now, it takes effect when the deal gets there (and the reply says so)."""
        codes = [c for c in dict.fromkeys(codes) if c]
        if not codes:
            raise ValueError("no issue code given")
        open_codes = {f.code: f for f in d.findings if f.blocks}
        bad = [c for c in codes if c not in open_codes and not c.startswith("reopen:")]
        if bad:
            raise ValueError(f"not an open blocking issue on this deal: {', '.join(bad)}")
        from_stage = d.stage
        newly = []
        for c in codes:
            if c in d.overrides:
                continue
            d.overrides.add(c)
            if not c.startswith("reopen:"):
                f = open_codes[c]
                d.accepted.append({"code": c, "stage": f.stage, "text": f.text, "at": iso(t), "by": by})
                newly.append(c)
        self._advance_stage(d, t)
        here = self._stage_idx(d.stage)
        deferred = [c for c in newly if self._stage_idx(open_codes[c].stage) > here]
        still = [f for f in self.blockers(d, d.stage)] if d.stage else []
        parts = []
        if newly:
            parts.append("Accepted " + ", ".join(newly) + ".")
        else:
            parts.append("Already accepted; nothing changed." if not any(c.startswith("reopen:") for c in codes) else "Re-opened.")
        if deferred:
            parts.append("Takes effect when the deal reaches " + ", ".join(sorted({open_codes[c].stage for c in deferred},
                                                                                     key=self._stage_idx)) + ".")
        if d.stage != from_stage:
            parts.append(f"Deal moved {from_stage} -> {d.stage}.")
        if still:
            parts.append(f"Still blocking {d.stage}: " + "; ".join(f.text for f in still) + ".")
        elif d.waiting_on and d.status == "active":
            parts.append(f"Now waiting for: {d.waiting_on}.")
        return {"accepted": newly, "deferred": deferred, "from_stage": from_stage, "to_stage": d.stage,
                "still_blocking": [f.code for f in still], "message": " ".join(parts)}

    def accept_stage(self, d: Deal, t: dt.datetime, by: str = "console") -> dict:
        codes = [f.code for f in self.blockers(d, d.stage)] if d.stage else []
        if not codes:
            raise ValueError(f"nothing is blocking {d.stage or 'this deal'} right now")
        return self.accept(d, codes, t, by)

    def _accepted_note(self, d: Deal, stage: Optional[str] = None) -> str:
        acc = [a for a in d.accepted if stage is None or a["stage"] == stage]
        if not acc:
            return ""
        return (" Proceeded with human-accepted issue(s): "
                + "; ".join(f"{a['code']} (accepted by {a['by']} at {a['at']})" for a in acc) + ".")

    # ================================================================== fraud
    def _refresh_fraud(self, t: dt.datetime):
        self.fraud_dirty = False
        live = [d for d in self.deals.values() if d.records and d.facts.get("legal_name")]
        profs = []
        for d in live:
            p = live_profile(d.folder, d.records, d.facts, self.known_vendors, as_of=t.date())
            d.watch = p.watch
            d.anomaly = self.anomaly.score(p)
            profs.append(p)
        if not profs:
            return
        g = RingGraph(self.history_profiles + profs)
        clusters = g.clusters()
        by_member = {m: c for c in clusters for m in c.members}
        rel = g.relatives(self.confirmed_bad) if self.confirmed_bad else {}
        hist_flags: set[str] = set()
        view = []
        for c in clusters:
            has_live = any(not m.startswith("H-") for m in c.members)
            if has_live:
                view.append({**c.dict(), "reason": g.explain(c), "evidence": g.evidence(c, None),
                             "labels": {m: g.p[m].label for m in c.members}})
                hist_flags |= {m for m in c.members if m.startswith("H-")}
        # A deal can be reached by the strict cluster, or by the relaxed 'relative of a confirmed deal' rule. Either way the
        # team needs the WHOLE group, so link every live deal that lands in the same relaxed component and is itself flagged.
        relaxed = g.edges(6.0, 2) if (self.confirmed_bad or clusters) else []
        comp_parent: dict[str, str] = {}

        def cfind(u):
            comp_parent.setdefault(u, u)
            while comp_parent[u] != u:
                comp_parent[u] = comp_parent[comp_parent[u]]
                u = comp_parent[u]
            return u

        for e in relaxed:
            comp_parent[cfind(e.a)] = cfind(e.b)
        comp_members: dict[str, set[str]] = defaultdict(set)
        for e in relaxed:
            for n in (e.a, e.b):
                comp_members[cfind(n)].add(n)
        will_flag = {d.folder for d in live if d.old_tricks or d.folder in by_member or d.folder in rel or d.fraud.flagged}
        for d in live:
            sources, reasons, linked = [], [], []
            for f in d.old_tricks:
                sources.append(f.code.split(":")[1])
                reasons.append(f"{f.code}: {f.text}. {f.evidence}")
            c = by_member.get(d.folder)
            if c:
                sources.append("CROSS_DEAL")
                reasons.append(g.explain(c, d.folder))
                linked += [m for m in c.members if m != d.folder]
            if d.folder in rel:
                e = rel[d.folder]
                other = e.b if e.a == d.folder else e.a
                sources.append("LINKED_TO_CONFIRMED")
                reasons.append(f"Linked to {other}, which is confirmed fraudulent (shares " +
                               ", ".join(t_.split(":", 1)[1] for t_, _, _ in e.shared[:4]) + ").")
                linked.append(other)
            if sources:
                if d.folder in comp_parent:
                    linked += [m for m in comp_members[cfind(d.folder)] if m != d.folder and m in will_flag]
                self._flag(d, t, sources, reasons, linked)
        for pid, e in rel.items():
            if pid.startswith("H-"):
                hist_flags.add(pid)
        hist_flags |= {s for s in self.confirmed_bad if s.startswith("H-")}
        # only report history deals linked to something we actually flagged
        self.history_flags = sorted(hist_flags)
        self.clusters = view

    def _flag(self, d: Deal, t: dt.datetime, sources: list[str], reasons: list[str], linked: list[str]):
        sig = "|".join(sorted(set(sources))) + "#" + "|".join(sorted(set(linked)))
        f = d.fraud
        linked = list(dict.fromkeys(linked))
        if f.flagged and f.signature == sig:
            return
        if f.released and f.release_sig == sig:
            return                                   # Fraud Ops already looked at exactly this evidence
        re_flag = (not f.flagged) or (f.released and f.release_sig != sig)
        f.signature, f.sources, f.linked_deals = sig, sorted(set(sources)), linked
        f.reason = " ".join(reasons)
        if not re_flag:
            return
        f.flagged, f.flagged_at, f.stage_at_flag = True, t, d.stage or "Intake"
        f.released = False
        funded = d.status == "funded"
        f.held = (d.status == "active")
        urgent = self._urgent(d)
        to = self.router.fraud_ops(t)
        label = d.facts.get("dba") or d.facts.get("legal_name") or d.folder
        msg = (f"{'URGENT. ' if urgent else ''}Please PLACE A HOLD on {label} (RM {self.router.rm(d.folder)}; currently at "
               f"{d.stage or 'Intake'}). " + (f"NOTE: funds have ALREADY gone out for this deal. " if funded else
               "Nothing will advance on this deal until you answer. ") +
               f"Why: {f.reason} " + (f"Linked deals: {', '.join(linked)}. " if linked else "") +
               "Reply 'hold' to place the hold, or 'release' if you judge it genuine.")
        req = self._new_request(d, "fraud_hold", to, t, msg, d.stage or "Intake",
                                meta={"evidence": f.reason, "urgent": urgent})
        f.request_id = req.id
        if d.current():
            d.current().decision = "waiting"
            d.current().waiting_on = f"Fraud Operations decision on hold request ({to})"

    # ================================================================== humans
    def _new_request(self, d: Deal, rtype: str, to: str, t: dt.datetime, msg: str, stage: str, meta: Optional[dict] = None) -> HumanRequest:
        self.rid += 1
        r = HumanRequest(self.rid, d.folder, rtype, to, t, msg, stage, ANSWER_OPTIONS.get(rtype, []), meta=meta or {})
        d.requests.append(r)
        self.requests.append(r)
        return r

    def answer(self, req_id: int, answer: str, note: str = "") -> HumanRequest:
        req = next((r for r in self.requests if r.id == req_id), None)
        if req is None:
            raise KeyError(f"no request {req_id}")
        if req.answer is not None:
            raise ValueError("already answered")
        if req.type == "info_request":
            raise ValueError("info requests go to the borrower; they are resolved by new documents arriving")
        if answer not in req.options:
            raise ValueError(f"answer must be one of {req.options}")
        req.answer, req.answered_at, req.note = answer, self.now, note
        d = self.deals[req.deal]
        if req.type == "fraud_hold":
            self._fraud_answer(d, req, answer)
        self._advance_stage(d, self.now)
        return req

    def _fraud_answer(self, d: Deal, req: HumanRequest, answer: str):
        t = self.now
        f = d.fraud
        if answer == "hold":
            f.confirmed, f.held = True, True
            if d.status == "active":
                self._exit(d, t, "held", f"Fraud hold placed by {req.to}: {f.reason}"[:400])
                d.status = "held"
            self.confirmed_bad.add(d.folder)
            self.fraud_dirty = True                  # now go find the rest
        else:
            f.released, f.held, f.release_sig = True, False, f.signature
            if d.current():
                d.current().decision = "in_progress"
                d.current().waiting_on = ""

    def _auto_answer(self, t: dt.datetime):
        for r in list(self.requests):
            if r.pending:
                a = personas_mod.auto_answer(r, t, self.deals.get(r.deal))
                if a:
                    self.answer(r.id, a, "auto-persona")

    def _urgent(self, d: Deal) -> bool:
        return bool(d.facts.get("needed_by"))

    def _ask_borrower(self, d: Deal, t: dt.datetime, key: str, items: list[str], stage: str):
        # Only write to the borrower when there is something NEW to ask for. A shrinking list (a document arrived, or a
        # human accepted an issue) must not re-send the request: that spammed the borrower once per accepted issue.
        if not items or all((key, it) in d.borrower_items for it in items):
            return
        d.borrower_items |= {(key, it) for it in items}
        sig = key + "|" + "|".join(sorted(items))
        label = d.facts.get("dba") or d.facts.get("legal_name") or d.folder
        msg = (f"Hello {label} - to keep your loan moving we still need the following. "
               + " ".join(f"({i + 1}) {it}." for i, it in enumerate(items))
               + (f" You told us funds are needed by {d.facts['needed_by']}, so we will work on this the moment it arrives."
                  if d.facts.get("needed_by") else ""))
        r = self._new_request(d, "info_request", "borrower", t, msg, stage, meta={"urgent": self._urgent(d)})
        d.borrower_asked[sig] = r.id

    # ================================================================== stage machine
    def _enter(self, d: Deal, stage: str, at: dt.datetime):
        d.stage, d.stage_entered = stage, at
        d.log.append(StageEntry(stage, at))
        d.waiting_on = d.unblock = ""

    def _exit(self, d: Deal, t: dt.datetime, decision: str, why: str):
        e = d.current()
        if not e:
            return
        e.exited_at, e.decision, e.why = t, decision, why
        e.saw = self._saw(d)
        e.waiting_on = ""

    def ensure_memos(self, d: Deal) -> bool:
        """Gemini narrative (saw / decided / why) for every finished stage, in ONE request per deal. Lazy: called on
        export and on demand, not on every stage exit (a free-tier key cannot afford 6 calls per deal)."""
        todo = [e for e in d.log if e.exited_at and not e.memo]
        if not todo:
            return True
        memos = write_deal_memos(self.ds.rules, d.facts, d.findings + d.old_tricks,
                                 [{"stage": e.stage, "entered_at": iso(e.entered_at), "exited_at": iso(e.exited_at),
                                   "decision": {"advanced": "advance", "held": "hold", "declined": "decline"}.get(e.decision, "advance"),
                                   "why": e.why} for e in todo])
        for e in todo:
            e.memo = memos.get(e.stage, e.memo)
        return bool(memos)

    def _saw(self, d: Deal) -> str:
        kinds = sorted({r.doc.doc_type for r in d.records})
        n_st = len(statements(d.records))
        s = f"{len(d.records)} files read ({', '.join(kinds)}; {n_st} monthly bank statements)."
        iss = self.issues(d)
        return s + (f" Issues: {', '.join(iss)}." if iss else " No issues.")

    def _wait(self, d: Deal, waiting: str, unblock: str):
        d.waiting_on, d.unblock = waiting, unblock
        if d.current():
            d.current().decision = "waiting"
            d.current().waiting_on = waiting

    def _advance_stage(self, d: Deal, t: dt.datetime):
        for _ in range(10):
            if d.status != "active" or not d.records:
                return
            if d.stage is None:
                self._enter(d, "Intake", d.first_seen or t)
            if d.frozen:
                to = self.router.fraud_ops(t)
                self._wait(d, f"Fraud Operations decision on the hold request ({to}) - deal is FROZEN, nothing advances",
                           f"{to} answers the fraud_hold request (hold or release)")
                return
            if d.current() and d.current().decision == "waiting":
                d.current().decision = "in_progress"
            handler = getattr(self, f"_h_{d.stage.lower()}")
            if not handler(d, t):
                return

    # ---------------------------------------------------------------- Intake (automated, no human gate)
    def _h_intake(self, d: Deal, t: dt.datetime) -> bool:
        if not d.settled:
            self._wait(d, "all files of the folder to finish landing", "no action needed; review starts once the folder is quiet")
            return False
        bl = self.blockers(d, "Intake")
        self._request_everything_missing(d, t)
        if bl:
            self._wait(d, "; ".join(b.text for b in bl),
                       "borrower supplies or clarifies: " + "; ".join(b.text for b in bl) + " (info request sent to the borrower)")
            return False
        self._exit(d, t, "advanced", "All required Intake documents are present and legible, and the application facts "
                   "(name, EIN, amount, guarantor) agree with the supporting documents." + self._accepted_note(d, "Intake"))
        self._enter(d, "Credit", t)
        return True

    @staticmethod
    def _ask_text(f: Finding) -> str:
        t = f.text[0].upper() + f.text[1:]
        if f.code.startswith("MISMATCH"):
            return f"{t}" + (f" ({f.evidence})" if f.evidence else "") + ". Please confirm which is correct and send a corrected document if needed"
        return t + ". Please send it"

    def _request_everything_missing(self, d: Deal, t: dt.datetime):
        """Ask for ALL missing/clarifying items at once (not stage by stage): slow is bad, especially for urgent deals."""
        items = [self._ask_text(f) for f in d.findings if f.blocks and f.code not in d.overrides]
        self._ask_borrower(d, t, "intake", items, d.stage or "Intake")

    # ---------------------------------------------------------------- generic human gate
    def _gate(self, d: Deal, t: dt.datetime, gtype: str, stage: str, to: str, behalf: Optional[str], summary: str) -> HumanRequest:
        cyc = d.gate_cycle.get(stage, 0)
        for r in d.requests:
            if r.type == gtype and r.stage == stage and r.meta.get("cycle") == cyc:
                return r
        label = d.facts.get("dba") or d.facts.get("legal_name") or d.folder
        head = {"credit_decision": "Credit decision needed", "committee_approval": "Committee approval needed",
                "commitment_signoff": "Commitment letter sign-off needed", "funding_release": "Funding release needed"}[gtype]
        urgent = self._urgent(d)
        msg = (("URGENT - " if urgent else "") + f"{head} for {label} (RM {self.router.rm(d.folder)}). "
               + (f"(Routed to you because {behalf} is out of office.) " if behalf else "")
               + summary + " Options: " + " / ".join(ANSWER_OPTIONS[gtype]) + ".")
        return self._new_request(d, gtype, to, t, msg, stage, meta={"cycle": cyc, "on_behalf_of": behalf, "urgent": urgent})

    def _deal_summary(self, d: Deal) -> str:
        f = d.facts
        dep = annualised_deposits(d.records)
        parts = [f"Request: {money(f.get('amount_requested'))} {f.get('product') or 'loan'}, {f.get('term_months') or 'n/a'} months. "
                 f"Purpose: {f.get('purpose') or f.get('purpose_category') or 'n/a'}.",
                 f"Stated revenue {money(f.get('annual_revenue_stated'))}; bank deposits annualise to {money(dep)}."]
        if f.get("needed_by"):
            parts.append(f"Funds needed by {f['needed_by']}.")
        iss = self.issues(d)
        parts.append("Open issues: " + (", ".join(iss) if iss else "none") + ".")
        parts.append("Fraud screen: " + ("clear (old-trick checks and cross-deal check)." if not d.fraud.flagged else f"FLAGGED - {d.fraud.reason[:200]}"))
        if d.watch:
            parts.append("Watch notes (informational, not blocking): " + "; ".join(d.watch[:3]) + ".")
        if d.anomaly.get("unusual"):
            parts.append("ML watch score: statistically unusual vs the bank's normal book (" +
                         ", ".join(f"{x['feature']} z={x['z']}" for x in d.anomaly.get("top", [])) + ").")
        return " ".join(parts)

    def _resolve_gate(self, d: Deal, t: dt.datetime, req: HumanRequest, stage: str) -> Optional[str]:
        """Returns 'approve' | 'decline' | None (waiting / loop back)."""
        if req.answer is None:
            who = f"{req.to} (assigned: {req.meta['on_behalf_of']}, out of office)" if req.meta.get("on_behalf_of") else req.to
            self._wait(d, f"{req.type.replace('_', ' ')} from {who}",
                       f"{req.to} replies {'/'.join(req.options)} to the request sent {iso(req.at)}")
            return None
        if req.answer == "request_info":
            self._ask_borrower(d, t, f"{stage}-info-{req.meta.get('cycle')}",
                               [req.note or "additional information requested by the credit officer"], stage)
            new_docs = d.last_arrival and req.answered_at and d.last_arrival > req.answered_at
            if new_docs or f"reopen:{stage}" in d.overrides:
                d.overrides.discard(f"reopen:{stage}")
                d.gate_cycle[stage] = req.meta.get("cycle", 0) + 1   # next tick opens a fresh decision request
                return None
            self._wait(d, f"borrower response to the credit officer's information request ({req.note or 'details'})",
                       "borrower sends the requested information; the credit decision is then re-opened")
            return None
        return req.answer

    # ---------------------------------------------------------------- Credit
    def _h_credit(self, d: Deal, t: dt.datetime) -> bool:
        bl = [b for b in self.blockers(d, "Credit")]
        if bl:
            self._request_everything_missing(d, t)
            self._wait(d, "; ".join(b.text for b in bl),
                       "borrower sends the missing item(s): " + "; ".join(b.text for b in bl) + " (info request sent to the borrower)")
            return False
        to, behalf = self.router.credit_officer(d.folder, t)
        req = self._gate(d, t, "credit_decision", "Credit", to, behalf,
                         self._deal_summary(d) + " Known-fraud checks have been run (statement tamper, revenue inflation, ID, duplicate EIN, address).")
        ans = self._resolve_gate(d, t, req, "Credit")
        if ans == "approve":
            self._exit(d, t, "advanced", f"Credit officer {req.to} approved at {iso(req.answered_at)}. " +
                       "All Credit documents present; known-fraud checks run and clear." + self._accepted_note(d, "Credit"))
            self._enter(d, "Committee", t)
            return True
        if ans == "decline":
            self._exit(d, t, "declined", f"Credit officer {req.to} declined. {req.note}")
            d.status = "declined"
        return False

    # ---------------------------------------------------------------- Committee
    def _h_committee(self, d: Deal, t: dt.datetime) -> bool:
        if "credit_memo" not in d.memos:
            d.memos["credit_memo"] = write_credit_memo({
                "facts": {k: v for k, v in d.facts.items() if v not in (None, "")},
                "issues": [{"code": f.code, "text": f.text, "evidence": f.evidence} for f in d.findings + d.old_tricks],
                "annualised_deposits": annualised_deposits(d.records),
                "watch_notes": d.watch, "ml_watch": d.anomaly,
                "fraud": {"flagged": d.fraud.flagged, "reason": d.fraud.reason},
                "credit_decision": next((f"{r.answer} by {r.to}" for r in d.requests if r.type == "credit_decision" and r.answer), None),
            }) or "(credit memo unavailable: Gemini not configured)"
        amount = d.facts.get("amount_requested")
        approver = self.router.committee_approver(amount)
        to = self.router.available(approver, t)
        behalf = approver if to != approver else None
        full = (amount or 0) > self.ds.rules["stages"]["Committee"]["routing"]["delegated_max_amount"]
        req = self._gate(d, t, "committee_approval", "Committee", to, behalf,
                         ("Full committee chair approval (amount >= $250,000). " if full else "Delegated approval (amount < $250,000). ")
                         + "Credit memo: " + (d.memos["credit_memo"] or "")[:900])
        ans = self._resolve_gate(d, t, req, "Committee")
        if ans == "approve":
            self._exit(d, t, "advanced", f"{req.to} approved at {iso(req.answered_at)}; credit memo on file.")
            self._enter(d, "Product", t)
            return True
        if ans == "decline":
            self._exit(d, t, "declined", f"Committee ({req.to}) declined. {req.note}")
            d.status = "declined"
        return False

    # ---------------------------------------------------------------- Product (automated)
    def _h_product(self, d: Deal, t: dt.datetime) -> bool:
        bl = self.blockers(d, "Product")
        if bl:
            self._request_everything_missing(d, t)
            self._wait(d, "; ".join(b.text for b in bl), "borrower sends the vendor quote")
            return False
        if d.vendor_status == "lookalike":
            q = current(d.records, "equipment_quote").doc
            known = sorted(self.known_vendors.get(norm_entity(q.vendor_name), []))
            self._ask_borrower(d, t, "vendor", [
                f"Vendor payment verification: '{q.vendor_name}' matches a vendor we know, but the remit-to account ...{q.vendor_account_last4} "
                f"is not the account on file ({', '.join('...' + a for a in known)}). Please send a voided check or letterhead invoice from the vendor "
                "confirming the remit-to account"], "Product")
            self._wait(d, "vendor identity / remit-to account could not be verified against known vendors",
                       "borrower provides vendor-verified payment details (voided check / vendor letterhead)")
            return False
        why = "Product and pricing consistent with the request (" + f"{d.facts.get('product')}, {money(d.facts.get('amount_requested'))}, {d.facts.get('term_months')} months)."
        if d.vendor_status == "known":
            why += " Vendor and remit-to account match a known vendor."
        elif d.vendor_status == "new":
            why += " Vendor is new to the bank (not in the known-vendor list): flagged for call-back verification at funding release."
        self._exit(d, t, "advanced", why + self._accepted_note(d, "Product"))
        self._enter(d, "Committed", t)
        return True

    # ---------------------------------------------------------------- Committed (+ funding release before Closed)
    def _h_committed(self, d: Deal, t: dt.datetime) -> bool:
        rm = self.router.rm(d.folder)
        req = self._gate(d, t, "commitment_signoff", "Committed", rm, None,
                         "Approved by committee. Please issue the commitment letter and obtain the borrower's signature; 'approve' confirms it is signed by you and the borrower. "
                         + self._deal_summary(d))
        ans = self._resolve_gate(d, t, req, "Committed")
        if ans == "decline":
            self._exit(d, t, "declined", f"Relationship manager {rm} declined to sign off. {req.note}")
            d.status = "declined"
            return False
        if ans != "approve":
            return False
        # ---- closing pre-checks (Closed.required_to_exit) -- done BEFORE entering Closed, because entering Closed sends money
        problems = self._closing_problems(d)
        if problems:
            self._ask_borrower(d, t, "closing", problems, "Closed")
            self._wait(d, "; ".join(problems), "borrower confirms the disbursement account")
            return False
        notes = []
        if d.vendor_status == "new":
            notes.append("The equipment vendor is new to the bank: please verify the vendor and remit-to account by call-back before releasing funds.")
        if "MISSING_DOC:equipment_quote" in d.overrides and not current(d.records, "equipment_quote"):
            notes.append("No vendor quote is on file (a human accepted it as missing): verify the payee before releasing funds.")
        if d.accepted:
            notes.append("Issues accepted by a human earlier in the deal: " + "; ".join(a["code"] for a in d.accepted) + ".")
        q = current(d.records, "equipment_quote")
        dest = (f"to vendor {q.doc.vendor_name} (remit-to {q.doc.vendor_bank} ...{q.doc.vendor_account_last4})" if q
                else "to the borrower's own operating account")
        fr = self._gate(d, t, "funding_release", "Closed", "tasha.reed", None,
                        f"Commitment signed by {rm} at {iso(req.answered_at)}. Final fraud screen: CLEAR. Disbursement {dest}. "
                        f"Amount {money(d.facts.get('amount_requested'))}. " + " ".join(notes) +
                        (" Watch notes on this deal (informational, did not block): " + "; ".join(d.watch[:4]) + "." if d.watch else "") +
                        " Approving RELEASES THE MONEY.")
        a2 = self._resolve_gate(d, t, fr, "Closed")
        if a2 == "decline":
            self._exit(d, t, "declined", f"Funding release declined by tasha.reed. {fr.note}")
            d.status = "declined"
            return False
        if a2 != "approve":
            return False
        self._exit(d, fr.answered_at, "advanced", f"Commitment signed by {rm}; funding released by tasha.reed at {iso(fr.answered_at)}.")
        self._enter(d, "Closed", fr.answered_at)
        return True

    def _closing_problems(self, d: Deal) -> list[str]:
        out = []
        if d.fraud.flagged and not d.fraud.released:
            out.append("final fraud screen is not clear")
        if d.vendor_status == "lookalike":
            out.append("vendor remit-to account is not verified")
        elif d.vendor_status == "n/a":
            last4 = d.facts.get("primary_account_last4")
            accts = {r.doc.account_last4 for rs in statements(d.records).values() for r in rs if r.doc.account_last4}
            if last4 and accts and last4 not in accts:
                out.append(f"Disbursement account ...{last4} on the application does not appear on the bank statements ({', '.join('...' + a for a in sorted(accts))}). Please confirm the account for disbursement")
        return out

    # ---------------------------------------------------------------- Closed (money has gone out)
    def _h_closed(self, d: Deal, t: dt.datetime) -> bool:
        if t >= d.stage_entered + dt.timedelta(minutes=DISBURSE_MINUTES):
            self._exit(d, d.stage_entered + dt.timedelta(minutes=DISBURSE_MINUTES), "funds disbursed",
                       "Final fraud screen clear and disbursement account verified; funds disbursed.")
            d.status = "funded"
        else:
            self._wait(d, "disbursement to settle", "none; wire in progress")
        return False

    # ================================================================== deadlines / nudges
    def _stage_medians(self) -> dict[str, float]:
        by = defaultdict(list)
        for r in self.ds.stage_events:
            try:
                by[r["stage"]].append(float(r["hours_in_stage"]))
            except (KeyError, ValueError):
                pass
        return {s: statistics.median(v) for s, v in by.items() if v}

    def _tick_deadline(self, t: dt.datetime):
        for d in self.deals.values():
            nb = d.facts.get("needed_by")
            if not nb or d.status != "active" or not d.stage:
                continue
            try:
                need = parse_iso(nb)
            except ValueError:
                continue
            idx = STAGES.index(d.stage)
            elapsed = (t - d.stage_entered).total_seconds() / 3600
            remain = max(self.medians.get(d.stage, 8) - elapsed, 0.25 * self.medians.get(d.stage, 8))
            remain += sum(self.medians.get(s, 8) for s in STAGES[idx + 1:])
            projected = t + dt.timedelta(hours=remain)
            if projected <= need:
                continue
            owner = self.router.stage_owner(d.stage, d.folder, d.facts.get("amount_requested"), t)
            rm = self.router.rm(d.folder)
            label = d.facts.get("dba") or d.facts.get("legal_name") or d.folder
            msg = (f"DEADLINE AT RISK: {label} (RM {rm}) needs funds by {iso(need)}; at normal speed the deal would fund around "
                   f"{iso(projected)}. It is in {d.stage} waiting for: {d.waiting_on or 'the next step'}. To unblock: {d.unblock or 'prioritise this deal'}.")
            if not d.deadline_flagged:
                d.deadline_flagged = True
                d.alerts.append(Alert(t, d.folder, d.stage, "alert", owner, msg, [rm], "deadline_risk"))
            elif not d.deadline_escalated and (t - d.stage_entered) >= dt.timedelta(hours=4):
                d.deadline_escalated = True
                d.alerts.append(Alert(t, d.folder, d.stage, "escalation", self.router.escalates_to(owner) or self.router.final_escalation(),
                                      "STILL AT RISK - " + msg, [owner, rm], "deadline_risk"))

    def _tick_nudges(self, t: dt.datetime):
        """An unanswered fraud-hold request is itself a stuck item: remind at +2h (backup), escalate at +4h."""
        for r in self.requests:
            if r.type != "fraud_hold" or not r.pending:
                continue
            d = self.deals[r.deal]
            if d.status not in ("active", "funded"):
                continue
            age = (t - r.at).total_seconds() / 3600
            label = d.facts.get("dba") or d.facts.get("legal_name") or d.folder
            for hours, tag, level, to in ((2, "2h", "escalation", "monica.salas"), (4, "4h", "escalation", "lauren.kim")):
                if age >= hours and tag not in r.nudged:
                    r.nudged.add(tag)
                    tgt = to if r.to != to else "lauren.kim"
                    d.alerts.append(Alert(r.at + dt.timedelta(hours=hours), d.folder, d.stage or "Intake", level, tgt,
                                          f"FRAUD HOLD UNANSWERED for {hours}h: {label} was flagged and {r.to} has not answered. The deal is frozen. "
                                          f"Waiting for: hold/release decision. To unblock: answer request #{r.id}.", [r.to], "fraud_nudge"))

    # ================================================================== views / export
    def deal_view(self, d: Deal) -> dict:
        sla = None
        if d.status == "active" and d.stage:
            hrs = self.router.sla_hours(d.stage, d.facts.get("amount_requested"))
            el = (self.now - d.stage_entered).total_seconds() / 3600
            sla = {"hours": hrs, "elapsed": round(el, 1), "pct": round(100 * el / hrs)}
        return {
            "folder": d.folder, "name": d.facts.get("dba") or d.facts.get("legal_name") or d.folder,
            "legal_name": d.facts.get("legal_name"), "stage": d.stage, "status": d.status, "settled": d.settled,
            "frozen": d.frozen, "waiting_on": d.waiting_on, "unblock": d.unblock, "sla": sla,
            "rm": self.router.rm(d.folder), "amount": d.facts.get("amount_requested"),
            "needed_by": d.facts.get("needed_by"), "issues": self.issues(d),
            "fraud": d.fraud.dict(), "watch": d.watch, "anomaly": d.anomaly, "vendor_status": d.vendor_status,
            "n_files": len(d.records), "first_seen": iso(d.first_seen),
        }

    def _finding_view(self, d: Deal, f: Finding) -> dict:
        v = f.dict()
        acc = f.blocks and f.code in d.overrides
        open_ = f.blocks and not acc and bool(f.stage) and d.status == "active"
        v["accepted"] = acc
        v["blocking_now"] = open_ and f.stage == d.stage
        v["later"] = open_ and self._stage_idx(f.stage) > self._stage_idx(d.stage)
        return v

    def deal_detail(self, d: Deal) -> dict:
        v = self.deal_view(d)
        v.update({
            "facts": d.facts, "findings": [self._finding_view(d, f) for f in d.findings + d.old_tricks],
            "accepted_log": d.accepted,
            "log": [e.dict() for e in d.log], "requests": [r.dict() for r in d.requests],
            "alerts": [a.dict() for a in d.alerts], "credit_memo": d.memos.get("credit_memo"),
            "docs": [{"file": r.name, "type": r.doc.doc_type, "arrived": r.arrive_at, "producer": r.meta.get("producer"),
                      "warnings": r.warnings, "legible": r.doc.legible} for r in sorted(d.records, key=lambda r: r.arrive_at)],
        })
        return v

    def export(self, set_name: str = "sample", with_memos: bool = True) -> dict:
        if with_memos:
            for d in self.deals.values():
                try:
                    self.ensure_memos(d)
                except Exception:
                    pass
        deals = {}
        for folder, d in self.deals.items():
            f = d.facts
            nb = f.get("needed_by")
            try:
                nb = iso(parse_iso(nb)) if nb else None
            except ValueError:
                nb = None
            deals[folder] = {
                "extracted": {
                    "legal_name": f.get("legal_name"), "ein": f.get("ein"), "amount_requested": f.get("amount_requested"),
                    "purpose_category": f.get("purpose_category"), "product": f.get("product"), "term_months": f.get("term_months"),
                    "guarantor_name": f.get("guarantor_name"), "annual_revenue_stated": f.get("annual_revenue_stated"), "needed_by": nb,
                },
                "issues": self.issues(d),
                "stage_log": [{"stage": e.stage, "entered_at": iso(e.entered_at), "exited_at": iso(e.exited_at),
                               "decision": e.decision, "why": e.why, "saw": e.saw, "memo": e.memo} for e in d.log],
                "human_requests": [r.dict() for r in d.requests],
                "alerts": [{"at": iso(a.at), "stage": a.stage, "level": a.level, "to": a.to, "message": a.message}
                           for a in d.alerts],
                "fraud": {**d.fraud.dict(), "flagged": d.fraud.flagged, "held": d.fraud.held,
                          "watch_notes": d.watch, "ml_watch": d.anomaly},
            }
        return {"team": config.TEAM_NAME, "set": set_name, "deals": deals, "history_flags": self.history_flags}
