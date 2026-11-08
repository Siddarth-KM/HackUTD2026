"""Deal profiles for cross-deal fraud detection.

A profile is a bag of TOKENS, each belonging to an independent evidence FAMILY:

  provenance  how the paperwork was produced (PDF producer/creator, one tool for borrower docs AND bank statements)
  people      who is behind it (preparer, registered agent, guarantor id/DOB/name, phones, addresses, organizer)
  money       where money moves (vendor + remit account, operating bank account)
  numeric     the style of the numbers (share of round-dollar deposits, deposit weekdays, identical monthly totals)
  (context)   company age: shown as supporting evidence, never links deals by itself

The same token vocabulary is produced for a LIVE deal (from extracted documents) and for a HISTORY row, so a new
deal can be compared against a year of past deals. Nothing here knows about any specific trick: a ring is whatever
shares RARE tokens across >=2 families (see graph.py).
"""
from __future__ import annotations
import math, re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from typing import Optional
from ..ingest.extract import DocRecord
from ..validate.facts import current, statements
from ..validate.old_tricks import recompute_flows, norm_addr_street
from ..validate.textnorm import norm_entity, norm_preparer, parse_date, digits, norm_ein, person_tokens

FAMILIES = ("provenance", "people", "money", "numeric")
APPROVAL_LIMITS = (250_000.0,)        # rules/stages.json routing.delegated_max_amount boundary
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# A numeric-style token is emitted only when the VALUE is unusual in itself (>=60% round-hundred deposits; deposits
# on only a couple of weekdays). 'Mon-Fri' or 'all days' are merely uncommon in a small corpus, not distinctive.
ROUND_STYLE_MIN = 0.60
COMMON_DAY_LABELS = {"Mon-Fri", "Mon-Sat", "all days", "Tue-Sat", "Mon-Sun", "Tue-Sun"}


@dataclass
class Profile:
    pid: str                                  # folder name (live) or H-... (history)
    kind: str                                 # "live" | "history"
    label: str                                # human label (legal name)
    tokens: dict[str, str] = field(default_factory=dict)      # token -> family
    stats: dict[str, float] = field(default_factory=dict)     # numeric features for the anomaly model
    txn_sig: Counter = field(default_factory=Counter)         # live only: (amount, description shape)
    counterparties: set[str] = field(default_factory=set)     # live only: normalised names found in txn descriptions
    own_names: set[str] = field(default_factory=set)          # normalised legal name / dba
    watch: list[str] = field(default_factory=list)            # single-deal oddities (never a hold on their own)
    context: dict[str, str] = field(default_factory=dict)     # weak facts shown as supporting evidence, never used to link
    meta: dict = field(default_factory=dict)

    def add(self, family: str, key: str, value) -> None:
        if value is None:
            return
        v = str(value).strip().lower()
        if not v or v in {"-", "none", "(owner)", "self-prepared", "n/a", "null"}:
            return
        self.tokens[f"{family}:{key}={v}"] = family


# --------------------------------------------------------------------------- helpers
def pct_bin(x: float) -> str:
    return "0-10" if x < .10 else "10-30" if x < .30 else "30-60" if x < .60 else "60-90" if x < .90 else "90-100"


def weekday_label(days: set[int]) -> str:
    if not days:
        return ""
    if 6 in days:
        return "all days"
    if len(days) >= 5 and days <= {0, 1, 2, 3, 4}:
        return "Mon-Fri"
    if len(days) >= 5 and days <= {0, 1, 2, 3, 4, 5}:
        return "Mon-Sat"
    return ",".join(WEEKDAYS[d] for d in sorted(days))


def _street(addr: Optional[str]) -> str:
    return norm_addr_street(addr or "")


def _near_limit(amount: Optional[float]) -> Optional[str]:
    if not amount:
        return None
    for lim in APPROVAL_LIMITS:
        if 0.95 * lim <= amount < lim:
            return f"{int(lim/1000)}k"
    return None


def _desc_shape(d: str) -> str:
    return re.sub(r"\d+", "#", d.upper()).strip()


def credit_txns(doc) -> list:
    """Credits recomputed from balance movement (not trusting the extractor's direction)."""
    out, prev = [], doc.opening_balance
    for t in doc.transactions:
        if t.balance is not None and prev is not None:
            is_credit = t.balance - prev >= 0
        else:
            is_credit = t.direction == "credit"
        if is_credit:
            out.append(t)
        if t.balance is not None:
            prev = t.balance
    return out


