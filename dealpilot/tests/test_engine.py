"""Routing, SLA, human-gate, fraud-graph and end-to-end tests on the REAL sample pack (fixture extractor, no Gemini)."""
import datetime as dt
import re
import pytest
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from backend.engine.routing import Router
from backend.engine.state import parse_iso, iso, STAGES
from backend.fraud.features import history_profile
from backend.fraud.graph import RingGraph
from tests.support.fixture_parser import fixture_extract

RING = {"Ridgeway Freight Logistics", "Pecan Grove Catering", "Summit Peak Flooring"}


@pytest.fixture(scope="module")
def ds():
    return Dataset.load()


@pytest.fixture(scope="module")
def week(ds):
    p = Pipeline(ds, extractor=fixture_extract, personas=True)
    p.advance(dt.timedelta(hours=5 * 24 + 10))
    return p


# ------------------------------------------------------------------ routing
def test_out_of_office_routes_to_backup(ds):
    r = Router(ds)
    assert r.credit_officer("Priya's Bakery", parse_iso("2026-11-03T09:00-06:00")) == ("marcus.lee", "dana.whitfield")
    assert r.credit_officer("Priya's Bakery", parse_iso("2026-11-02T09:00-06:00"))[0] == "dana.whitfield"   # before her leave starts
    assert r.credit_officer("Priya's Bakery", parse_iso("2026-11-06T18:30-06:00"))[0] == "dana.whitfield"   # after it ends


def test_committee_routing_by_amount_and_sla(ds):
    r = Router(ds)
    assert r.committee_approver(249_999.99) == "priscilla.nguyen"
    assert r.committee_approver(250_000) == "harold.benson"
    assert r.sla_hours("Committee", 100_000) == 24 and r.sla_hours("Committee", 300_000) == 48


# ------------------------------------------------------------------ SLA timers: exactly 100% / 150% / 200%
def test_sla_alert_levels_and_content(week):
    d = week.deals["tyler loopwise loan stuff"]
    got = [(a.level, a.to) for a in d.alerts if a.kind == "stuck"]
    assert [g[0] for g in got] == ["alert", "escalation", "escalation"]
    assert [g[1] for g in got] == ["aisha.grant", "susan.ortiz", "lauren.kim"]      # owner -> owner's escalates_to -> lauren.kim
    entered = d.log[-1].entered_at
    assert [(a.at - entered).total_seconds() / 3600 for a in d.alerts if a.kind == "stuck"] == [48.0, 72.0, 96.0]
    msg = d.alerts[0].message
    for needle in ("Loopwise Labs", "elena.ruiz", "Credit", "48.0h", "bank statement for 2026-06"):
        assert needle in msg                                                       # whose deal, stage+duration, waiting for, unblock


# ------------------------------------------------------------------ the sample, end to end
def issues(week, f):
    return set(week.issues(week.deals[f]))


def test_read_issues_on_sample(week):
    assert issues(week, "Westfield Print & Sign") == {"MISMATCH:ein"}
    assert issues(week, "Oakline Auto") == {"MISSING_PAGE:bank_statement_2026-08"}
    assert issues(week, "tyler loopwise loan stuff") == {"MISSING_DOC:bank_statement_2026-06"}      # 7004 accepted: young company
    assert "MISSING_DOC:tax_return" in issues(week, "LSFD_docs")
    assert "MISMATCH:amount_requested" in issues(week, "Bluebonnet Landscape")
    assert issues(week, "Granite Bay Building Supply") == {"OLD_TRICK:STMT_TAMPER", "OLD_TRICK:REV_INFLATION"}
    for clean in ("Garza Family Pharmacy", "Okafor Advisory - James", "Harbor Tea Co", "Priya's Bakery"):
        assert issues(week, clean) == set(), clean


def test_new_trick_ring_found_early_and_nobody_else_blocked(week):
    flagged = {f for f, d in week.deals.items() if d.fraud.flagged}
    assert flagged == RING | {"Granite Bay Building Supply"}
    rid = week.deals["Ridgeway Freight Logistics"]
    assert rid.fraud.stage_at_flag == "Intake"                                       # before Credit: caught at the 4th deal
    assert (rid.fraud.flagged_at - rid.first_seen).total_seconds() <= 10 * 60
    assert {"H-2608-002", "H-2609-008"} <= set(rid.fraud.linked_deals)
    assert set(week.history_flags) == {"H-2608-002", "H-2609-008"}                   # "help the team find the rest"
    assert "CROSS_DEAL" in rid.fraud.sources and not rid.old_tricks                   # passes every OLD check: only the graph sees it


def test_decoys_are_not_blocked(week):
    for f in ("Garza Family Pharmacy", "Okafor Advisory - James", "Harbor Tea Co", "Priya's Bakery", "tyler loopwise loan stuff",
              "Westfield Print & Sign", "Oakline Auto", "LSFD_docs", "Bluebonnet Landscape"):
        assert not week.deals[f].fraud.flagged, f


