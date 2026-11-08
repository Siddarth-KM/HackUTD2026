"""Render synthetic loan documents as real PDFs (reportlab) in the same label/value style as the bank's samples,
so both Gemini and the text layer read them the way they read the real folder."""
from __future__ import annotations
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

W, H = letter
LX, VX = 56, 250


def _new(path: Path, title: str, producer: str, creator: str = "") -> canvas.Canvas:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=letter, pageCompression=0)
    c.setTitle(title)
    c.setProducer(producer)
    c.setCreator(creator)
    return c


class Doc:
    def __init__(self, path: Path, title: str, producer: str, creator: str = "", heading: str = ""):
        self.c = _new(path, title, producer, creator)
        self.y = H - 60
        if heading:
            self.c.setFont("Helvetica", 9)
            self.c.drawString(LX, self.y, heading)
            self.y -= 22
        self.c.setFont("Helvetica-Bold", 15)
        self.c.drawString(LX, self.y, title)
        self.y -= 28

    def section(self, text: str):
        self.y -= 6
        self.c.setFont("Helvetica-Bold", 10.5)
        self.c.drawString(LX, self.y, text)
        self.y -= 18

    def row(self, label: str, value: str):
        self.c.setFont("Helvetica", 10)
        self.c.drawString(LX, self.y, label)
        self.c.drawString(VX, self.y, str(value))
        self.y -= 17

    def text(self, s: str, size=10.5, gap=15):
        self.c.setFont("Helvetica", size)
        for line in _wrap(s, 95):
            self.c.drawString(LX, self.y, line)
            self.y -= gap

    def save(self):
        self.c.save()


def _wrap(s: str, n: int):
    out, cur = [], ""
    for w in s.split():
        if len(cur) + len(w) + 1 > n:
            out.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        out.append(cur)
    return out


def money(x: float) -> str:
    return f"${x:,.2f}" if x >= 0 else f"-${-x:,.2f}"


# ------------------------------------------------------------------ documents
def application(path, d, producer, creator=""):
    doc = Doc(path, "Small Business Loan Application", producer, creator, "Trinity Commercial Bank — Commercial Lending")
    g = d["guarantor"]
    doc.section("Section A — Business")
    for k, v in [("Legal business name", d["legal"]), ("DBA / trade name", d.get("dba") or "—"), ("Federal EIN", d["ein"]),
                 ("Entity type / state", d["entity"]), ("Date business established", d["formed"]), ("Business address", d["addr"]),
                 ("Business phone / email", f"{d['phone']} / {d['email']}"), ("Industry (NAICS)", d["industry"]),
                 ("Number of employees", d["employees"]), ("Annual revenue (most recent year)", d["revenue_text"]),
                 ("Primary bank / account", f"{d['bank']} ...{d['acct4']}")]:
        doc.row(k, v)
    doc.section("Section B — Loan request")
    for k, v in [("Amount requested", money(d["amount"])), ("Product", d["product"]), ("Use of proceeds", d["purpose_text"]),
                 ("Requested term", f"{d['term']} months"), ("Collateral offered", d["collateral"]), ("Funds needed by", d["needed_by_text"])]:
        doc.row(k, v)
    doc.section("Section C — Owner / guarantor")
    for k, v in [("Name", g["app_name"]), ("Title / ownership", g["title"]), ("Date of birth", g["dob"]),
                 ("SSN", f"XXX-XX-{g['ssn4']}"), ("Home address", g["addr"]), ("Driver license", f"TX {g['dl']}"),
                 ("Affiliated businesses", d.get("affiliated", "None"))]:
        doc.row(k, v)
    if d.get("applicant_note"):
        doc.y -= 4
        doc.text("Note from applicant: " + d["applicant_note"], 9.5, 13)
    doc.y -= 4
    doc.text("I certify the information in this application is true and complete and authorize Trinity Commercial Bank to verify it, including credit and identity checks.", 9, 12)
    doc.y -= 6
    if d.get("signed", True):
        doc.text(f"/s/ {g['app_name']} Date: {d['app_date']}", 10.5)
    doc.save()