# --------------------------------------------------------------------------- history rows
def history_profile(row: dict, deposits: list[dict]) -> Profile:
    p = Profile(row["deal_id"], "history", row.get("legal_name", ""))
    p.meta = {"final_status": row.get("final_status"), "fraud_label": row.get("fraud_label"),
              "repayment": row.get("repayment_status"), "amount": row.get("amount_requested")}
    p.own_names = {norm_entity(row.get("legal_name"))}
    p.add("provenance", "producer", row.get("pdf_producer"))
    p.meta["guarantor"] = row.get("guarantor_name") or ""
    p.add("people", "preparer_phone", digits(row.get("preparer_phone")))
    p.add("people", "preparer", norm_preparer(row.get("preparer_name")))
    p.add("people", "agent", norm_entity(row.get("registered_agent")))
    p.add("people", "agent_addr", _street(row.get("registered_agent_address")))
    p.add("people", "dl", digits(row.get("guarantor_dl_number")))
    if row.get("guarantor_ssn4") and row.get("guarantor_dob"):
        p.add("people", "ssn4_dob", f"{row['guarantor_ssn4']}|{row['guarantor_dob']}")
    for n in (row.get("guarantor_name"),):
        if n:
            p.add("people", "person", " ".join(person_tokens(n)))
    p.add("people", "biz_addr", _street(row.get("business_address")))
    if row.get("equipment_vendor"):
        vn = norm_entity(row["equipment_vendor"])
        p.add("money", "vendor_acct", f"{vn}|{row.get('vendor_remit_acct_last4')}")
        p.add("money", "remit", row.get("vendor_remit_acct_last4"))
        p.meta["vendor"], p.meta["remit"] = vn, row.get("vendor_remit_acct_last4")
    p.add("money", "bank", row.get("bank_name"))
    fd = parse_date(row.get("formation_date"))
    ad = parse_date(row.get("application_date"))
    if fd:
        p.context["formed_year"] = str(fd.year)
        if ad and (ad - fd).days < 730:
            p.context["young"] = "yes"
    amt = _f(row.get("amount_requested"))
    nl = _near_limit(amt)
    if nl:
        p.add("numeric", "near_limit", nl)
    if deposits:
        pc = [float(d["pct_deposits_multiple_of_100"]) for d in deposits]
        if sum(pc) / len(pc) >= ROUND_STYLE_MIN:           # only a distinctive style, not merely an infrequent one
            p.add("numeric", "round_deposit_share", pct_bin(sum(pc) / len(pc)))
        wd = Counter(d["deposit_weekdays"] for d in deposits).most_common(1)[0][0]
        if wd not in COMMON_DAY_LABELS:
            p.add("numeric", "deposit_days", wd)
        for d in deposits:
            p.add("numeric", "month_total", f"{float(d['total_deposits']):.2f}")
        tot = [float(d["total_deposits"]) for d in deposits]
        mean_dep = sum(tot) / len(tot)
        p.stats.update({
            "log_amount": math.log1p(amt or 0),
            "amount_to_rev": (amt or 0) / max(_f(row.get("annual_revenue_stated")) or 1, 1),
            "log_revenue": math.log1p(_f(row.get("annual_revenue_stated")) or 0),
            "age_years": ((ad - fd).days / 365.25) if (ad and fd) else 5.0,
            "round_share": sum(pc) / len(pc),
            "deposit_count": sum(float(d["deposit_count"]) for d in deposits) / len(deposits),
            "deposit_cv": _cv(tot),
            "deposits_to_rev": (mean_dep * 12) / max(_f(row.get("annual_revenue_stated")) or 1, 1),
            "term": float(row.get("term_months") or 0),
        })
    return p


def _f(x) -> Optional[float]:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _cv(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / len(xs)) ** 0.5 / m if m else 0.0


