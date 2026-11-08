"""Per-file extraction: Gemini reads the document, Python verifies the numbers.

Flow for one file:
  PDF/JPG  -> Gemini (native file input, JSON schema = ExtractedDoc)
  CSV      -> Gemini classifies header context; rows parsed deterministically
  then     -> sanity checks: every amount Gemini reports must exist in the PDF's own text layer
              (catches mis-transcription). One strict retry; if still off, a warning is attached
              so downstream checks do NOT mistake an extraction slip for statement tampering.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from ..models import ExtractedDoc, BatchResult
from .. import config
from .gemini_client import get_client, GeminiUnavailable
from .pdf_meta import PdfMeta, read_pdf_meta, numbers_in
from .csv_statements import parse_bank_csv, looks_like_bank_csv

MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}

EXTRACT_PROMPT = """You are an intake analyst at a commercial bank reading ONE document from a small-business loan folder.
Identify what the document IS by its CONTENT (file names are unreliable: borrowers name files 'SCAN_..pdf' or 'FINAL.pdf').
Fill ExtractedDoc. Rules:
- doc_type: application | guarantor_id (driver license copy or photo of one) | certificate_of_formation | ein_letter (IRS CP 575) |
  bank_statement | financial_statements (P&L and/or balance sheet) | tax_return (return summary) | extension_7004 (IRS Form 7004) |
  request_letter | equipment_quote | contract_summary | collections_notice | other.
- Only fill a field if the document STATES it. Never infer, never copy from your memory of other documents. Unknown -> null.
- Dates as ISO YYYY-MM-DD. EIN as NN-NNNNNNN. Money as plain numbers (no $ or commas). SSN: last 4 digits only.
- A field a document type does not state (e.g. product / purpose_category on a request letter that only gives an amount and a use) MUST stay null: do not infer it from context.
- Placeholder dashes like '—' mean null (e.g. DBA).
- application: the business section, loan request section and guarantor section. annual_revenue = the stated number;
  if a range like 'approx 400-500k' is given use the midpoint and say so in notes. needed_by: ISO datetime with offset -06:00 if a
  funds-needed-by date/time is stated (e.g. 'Friday 2026-11-06 by 3:00 PM' -> 2026-11-06T15:00:00-06:00); 'No specific date' -> null.
  signed = true only if a signature line is actually filled in (e.g. '/s/ Name' with a date). Copy any applicant note into notes.
  primary_bank = bank name only; primary_account_last4 = the digits after '...' in the 'Primary bank / account' line.
  purpose_category must be one of working_capital, equipment, inventory, payroll, expansion, refinance (pick the closest to the stated use of proceeds).
  product must be exactly one of: Term Loan, Equipment Loan, Revolving Line of Credit, Working Capital Loan.
- guarantor_id: name, dob, address, driver license number (digits as printed), put them in guarantor_* fields; legal_name stays null.
- certificate_of_formation: legal_name = entity name; formation_date = effective date; registered_agent + registered_agent_address; file_number; organizer; business_address = principal office.
- ein_letter: legal_name and ein exactly as printed.
- bank_statement: bank_name (the institution that issued it), legal_name = account holder, account_last4, period_start/period_end,
  opening/closing balance, total_deposits (summary 'deposits & credits'), total_withdrawals. Extract EVERY transaction row on EVERY page in order:
  date, description, amount (absolute value), balance (running balance printed on that row), direction = credit if the balance went UP
  from the previous row (or from the opening balance for the first row) else debit. Do NOT invent, merge, skip or re-order rows.
  pages_seen = the X from every 'Page X of N' marker; pages_expected = N. If no marker, leave pages_seen empty and pages_expected null.