def test_missing_documents_wait_without_rejecting_or_flagging(week):
    for f, stage in (("tyler loopwise loan stuff", "Credit"), ("Oakline Auto", "Credit"), ("LSFD_docs", "Credit"), ("Westfield Print & Sign", "Intake")):
        d = week.deals[f]
        assert d.status == "active" and d.stage == stage and not d.fraud.flagged
        assert any(r.type == "info_request" and r.to == "borrower" for r in d.requests)
        assert not any(r.type == "credit_decision" for r in d.requests) or stage != "Credit"    # nobody asked to decide on an incomplete file


def test_humans_asked_in_order_before_each_sign_off(week):
    d = week.deals["Garza Family Pharmacy"]
    assert [r.type for r in d.requests if r.type != "info_request"] == ["credit_decision", "committee_approval", "commitment_signoff", "funding_release"]
    assert [e.stage for e in d.log] == STAGES and d.status == "funded"
    by = {r.type: r for r in d.requests}
    closed = next(e for e in d.log if e.stage == "Closed")
    assert by["funding_release"].answered_at <= closed.entered_at                     # money goes out only after release
    assert d.log[0].exited_at <= by["credit_decision"].at


def test_urgent_deal_funded_before_deadline_with_backup_officer(week):
    d = week.deals["Priya's Bakery"]
    cd = next(r for r in d.requests if r.type == "credit_decision")
    assert cd.to == "marcus.lee" and cd.meta["on_behalf_of"] == "dana.whitfield"
    assert "URGENT" in cd.message
    closed = next(e for e in d.log if e.stage == "Closed")
    assert closed.exited_at < parse_iso(d.facts["needed_by"])


def test_large_loan_goes_to_committee_chair(week):
    cm = next(r for r in week.deals["Okafor Advisory - James"].requests if r.type == "committee_approval")
    assert cm.to == "harold.benson"


def test_flagged_deals_never_reach_closed_and_funding_never_precedes_hold(week):
    for f in RING | {"Granite Bay Building Supply"}:
        d = week.deals[f]
        assert "Closed" not in [e.stage for e in d.log] and d.status == "held"
        assert not any(r.type == "funding_release" for r in d.requests)


# ------------------------------------------------------------------ graph calibration
def test_history_alone_contains_only_the_two_known_ring_seeds(ds):
    g = RingGraph([history_profile(r, ds.deposits.get(r["deal_id"], [])) for r in ds.history])
    assert [c.members for c in g.clusters()] == [["H-2608-002", "H-2609-008"]]


def test_unconfirmed_single_shared_attribute_does_not_link(ds):
    profs = [history_profile(r, ds.deposits.get(r["deal_id"], [])) for r in ds.history]
    g = RingGraph(profs)
    # the best honest pair in a year of history must sit far below the threshold
    from backend import config
    from backend.fraud.graph import fact_group
    from itertools import combinations
    from collections import defaultdict
    best = defaultdict(dict)
    for t, pids in g.index.items():
        if len(pids) >= 2 and g.weight(t) >= config.STRONG_ATTR_MIN_WEIGHT and len(pids) <= max(12, g.N // 10):
            for a, b in combinations(sorted(pids), 2):
                best[(a, b)][fact_group(t)] = max(best[(a, b)].get(fact_group(t), 0), g.weight(t))
    honest = [sum(v.values()) for (a, b), v in best.items() if {a, b} != {"H-2608-002", "H-2609-008"}]
    assert max(honest) < config.CLUSTER_MIN_SCORE * 0.7


# ------------------------------------------------------------------ export format
def test_export_matches_submission_format(week):
    exp = week.export("sample", with_memos=False)
    assert set(exp) >= {"team", "set", "deals", "history_flags"}
    ok_issue = re.compile(r"^(MISSING_DOC|MISSING_PAGE|MISMATCH|OLD_TRICK):[A-Za-z0-9_\-]+$")
    types = {"credit_decision", "committee_approval", "commitment_signoff", "funding_release", "fraud_hold", "fraud_release", "info_request"}
    for f, d in exp["deals"].items():
        assert set(d["extracted"]) >= {"legal_name", "ein", "amount_requested", "purpose_category", "product", "term_months",
                                      "guarantor_name", "annual_revenue_stated", "needed_by"}
        assert all(ok_issue.match(i) for i in d["issues"]), d["issues"]
        for e in d["stage_log"]:
            assert e["stage"] in STAGES and e["entered_at"]
        for r in d["human_requests"]:
            assert r["type"] in types and r["to"] and r["message"]
        for a in d["alerts"]:
            assert a["level"] in ("alert", "escalation") and a["to"] and a["message"]
        assert set(d["fraud"]) >= {"flagged", "flagged_at", "stage_at_flag", "held", "reason", "linked_deals"}
    assert exp["deals"]["Priya's Bakery"]["extracted"]["needed_by"] == "2026-11-06T15:00-06:00"


def test_clock_cannot_leak_future_files(ds):
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(hours=2, minutes=15))                                      # 08:00 -> 10:15 Monday
    assert set(p.deals) == {"Garza Family Pharmacy", "tyler loopwise loan stuff"}     # Oakline lands at 11:41
    assert all(parse_iso(r.arrive_at) <= p.now for d in p.deals.values() for r in d.records)