# --------------------------------------------------------------------------- live deals
def live_profile(folder: str, records: list[DocRecord], facts: dict, known_vendors: dict[str, set[str]] | None = None,
                 as_of: date | None = None) -> Profile:
    known_vendors = known_vendors or {}
    as_of = as_of or date(2026, 11, 2)
    p = Profile(folder, "live", facts.get("legal_name") or folder)
    p.own_names = {n for n in (norm_entity(facts.get("legal_name")), norm_entity(facts.get("dba"))) if n}
    app = current(records, "application")
    cert = current(records, "certificate_of_formation")
    quote = current(records, "equipment_quote")
    fin = current(records, "financial_statements")
    tax = current(records, "tax_return")
    st = statements(records)

    # ---- provenance
    if app:
        p.add("provenance", "producer", app.meta.get("producer"))
    prods = Counter((r.meta.get("producer"), r.meta.get("creator")) for r in records if r.meta.get("producer"))
    for (prod, cre), _ in prods.items():
        if cre:
            p.add("provenance", "creator", cre)
    stmt_prods = {r.meta.get("producer") for rs in st.values() for r in rs if r.meta.get("producer")}
    for sp in stmt_prods:
        p.add("provenance", "stmt_producer", sp)
    borrower_prods = {r.meta.get("producer") for r in records if r.doc.doc_type != "bank_statement" and r.meta.get("producer")}
    if stmt_prods and stmt_prods <= borrower_prods and len(stmt_prods) == 1:
        p.watch.append("bank statements were produced by the same software as the borrower's own documents")
        p.add("provenance", "single_tool", next(iter(stmt_prods)))
    for r in records:
        sig = r.meta.get("layout_sig")
        if sig and r.doc.doc_type in ("application", "bank_statement", "equipment_quote", "financial_statements"):
            p.add("provenance", f"layout_{r.doc.doc_type}", sig)
    created = sorted(r.meta.get("creation_date") for r in records if r.meta.get("creation_date"))
    if created:
        p.meta["created_span"] = (created[0], created[-1])

    # ---- people
    p.meta["guarantor"] = facts.get("guarantor_name") or ""
    p.add("people", "preparer_phone", digits(facts.get("preparer_phone")))
    p.add("people", "preparer", norm_preparer(facts.get("preparer_name")))
    p.add("people", "agent", norm_entity(facts.get("registered_agent")))
    p.add("people", "agent_addr", _street(facts.get("registered_agent_address")))
    p.add("people", "dl", digits(facts.get("guarantor_dl")))
    if facts.get("guarantor_ssn4") and facts.get("guarantor_dob"):
        p.add("people", "ssn4_dob", f"{digits(facts['guarantor_ssn4'])[-4:]}|{facts['guarantor_dob']}")
    for nm in (facts.get("guarantor_name"), cert and cert.doc.organizer):
        if nm:
            p.add("people", "person", " ".join(person_tokens(nm)))
    p.add("people", "biz_addr", _street(facts.get("business_address")))
    p.add("people", "home_addr", _street(facts.get("guarantor_address")))
    p.add("people", "phone", digits(facts.get("phone")))
    if app and app.doc.email and "@" in app.doc.email:
        dom = app.doc.email.split("@")[1].lower()
        if dom not in {"gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"}:
            p.add("people", "email_domain", dom)
    if quote:
        p.add("people", "phone", digits(quote.doc.vendor_phone))

    # ---- money rails
    if quote:
        vn = norm_entity(quote.doc.vendor_name)
        p.add("money", "vendor_acct", f"{vn}|{quote.doc.vendor_account_last4}")
        p.add("money", "remit", quote.doc.vendor_account_last4)
        if quote.doc.vendor_routing and quote.doc.vendor_account_last4:
            p.add("money", "remit_full", f"{digits(quote.doc.vendor_routing)}|{quote.doc.vendor_account_last4}")
        p.meta["vendor"], p.meta["remit"] = vn, quote.doc.vendor_account_last4
        p.meta["remit_full"] = f"{digits(quote.doc.vendor_routing)}|{quote.doc.vendor_account_last4}" if quote.doc.vendor_routing else ""
        known = known_vendors.get(vn)
        if known and quote.doc.vendor_account_last4 and quote.doc.vendor_account_last4 not in known:
            p.watch.append(f"vendor '{quote.doc.vendor_name}' matches a known vendor name but its remit-to account "
                           f"…{quote.doc.vendor_account_last4} differs from the known account(s) {sorted(known)}")
            p.add("money", "lookalike_vendor", vn)
    bank = None
    for rs in st.values():
        for r in rs:
            bank = bank or r.doc.bank_name
            if r.doc.bank_name and r.doc.account_last4:
                p.add("money", "acct", f"{norm_entity(r.doc.bank_name)}|{r.doc.account_last4}")
    p.add("money", "bank", bank or facts.get("primary_bank"))

    # ---- entity / amount
    fd = parse_date(facts.get("formation_date"))
    if fd:
        p.context["formed_year"] = str(fd.year)
        if (as_of - fd).days < 730:
            p.context["young"] = "yes"
    amt = facts.get("amount_requested")
    nl = _near_limit(amt)
    if nl:
        p.add("numeric", "near_limit", nl)
        p.watch.append(f"requested amount ${amt:,.0f} sits just under the ${nl} committee limit")

    # ---- numeric style from statements
    credits, shares, totals, days, n_deps = [], [], [], set(), []
    for ym, rs in sorted(st.items()):
        d = rs[-1].doc
        cs = credit_txns(d) if d.transactions else []
        credits += cs
        if cs:
            shares.append(sum(1 for t in cs if abs(t.amount - round(t.amount, -2)) < 0.005) / len(cs))
            n_deps.append(len(cs))
            for t in cs:
                dt = parse_date(t.date)
                if dt:
                    days.add(dt.weekday())
        if d.total_deposits is not None:
            totals.append(d.total_deposits)
            p.add("numeric", "month_total", f"{d.total_deposits:.2f}")
        for t in d.transactions:
            p.txn_sig[(round(t.amount, 2), _desc_shape(t.description))] += 1
            p.counterparties.add(t.description.upper())
    if shares:
        mean_share = sum(shares) / len(shares)
        if mean_share >= ROUND_STYLE_MIN:
            p.add("numeric", "round_deposit_share", pct_bin(mean_share))
        if mean_share >= 0.9:
            p.watch.append(f"{mean_share:.0%} of deposits are exact multiples of $100 (typical businesses: <20%)")
    wl = weekday_label(days)
    if wl and wl not in COMMON_DAY_LABELS:
        p.add("numeric", "deposit_days", wl)
    whole = [t for rs in st.values() for t in rs[-1].doc.transactions]
    if whole:
        wd_share = sum(1 for t in whole if abs(t.amount - round(t.amount)) < 0.005) / len(whole)
        p.meta["whole_dollar_share"] = wd_share
        if wd_share >= 0.95:
            p.watch.append(f"{wd_share:.0%} of ALL transactions are whole-dollar amounts (no cents)")

    rev = facts.get("annual_revenue_stated") or (tax and tax.doc.gross_receipts) or (fin and fin.doc.fy_revenue)
    mean_dep = sum(totals) / len(totals) if totals else None
    p.stats = {
        "log_amount": math.log1p(amt or 0),
        "amount_to_rev": (amt or 0) / max(rev or 1, 1),
        "log_revenue": math.log1p(rev or 0),
        "age_years": ((as_of - fd).days / 365.25) if fd else 5.0,
        "round_share": (sum(shares) / len(shares)) if shares else 0.0,
        "deposit_count": (sum(n_deps) / len(n_deps)) if n_deps else 0.0,
        "deposit_cv": _cv(totals),
        "deposits_to_rev": ((mean_dep * 12) / max(rev or 1, 1)) if mean_dep else 0.0,
        "term": float(facts.get("term_months") or 0),
    }
    p.meta.update({"amount": amt, "formed": facts.get("formation_date")})
    return p


def known_vendor_accounts(history: list[dict]) -> dict[str, set[str]]:
    """vendor name (normalised) -> remit accounts seen on FUNDED, non-fraud history deals (the 'known vendors')."""
    out: dict[str, Counter] = {}
    for r in history:
        if r.get("equipment_vendor") and r.get("final_status") == "funded" and r.get("fraud_label") in ("none", ""):
            out.setdefault(norm_entity(r["equipment_vendor"]), Counter())[r.get("vendor_remit_acct_last4")] += 1
    # A vendor's trusted account is its DOMINANT one. An account that merely appears twice must not be trusted:
    # funded history deals are labelled 'none' ("no known trick found"), which is not the same as proven clean.
    res = {}
    for v, cnt in out.items():
        total = sum(cnt.values())
        top = cnt.most_common(1)[0][0]
        res[v] = {top} | {a for a, c in cnt.items() if c >= 0.25 * total}
    return res
