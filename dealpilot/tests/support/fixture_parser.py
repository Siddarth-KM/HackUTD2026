"""TEST-ONLY stand-in for Gemini.

The product extracts with Gemini and deliberately has no regex fallback. To exercise everything DOWNSTREAM of
extraction (validators, fraud graph, stage machine, SLA, routing) on the real sample documents without an API key,
tests inject this parser as the pipeline's `extractor`. It reads the PDF text layer of the sample's template-style
documents into the same ExtractedDoc shape Gemini produces. Never import this from backend/.
"""
from __future__ import annotations
import re
from pathlib import Path
from backend.ingest.extract import DocRecord
from backend.ingest.pdf_meta import read_pdf_meta
from backend.ingest.csv_statements import parse_bank_csv, looks_like_bank_csv
from backend.models import ExtractedDoc, Txn
import hashlib


def _kv(text: str) -> dict:
    d = {}
    for l in text.splitlines():
        parts = re.split(r"\s{2,}", l.strip())
        if len(parts) >= 2 and parts[0] not in d:
            d[parts[0]] = parts[1]
    return d


def _m(s):
    m = re.search(r"-?\$?\s?([\d,]+\.?\d*)", s or "")
    return float(m.group(1).replace(",", "")) if m and m.group(1).replace(",", "").replace(".", "").isdigit() else None


def _clean(s):
    if s is None:
        return None
    s = s.strip()
    return None if s in ("", "-", "—", "�", "–") else s


PURPOSE = [("payroll", "payroll"), ("refinanc", "refinance"), ("inventory", "inventory"), ("equipment", "equipment"), ("purchase", "equipment"), ("replace", "equipment"), ("buy", "equipment"), ("build out", "expansion"), ("hire", "expansion"),
           ("expan", "expansion"), ("bridge", "working_capital"), ("renew", "inventory")]


def _purpose_cat(txt: str):
    t = (txt or "").lower()
    for k, v in PURPOSE:
        if k in t:
            return v
    return "working_capital"


