"""CSV bank exports (e.g. export_may_2026.csv). Deterministic ingestion of structured rows: no LLM is
needed to transcribe numbers that are already machine-readable. Gemini still classifies the file."""
from __future__ import annotations
import csv, io, re
from datetime import date
from ..models import ExtractedDoc, Txn


def _d(s: str) -> str | None:
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})$", s.strip())
    if not m:
        return None
    mo, d, y = int(m[1]), int(m[2]), int(m[3])
    y += 2000 if y < 100 else 0
    return date(y, mo, d).isoformat()


def looks_like_bank_csv(text: str) -> bool:
    head = "\n".join(text.splitlines()[:4]).lower()
    return "running bal" in head or ("amount" in head and "date" in head)


def parse_bank_csv(text: str) -> ExtractedDoc:
    lines = text.splitlines()
    banner = lines[0] if lines and "," not in lines[0] else ""
    start = 1 if banner else 0
    rdr = csv.DictReader(io.StringIO("\n".join(lines[start:])))
    txns, first_bal, first_amt = [], None, None
    for row in rdr:
        keys = {k.strip().lower(): v for k, v in row.items() if k and v is not None}
        date_s = next((v for k, v in keys.items() if "date" in k), "")
        desc = next((v for k, v in keys.items() if "detail" in k or "desc" in k), "")
        try:
            amt = float(str(keys["amount"]).replace(",", "").replace("$", ""))
        except (KeyError, ValueError):
            continue
        bal_s = next((v for k, v in keys.items() if "bal" in k), "")
        try:
            bal = float(bal_s.replace(",", "").replace("$", ""))
        except ValueError:
            bal = None
        if first_bal is None and bal is not None:
            first_bal, first_amt = bal, amt
        txns.append(Txn(date=_d(date_s), description=desc.strip(), amount=abs(amt),
                        direction="credit" if amt > 0 else "debit", balance=bal))
    doc = ExtractedDoc(doc_type="bank_statement", confidence=1.0, transactions=txns)
    m = re.match(r"(.+?)\s+-\s+acct\s+\.*(\d+)\s+-\s+(.+)$", banner)
    if m:
        doc.bank_name, doc.account_last4, doc.legal_name = m[1].strip(), m[2][-4:], m[3].strip()
    dates = sorted(t.date for t in txns if t.date)
    if dates:
        y, mo = int(dates[0][:4]), int(dates[0][5:7])
        doc.period_start = date(y, mo, 1).isoformat()
        nxt = date(y + (mo == 12), mo % 12 + 1, 1)
        doc.period_end = date.fromordinal(nxt.toordinal() - 1).isoformat()
    if first_bal is not None and txns:
        delta = first_amt
        doc.opening_balance = round(first_bal - delta, 2)
        doc.closing_balance = txns[-1].balance
    doc.total_deposits = round(sum(t.amount for t in txns if t.direction == "credit"), 2)
    doc.total_withdrawals = round(sum(t.amount for t in txns if t.direction == "debit"), 2)
    doc.pages_seen, doc.pages_expected = [1], 1
    return doc
