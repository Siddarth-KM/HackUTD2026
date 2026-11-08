"""Merge the per-document extractions of one folder into the deal's facts (the `extracted` block).

The application is the primary source for the request; other documents are used to fill gaps and to be
CHECKED against the application (consistency.py). Nothing here decides pass/fail.
"""
from __future__ import annotations
import re
from typing import Iterable, Optional
from ..ingest.extract import DocRecord


def by_type(records: Iterable[DocRecord]) -> dict[str, list[DocRecord]]:
    out: dict[str, list[DocRecord]] = {}
    for r in records:
        out.setdefault(r.doc.doc_type, []).append(r)
    return out


def current(records: Iterable[DocRecord], doc_type: str) -> Optional[DocRecord]:
    """The latest document of a type. A re-sent / corrected document supersedes the earlier one."""
    rs = sorted((r for r in records if r.doc.doc_type == doc_type), key=lambda r: r.arrive_at)
    return rs[-1] if rs else None


def merge_facts(records: list[DocRecord]) -> dict:
    app = current(records, "application")
    a = app.doc if app else None
    letter = current(records, "request_letter")
    quote = current(records, "equipment_quote")
    ein_l = current(records, "ein_letter")
    cert = current(records, "certificate_of_formation")
    gid = current(records, "guarantor_id")

    def pick(*vals):
        for v in vals:
            if v not in (None, ""):
                return v
        return None

    purpose_cat = pick(a and a.purpose_category, letter and letter.doc.purpose_category)
    product = pick(a and a.product, letter and letter.doc.product)
    needed_by = pick(a and a.needed_by, letter and letter.doc.needed_by)
    facts = {
        "legal_name": pick(a and a.legal_name, ein_l and ein_l.doc.legal_name, cert and cert.doc.legal_name),
        "dba": a.dba if a else None,
        "ein": pick(a and a.ein, ein_l and ein_l.doc.ein),
        "amount_requested": pick(a and a.amount_requested, letter and letter.doc.amount_requested),
        "purpose": pick(a and a.purpose, letter and letter.doc.purpose),
        "purpose_category": purpose_cat,
        "product": product,
        "term_months": pick(a and a.term_months, letter and letter.doc.term_months),
        "guarantor_name": pick(a and a.guarantor_name, gid and gid.doc.guarantor_name),
        "annual_revenue_stated": a.annual_revenue if a else None,
        "needed_by": needed_by,
        "business_address": pick(a and a.business_address, cert and cert.doc.business_address),
        "formation_date": pick(cert and cert.doc.formation_date, a and a.formation_date),
        "guarantor_dob": pick(a and a.guarantor_dob, gid and gid.doc.guarantor_dob),
        "guarantor_address": pick(a and a.guarantor_address, gid and gid.doc.guarantor_address),
        "guarantor_dl": pick(a and a.guarantor_dl, gid and gid.doc.guarantor_dl),
        "guarantor_ssn4": a.guarantor_ssn4 if a else None,
        "affiliated_businesses": a.affiliated_businesses if a else None,
        "phone": a.phone if a else None,
        "email": a.email if a else None,
        "primary_bank": a.primary_bank if a else None,
        "primary_account_last4": (a.primary_account_last4 or (re.search(r"(\d{4})\s*$", a.primary_bank or "") or [None, None])[1]) if a else None,
        "industry": a.industry if a else None,
        "registered_agent": cert.doc.registered_agent if cert else None,
        "registered_agent_address": cert.doc.registered_agent_address if cert else None,
        "equipment_vendor": quote.doc.vendor_name if quote else None,
        "vendor_remit_bank": quote.doc.vendor_bank if quote else None,
        "vendor_account_last4": quote.doc.vendor_account_last4 if quote else None,
        "vendor_routing": quote.doc.vendor_routing if quote else None,
        "applicant_notes": a.notes if a else None,
    }
    fin = current(records, "financial_statements")
    tax = current(records, "tax_return")
    facts["preparer_name"] = pick(fin and fin.doc.preparer_name, tax and tax.doc.preparer_name)
    facts["preparer_firm"] = pick(fin and fin.doc.preparer_firm, tax and tax.doc.preparer_firm)
    facts["preparer_phone"] = pick(fin and fin.doc.preparer_phone, tax and tax.doc.preparer_phone)
    return facts


def statements(records: Iterable[DocRecord]) -> dict[str, list[DocRecord]]:
    """Bank statement records keyed by YYYY-MM (a month may have several files, e.g. a re-send)."""
    out: dict[str, list[DocRecord]] = {}
    for r in records:
        if r.doc.doc_type == "bank_statement" and r.month():
            out.setdefault(r.month(), []).append(r)
    return out