def parse_text(text: str, name: str) -> ExtractedDoc:
    k = _kv(text)
    d = ExtractedDoc()
    if "Loan Application" in text:
        d.doc_type = "application"
        d.legal_name, d.dba = k.get("Legal business name"), _clean(k.get("DBA / trade name"))
        d.ein = k.get("Federal EIN")
        d.formation_date = k.get("Date business established")
        d.business_address = k.get("Business address")
        ph = (k.get("Business phone / email") or "").split("/")
        d.phone, d.email = ph[0].strip(), (ph[1].strip() if len(ph) > 1 else None)
        d.industry = k.get("Industry (NAICS)")
        rev = k.get("Annual revenue (most recent year)") or ""
        if rev.startswith("$"):
            d.annual_revenue = _m(rev)
        else:
            nums = re.findall(r"(\d+)-(\d+)k", rev)
            d.annual_revenue = (float(nums[0][0]) + float(nums[0][1])) / 2 * 1000 if nums else None
        d.primary_bank = k.get("Primary bank / account")
        d.amount_requested = _m(k.get("Amount requested"))
        d.product, d.purpose = k.get("Product"), k.get("Use of proceeds")
        d.purpose_category = _purpose_cat(d.purpose)
        d.term_months = int(re.search(r"\d+", k.get("Requested term", "0")).group())
        d.collateral = k.get("Collateral offered")
        nb = k.get("Funds needed by") or ""
        m = re.search(r"(\d{4}-\d{2}-\d{2}) by (\d{1,2}):(\d{2}) (AM|PM)", nb)
        if m:
            h = int(m[2]) % 12 + (12 if m[4] == "PM" else 0)
            d.needed_by = f"{m[1]}T{h:02d}:{m[3]}:00-06:00"
        d.guarantor_name, d.guarantor_dob = k.get("Name"), k.get("Date of birth")
        d.guarantor_ssn4 = re.sub(r"\D", "", k.get("SSN", ""))[-4:] or None
        d.guarantor_address = k.get("Home address")
        d.guarantor_dl = re.sub(r"\D", "", k.get("Driver license", "")) or None
        d.affiliated_businesses = k.get("Affiliated businesses")
        d.signed = bool(re.search(r"/s/\s*\S+", text))
        n = re.search(r"Note from applicant:(.*)", text)
        d.notes = n.group(1).strip() if n else ""
    elif "Driver License" in text:
        d.doc_type = "guarantor_id"
        d.guarantor_name, d.guarantor_address = k.get("Name"), k.get("Address")
        d.guarantor_dob, d.guarantor_dl = k.get("Date of birth"), k.get("DL number")
    elif "Certificate of Formation" in text:
        d.doc_type = "certificate_of_formation"
        d.legal_name, d.formation_date = k.get("Entity name"), k.get("Effective date")
        d.business_address, d.file_number = k.get("Principal office"), k.get("File number")
        d.registered_agent, d.registered_agent_address = k.get("Registered agent"), k.get("Registered office")
        d.organizer = k.get("Organizer")
    elif "CP 575" in text:
        d.doc_type = "ein_letter"
        d.legal_name, d.ein = k.get("Name of business"), k.get("Employer Identification Number")
    elif "Statement period" in text:
        d.doc_type = "bank_statement"
        d.bank_name = text.strip().splitlines()[0].strip()
        d.legal_name = k.get("Account holder")
        d.account_last4 = re.sub(r"\D", "", k.get("Account", ""))[-4:]
        per = re.match(r"(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})", k.get("Statement period", ""))
        d.period_start, d.period_end = (per[1], per[2]) if per else (None, None)
        d.opening_balance, d.total_deposits = _m(k.get("Opening balance")), _m(k.get("Total deposits & credits"))
        d.total_withdrawals, d.closing_balance = _m(k.get("Total withdrawals & debits")), _m(k.get("Closing balance"))
        for l in text.splitlines():
            mm = re.match(r"\s*(\d\d)/(\d\d)/(\d{4})\s+(.+?)\s+((?:\$[\d,]+\.\d\d\s*)+)$", l)
            if mm:
                nums = [float(x.replace("$", "").replace(",", "")) for x in re.findall(r"\$[\d,]+\.\d\d", mm[5])]
                if len(nums) >= 2:
                    d.transactions.append(Txn(date=f"{mm[3]}-{mm[1]}-{mm[2]}", description=mm[4].strip(), amount=nums[0],
                                              balance=nums[-1], direction="unknown"))
        pg = re.findall(r"Page (\d+) of (\d+)", text)
        d.pages_seen = sorted({int(a) for a, _ in pg})
        d.pages_expected = max((int(b) for _, b in pg), default=None)
    elif "Financial Statements" in text or "Profit & Loss" in text:
        d.doc_type = "financial_statements"
        first = text.strip().splitlines()
        d.legal_name = next((l.split("—")[0].split("�")[0].strip() for l in first if "Financial Statements" in l), None)
        pb = re.search(r"Prepared by:\s*(.+)", text)
        if pb:
            segs = re.split(r"\s*[,·�]\s*", pb.group(1).strip())
            d.preparer_name = segs[0]
            d.preparer_firm = segs[1] if len(segs) > 1 and segs[0].lower() != "self-prepared" else None
            ph = re.search(r"(\d{3}-\d{3}-\d{4})", pb.group(1))
            d.preparer_phone = ph.group(1) if ph else None
            if d.preparer_name.lower().startswith("self"):
                d.preparer_name = None
            elif len(segs) > 2 and "," in pb.group(1):
                m2 = re.match(r"(.+?, (?:CPA|EA)),\s*(.+?)\s*[·�]", pb.group(1))
                if m2:
                    d.preparer_name, d.preparer_firm = m2[1], m2[2]
        m = re.search(r"Revenue\s+(\$[\d,\.]+)\s+(\$[\d,\.]+)", text)
        if m:
            d.fy_revenue, d.ytd_revenue = _m(m[1]), _m(m[2])
        ni = re.search(r"Net income\s+(-?\$[\d,\.]+)", text)
        d.net_income = _m(ni[1]) if ni else None
        c = re.search(r"\bCash\s+(\$[\d,\.]+)", text)
        d.cash_balance = _m(c[1]) if c else None
    elif "Income Tax Return" in text:
        d.doc_type = "tax_return"
        d.legal_name, d.ein = k.get("Name"), k.get("EIN")
        d.gross_receipts = _m(k.get("Gross receipts or sales"))
        pp = k.get("Paid preparer") or ""
        m = re.match(r"(.+?)\s*\((.+)\)", pp)
        d.preparer_name, d.preparer_firm = (m[1], m[2]) if m else (pp or None, None)
        d.preparer_ptin = k.get("Preparer PTIN")
        ty = re.search(r"Tax Year (\d{4})", text)
        d.tax_year = int(ty[1]) if ty else None
    elif "Form 7004" in text:
        d.doc_type = "extension_7004"
        d.legal_name, d.ein, d.notes = k.get("Name"), k.get("EIN"), k.get("Status", "")
    elif "Re: Loan request" in text:
        d.doc_type = "request_letter"
        m = re.search(r"requesting \$([\d,\.]+)", text)
        d.amount_requested = float(m[1].replace(",", "")) if m else None
        t = re.search(r"(\d+)-month term", text)
        d.term_months = int(t[1]) if t else None
        sig = re.findall(r"\n\s*([A-Z][^\n]+?,[^\n]+?,\s*([^\n]+?))\s*$", text.strip())
        d.legal_name = sig[-1][1].strip() if sig else None
    elif "Quotation" in text:
        d.doc_type = "equipment_quote"
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        vend = next((l for l in lines[1:3] if "·" in l or "�" in l), "")
        segs = re.split(r"\s*[·�]\s*", vend)
        d.vendor_name = segs[0] if segs else None
        d.vendor_address = segs[1] if len(segs) > 2 else None
        d.vendor_phone = segs[-1] if segs else None
        d.legal_name = k.get("Customer")
        tot = re.search(r"TOTAL\s+(\$[\d,\.]+)", text)
        d.quote_total = _m(tot[1]) if tot else None
        r = re.search(r"Remit to:\s*(.+?)\s*[·�]\s*Routing\s*(\d+)\s*[·�]\s*Account ending\s*(\d+)", text)
        if r:
            d.vendor_bank, d.vendor_routing, d.vendor_account_last4 = r[1], r[2], r[3]
    elif "Collections Notice" in text:
        d.doc_type = "collections_notice"
        d.subject_name = k.get("Borrower")
        d.notice_text = " ".join(text.split())[:400]
    elif "Active Client Contracts" in text:
        d.doc_type = "contract_summary"
        d.contract_currencies = sorted(set(re.findall(r"\b(GBP|EUR|SGD|AED|USD)\b", text)))
    else:
        d.doc_type, d.legible = "other", len(text) > 40
    return d


