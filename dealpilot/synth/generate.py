"""Synthetic data-pack generator: new deals, a NEW fraud trick, and decoys built to tempt false positives.

    .venv\\Scripts\\python.exe -m synth.generate --trick identity --seed 7 --out data\\synth\\identity_7

Writes a complete pack (rules, contacts, history copy, sim/arrivals.jsonl, sim/assignments.json, shared_folder/ with
real PDFs + CSV exports) and ground_truth.json for synth/score.py.  Tricks are deliberately different from the
sample's:  identity | vendor_rail | ledger | circular | template | two_family
"""
from __future__ import annotations
import argparse, calendar, csv, datetime as dt, json, random, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from synth import render as R
from backend import config
from backend.dataset import Dataset
from backend.fraud.features import known_vendor_accounts

TZ = dt.timezone(dt.timedelta(hours=-6))
MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
FIRST = ["Aaron", "Bianca", "Carlos", "Dana", "Elias", "Farah", "Gustavo", "Hannah", "Isaac", "Jenna", "Kofi", "Lena", "Mateo", "Nadia", "Omar",
         "Paula", "Quincy", "Rosa", "Sanjay", "Tessa", "Umar", "Vera", "Wesley", "Ximena", "Yusuf", "Zoe", "Robert", "William", "Michael", "Katherine"]
LAST = ["Alvarado", "Brooks", "Castillo", "Dunn", "Estrada", "Fischer", "Gomez", "Hale", "Iyer", "Jensen", "Khan", "Lowe", "Mendez", "Nolan", "Ortega",
        "Pruitt", "Quinn", "Rao", "Santos", "Tran", "Underwood", "Vance", "Whitaker", "Xu", "Young", "Zimmer", "Bellamy", "Cardenas", "Doyle", "Ellison"]
NICK = {"Robert": "Bob", "William": "Bill", "Michael": "Mike", "Katherine": "Kate"}
BIZ_A = ["Mesa", "Cedar", "Blue Heron", "Iron Oak", "Prairie", "Redbud", "Granite", "Lakeview", "Sable", "Copperfield", "Bayou", "Juniper", "Harvest", "Anchor"]
BIZ_B = [("Roofing", "Roofing Contractors", "238160", ["roofing trucks", "a nail-gun compressor set"]),
         ("Dental Group", "Offices of Dentists", "621210", ["a dental imaging unit", "two treatment chairs"]),
         ("Bakery", "Retail Bakeries", "311811", ["a deck oven", "a dough sheeter"]),
         ("Plumbing", "Plumbing Contractors", "238220", ["a drain-camera rig", "a service van"]),
         ("Logistics", "General Freight Trucking", "484110", ["two box trucks", "a liftgate trailer"]),
         ("Landscaping", "Landscaping Services", "561730", ["a skid steer", "two zero-turn mowers"]),
         ("Print Shop", "Commercial Printing", "323111", ["a wide-format printer", "a finishing cutter"]),
         ("Tile & Stone", "Flooring Contractors", "238330", ["a wet saw line", "a tile polisher"]),
         ("Auto Care", "Automotive Repair", "811111", ["an alignment machine", "two vehicle lifts"]),
         ("Catering", "Caterers", "722320", ["a combi oven", "a refrigerated van"]),
         ("Fitness", "Fitness Centers", "713940", ["cardio equipment", "a sauna build-out"]),
         ("Pharmacy", "Pharmacies and Drug Stores", "456110", ["a robotic pill counter"])]
STREETS = ["Maple St", "Greenville Ave", "Belt Line Rd", "Coit Rd", "Preston Rd", "Jupiter Rd", "Campbell Rd", "Main St", "Elm St", "Ross Ave", "Lemmon Ave"]
CITIES = [("Dallas", "752"), ("Plano", "750"), ("Richardson", "750"), ("Garland", "750"), ("Irving", "750"), ("Frisco", "750"), ("McKinney", "750")]
AGENTS = [("Lone Star Registered Agents Inc", "700 Lavaca St Ste 1401, Austin, TX 78701"), ("Northstar Corporate Services LLC", "5950 Berkshire Ln Ste 1000, Dallas, TX 75225"),
          ("Capitol Services Inc", "1501 S MoPac Expy Ste 220, Austin, TX 78746")]
PREPARERS = [("Lauren Hartwell, CPA", "Hartwell & Co CPAs", "214-555-0110"), ("Rosa Benavides, EA", "Benavides Tax & Accounting", "972-555-0123"),
             ("Samir Patel, CPA", "Rios & Patel CPAs", "214-555-0148"), ("Owen Price, CPA", "Northlake CPA Group", "469-555-0131"),
             ("Tom Becker, CPA", "Becker Accounting", "972-555-0151"), None]