def guarantor_id(path, d, producer, creator=""):
    doc = Doc(path, "Texas Driver License — Copy", producer, creator)
    g = d["guarantor"]
    for k, v in [("Name", g["id_name"]), ("Address", g["id_addr"]), ("Date of birth", g["id_dob"]), ("DL number", g["dl"]),
                 ("Class", "C"), ("Issued", "2024-03-02"), ("Expires", "2030-03-02")]:
        doc.row(k, v)
    doc.y -= 6
    doc.text("Front and back scanned. SYNTHETIC SPECIMEN — not a real credential.", 9)
    doc.save()


def certificate(path, d, producer, creator=""):
    doc = Doc(path, "Certificate of Formation — Filing Acknowledgment", producer, creator)
    doc.text("Office of the Secretary of State (synthetic record)", 9.5)
    a = d["agent"]
    for k, v in [("Entity name", d["legal"]), ("Entity type", d["entity"].split(" / ")[0]), ("File number", d["file_no"]),
                 ("Effective date", d["formed"]), ("Principal office", d["addr"]), ("Registered agent", a["name"]),
                 ("Registered office", a["addr"]), ("Organizer", d["guarantor"]["id_name"])]:
        doc.row(k, v)
    doc.save()


def ein_letter(path, d, producer, creator=""):
    doc = Doc(path, "IRS Notice CP 575 — EIN Assigned (copy)", producer, creator)
    for k, v in [("Name of business", d["legal"].upper()), ("Employer Identification Number", d["ein_irs"]), ("Date of notice", d["formed"])]:
        doc.row(k, v)
    doc.y -= 6
    doc.text("Keep this notice in your permanent records. (Synthetic document for testing.)", 9)
    doc.save()


def financials(path, d, producer, creator=""):
    p = d["preparer"]
    prep = f"{p['name']}, {p['firm']} · {p['phone']}" if p else "Self-prepared, (owner)"
    doc = Doc(path, f"{d['legal']} — Financial Statements", producer, creator, p["firm"] if p else "")
    doc.text(f"Prepared by: {prep}", 10)
    doc.section("Profit & Loss")
    doc.row("Line", "FY 2025                    YTD Jan–Oct 2026")
    f = d["fin"]
    for k in ["Revenue", "Cost of goods sold", "Gross profit", "Payroll", "Rent & occupancy", "Other operating", "Net income"]:
        a, b = f[k]
        doc.row(k, f"{money(a)}            {money(b)}")
    doc.section(f"Balance sheet as of {d['bs_date']}")
    doc.row("Item", "Amount")
    for k, v in d["bs"]:
        doc.row(k, money(v))
    doc.save()


def tax_return(path, d, producer, creator=""):
    doc = Doc(path, "U.S. Income Tax Return for an S Corporation / Partnership — Summary (Tax Year 2025)", producer, creator)
    p = d["preparer"]
    rows = [("Name", d["legal"]), ("EIN", d["ein_irs"]), ("Gross receipts or sales", money(d["tax_gross"])),
            ("Ordinary business income", money(d["tax_income"])),
            ("Paid preparer", f"{p['name']} ({p['firm']})" if p else "Self-prepared"),
            ("Preparer PTIN", p["ptin"] if p else "—"), ("Date filed", "2026-03-12")]
    for k, v in rows:
        doc.row(k, v)
    doc.save()


def extension_7004(path, d, producer, creator=""):
    doc = Doc(path, "Form 7004 — Application for Automatic Extension (copy)", producer, creator)
    for k, v in [("Name", d["legal"]), ("EIN", d["ein_irs"]), ("Tax year", "2025"), ("Extended due date", "2026-09-15"),
                 ("Status", "Filed 2026-03-13 — return not yet filed as of application date")]:
        doc.row(k, v)
    doc.save()


