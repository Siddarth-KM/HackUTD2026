"""'Accept this issue and continue' on deals with MORE THAN ONE open issue, through the same HTTP endpoint the console uses.

Regression for: the second Accept click looked dead. One of a deal's issues often blocks a LATER stage (e.g. a missing
equipment quote blocks Product while the deal is still in Intake); accepting it changed nothing visible and the console kept
showing its button. Now the reply says it is deferred, the issue is marked accepted, and it really does not block later.
"""
import datetime as dt
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from backend import app as A
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from tests.support.fixture_parser import fixture_extract

BLUE = "Bluebonnet Landscape"     # MISMATCH:amount_requested@Intake + MISSING_DOC:equipment_quote@Product


@pytest.fixture(scope="module")
def ds():
    return Dataset.load()


def client_on(p: Pipeline) -> TestClient:
    A.STATE["pipe"], A.STATE["fixture"] = p, True
    return TestClient(A.app)


def url(folder: str, tail: str = "") -> str:
    return "/api/deals/" + quote(folder, safe="") + tail


def blocking(c, folder):
    return {x["code"]: x for x in c.get(url(folder)).json()["findings"] if x["blocks"]}


def borrower_requests(p, folder):
    return [r for r in p.deals[folder].requests if r.type == "info_request"]


@pytest.fixture()
def wed(ds):
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(days=2))          # Wed 09:00: every sample folder has landed and settled
    return p


def test_later_stage_issue_is_deferred_then_really_does_not_block(wed):
    c = client_on(wed)
    f = blocking(c, BLUE)
    assert f["MISMATCH:amount_requested"]["blocking_now"] and f["MISSING_DOC:equipment_quote"]["later"]
    asked_before = len(borrower_requests(wed, BLUE))

    r = c.post(url(BLUE, "/override"), json={"code": "MISSING_DOC:equipment_quote"}).json()
    assert r["result"]["deferred"] == ["MISSING_DOC:equipment_quote"] and r["deal"]["stage"] == "Intake"
    assert "reaches Product" in r["result"]["message"] and "Still blocking Intake" in r["result"]["message"]
    f = {x["code"]: x for x in r["deal"]["findings"]}
    assert f["MISSING_DOC:equipment_quote"]["accepted"] and not f["MISSING_DOC:equipment_quote"]["later"]

    r = c.post(url(BLUE, "/override"), json={"code": "MISMATCH:amount_requested"}).json()
    assert r["deal"]["stage"] == "Credit" and "Intake -> Credit" in r["result"]["message"]
    assert len(borrower_requests(wed, BLUE)) == asked_before        # accepting never writes to the borrower again

    # walk the human gates; Product must pass without waiting on the accepted quote
    for gate in ("credit_decision", "committee_approval"):
        req = next(q for q in wed.deals[BLUE].requests if q.type == gate and q.answer is None)
        assert c.post(f"/api/humans/{req.id}/answer", json={"answer": "approve"}).status_code == 200
        wed.advance(dt.timedelta(minutes=1))
    d = wed.deals[BLUE]
    assert d.stage == "Committed", (d.stage, d.waiting_on)
    product = next(e for e in d.log if e.stage == "Product")
    assert "MISSING_DOC:equipment_quote" in product.why
    intake = next(e for e in d.log if e.stage == "Intake")
    assert "MISMATCH:amount_requested" in intake.why


def test_accept_all_for_the_current_stage_in_one_click(ds):
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    target = "Garza Family Pharmacy"
    orig = p._ingest_due

    def ingest(t):                                              # Garza arrives without its photo ID and EIN letter
        orig(t)
        d = p.deals.get(target)
        if d:
            d.records = [r for r in d.records if r.doc.doc_type not in ("guarantor_id", "ein_letter")]
    p._ingest_due = ingest
    p.advance(dt.timedelta(hours=6))
    c = client_on(p)
    now = [k for k, x in blocking(c, target).items() if x["blocking_now"]]
    assert sorted(now) == ["MISSING_DOC:ein_letter", "MISSING_DOC:guarantor_id"]
    asked = len(borrower_requests(p, target))

    r = c.post(url(target, "/override"), json={"all_stage": True})
    assert r.status_code == 200
    j = r.json()
    assert sorted(j["result"]["accepted"]) == sorted(now) and j["deal"]["stage"] == "Credit"
    assert len(borrower_requests(p, target)) == asked
    assert len(p.deals[target].accepted) == 2

    # nothing left to accept in Credit -> a clear 400, not a silent no-op
    assert c.post(url(target, "/override"), json={"all_stage": True}).status_code == 400
    # the gate re-open code still goes through the same endpoint
    r = c.post(url(target, "/override"), json={"code": "reopen:Credit"})
    assert r.status_code == 200 and r.json()["result"]["accepted"] == []


def test_unknown_code_is_an_error_and_repeating_an_accept_is_harmless(wed):
    c = client_on(wed)
    assert c.post(url(BLUE, "/override"), json={"code": "MISSING_DOC:nope"}).status_code == 400
    assert c.post(url(BLUE, "/override"), json={}).status_code == 400
    a = c.post(url(BLUE, "/override"), json={"code": "MISSING_DOC:equipment_quote"}).json()
    b = c.post(url(BLUE, "/override"), json={"code": "MISSING_DOC:equipment_quote"}).json()
    assert a["result"]["accepted"] and b["result"]["accepted"] == [] and "Already accepted" in b["result"]["message"]
    assert len(wed.deals[BLUE].accepted) == 1


def test_borrower_is_asked_again_only_for_something_new(wed):
    d = wed.deals[BLUE]
    n = len(borrower_requests(wed, BLUE))
    wed._ask_borrower(d, wed.now, "intake", ["Please send X"], "Intake")
    wed._ask_borrower(d, wed.now, "intake", ["Please send X"], "Intake")           # same item: no repeat
    assert len(borrower_requests(wed, BLUE)) == n + 1
    wed._ask_borrower(d, wed.now, "intake", ["Please send X", "Please send Y"], "Intake")   # one new item: ask
    assert len(borrower_requests(wed, BLUE)) == n + 2
