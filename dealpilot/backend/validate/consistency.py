"""Do the documents agree with each other?  -> MISMATCH:<field>

Conservative by design: a mismatch is raised only when two documents state the SAME thing differently
(EIN digits, amount, DOB). Benign variation (nickname, DBA vs legal name, Co/Company, annualised vs calendar
revenue) is not a mismatch. A mismatch asks the borrower to clarify; it is never a decline and never fraud by itself.
"""
from __future__ import annotations
from typing import Optional
from ..ingest.extract import DocRecord
from .facts import by_type, current, statements
from .findings import Finding
from .textnorm import (entity_match, person_match, addr_match, parse_date, norm_ein, money_close)

REV_TOL = 0.10        # stated revenue must match some reference within 10%
CASH_TOL = 0.02       # balance-sheet cash vs latest statement closing balance


def check_consistency(records: list[DocRecord], facts: dict) -> list[Finding]:
    t = by_type(records)
    out: list[Finding] = []
    app = current(records, "application")
    if not app:
        return out
    a = app.doc

    # ---- legal name across every document that names the borrower ----
    bad = []
    for kind in ("ein_letter", "certificate_of_formation", "tax_return", "financial_statements",
                 "extension_7004", "equipment_quote", "request_letter", "bank_statement"):
        for r in t.get(kind, []):
            n = r.doc.legal_name
            if n and not entity_match(a.legal_name, n, a.dba):
                bad.append(f"{r.name}: '{n}'")
    if bad:
        out.append(Finding("MISMATCH:legal_name", "Intake",
                           f"business name differs between documents (application says '{a.legal_name}')",
                           "; ".join(sorted(set(bad))[:5])))

    # ---- EIN (exact digits; one transposed digit is exactly what we are looking for) ----
    bad = []
    for kind in ("ein_letter", "tax_return", "extension_7004"):
        for r in t.get(kind, []):
            if r.doc.ein and a.ein and norm_ein(r.doc.ein) != norm_ein(a.ein):
                bad.append(f"{kind} says {norm_ein(r.doc.ein)}")
    if bad:
        out.append(Finding("MISMATCH:ein", "Intake",
                           f"EIN on the application ({norm_ein(a.ein)}) does not match supporting documents",
                           "; ".join(bad)))

    # ---- amount: application vs request letter vs quote ----
    bad = []
    for r in t.get("request_letter", []):
        if not money_close(a.amount_requested, r.doc.amount_requested, rel=0.0005, abs_tol=0.5):
            bad.append(f"request letter says ${r.doc.amount_requested:,.2f}")
    for r in t.get("equipment_quote", []):
        if a.amount_requested and r.doc.quote_total and a.amount_requested > r.doc.quote_total * 1.005:
            bad.append(f"vendor quote total is only ${r.doc.quote_total:,.2f}")
    if bad and a.amount_requested is not None:
        out.append(Finding("MISMATCH:amount_requested", "Intake",
                           f"requested amount differs between documents (application says ${a.amount_requested:,.2f})",
                           "; ".join(bad)))

    # ---- guarantor identity vs photo ID ----
    gid = current(records, "guarantor_id")
    if gid and gid.doc.legible:
        g = gid.doc
        if not person_match(a.guarantor_name, g.guarantor_name):
            out.append(Finding("MISMATCH:guarantor_name", "Intake",
                               f"name on the photo ID ('{g.guarantor_name}') does not match the application ('{a.guarantor_name}')"))
        da, db = parse_date(a.guarantor_dob), parse_date(g.guarantor_dob)
        if da and db and da != db:
            out.append(Finding("MISMATCH:guarantor_dob", "Intake",
                               f"date of birth differs: application {da}, ID {db}"))
        if not addr_match(a.guarantor_address, g.guarantor_address):
            out.append(Finding("MISMATCH:guarantor_address", "Intake",
                               f"home address differs: application '{a.guarantor_address}', ID '{g.guarantor_address}'"))

    # ---- stated revenue must agree with SOME independent reference ----
    stated = a.annual_revenue
    if stated:
        refs = []
        for r in t.get("tax_return", []):
            if r.doc.gross_receipts:
                refs.append(("tax return gross receipts", r.doc.gross_receipts))
        for r in t.get("financial_statements", []):
            if r.doc.fy_revenue:
                refs.append(("P&L full-year revenue", r.doc.fy_revenue))
            if r.doc.ytd_revenue:
                refs.append(("P&L YTD revenue annualised (x12/10)", r.doc.ytd_revenue * 1.2))
        dep = annualised_deposits(records)
        if dep:
            refs.append(("annualised bank deposits", dep))
        if refs and not any(abs(stated - v) <= REV_TOL * max(stated, v) for _, v in refs):
            out.append(Finding("MISMATCH:annual_revenue", "Credit",
                               f"stated revenue ${stated:,.0f} does not match any supporting figure",
                               "; ".join(f"{n}: ${v:,.0f}" for n, v in refs), blocks=False))

    # ---- balance sheet cash vs latest statement closing balance ----
    fin = current(records, "financial_statements")
    st = statements(records)
    if fin and fin.doc.cash_balance is not None and st:
        last = sorted(st)[-1]
        closes = [r.doc.closing_balance for r in st[last] if r.doc.closing_balance is not None]
        if closes and abs(fin.doc.cash_balance - closes[-1]) > CASH_TOL * max(abs(closes[-1]), 1):
            out.append(Finding("MISMATCH:bank_balance", "Credit",
                               f"balance-sheet cash ${fin.doc.cash_balance:,.2f} does not match the {last} statement closing balance ${closes[-1]:,.2f}", blocks=False))
    return out


def annualised_deposits(records: list[DocRecord]) -> Optional[float]:
    """Total deposits annualised from however many statement months we actually have (>=3)."""
    st = statements(records)
    vals = []
    for ym, recs in st.items():
        dep = [r.doc.total_deposits for r in recs if r.doc.total_deposits is not None]
        if dep:
            vals.append(max(dep))
    if len(vals) < 3:
        return None
    return sum(vals) / len(vals) * 12
