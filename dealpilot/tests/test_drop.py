"""Weekend drop: new papers on a deal we already hold, and a Collections notice that seeds 'find the rest'."""
import datetime as dt
import json
import pytest
from reportlab.pdfgen import canvas
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from backend.engine.state import parse_iso
from tests.support.fixture_parser import fixture_extract


def collections_pdf(path, subject, body):
    c = canvas.Canvas(str(path))
    c.setProducer("Collections Dept Notice Generator")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(56, 780, "Trinity Commercial Bank — Collections Notice")
    c.setFont("Helvetica", 10)
    c.drawString(56, 750, f"Borrower                          {subject}")
    c.drawString(56, 730, body)
    c.save()


@pytest.fixture()
def drop(tmp_path):
    folder = tmp_path / "drop_folder"
    (folder / "tyler loopwise loan stuff").mkdir(parents=True)
    # Tyler's June export: opens at May's closing (20245.10) and closes at July's opening (28134.91)
    (folder / "tyler loopwise loan stuff" / "export_june_2026.csv").write_text(
        "Frost-Hill Bank - acct ...7720 - Loopwise Labs Inc.\nPosted Date,Details,Amount,Running Bal\n"
        "6/10/26,STRIPE TRANSFER ST-JUNE001,7889.81,28134.91\n", encoding="utf-8")
    (folder / "Collections").mkdir()
    collections_pdf(folder / "Collections" / "notice_2608.pdf", "Trinity Bend Plumbing LLC",
                    "Account H-2608-002 is 30 days past due. Referred to Collections.")
    arr = [
        {"path": "tyler loopwise loan stuff/export_june_2026.csv", "arrive_at": "2026-11-03T08:10-06:00"},
        {"path": "Collections/notice_2608.pdf", "arrive_at": "2026-11-03T08:20-06:00"},
    ]
    return folder, arr


def test_new_paper_on_existing_deal_unblocks_it(drop):
    folder, arr = drop
    ds = Dataset.load()
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(hours=2, minutes=30))                       # Mon ~10:30: Tyler's folder landed, June missing
    tyler = p.deals["tyler loopwise loan stuff"]
    p.advance(dt.timedelta(hours=1))
    assert "MISSING_DOC:bank_statement_2026-06" in p.issues(tyler) and tyler.stage == "Credit"
    assert not any(r.type == "credit_decision" for r in tyler.requests)

    ds.extra_shared.append(folder)
    p.load_arrivals(arr)
    p.advance(parse_iso("2026-11-03T09:30-06:00") - p.now)
    assert "MISSING_DOC:bank_statement_2026-06" not in p.issues(tyler)
    gate = [r for r in tyler.requests if r.type == "credit_decision"]
    assert gate and gate[0].to == "aisha.grant" and gate[0].at == parse_iso("2026-11-03T08:10-06:00")   # re-evaluated the minute the paper landed
    assert not any(a.kind == "stuck" and a.level == "escalation" for a in tyler.alerts)   # unblocked before 150% of SLA


def test_collections_notice_seeds_find_the_rest(drop):
    folder, arr = drop
    ds = Dataset.load()
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(minutes=30))
    assert p.history_flags == [] and p.confirmed_bad == set()
    ds.extra_shared.append(folder)
    p.load_arrivals(arr)
    p.advance(parse_iso("2026-11-03T08:30-06:00") - p.now)
    assert "H-2608-002" in p.confirmed_bad
    # the sibling history deal is surfaced even though no live deal is flagged yet
    assert set(p.history_flags) >= {"H-2608-002", "H-2609-008"}


def test_late_ring_member_is_flagged_on_arrival_once_a_seed_is_confirmed(drop):
    folder, arr = drop
    ds = Dataset.load()
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    ds.extra_shared.append(folder)
    p.load_arrivals([{"path": "Collections/notice_2608.pdf", "arrive_at": "2026-11-02T08:30-06:00"}])
    p.advance(parse_iso("2026-11-02T14:10-06:00") - p.now)             # Ridgeway (ring) lands 13:51
    rid = p.deals["Ridgeway Freight Logistics"]
    assert rid.fraud.flagged and rid.fraud.flagged_at <= parse_iso("2026-11-02T13:54-06:00")
    assert not any(d.fraud.flagged for f, d in p.deals.items() if f != "Ridgeway Freight Logistics")


def test_one_new_paper_does_not_hide_a_second_gap(tmp_path):
    """LSFD lacks BOTH a tax return and an equipment quote. Receiving only the quote must keep the deal blocked:
    a new file must never make known gaps vanish while the folder 're-settles'."""
    from synth import render as R
    ds = Dataset.load()
    folder = tmp_path / "drop"
    (folder / "LSFD_docs").mkdir(parents=True)
    d = {"legal": "Lone Star Family Dental PLLC", "amount": 180000, "eq_items": ["x"],
         "vendor": {"name": "Metroplex Equipment Supply, Inc.", "addr": "4800 Irving Blvd", "phone": "214-555-0166", "bank": "Prairie National Bank",
                    "routing": "111000614", "acct4": "9902", "quote_no": "Q-1", "items": [("Imaging unit", 1, 180000)], "total": 180000}}
    R.equipment_quote(folder / "LSFD_docs" / "SCAN_quote.pdf", d, "Adobe PDF Library 17.0")
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(parse_iso("2026-11-03T15:00-06:00") - p.now)
    lsfd = p.deals["LSFD_docs"]
    assert {"MISSING_DOC:tax_return", "MISSING_DOC:equipment_quote"} <= set(p.issues(lsfd))
    ds.extra_shared.append(folder)
    p.load_arrivals([{"path": "LSFD_docs/SCAN_quote.pdf", "arrive_at": "2026-11-03T15:10-06:00"}])
    p.advance(dt.timedelta(minutes=20))
    assert "MISSING_DOC:equipment_quote" not in p.issues(lsfd)         # the paper that arrived is credited ...
    assert "MISSING_DOC:tax_return" in p.issues(lsfd)                  # ... and the other gap is still open
    assert lsfd.stage == "Credit" and not any(r.type == "credit_decision" for r in lsfd.requests)
