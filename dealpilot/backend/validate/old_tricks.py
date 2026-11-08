"""The bank's EXISTING fraud list (rules/known_fraud_checks.md). Pure arithmetic/comparison, no LLM.

A hit here goes straight to Fraud Operations. These are the OLD tricks; the cross-deal engine in
backend/fraud/ is what finds the new one.
"""
from __future__ import annotations
import re
from datetime import date
from typing import Iterable, Optional
from .. import config
from ..ingest.extract import DocRecord
from ..models import ExtractedDoc
from .consistency import annualised_deposits
from .facts import current, statements
from .findings import Finding
from .textnorm import entity_match, person_match, addr_match, parse_date, norm_ein, norm_entity

_MAILBOX = re.compile(r"\bPMB\b|\bP\.?\s?O\.?\s?Box\b|\bmail\s?box\b|\bMBE\b|\bups store\b|\bpostal (annex|center|connection)\b|\bpostnet\b|\bpack\s?&\s?ship\b",
                      re.I)


# ------------------------------------------------------------------ STMT_TAMPER
def recompute_flows(doc: ExtractedDoc) -> tuple[float, float, list[int]]:
    """Credits, debits and row indexes where the running balance does not follow from the previous row.
    Direction is re-derived from balance movement, not trusted from the extractor."""
    prev = doc.opening_balance
    credits = debits = 0.0
    breaks: list[int] = []
    for i, t in enumerate(doc.transactions):
        if t.balance is not None and prev is not None:
            delta = round(t.balance - prev, 2)
            if abs(abs(delta) - t.amount) > config.BALANCE_TOLERANCE:
                breaks.append(i)
            if delta >= 0:
                credits += t.amount
            else:
                debits += t.amount
        else:
            if t.direction == "credit":
                credits += t.amount
            else:
                debits += t.amount
        if t.balance is not None:
            prev = t.balance
    return round(credits, 2), round(debits, 2), breaks


def _pages_complete(r: DocRecord) -> bool:
    d = r.doc
    if d.pages_expected and d.pages_seen is not None:
        return set(range(1, d.pages_expected + 1)) <= set(d.pages_seen)
    return True


def check_stmt_tamper(records: Iterable[DocRecord]) -> list[Finding]:
    out: list[Finding] = []
    st = statements(records)
    months = sorted(st)
    prev_close: Optional[tuple[str, float]] = None
    for ym in months:
        r = st[ym][-1]
        d = r.doc
        if any(w.startswith("EXTRACTION_UNVERIFIED") for w in r.warnings):
            prev_close = (ym, d.closing_balance) if d.closing_balance is not None else None
            continue
        ev = []
        if None not in (d.opening_balance, d.total_deposits, d.total_withdrawals, d.closing_balance):
            calc = round(d.opening_balance + d.total_deposits - d.total_withdrawals, 2)
            if abs(calc - d.closing_balance) > config.BALANCE_TOLERANCE:
                ev.append(f"{ym}: opening {d.opening_balance:,.2f} + deposits {d.total_deposits:,.2f} - withdrawals "
                          f"{d.total_withdrawals:,.2f} = {calc:,.2f}, but closing balance is {d.closing_balance:,.2f}")
        if _pages_complete(r) and d.transactions:
            c, w, breaks = recompute_flows(d)
            if d.total_deposits is not None and abs(c - d.total_deposits) > config.BALANCE_TOLERANCE:
                ev.append(f"{ym}: listed credits {c:,.2f} != summary deposits {d.total_deposits:,.2f}")
            if d.total_withdrawals is not None and abs(w - d.total_withdrawals) > config.BALANCE_TOLERANCE:
                ev.append(f"{ym}: listed debits {w:,.2f} != summary withdrawals {d.total_withdrawals:,.2f}")
            if breaks:
                ev.append(f"{ym}: running balance breaks at row(s) {breaks[:5]}")
        # continuity only between CONSECUTIVE months we actually hold (a missing month is a missing doc, not tampering)
        if prev_close and d.opening_balance is not None and _next_month(prev_close[0]) == ym \
                and abs(prev_close[1] - d.opening_balance) > config.BALANCE_TOLERANCE:
            ev.append(f"{ym} opening {d.opening_balance:,.2f} != {prev_close[0]} closing {prev_close[1]:,.2f}")
        if ev:
            out.append(Finding("OLD_TRICK:STMT_TAMPER", "", "bank statement numbers do not reconcile", " | ".join(ev),
                               blocks=False))
        prev_close = (ym, d.closing_balance) if d.closing_balance is not None else None
    return _merge(out, "OLD_TRICK:STMT_TAMPER", "bank statement numbers do not reconcile (possible edited statement)")


def _next_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y + (m == 12)}-{m % 12 + 1:02d}"


