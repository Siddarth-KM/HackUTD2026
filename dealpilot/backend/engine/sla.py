"""Stuck-deal timers. Exactly rules/stages.json:  alert @100% of SLA, escalate @150%, second escalation @200%.

Timers are wall-clock sim hours from the moment the deal ENTERS the stage. Alerts are stamped with the moment
the threshold was crossed (not the moment we noticed), so a coarse clock step does not distort the record.
Alert text always says: whose deal (borrower + RM), which stage and how long, what it is waiting for,
and what would unblock it.
"""
from __future__ import annotations
import datetime as dt
from .. import config
from .state import Alert, Deal, iso

LEVELS = [("alert", config.ALERT_PCT), ("escalation", config.ESCALATE_PCT), ("escalation2", config.SECOND_ESCALATE_PCT)]


def hours_between(a: dt.datetime, b: dt.datetime) -> float:
    return (b - a).total_seconds() / 3600


def check_sla(deal: Deal, now: dt.datetime, router, borrower_label: str) -> list[Alert]:
    if deal.status != "active" or not deal.stage or not deal.stage_entered:
        return []
    amount = deal.facts.get("amount_requested")
    sla = router.sla_hours(deal.stage, amount)
    owner = router.stage_owner(deal.stage, deal.folder, amount, now)
    rm = router.rm(deal.folder)
    out: list[Alert] = []
    for key, pct in LEVELS:
        due = deal.stage_entered + dt.timedelta(hours=sla * pct)
        tag = (deal.stage, deal.stage_entered.isoformat(), key)
        if now < due or tag in deal.sla_fired:
            continue
        deal.sla_fired.add(tag)
        elapsed = hours_between(deal.stage_entered, due)
        if key == "alert":
            to, level, cc = owner, "alert", [rm] if rm != owner else []
        elif key == "escalation":
            to, level, cc = router.escalates_to(owner) or router.final_escalation(), "escalation", [owner, rm]
        else:
            to, level, cc = router.final_escalation(), "escalation", [owner, rm]
        msg = _message(deal, borrower_label, rm, owner, key, elapsed, sla)
        out.append(Alert(due, deal.folder, deal.stage, level, to, msg, cc))
    deal.alerts.extend(out)
    return out


def _message(deal: Deal, borrower: str, rm: str, owner: str, key: str, elapsed: float, sla: float) -> str:
    kind = {"alert": "STUCK DEAL", "escalation": "ESCALATION (150% of SLA)", "escalation2": "SECOND ESCALATION (200% of SLA)"}[key]
    waiting = deal.waiting_on or "the next action in this stage"
    unblock = deal.unblock or f"{owner} completes the {deal.stage} step"
    return (f"{kind}: {borrower} (RM: {rm}) has been in {deal.stage} for {elapsed:.1f}h "
            f"(limit {sla:g}h; owner: {owner}). Waiting for: {waiting}. To unblock: {unblock}.")