- financial_statements: legal_name, preparer_name/firm/phone from the 'Prepared by' line, fy_revenue (full-year column), ytd_revenue, net_income (full-year), total_liabilities, cash_balance (balance sheet 'Cash'), balance_sheet_date.
- tax_return: legal_name, ein, gross_receipts, tax_year, and from the 'Paid preparer' line written as 'Name (Firm)': preparer_name = the name, preparer_firm = the text in parentheses; preparer_ptin.
- extension_7004: legal_name, ein, tax_year, notes = status text.
- request_letter: amount_requested, term_months, purpose (the borrower's own words), legal_name = company named in the signature line, any deadline in notes; needed_by if a firm date/time is stated.
- equipment_quote: vendor_name, vendor_address, vendor_phone, legal_name = the Customer, vendor_bank, vendor_routing, vendor_account_last4 (the 'Remit to' account), quote_total.
- contract_summary: contract_currencies = ISO codes present. collections_notice: subject_name, notice_text.
- legible=false if the document is cut off, blank, or unreadable. confidence 0..1. Put anything that looks odd about the document in notes."""

# Fields every document of a type is expected to carry. A lite model occasionally OMITS a field it could read
# (seen: certificate of formation without its effective date). Missing ones trigger ONE targeted re-read.
REQUIRED = {
    "application": ["legal_name", "ein", "amount_requested", "product", "term_months", "guarantor_name", "guarantor_dob"],
    "certificate_of_formation": ["legal_name", "formation_date", "registered_agent", "business_address"],
    "ein_letter": ["legal_name", "ein"],
    "bank_statement": ["opening_balance", "closing_balance", "total_deposits", "total_withdrawals", "period_start"],
    "financial_statements": ["cash_balance"],
    "tax_return": ["gross_receipts", "ein", "preparer_name"],
    "equipment_quote": ["vendor_name", "vendor_account_last4", "quote_total"],
    "request_letter": ["amount_requested"],
}


FIELD_HINTS = {
    "formation_date": "the 'Effective date' / 'Date of formation' / 'Date business established' line",
    "business_address": "the 'Principal office' / 'Business address' line",
    "registered_agent": "the 'Registered agent' line",
    "preparer_name": "the 'Paid preparer' / 'Prepared by' line: the person's name (text before the parentheses)",
    "cash_balance": "the balance sheet line labelled 'Cash'",
    "gross_receipts": "the 'Gross receipts or sales' line",
    "opening_balance": "the summary line 'Opening balance'", "closing_balance": "the summary line 'Closing balance'",
    "total_deposits": "the summary line 'Total deposits & credits'", "total_withdrawals": "the summary line 'Total withdrawals & debits'",
    "period_start": "the 'Statement period' line (first date)",
    "vendor_account_last4": "the 'Remit to ... Account ending NNNN' line", "quote_total": "the 'TOTAL' line",
    "term_months": "the 'Requested term' line", "product": "the 'Product' line", "guarantor_dob": "the 'Date of birth' line",
}


def _missing_required(doc: ExtractedDoc) -> list[str]:
    miss = [f for f in REQUIRED.get(doc.doc_type, []) if getattr(doc, f, None) in (None, "", [])]
    if doc.doc_type == "bank_statement" and not doc.transactions:
        miss.append("transactions")
    if doc.doc_type == "financial_statements" and doc.fy_revenue is None and doc.ytd_revenue is None:
        miss.append("fy_revenue")
    return miss


STRICT_SUFFIX = ("\nIMPORTANT RETRY: a previous extraction contained amounts that do not appear in the document. "
                 "Transcribe each number character-for-character from the document.")


@dataclass
class DocRecord:
    rel_path: str
    folder: str
    name: str
    arrive_at: str
    mime: str
    meta: dict
    doc: ExtractedDoc
    warnings: list[str] = field(default_factory=list)
    sha256: str = ""
    kind: str = ""  # doc_type shortcut

    def month(self) -> Optional[str]:
        return (self.doc.period_start or "")[:7] or None


def _check_numbers(doc: ExtractedDoc, text: str) -> list[str]:
    """Return warnings for reported amounts absent from the PDF text layer."""
    if len(text) < 80:
        return []
    have = numbers_in(text)
    if not have:
        return []
    miss = []
    vals = [("opening_balance", doc.opening_balance), ("closing_balance", doc.closing_balance),
            ("total_deposits", doc.total_deposits), ("total_withdrawals", doc.total_withdrawals),
            ("amount_requested", doc.amount_requested), ("quote_total", doc.quote_total)]
    vals += [(f"txn[{i}]", t.amount) for i, t in enumerate(doc.transactions)]
    for k, v in vals:
        if v is None:
            continue
        if round(abs(v), 2) not in have and round(abs(v)) not in have:
            miss.append(f"{k}={v}")
    return miss


def _prepare(abs_path: Path, rel_path: str, arrive_at: str):
    """-> (kind, data, mime, meta, text, folder, name). kind: 'csv' | 'file'."""
    import hashlib
    parts = rel_path.replace("\\", "/").split("/")
    folder, name = parts[0], parts[-1]
    ext = abs_path.suffix.lower()
    data = abs_path.read_bytes()
    if ext == ".csv":
        text = data.decode("utf-8", "ignore")
        meta = {"producer": "", "creator": "", "creation_date": "", "pages": 1,
                "sha256": hashlib.sha256(data).hexdigest(), "text_chars": len(text), "format": "csv"}
        return "csv", data, "text/csv", meta, text, folder, name
    mime = MIME.get(ext)
    if mime is None:
        raise ValueError(f"unsupported file type: {ext}")
    if ext == ".pdf":
        pm: PdfMeta = read_pdf_meta(abs_path)
        return "file", data, mime, pm.dict(), pm.text, folder, name
    meta = {"producer": "", "creator": "", "creation_date": "", "pages": 1,
            "sha256": hashlib.sha256(data).hexdigest(), "text_chars": 0, "format": "image"}
    return "file", data, mime, meta, "", folder, name


def _finish(rel_path, arrive_at, folder, name, mime, meta, text, data, doc: ExtractedDoc) -> DocRecord:
    """Verify Gemini's numbers against the PDF's own text layer; one strict re-extraction if they do not appear."""
    gem = get_client()
    warnings: list[str] = []
    miss = _check_numbers(doc, text) if doc.doc_type in ("bank_statement", "application", "equipment_quote") else []
    if miss:
        doc = gem.extract(data, mime, EXTRACT_PROMPT + STRICT_SUFFIX, ExtractedDoc)
        miss = _check_numbers(doc, text)
        if miss:
            warnings.append("EXTRACTION_UNVERIFIED: amounts not found in the document's text layer: " + ", ".join(miss[:6]))
    gaps = _missing_required(doc)
    if gaps and doc.legible:
        again = gem.extract(data, mime, EXTRACT_PROMPT + (
            "\nIMPORTANT RETRY (targeted): your previous extraction left these fields empty although this document type "
            "normally contains them. Look for: " + "; ".join(f"{g} = {FIELD_HINTS.get(g, g)}" for g in gaps) +
            ". Fill each one that is actually printed; leave it null only if it truly is not there."), ExtractedDoc)
        if again.doc_type == doc.doc_type:
            for f in gaps:
                v = getattr(again, f, None)
                if v not in (None, "", []):
                    setattr(doc, f, v)
            gem.store(gem.file_key(data, EXTRACT_PROMPT, ExtractedDoc), doc)   # next run skips the retry
    if doc.doc_type == "bank_statement" and doc.pages_seen is not None:
        doc.pages_seen = sorted(set(doc.pages_seen))
    return DocRecord(rel_path, folder, name, arrive_at, mime, meta, doc, warnings, meta.get("sha256", ""), doc.doc_type)


def _csv_record(rel_path, arrive_at, folder, name, meta, text) -> DocRecord:
    doc = parse_bank_csv(text) if looks_like_bank_csv(text) else get_client().extract_text(text, EXTRACT_PROMPT, ExtractedDoc)
    return DocRecord(rel_path, folder, name, arrive_at, "text/csv", meta, doc, [], meta["sha256"], doc.doc_type)


def extract_file(abs_path: Path, rel_path: str, arrive_at: str) -> DocRecord:
    kind, data, mime, meta, text, folder, name = _prepare(abs_path, rel_path, arrive_at)
    if kind == "csv":
        return _csv_record(rel_path, arrive_at, folder, name, meta, text)
    doc = get_client().extract(data, mime, EXTRACT_PROMPT, ExtractedDoc)
    return _finish(rel_path, arrive_at, folder, name, mime, meta, text, data, doc)


def extract_batch(items: list[tuple[Path, str, str]]) -> dict[str, "DocRecord | Exception"]:
    """Extract many files with as few Gemini requests as possible. Cache first (per file), then chunks of
    <= GEMINI_BATCH_DOCS documents (bank statements <= 3 per request: long tables transcribe more reliably in
    small groups). A chunk that comes back with the wrong item count falls back to single-file requests."""
    gem = get_client()
    out: dict[str, DocRecord | Exception] = {}
    pending = []   # (rel, arrive, folder, name, mime, meta, text, data)
    for abs_path, rel, arrive in items:
        try:
            kind, data, mime, meta, text, folder, name = _prepare(abs_path, rel, arrive)
            if kind == "csv":
                out[rel] = _csv_record(rel, arrive, folder, name, meta, text)
                continue
            hit = gem.cached(gem.file_key(data, EXTRACT_PROMPT, ExtractedDoc), ExtractedDoc)
            if hit is not None:
                out[rel] = _finish(rel, arrive, folder, name, mime, meta, text, data, hit)
            else:
                pending.append((rel, arrive, folder, name, mime, meta, text, data))
        except Exception as e:
            out[rel] = e
    chunk, n_stmt = [], 0
    chunks = []
    for it in pending:
        is_stmt = "statement period" in it[6].lower() or "statement" in it[3].lower()
        if chunk and (len(chunk) >= config.GEMINI_BATCH_DOCS or (is_stmt and n_stmt >= 3)):
            chunks.append(chunk)
            chunk, n_stmt = [], 0
        chunk.append(it)
        n_stmt += is_stmt
    if chunk:
        chunks.append(chunk)
    for ch in chunks:
        try:
            if len(ch) == 1:
                raise ValueError("single")
            docs = gem.extract_many([(c[7], c[4]) for c in ch], EXTRACT_PROMPT, ExtractedDoc, BatchResult)
            for c, d in zip(ch, docs):
                gem.store(gem.file_key(c[7], EXTRACT_PROMPT, ExtractedDoc), d)
        except (GeminiUnavailable, ) as e:
            for c in ch:
                out[c[0]] = e
            continue
        except Exception:
            docs = []
            for c in ch:
                try:
                    docs.append(gem.extract(c[7], c[4], EXTRACT_PROMPT, ExtractedDoc))
                except Exception as e:
                    docs.append(e)
        for c, d in zip(ch, docs):
            if isinstance(d, Exception):
                out[c[0]] = d
            else:
                try:
                    out[c[0]] = _finish(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], d)
                except Exception as e:
                    out[c[0]] = e
    return out