def _merge(fs: list[Finding], code: str, text: str) -> list[Finding]:
    if not fs:
        return []
    return [Finding(code, "", text, " | ".join(f.evidence for f in fs), blocks=False)]


# ------------------------------------------------------------------ REV_INFLATION
def check_rev_inflation(records: list[DocRecord], facts: dict) -> list[Finding]:
    dep = annualised_deposits(records)
    if not dep:
        return []
    stated = []
    if facts.get("annual_revenue_stated"):
        stated.append(("application", facts["annual_revenue_stated"]))
    tax = current(records, "tax_return")
    if tax and tax.doc.gross_receipts:
        stated.append(("tax return", tax.doc.gross_receipts))
    hit = [(n, v) for n, v in stated if v > config.REV_INFLATION_RATIO * dep]
    if not hit:
        return []
    ev = "; ".join(f"{n} revenue ${v:,.0f} = {v / dep:.2f}x annualised deposits ${dep:,.0f}" for n, v in hit)
    return [Finding("OLD_TRICK:REV_INFLATION", "", "stated revenue is far above what the bank statements show", ev, blocks=False)]


# ------------------------------------------------------------------ ID_MISMATCH
def check_id_mismatch(records: list[DocRecord]) -> list[Finding]:
    app, gid = current(records, "application"), current(records, "guarantor_id")
    if not (app and gid and gid.doc.legible):
        return []
    a, g = app.doc, gid.doc
    ev = []
    if g.guarantor_name and a.guarantor_name and not person_match(a.guarantor_name, g.guarantor_name):
        ev.append(f"name: application '{a.guarantor_name}' vs ID '{g.guarantor_name}'")
    da, db = parse_date(a.guarantor_dob), parse_date(g.guarantor_dob)
    if da and db and da != db:
        ev.append(f"DOB: application {da} vs ID {db}")
    if g.guarantor_address and a.guarantor_address and not addr_match(a.guarantor_address, g.guarantor_address):
        ev.append(f"address: application '{a.guarantor_address}' vs ID '{g.guarantor_address}'")
    return [Finding("OLD_TRICK:ID_MISMATCH", "", "photo ID does not match the application", "; ".join(ev), blocks=False)] if ev else []


# ------------------------------------------------------------------ DUP_EIN
def check_dup_ein(facts: dict, known: Iterable[tuple[str, str, str]]) -> list[Finding]:
    """known = (ein, legal_name, reference) for history deals and other live deals."""
    ein = norm_ein(facts.get("ein"))
    name = facts.get("legal_name")
    if not ein or not name:
        return []
    hits = [(n, ref) for e, n, ref in known if norm_ein(e) == ein and not entity_match(name, n, facts.get("dba"))]
    if not hits:
        return []
    ev = "; ".join(f"EIN {ein} already used by '{n}' ({ref})" for n, ref in hits[:4])
    return [Finding("OLD_TRICK:DUP_EIN", "", "this EIN is already used by a different company name", ev, blocks=False)]


# ------------------------------------------------------------------ SHELL_ADDRESS
def shell_street_keys(history: list[dict]) -> set[str]:
    """Street parts of addresses the bank already confirmed as mailbox stores (history fraud_label=SHELL_ADDRESS)."""
    keys = set()
    for r in history:
        if r.get("fraud_label") == "SHELL_ADDRESS":
            keys.add(norm_addr_street(r.get("business_address", "")))
    return {k for k in keys if k}


def norm_addr_street(addr: str) -> str:
    a = re.split(r",|\bPMB\b|#", addr or "", flags=re.I)[0]
    return re.sub(r"\s+", " ", a).strip().lower()


def check_shell_address(records: list[DocRecord], facts: dict, shell_streets: set[str]) -> list[Finding]:
    cands = [facts.get("business_address")]
    cert = current(records, "certificate_of_formation")
    if cert:
        cands.append(cert.doc.business_address)
    ev = []
    for c in filter(None, cands):
        if _MAILBOX.search(c):
            ev.append(f"'{c}' is a mailbox/PMB address")
        elif norm_addr_street(c) in shell_streets:
            ev.append(f"'{c}' is the same street address as a confirmed mailbox store in history")
    return [Finding("OLD_TRICK:SHELL_ADDRESS", "", "business address is a mailbox store, not real premises",
                    "; ".join(dict.fromkeys(ev)), blocks=False)] if ev else []


def run_old_tricks(records: list[DocRecord], facts: dict, known_eins: Iterable[tuple[str, str, str]],
                   shell_streets: set[str]) -> list[Finding]:
    out: list[Finding] = []
    out += check_stmt_tamper(records)
    out += check_rev_inflation(records, facts)
    out += check_id_mismatch(records)
    out += check_dup_ein(facts, known_eins)
    out += check_shell_address(records, facts, shell_streets)
    return out
