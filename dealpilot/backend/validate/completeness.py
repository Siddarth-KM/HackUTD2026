"""Is everything the pipeline needs actually in the folder?  (stages.json `required_to_exit`)

A missing document is NEVER a reason to reject or to suspect fraud. It produces a finding that blocks exit
from exactly the stage that needs the document; earlier stages still advance.
"""
from __future__ import annotations
from datetime import date
from typing import Optional
from ..ingest.extract import DocRecord
from .facts import by_type, statements
from .findings import Finding
from .textnorm import parse_date


def expected_months(now: date, n: int = 6) -> list[str]:
    """The n most recent FULL calendar months before `now` (oldest first)."""
    y, m = now.year, now.month
    out = []
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(f"{y}-{m:02d}")
    return list(reversed(out))


def is_young(formation: Optional[str], now: date, years: float = 2.0) -> Optional[bool]:
    d = parse_date(formation)
    if d is None:
        return None
    return (now - d).days < years * 365.25


def find_missing(records: list[DocRecord], facts: dict, now: date) -> list[Finding]:
    t = by_type(records)
    out: list[Finding] = []

    def have(kind: str) -> bool:
        return any(r.doc.legible for r in t.get(kind, []))

    # ---- Intake ----
    app = t.get("application", [])
    if not app:
        out.append(Finding("MISSING_DOC:application", "Intake", "signed loan application is missing"))
    elif all(r.doc.signed is False for r in app):
        out.append(Finding("MISSING_DOC:application", "Intake",
                           "the loan application is not signed", "no signature line filled in"))
    elif not have("application"):
        out.append(Finding("MISSING_DOC:application", "Intake", "the loan application is not legible"))
    if not have("guarantor_id"):
        out.append(Finding("MISSING_DOC:guarantor_id", "Intake",
                           "government photo ID for the guarantor is missing or illegible"))
    if not have("certificate_of_formation"):
        out.append(Finding("MISSING_DOC:certificate_of_formation", "Intake", "certificate of formation is missing"))
    if not have("ein_letter"):
        out.append(Finding("MISSING_DOC:ein_letter", "Intake", "IRS EIN letter (CP 575) is missing"))

    # ---- Credit: 6 most recent full months, every page ----
    st = statements(records)
    for ym in expected_months(now):
        recs = [r for r in st.get(ym, []) if r.doc.legible]
        if not recs:
            out.append(Finding(f"MISSING_DOC:bank_statement_{ym}", "Credit",
                               f"bank statement for {ym} is missing"))
            continue
        seen = set()
        expected = 0
        for r in recs:
            seen |= set(r.doc.pages_seen or [])
            expected = max(expected, r.doc.pages_expected or 0)
        if expected and set(range(1, expected + 1)) - seen:
            gone = sorted(set(range(1, expected + 1)) - seen)
            out.append(Finding(f"MISSING_PAGE:bank_statement_{ym}", "Credit",
                               f"bank statement for {ym} is missing page(s) {gone} of {expected}",
                               f"pages found: {sorted(seen)} of {expected}"))
    if not have("financial_statements"):
        out.append(Finding("MISSING_DOC:financial_statements", "Credit",
                           "financial statements (P&L and balance sheet) are missing"))
    young = is_young(facts.get("formation_date"), now)
    if not have("tax_return"):
        if young and have("extension_7004"):
            pass  # < 2 years old: an IRS Form 7004 extension is acceptable in place of the return
        elif young is None and have("extension_7004"):
            pass  # cannot tell the age; do not penalise a filed extension
        else:
            why = ("a business under 2 years old may send an IRS Form 7004 extension instead"
                   if young else "the most recent business tax return is required")
            out.append(Finding("MISSING_DOC:tax_return", "Credit", f"business tax return is missing ({why})"))

    # ---- Product ----
    if (facts.get("product") == "Equipment Loan") and not have("equipment_quote"):
        out.append(Finding("MISSING_DOC:equipment_quote", "Product",
                           "equipment loan requires a vendor quote (vendor identity and remit-to account)"))
    return out
