"""Unit tests for the deterministic decision logic (no Gemini, no pipeline)."""
import datetime as dt
import pytest
from backend.ingest.extract import DocRecord
from backend.models import ExtractedDoc, Txn
from backend.validate import textnorm as T
from backend.validate.completeness import expected_months, find_missing, is_young
from backend.validate.consistency import check_consistency
from backend.validate.facts import merge_facts
from backend.validate import old_tricks as OT


def rec(doc_type, name="x.pdf", arrive="2026-11-02T09:00-06:00", **kw) -> DocRecord:
    return DocRecord(f"F/{name}", "F", name, arrive, "fixture", {"producer": "p"}, ExtractedDoc(doc_type=doc_type, **kw), [], "", doc_type)


def stmt(ym, opening, txns, deposits=None, withdrawals=None, closing=None, pages=(1,), expected=1):
    """txns: [(kind, amount)] -> a statement whose running balances are derived honestly."""
    bal, rows = opening, []
    for i, (kind, amt) in enumerate(txns):
        bal = round(bal + amt if kind == "credit" else bal - amt, 2)
        rows.append(Txn(date=f"{ym}-{i + 1:02d}", description=f"T{i}", amount=amt, balance=bal, direction=kind))
    dep = sum(a for k, a in txns if k == "credit")
    wd = sum(a for k, a in txns if k == "debit")
    return rec("bank_statement", f"{ym}.pdf", period_start=f"{ym}-01", opening_balance=opening,
               total_deposits=deposits if deposits is not None else round(dep, 2),
               total_withdrawals=withdrawals if withdrawals is not None else round(wd, 2),
               closing_balance=closing if closing is not None else bal, transactions=rows,
               pages_seen=list(pages), pages_expected=expected)


# ------------------------------------------------------------------ matching
@pytest.mark.parametrize("a,b,ok", [
    ("Bob Kline", "Robert Allen Kline", True), ("Maria Elena Garza", "Maria Garza", True), ("Kate Lin", "Katherine Lin", True),
    ("Robert Kline", "Robert Cline", False), ("Priya Raman", "Raman, Priya", True), ("Jim Okafor", "James Chukwuemeka Okafor", True),
    ("Alice Smith", "Bob Jones", False)])
def test_person_match(a, b, ok):
    assert T.person_match(a, b) is ok


def test_entity_and_dba_match():
    assert T.entity_match("Harbor Tea Co LLC", "Harbor Tea Company LLC")
    assert T.entity_match("Sunrise Rasoi Bakery LLC", "Priya's Bakery", dba="Priya's Bakery")
    assert not T.entity_match("Mesa Roofing LLC", "Cedar Dental Group LLC")


def test_address_requires_same_number_and_zip():
    assert T.addr_match("2818 Swiss Ave Apt 7, Dallas, TX 75204", "2818 Swiss Avenue Apartment 7, Dallas TX 75204")
    assert not T.addr_match("2818 Swiss Ave, Dallas, TX 75204", "2819 Swiss Ave, Dallas, TX 75204")


def test_preparer_credentials_ignored_and_self_prepared_is_not_a_preparer():
    assert T.norm_preparer("Owen Price, CPA") == T.norm_preparer("Owen Price")
    assert T.norm_preparer("Self-prepared") == "" and T.norm_preparer("(owner)") == ""


# ------------------------------------------------------------------ completeness: missing != fraud != rejection
NOW = dt.date(2026, 11, 2)


def test_expected_months_are_the_six_full_months_before_now():
    assert expected_months(NOW) == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert expected_months(dt.date(2027, 2, 10))[0] == "2026-08"


def test_young_business_may_send_7004_instead_of_tax_return():
    base = [rec("application"), rec("guarantor_id"), rec("certificate_of_formation"), rec("ein_letter"), rec("financial_statements")]
    facts = {"formation_date": "2025-03-10", "product": "Term Loan"}
    ok = find_missing(base + [rec("extension_7004")], facts, NOW)
    assert "MISSING_DOC:tax_return" not in {f.code for f in ok}
    old = find_missing(base + [rec("extension_7004")], {"formation_date": "2015-03-10"}, NOW)
    assert "MISSING_DOC:tax_return" in {f.code for f in old}      # an extension does not excuse an established business


def test_missing_statement_and_missing_page_are_distinct_and_block_credit_only():
    recs = [rec("application"), rec("guarantor_id"), rec("certificate_of_formation"), rec("ein_letter"), rec("financial_statements"), rec("tax_return")]
    recs += [stmt(m, 1000, [("credit", 500)]) for m in ["2026-05", "2026-07", "2026-09", "2026-10"]]
    recs.append(stmt("2026-08", 1000, [("credit", 500)], pages=(1,), expected=2))
    got = {f.code: f for f in find_missing(recs, {"formation_date": "2010-01-01"}, NOW)}
    assert "MISSING_DOC:bank_statement_2026-06" in got
    assert "MISSING_PAGE:bank_statement_2026-08" in got
    assert {f.stage for f in got.values()} == {"Credit"}           # Intake docs are all present: only Credit is blocked


def test_equipment_loan_needs_quote_at_product_stage():
    got = find_missing([rec("application")], {"product": "Equipment Loan", "formation_date": "2010-01-01"}, NOW)
    q = next(f for f in got if f.code == "MISSING_DOC:equipment_quote")
    assert q.stage == "Product"


