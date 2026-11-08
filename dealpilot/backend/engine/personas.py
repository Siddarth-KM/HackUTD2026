"""Optional scripted 'humans' for development and demos (toggle in the UI). During judging the organisers answer
as the real people; this only lets us exercise SLA alerts, escalations, out-of-office routing and slow/silent people.

Each persona: reply delay (sim minutes), whether they answer at all, and the answer they give. Delays apply from
the moment the request was made; people only answer during business hours (Mon-Fri 08:00-18:00 CT).
"""
from __future__ import annotations
import datetime as dt
from .state import HumanRequest

DEFAULT = {
    "delay_min": 60, "silent": False,
}
PERSONAS = {
    "marcus.lee": {"delay_min": 90},
    "aisha.grant": {"delay_min": 150},
    "dana.whitfield": {"delay_min": 45},
    "priscilla.nguyen": {"delay_min": 120},
    "harold.benson": {"delay_min": 60 * 30, "note": "slow chair: answers after ~30h"},
    "brian.foster": {"delay_min": 70},
    "elena.ruiz": {"delay_min": 40},
    "tasha.reed": {"delay_min": 35},
    "victor.hale": {"delay_min": 25},
    "monica.salas": {"delay_min": 20},
    "susan.ortiz": {"delay_min": 60},
    "lauren.kim": {"delay_min": 30},
}
SILENT: set[str] = set()   # e.g. {"aisha.grant"} to test "doesn't answer at all"


def business_open(t: dt.datetime) -> bool:
    return t.weekday() < 5 and 8 <= t.hour < 18


def auto_answer(req: HumanRequest, now: dt.datetime, deal) -> str | None:
    """Return an answer if this persona would have answered by `now`, else None."""
    if not req.pending or req.to in SILENT or not business_open(now):
        return None
    p = {**DEFAULT, **PERSONAS.get(req.to, {})}
    if now < req.at + dt.timedelta(minutes=p["delay_min"]):
        return None
    if req.type == "fraud_hold":
        return "hold"                      # Fraud Ops follows the system's evidence in the demo
    return "approve"