BANKS = ["Trinity Commercial Bank", "Frost-Hill Bank", "Prairie National Bank", "First Lakes Bank", "Comal Credit Union"]
TOOLS = ["Adobe PDF Library 17.0", "Skia/PDF m124", "iLovePDF", "Microsoft: Print To PDF", "macOS Version 14.5 (Build 23F79) Quartz PDFContext",
         "Adobe Acrobat Pro (64-bit) 24.2", "QuickBooks Online PDF"]
SUPPLIERS = ["FERGUSON SUPPLY", "HOME DEPOT PRO", "SYSCO TEXAS", "GRAINGER", "UNITED RENTALS", "SHERWIN WILLIAMS", "STAPLES BUSINESS", "FASTENAL"]


def ein(rng): return f"{rng.randint(11, 98)}-{rng.randint(1000000, 9999999)}"
def phone(rng): return f"{rng.choice(['214', '469', '972'])}-555-01{rng.randint(10, 99)}"
def cents(x): return round(x + 1e-9, 2)


class Gen:
    def __init__(self, seed: int, out: Path, trick: str, n_live: int, history_seed: bool):
        self.rng = random.Random(seed)
        self.out, self.trick, self.n_live, self.history_seed = out, trick, n_live, history_seed
        self.ds = Dataset.load()
        self.known_vendors = known_vendor_accounts(self.ds.history)
        self.used_names: set[str] = set()
        self.truth: dict[str, dict] = {}
        self.ring_shared: dict = {}

    # ------------------------------------------------------------ people / companies
    def person(self, taken_last=None):
        r = self.rng
        f, l = r.choice(FIRST), r.choice([x for x in LAST if x != taken_last])
        return f, l

    def company(self, kind=None):
        r = self.rng
        while True:
            a, (b, ind, naics, items) = r.choice(BIZ_A), (kind or r.choice(BIZ_B))
            name = f"{a} {b}"
            if name not in self.used_names:
                self.used_names.add(name)
                return a, b, ind, naics, items

    def address(self):
        r = self.rng
        city, z = r.choice(CITIES)
        return f"{r.randint(100, 9899)} {r.choice(STREETS)}, {city}, TX {z}{r.randint(10, 99)}"

    def base_deal(self, young=False, equipment=None, revenue=None, needed=False, kind=None) -> dict:
        r = self.rng
        a, b, ind, naics, items = self.company(kind)
        legal = f"{a} {b} LLC"
        f, l = self.person()
        formed = dt.date(2025, r.randint(1, 8), r.randint(1, 28)) if young else dt.date(r.randint(2004, 2021), r.randint(1, 12), r.randint(1, 28))
        rev = revenue or round(r.uniform(0.45e6, 3.6e6), -4)
        agent = r.choice(AGENTS)
        eq = equipment if equipment is not None else r.random() < 0.4
        amount = round(r.uniform(40000, 230000) / 500) * 500 if eq else round(r.uniform(30000, 380000) / 1000) * 1000
        prep = r.choice(PREPARERS)
        d = {
            "name": f"{a} {b}", "legal": legal, "dba": None, "ein": ein(r), "entity": "LLC / Texas", "formed": formed.isoformat(),
            "addr": self.address(), "phone": phone(r), "email": f"info@{a.lower().replace(' ', '')}{b.split()[0].lower()}.example",
            "industry": f"{ind} ({naics})", "employees": r.randint(4, 40), "revenue": rev, "revenue_text": R.money(rev),
            "bank": r.choice(BANKS), "acct4": f"{r.randint(1000, 9999)}", "amount": amount, "letter_amount": amount,
            "product": "Equipment Loan" if eq else r.choice(["Term Loan", "Revolving Line of Credit", "Working Capital Loan"]),
            "term": r.choice([24, 36, 48, 60, 84]) if eq else r.choice([12, 24, 36]), "collateral": "First lien on financed equipment" if eq else "Blanket lien on business assets",
            "needed_by_text": "No specific date", "needed_by": None, "app_date": "2026-11-01", "signed": True,
            "guarantor": self.guarantor(f, l), "agent": {"name": agent[0], "addr": agent[1]}, "file_no": f"0{r.randint(100000000, 899999999)}",
            "preparer": None if prep is None else {"name": prep[0], "firm": prep[1], "phone": prep[2], "ptin": f"P{r.randint(10000000, 99999999)}"},
            "producer": r.choice(TOOLS), "creator": "", "stmt_producer": "FIS Statement Services 9.2", "style": "tidy",
            "young": young, "eq_items": items, "monthly_dep": rev / 12 * r.uniform(0.95, 1.1), "ein_irs": None, "open0": None,
            "truth_issues": [], "contracts": None, "csv_statements": False, "round_dollar": False,
        }
        d["ein_irs"] = d["ein"]
        d["letter_company"] = legal
        d["purpose_cat"], d["purpose_text"] = self.purpose(d, eq, needed)
        if needed:
            d["needed_by_text"] = "Friday 2026-11-06 by 3:00 PM (payroll)"
            d["needed_by"] = "2026-11-06T15:00-06:00"
        d["applicant_note"] = ""
        if d["product"] == "Equipment Loan":
            self.vendor(d, known=r.random() < 0.6)
        return d

    def guarantor(self, f, l):
        r = self.rng
        dob = dt.date(r.randint(1960, 1996), r.randint(1, 12), r.randint(1, 28)).isoformat()
        addr = self.address()
        full = f"{f} {l}"
        return {"first": f, "last": l, "app_name": full, "id_name": full, "dob": dob, "id_dob": dob, "ssn4": f"{r.randint(1000, 9999)}",
                "addr": addr, "id_addr": addr, "dl": f"{r.randint(10000000, 49999999)}", "title": "Owner / 100%"}

    def purpose(self, d, eq, needed):
        items = d["eq_items"]
        if needed:
            d["product"] = "Working Capital Loan"
            d["amount"] = d["letter_amount"] = round(self.rng.uniform(20000, 60000) / 1000) * 1000
            d["term"], d["collateral"] = 12, "Blanket lien on business assets"
            return "payroll", "Cover payroll this Friday while a large invoice is paid in 30 days"
        if eq:
            return "equipment", f"Purchase {items[0]} and {items[1] if len(items) > 1 else 'related accessories'}"
        return self.rng.choice([("inventory", "Inventory financing for the busy season"), ("expansion", "Build out a second location"),
                                ("working_capital", "Working capital while receivables convert"), ("refinance", "Refinance existing equipment debt")])

    def vendor(self, d, known=True, shared_acct=None, name=None):
        r = self.rng
        items = [(d["eq_items"][0].capitalize(), 1, round(d["amount"] * 0.7 / 100) * 100), (d["eq_items"][-1].capitalize(), 1, d["amount"] - round(d["amount"] * 0.7 / 100) * 100)]
        if known:
            vname = r.choice([k for k in self.known_vendors if self.known_vendors[k]])
            acct = sorted(self.known_vendors[vname])[0]
            vname = {"metroplex equipment supply": "Metroplex Equipment Supply, Inc."}.get(vname, vname.title() + " Co")
            routing, bank = "111000614", "Prairie National Bank"
        else:
            vname = name or f"{r.choice(BIZ_A)} {r.choice(['Machinery', 'Supply', 'Equipment', 'Industrial'])} {r.choice(['LLC', 'Inc.'])}"
            acct, routing, bank = f"{r.randint(1000, 9999)}", f"11{r.randint(1000000, 1999999)}", r.choice(BANKS)
        if shared_acct:
            routing, acct, bank = shared_acct
        d["vendor"] = {"name": vname, "addr": self.address(), "phone": phone(r), "bank": bank, "routing": routing, "acct4": acct,
                       "quote_no": f"Q-{r.randint(1000, 9999)}", "items": items, "total": d["amount"]}

    # ------------------------------------------------------------ financial documents
    def finish(self, d: dict, stmts: dict | None = None, deposit_scale=1.0):
        r = self.rng
        d["open0"] = d["monthly_dep"] * r.uniform(0.5, 0.9)
        d["months"] = stmts or self.statements(d, deposit_scale=deposit_scale)
        rev, young = d["revenue"], d["young"]
        fy = round(rev * (0.45 if young else 1.0), 2)
        ytd = round(rev * 0.83 * (1.0 if not young else 1.0), 2)
        def lines(base):
            cogs, pay, rent, oth = round(base * .69, 2), round(base * .132, 2), round(base * .048, 2), round(base * .06, 2)
            gp = round(base - cogs, 2)
            return {"Revenue": base, "Cost of goods sold": -cogs, "Gross profit": gp, "Payroll": -pay, "Rent & occupancy": -rent,
                    "Other operating": -oth, "Net income": round(gp - pay - rent - oth, 2)}
        a, b = lines(fy), lines(ytd)
        d["fin"] = {k: (a[k], b[k]) for k in a}
        d["tax_gross"], d["tax_income"] = fy, a["Net income"]
        cash = round(d["months"][-1]["closing"])
        d["bs_date"] = "2026-10-31"
        d["bs"] = [("Cash", cash), ("Accounts receivable", round(rev * 0.07)), ("Equipment, net", round(rev * 0.1)), ("Total liabilities", round(rev * 0.2))]
        return d

    def statements(self, d, deposit_scale=1.0, round_dollar=False, template=None, circular=None):
        r, out, bal = self.rng, [], d["open0"]
        months = []
        for mi, ym in enumerate(MONTHS):
            y, m = map(int, ym.split("-"))
            ndays = calendar.monthrange(y, m)[1]
            if template is not None:
                evs = [(min(max(day + r.randint(0, 2), 1), ndays), desc, kind, amt) for day, desc, kind, amt in template[mi]]
            else:
                target = d["monthly_dep"] * deposit_scale * (1 + 0.025 * mi) * r.uniform(0.93, 1.07)
                n = r.randint(5, 12)
                cuts = sorted(r.random() for _ in range(n - 1))
                parts = [b - a for a, b in zip([0] + cuts, cuts + [1])]
                deps = [max(250.0, target * p) for p in parts]
                deps = [float(round(x, -2)) if round_dollar else cents(x) for x in deps]
                evs = [(r.randint(1, ndays), r.choice(["BRANCH DEPOSIT", f"ACH CREDIT INV-26-{r.randint(100, 999):04d}", f"STRIPE TRANSFER ST-{r.randint(10000, 99999)}"]), "credit", x) for x in deps]
                if circular:
                    for who in circular:
                        evs.append((r.randint(2, ndays), f"WIRE IN {who.upper()}", "credit", float(r.randint(8, 15) * 1000) + (0 if round_dollar else r.random())))
                outflow = sum(e[3] for e in evs if e[2] == "credit") * r.uniform(0.84, 0.93)
                fixed = [("ACH DEBIT PROPERTY MGMT RENT", .13), ("PAYROLL ADP WAGE PAY", .22), ("PAYROLL ADP WAGE PAY", .22), ("ONCOR ELECTRIC UTIL", .02),
                         ("AT&T BUSINESS", .01), ("TX MUTUAL INS PREM", .03)]
                tot = sum(w for _, w in fixed)
                for desc, w in fixed:
                    evs.append((r.randint(1, ndays), desc, "debit", float(round(outflow * w / 1.0 * 0.55, -1 if round_dollar else 2)) if round_dollar else cents(outflow * w * 0.55)))
                rest = max(outflow - sum(e[3] for e in evs if e[2] == "debit"), 500.0)
                k = r.randint(3, 6)
                for _ in range(k):
                    x = rest / k * r.uniform(0.7, 1.3)
                    evs.append((r.randint(1, ndays), f"ACH DEBIT {r.choice(SUPPLIERS)}", "debit", float(round(x)) if round_dollar else cents(x)))
            evs.sort(key=lambda e: (e[0], e[2] != "credit"))
            opening = bal if mi else cents(d["open0"])
            # keep the running balance positive WITHOUT touching the opening balance (it must equal last month's closing):
            # if it would dip, a transfer-in on day 1 covers it (a real statement transaction, so totals stay honest)
            run, lo = opening, opening
            for _, _, kind, amt in evs:
                run += amt if kind == "credit" else -amt
                lo = min(lo, run)
            if lo < 300:
                evs.insert(0, (1, f"ONLINE TRANSFER FROM XXXX{r.randint(1000, 9999)}", "credit", float(round(300 - lo + r.randint(200, 900)))))
            run, rows = opening, []
            deposits = withdrawals = 0.0
            for day, desc, kind, amt in evs:
                run = cents(run + amt if kind == "credit" else run - amt)
                deposits += amt if kind == "credit" else 0
                withdrawals += amt if kind == "debit" else 0
                rows.append((f"{m:02d}/{day:02d}/{y}", desc, kind, amt, run))
            bal = run
            months.append({"ym": ym, "start": f"{y}-{m:02d}-01", "end": f"{y}-{m:02d}-{ndays:02d}", "opening": cents(opening), "closing": cents(run),
                           "deposits": cents(deposits), "withdrawals": cents(withdrawals), "txns": rows, "events": evs})
        return months

    # ------------------------------------------------------------ rendering
    def render(self, folder: str, d: dict, start: dt.datetime) -> list[dict]:
        base = self.out / "shared_folder" / folder
        base.mkdir(parents=True, exist_ok=True)
        t = start
        arrivals: list[dict] = []
        style = d["style"]
        files = []

        def name(tidy, messy, idx):
            return {"tidy": tidy, "messy": messy, "scan": f"SCAN_20261103_{idx:06d}.pdf"}[style]

        def stmt_name(ym):
            mon = calendar.month_abbr[int(ym[5:])].lower()
            return {"tidy": f"Bank_Statement_{ym}.pdf", "messy": f"{mon} statement.pdf", "scan": None}[style]

        prod, cre = d["producer"], d["creator"]
        issues = set(d.get("skip", []))
        seq = [("app", name("01_Loan_Application.pdf", "loan app FINAL.pdf", 1), R.application),
               ("id", name("02_Guarantor_ID.pdf", "drivers license.pdf", 2), R.guarantor_id),
               ("cert", name("03_Certificate_of_Formation.pdf", "state filing.pdf", 3), R.certificate),
               ("ein", name("04_EIN_Letter.pdf", "irs ein.pdf", 4), R.ein_letter)]
        if "fin" not in issues:
            seq.append(("fin", name("05_Financial_Statements.pdf", "P&L and balance sheet.pdf", 5), R.financials))
        if "tax" not in issues:
            if d["young"] and d.get("use_7004"):
                seq.append(("7004", name("06_IRS_7004.pdf", "IRS 7004 extension.pdf", 6), R.extension_7004))
            elif not d["young"] or not d.get("use_7004"):
                seq.append(("tax", name("06_Tax_Return_2025.pdf", "2025 taxes.pdf", 6), R.tax_return))
        seq.append(("letter", name("07_Request_Letter.pdf", "letter to bank.pdf", 7), R.request_letter))
        if d.get("vendor") and "quote" not in issues:
            seq.append(("quote", name("08_Equipment_Quote.pdf", "equipment quote.pdf", 8), R.equipment_quote))
        if d.get("contracts"):
            seq.append(("contracts", "09_Contract_Summary.pdf", R.contract_summary))
        for kind, fname, fn in seq:
            fn(base / fname, d, prod, cre)
            t += dt.timedelta(minutes=self.rng.randint(1, 3))
            arrivals.append({"path": f"{folder}/{fname}", "arrive_at": t.isoformat(timespec="minutes")})
        for i, mo in enumerate(d["months"]):
            if mo["ym"] in d.get("skip_months", []):
                continue
            t += dt.timedelta(minutes=1)
            if d["csv_statements"]:
                fname = f"export_{calendar.month_name[int(mo['ym'][5:])].lower()}_2026.csv"
                with open(base / fname, "w", encoding="utf-8", newline="") as f:
                    f.write(f"{d['bank']} - acct ...{d['acct4']} - {d['legal']}\nPosted Date,Details,Amount,Running Bal\n")
                    for date, desc, kind, amt, bal in mo["txns"]:
                        mm, dd, yy = date.split("/")
                        f.write(f"{int(mm)}/{int(dd)}/{yy[2:]},{desc},{amt if kind == 'credit' else -amt:.2f},{bal:.2f}\n")
            else:
                fname = stmt_name(mo["ym"]) or f"SCAN_20261103_{20 + i:06d}.pdf"
                R.bank_statement(base / fname, d, mo, d["stmt_producer"], "", truncate_to_one_page=(mo["ym"] in d.get("short_page_months", [])))
            arrivals.append({"path": f"{folder}/{fname}", "arrive_at": t.isoformat(timespec="minutes")})
        return arrivals

    # ------------------------------------------------------------ scenario
    def build(self):
        r = self.rng
        deals: list[tuple[str, dict, dict]] = []     # (folder, deal, truth)

        def add(d, label, decoy=None, trick=None, issues=None, folder=None):
            folder = folder or d["name"]
            deals.append((folder, d, {"label": label, "decoy": decoy, "trick": trick, "expected_issues": issues or d.get("truth_issues", [])}))

        # ---- decoys / honest deals
        d = self.base_deal(young=True); d.update(style="messy", csv_statements=True, use_7004=True, stmt_producer="", skip_months=["2026-06"],
                                                 applicant_note="some statements are CSV exports from our bank app, sorry for the mess. June missing, will send.",
                                                 revenue_text="approx 400-500k (annualized, we are growing fast)", producer="Adobe PDF Library 17.0")
        d["revenue"] = 450000.0; d["monthly_dep"] = 450000 / 12 * 1.05; d["product"] = "Term Loan"; d["amount"] = d["letter_amount"] = 150000
        d["purpose_cat"], d["purpose_text"] = "expansion", "Hire two engineers and pre-buy hardware kits for Q1 pilots"; d["vendor"] = None
        d["guarantor"]["title"] = "CEO / 72%"; d["collateral"] = "None offered (unsecured)"
        add(self.finish(d), "good", "messy_startup", issues=["MISSING_DOC:bank_statement_2026-06"])

        d = self.base_deal(revenue=9.4e6, equipment=False); d.update(contracts=[("Halden Energy plc", "UK", "GBP 1,450,000", "Net 60"), ("Rheinwerk Logistik GmbH", "Germany", "EUR 2,100,000", "Net 90"),
                                                                                  ("Straits Port Authority", "Singapore", "SGD 1,800,000", "Net 60")])
        d.update(product="Revolving Line of Credit", amount=1_200_000, letter_amount=1_200_000, term=24)
        d["purpose_cat"], d["purpose_text"] = "working_capital", "Bridge receivables on multi-country contracts with 60-90 day payment terms"; d["vendor"] = None
        add(self.finish(d), "good", "international_big")

        d = self.base_deal(equipment=False, needed=True); add(self.finish(d), "good", "urgent_payroll")

        d = self.base_deal(equipment=False)
        g = d["guarantor"]
        g.update(first="Robert", app_name=f"Bob {g['last']}", id_name=f"Robert Allen {g['last']}")
        d["letter_company"] = d["legal"]
        add(self.finish(d), "good", "nickname_id")

        d = self.base_deal(equipment=False); d["ein_irs"] = d["ein"][:3] + d["ein"][4] + d["ein"][3] + d["ein"][5:]
        if d["ein_irs"] == d["ein"]: d["ein_irs"] = d["ein"][:-1] + str((int(d["ein"][-1]) + 1) % 10)
        add(self.finish(d), "good", "ein_typo", issues=["MISMATCH:ein"])

        d = self.base_deal(equipment=False); d["skip_months"] = ["2026-07"]
        add(self.finish(d), "good", "missing_statement", issues=["MISSING_DOC:bank_statement_2026-07"])

        d = self.base_deal(equipment=False); d["short_page_months"] = ["2026-08"]
        add(self.finish(d), "good", "missing_page", issues=["MISSING_PAGE:bank_statement_2026-08"])

        d = self.base_deal(equipment=False); d["skip"] = ["tax"]; d["young"] = False
        add(self.finish(d), "good", "missing_tax", issues=["MISSING_DOC:tax_return"])

        d = self.base_deal(equipment=True); self.vendor(d, known=True); d["style"] = "scan"
        add(self.finish(d), "good", "scan_names_known_vendor")

        d = self.base_deal(equipment=True); self.vendor(d, known=False)
        d["letter_amount"] = d["amount"] - 5000
        add(self.finish(d), "good", "amount_mismatch_new_vendor", issues=["MISMATCH:amount_requested"])

        # repeat customer: same entity as a history row, small step-up
        d = self.base_deal(equipment=False)
        add(self.finish(d), "good", "plain_good_1"); add(self.finish(self.base_deal(equipment=False)), "good", "plain_good_2")
        add(self.finish(self.base_deal(equipment=True)), "good", "plain_good_3")

        # ---- old-trick deals
        d = self.base_deal(equipment=False, revenue=3.0e6); d = self.finish(d, deposit_scale=0.32)
        add(d, "fraud", "old_trick", trick="REV_INFLATION", issues=["OLD_TRICK:REV_INFLATION"])

        # ---- the NEW trick ring
        ring = self.make_ring()
        # one honest deal that shares ONE rare attribute with the ring (a coincidence is not fraud)
        coin = self.base_deal(equipment=False)
        self.apply_coincidence(coin)
        add(self.finish(coin), "good", "single_rare_coincidence")

        r.shuffle(deals)
        # place the first ring member as the 4th deal to arrive, others spread through the week
        order = [x for x in deals]
        ring_pos = [3, 7, 10, 12][:len(ring)]
        for k, (rd, label, trick) in enumerate(ring):
            order.insert(min(ring_pos[k], len(order)), (rd["name"], rd, {"label": "fraud", "decoy": None, "trick": trick, "expected_issues": []}))
        return order[: self.n_live + len(ring)] if self.n_live else order

    # ------------------------------------------------------------ tricks
    def make_ring(self):
        r, t = self.rng, self.trick
        K = 4 if t in ("template", "two_family") else 3
        members = []
        shared_prep = ("Dalia Whitcombe, CPA", "Whitcombe Tax Studio", f"214-555-0{r.randint(200, 299)}")
        shared_id = None
        shared_remit = ("111000" + str(r.randint(100, 999)), "", "")
        tool = r.choice(["PDFium Export 7.3", "DocuForge 3.0 (Linux)", "NovaPDF Studio 12"])
        ledger_template = None
        names = []
        for i in range(K):
            eq = t in ("vendor_rail",) or (t == "template" and r.random() < .5)
            d = self.base_deal(equipment=eq, young=(t in ("template", "two_family")))
            names.append(d["legal"])
            members.append(d)
        for i, d in enumerate(members):
            if t == "identity":
                f, l = self.person(); g = self.guarantor(f, l)
                if i == 0:
                    shared_id = {"dl": g["dl"], "ssn4": g["ssn4"], "dob": g["dob"]}
                    self.ring_shared["identity"] = shared_id
                    d["guarantor"] = g
                else:
                    g.update(dl=shared_id["dl"], ssn4=shared_id["ssn4"], dob=shared_id["dob"], id_dob=shared_id["dob"])
                    d["guarantor"] = g
                self.finish(d)
            elif t == "vendor_rail":
                self.vendor(d, known=False, shared_acct=(shared_remit[0] + "614", str(r.randint(1000, 9999)) if i == 0 else self.ring_shared.get("acct"), "First Lakes Bank"))
                if i == 0:
                    self.ring_shared["acct"] = d["vendor"]["acct4"]
                d["vendor"]["acct4"] = self.ring_shared["acct"]
                self.finish(d)
            elif t == "ledger":
                if i == 0:
                    self.finish(d)
                    ledger_template = [[(int(e[0]), e[1], e[2], e[3]) for e in mo["events"]] for mo in d["months"]]
                else:
                    d["open0"] = d["monthly_dep"] * r.uniform(0.5, 0.9)
                    self.finish(d, stmts=self.statements(d, template=ledger_template))
            elif t == "circular":
                others = [x["legal"] for j, x in enumerate(members) if j != i]
                d["open0"] = d["monthly_dep"] * r.uniform(0.5, 0.9)
                self.finish(d, stmts=self.statements(d, circular=[others[(i) % len(others)]]))
            elif t in ("template", "two_family"):
                d.update(producer=tool, stmt_producer=tool, round_dollar=True)
                if t == "template":
                    d["preparer"] = {"name": shared_prep[0], "firm": shared_prep[1], "phone": shared_prep[2], "ptin": f"P{r.randint(10000000, 99999999)}"}
                    d["agent"] = {"name": "Brazos Filing Partners LLC", "addr": "88 Brazos Plaza Ste 2, Austin, TX 78701"}
                d["open0"] = d["monthly_dep"] * r.uniform(0.5, 0.9)
                self.finish(d, stmts=self.statements(d, round_dollar=True))
            if d.get("vendor") is None and d["product"] == "Equipment Loan":
                self.vendor(d, known=True)
        self.ring_shared["prep"] = shared_prep
        self.ring_shared["tool"] = tool
        # tidy files for ring members so file names carry no hint
        return [(d, "fraud", t) for d in members]

    def apply_coincidence(self, d):
        """An honest deal that happens to share ONE rare attribute with the ring. One family only: must NOT be flagged."""
        sp = self.ring_shared.get("prep")
        if self.trick in ("template",) and sp:
            d["preparer"] = {"name": sp[0], "firm": sp[1], "phone": sp[2], "ptin": "P12345678"}
        elif self.trick in ("two_family",):
            d["producer"] = self.ring_shared["tool"]
        elif self.trick == "identity":
            d["agent"] = {"name": AGENTS[1][0], "addr": AGENTS[1][1]}

    # ------------------------------------------------------------ pack
    def write_pack(self):
        out = self.out
        if out.exists():
            shutil.rmtree(out)
        for sub in ("rules", "contacts", "history"):
            shutil.copytree(self.ds.root / sub, out / sub)
        (out / "sim").mkdir(parents=True)
        order = self.build()
        start = dt.datetime(2026, 11, 2, 9, 0, tzinfo=TZ)
        slots = [(0, 9, 20), (0, 11, 40), (0, 14, 0), (0, 15, 30), (1, 8, 45), (1, 11, 10), (1, 13, 15), (1, 15, 50), (2, 9, 10), (2, 10, 25),
                 (2, 14, 20), (3, 9, 30), (3, 13, 0), (3, 15, 10), (4, 9, 0), (4, 11, 0)]
        arrivals, assignments = [], {}
        rms, cos = ["brian.foster", "elena.ruiz"], ["marcus.lee", "aisha.grant", "dana.whitfield"]
        used_names = set()
        for i, (folder, d, truth) in enumerate(order):
            base = folder
            while folder in used_names:
                folder += " II"
            used_names.add(folder)
            day, hh, mm = slots[min(i, len(slots) - 1)]
            t0 = (start + dt.timedelta(days=day)).replace(hour=hh, minute=mm)
            arrivals += self.render(folder, d, t0)
            assignments[folder] = {"relationship_manager": rms[i % 2], "credit_officer": cos[i % 3]}
            g, ein_v = d["guarantor"], d["ein"]
            self.truth[folder] = {**truth, "extracted": {"legal_name": d["legal"], "ein": ein_v, "amount_requested": float(d["amount"]),
                                  "purpose_category": d["purpose_cat"], "product": d["product"], "term_months": d["term"],
                                  "guarantor_name": g["app_name"], "annual_revenue_stated": float(d["revenue"]) if d["revenue_text"][0] == "$" else None,
                                  "needed_by": d["needed_by"]}}
        (out / "sim" / "arrivals.jsonl").write_text("\n".join(json.dumps(a) for a in sorted(arrivals, key=lambda a: a["arrive_at"])) + "\n", encoding="utf-8")
        (out / "sim" / "assignments.json").write_text(json.dumps(assignments, indent=1), encoding="utf-8")
        ring = [f for f, v in self.truth.items() if v["label"] == "fraud" and v["trick"] == self.trick]
        for f in ring:
            self.truth[f]["ring"] = [x for x in ring if x != f]
        seeds = self.history_seeds() if (self.history_seed and self.trick in ('template', 'two_family', 'identity')) else []
        (out / "ground_truth.json").write_text(json.dumps({"trick": self.trick, "deals": self.truth, "ring": ring, "history_seeds": seeds}, indent=1), encoding="utf-8")
        return ring

    def history_seeds(self) -> list[str]:
        """Add 2 earlier ring deals to history/ (funded, label 'none': the bank has not noticed them yet)."""
        hd = self.out / "history"
        rows = list(csv.DictReader(open(hd / "deals.csv", encoding="utf-8")))
        cols = list(rows[0].keys())
        seeds = []
        for k in range(2):
            d = self.base_deal(equipment=False, young=True)
            self.finish(d)
            row = {c: "" for c in cols}
            hid = f"H-2609-9{k:02d}"
            g = d["guarantor"]
            sp = self.ring_shared.get("prep") or ("", "", "")
            row.update(deal_id=hid, application_date=f"2026-09-{10 + k}", legal_name=d["legal"], ein=d["ein"], industry=d["industry"].split(" (")[0],
                       naics=d["industry"].split("(")[1].rstrip(")"), formation_date=d["formed"], business_address=d["addr"],
                       registered_agent=d["agent"]["name"], registered_agent_address=d["agent"]["addr"], guarantor_name=g["app_name"],
                       guarantor_dob=g["dob"], guarantor_ssn_last4=g["ssn4"], guarantor_dl_number=g["dl"], preparer_name=sp[0], preparer_firm=sp[1],
                       preparer_phone=sp[2], bank_name=d["bank"], amount_requested=str(d["amount"]), product=d["product"], purpose=d["purpose_cat"],
                       term_months=str(d["term"]), annual_revenue_stated=str(int(d["revenue"])), pdf_producer=self.ring_shared.get("tool", d["producer"]),
                       final_status="funded", fraud_label="none", repayment_status="current")
            if self.trick == "identity" and self.ring_shared.get("identity"):
                sid = self.ring_shared["identity"]
                row.update(guarantor_dl_number=sid["dl"], guarantor_ssn_last4=sid["ssn4"], guarantor_dob=sid["dob"])
            rows.append(row)
            seeds.append(hid)
            dep = list(csv.DictReader(open(hd / "monthly_deposits.csv", encoding="utf-8")))
            with open(hd / "monthly_deposits.csv", "a", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                for mo in d["months"]:
                    w.writerow([hid, mo["ym"].replace("2026", "2026"), mo["deposits"], len(mo["txns"]), 1.0 if self.trick in ("template", "two_family") else 0.01,
                                "Mon,Thu" if self.trick in ("template", "two_family") else "Mon-Fri", max(t[3] for t in mo["txns"]), mo["closing"]])
        with open(hd / "deals.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        return seeds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trick", default="template", choices=["identity", "vendor_rail", "ledger", "circular", "template", "two_family"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--live", type=int, default=0, help="cap on total live deals (0 = all)")
    ap.add_argument("--out", default="")
    ap.add_argument("--history-seed", action="store_true", help="add 2 earlier ring deals to history/")
    a = ap.parse_args()
    out = Path(a.out or config.ROOT / "data" / "synth" / f"{a.trick}_{a.seed}")
    g = Gen(a.seed, out, a.trick, a.live, a.history_seed)
    ring = g.write_pack()
    print(f"wrote {out}  | {len(g.truth)} deals | ring ({a.trick}): {ring}")


if __name__ == "__main__":
    main()