def request_letter(path, d, producer, creator=""):
    doc = Doc(path, "Re: Loan request", producer, creator)
    doc.text("To: Trinity Commercial Bank Commercial Lending")
    doc.y -= 4
    doc.text(f"We are requesting {money(d['letter_amount'])} to {d['purpose_text'][0].lower() + d['purpose_text'][1:]}. We would like a {d['term']}-month term.")
    if d.get("letter_extra"):
        doc.text(d["letter_extra"])
    doc.y -= 6
    g = d["guarantor"]
    doc.text(f"{g['app_name']}, {g['title'].split(' / ')[0]}, {d['letter_company']}")
    doc.save()


def equipment_quote(path, d, producer, creator=""):
    v = d["vendor"]
    doc = Doc(path, f"Quotation {v['quote_no']}", producer, creator)
    doc.text(f"{v['name']} · {v['addr']} · {v['phone']}")
    doc.row("Customer", d["legal"])
    doc.row("Quote date", "2026-10-24")
    doc.y -= 6
    doc.row("Item", "Qty Price")
    for it, q, pr in v["items"]:
        doc.row(it, f"{q}   {money(pr)}")
    doc.row("TOTAL", money(v["total"]))
    doc.y -= 6
    doc.text(f"Remit to: {v['bank']} · Routing {v['routing']} · Account ending {v['acct4']}", 10)
    doc.text("50% deposit due on order; balance on delivery.", 10)
    doc.save()


def contract_summary(path, d, producer, creator=""):
    doc = Doc(path, "Active Client Contracts — Summary", producer, creator)
    doc.row("Client", "Country  Contract value  Terms")
    for r in d["contracts"]:
        doc.row(r[0], f"{r[1]}  {r[2]}  {r[3]}")
    doc.save()


def bank_statement(path, d, month: dict, producer, creator="", truncate_to_one_page=False, per_page=28):
    """month: {ym, opening, closing, deposits, withdrawals, txns:[(mm/dd/yyyy, desc, kind, amount, balance)]}"""
    rows = month["txns"]
    if truncate_to_one_page:
        per_page = max(5, len(rows) // 2 + 1)      # force >= 2 pages so page 2 can be 'lost'
    n_pages = max(1, -(-len(rows) // per_page))
    doc = Doc(path, "Business Checking Statement", producer, creator, d["bank"])
    c = doc.c
    for k, v in [("Account holder", d["legal"]), ("Account", f"Business Checking ...{d['acct4']}"),
                 ("Statement period", f"{month['start']} to {month['end']}"), ("Opening balance", money(month["opening"])),
                 ("Total deposits & credits", money(month["deposits"])), ("Total withdrawals & debits", money(month["withdrawals"])),
                 ("Closing balance", money(month["closing"]))]:
        doc.row(k, v)
    pages = [rows[i:i + per_page] for i in range(0, len(rows), per_page)] or [[]]
    for pi, chunk in enumerate(pages, 1):
        if truncate_to_one_page and pi > 1:
            break
        doc.y -= 8
        c.setFont("Helvetica-Bold", 9)
        for x, t in [(56, "Date"), (122, "Description"), (330, "Credit"), (410, "Debit"), (480, "Balance")]:
            c.drawString(x, doc.y, t)
        doc.y -= 14
        c.setFont("Helvetica", 9)
        for date, desc, kind, amt, bal in chunk:
            c.drawString(56, doc.y, date)
            c.drawString(122, doc.y, desc[:40])
            c.drawString(330 if kind == "credit" else 410, doc.y, money(amt))
            c.drawString(480, doc.y, money(bal))
            doc.y -= 13.5
        c.setFont("Helvetica", 8.5)
        c.drawString(56, 36, f"Page {pi} of {n_pages}")
        if pi < len(pages) and not (truncate_to_one_page and pi >= 1):
            c.showPage()
            doc.y = H - 60
    doc.save()