def fixture_extract(abs_path: Path, rel_path: str, arrive_at: str) -> DocRecord:
    parts = rel_path.replace("\\", "/").split("/")
    folder, name = parts[0], parts[-1]
    ext = abs_path.suffix.lower()
    data = abs_path.read_bytes()
    if ext == ".csv":
        text = data.decode("utf-8", "ignore")
        doc = parse_bank_csv(text) if looks_like_bank_csv(text) else ExtractedDoc(doc_type="other")
        meta = {"producer": "", "creator": "", "creation_date": "", "pages": 1, "sha256": hashlib.sha256(data).hexdigest(), "format": "csv"}
    elif ext == ".pdf":
        pm = read_pdf_meta(abs_path)
        doc = parse_text(pm.text, name)
        meta = pm.dict()
    else:   # phone photo of an ID: the fixture cannot OCR it; Gemini vision does this in the product
        doc = ExtractedDoc(doc_type="guarantor_id", confidence=0.3, notes="image: fields not read by the test fixture")
        meta = {"producer": "", "creator": "", "creation_date": "", "pages": 1, "sha256": hashlib.sha256(data).hexdigest(), "format": "image"}
    return DocRecord(rel_path, folder, name, arrive_at, "fixture", meta, doc, [], meta["sha256"], doc.doc_type)