# ------------------------------------------------------------------ consistency
def _app(**kw):
    d = dict(legal_name="Westfield Print & Sign LLC", ein="74-3169524", amount_requested=95000.0, guarantor_name="Renee Holt",
             guarantor_dob="1975-06-27", guarantor_address="5523 Vickery Blvd, Dallas, TX 75206", annual_revenue=1_380_000.0)
    d.update(kw)
    return rec("application", **d)


def test_transposed_ein_is_a_mismatch_not_fraud():
    recs = [_app(), rec("ein_letter", legal_name="WESTFIELD PRINT & SIGN LLC", ein="74-3196524")]
    codes = {f.code for f in check_consistency(recs, merge_facts(recs))}
    assert codes == {"MISMATCH:ein"}


def test_nickname_is_not_an_id_mismatch():
    recs = [_app(guarantor_name="Bob Kline"), rec("guarantor_id", guarantor_name="Robert Allen Kline", guarantor_dob="1975-06-27",
                                                   guarantor_address="5523 Vickery Blvd, Dallas, TX 75206")]
    assert check_consistency(recs, merge_facts(recs)) == []
    assert OT.check_id_mismatch(recs) == []


def test_annualised_ytd_revenue_is_not_a_mismatch_for_a_young_company():
    recs = [_app(annual_revenue=1_120_000.0), rec("tax_return", gross_receipts=470_400.0, ein="74-3169524"),
            rec("financial_statements", fy_revenue=470_400.0, ytd_revenue=923_800.0)]
    assert "MISMATCH:annual_revenue" not in {f.code for f in check_consistency(recs, merge_facts(recs))}


# ------------------------------------------------------------------ old tricks
def test_statement_tamper_detected_but_not_for_a_lost_page():
    good = [stmt("2026-05", 1000, [("credit", 500), ("debit", 200)]), stmt("2026-06", 1300, [("credit", 100)])]
    assert OT.check_stmt_tamper(good) == []
    edited = [stmt("2026-05", 1000, [("credit", 500), ("debit", 200)], closing=9999.0), stmt("2026-06", 1300, [("credit", 100)])]
    assert OT.check_stmt_tamper(edited)[0].code == "OLD_TRICK:STMT_TAMPER"
    broken_chain = [stmt("2026-05", 1000, [("credit", 500)]), stmt("2026-06", 777, [("credit", 100)])]
    assert OT.check_stmt_tamper(broken_chain)
    # a genuinely lost page: the SUMMARY is self-consistent (1000 + 900 - 200 = 1700) but only page 1 of 2 lists rows
    lost_page = [stmt("2026-05", 1000, [("credit", 500)], deposits=900, withdrawals=200, closing=1700, pages=(1,), expected=2)]
    assert OT.check_stmt_tamper(lost_page) == []                   # listed rows legitimately fall short: page 2 is missing
    lost_page_but_bad_summary = [stmt("2026-05", 1000, [("credit", 500)], deposits=900, withdrawals=200, closing=9999.0, pages=(1,), expected=2)]
    assert OT.check_stmt_tamper(lost_page_but_bad_summary)         # a missing page does not excuse a summary that does not add up


def test_missing_month_between_statements_is_not_tamper():
    recs = [stmt("2026-05", 1000, [("credit", 500)]), stmt("2026-07", 5000, [("credit", 100)])]
    assert OT.check_stmt_tamper(recs) == []


def test_revenue_inflation_threshold_is_1_5x_annualised_deposits():
    recs = [stmt(f"2026-0{m}", 1000, [("credit", 10000)]) for m in (5, 6, 7)]          # deposits 120k/yr
    assert OT.check_rev_inflation(recs, {"annual_revenue_stated": 170_000.0}) == []   # 1.42x
    assert OT.check_rev_inflation(recs, {"annual_revenue_stated": 190_000.0})         # 1.58x
    assert OT.check_rev_inflation(recs[:2], {"annual_revenue_stated": 900_000.0}) == []  # <3 months: not enough to judge


def test_shell_address_is_pmb_not_a_suite_number():
    app = [rec("application")]
    assert OT.check_shell_address(app, {"business_address": "5823 Main St PMB 126, Dallas, TX 75252"}, set())
    assert OT.check_shell_address(app, {"business_address": "1600 N Collins Blvd #210, Richardson, TX 75080"}, set()) == []
    assert OT.check_shell_address(app, {"business_address": "5823 Main St, Dallas, TX 75252"}, {"5823 main st"})   # same street address as a confirmed mailbox store


def test_duplicate_ein_needs_a_different_company_name():
    known = [("26-3669103", "Wright Services LLC", "H-2512-022")]
    assert OT.check_dup_ein({"ein": "26-3669103", "legal_name": "Sunset Rivera Shop LLC"}, known)
    assert OT.check_dup_ein({"ein": "26-3669103", "legal_name": "Wright Services, L.L.C."}, known) == []
    assert OT.check_dup_ein({"ein": "82-1974405", "legal_name": "Sunrise Rasoi Bakery LLC", "dba": "Priya's Bakery"},
                            [("82-1974405", "Priya's Bakery", "H-1")]) == []
