"""Deal state, human requests, alerts. Plain dataclasses so the whole run can be exported / inspected."""
from __future__ import annotations
import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

TZ = dt.timezone(dt.timedelta(hours=-6))  # America/Chicago, CST (no DST in the sim window)
STAGES = ["Intake", "Credit", "Committee", "Product", "Committed", "Closed"]

GATE_FOR_STAGE = {"Credit": "credit_decision", "Committee": "committee_approval",
                  "Committed": "commitment_signoff", "Closed": "funding_release"}
ANSWER_OPTIONS = {
    "credit_decision": ["approve", "decline", "request_info"],
    "committee_approval": ["approve", "decline"],
    "commitment_signoff": ["approve", "decline"],      # approve = commitment letter signed by RM and borrower
    "funding_release": ["approve", "decline"],
    "fraud_hold": ["hold", "release"],                  # hold = confirmed hold placed; release = no hold, deal may proceed
    "fraud_release": ["release", "keep_hold"],
    "info_request": [],
}


def iso(t: Optional[dt.datetime]) -> Optional[str]:
    return t.astimezone(TZ).isoformat(timespec="minutes") if t else None


def parse_iso(s: str) -> dt.datetime:
    t = dt.datetime.fromisoformat(s)
    return t if t.tzinfo else t.replace(tzinfo=TZ)


@dataclass
class HumanRequest:
    id: int
    deal: str
    type: str
    to: str
    at: dt.datetime
    message: str
    stage: str = ""
    options: list[str] = field(default_factory=list)
    answer: Optional[str] = None
    answered_at: Optional[dt.datetime] = None
    note: str = ""
    nudged: set = field(default_factory=set)
    meta: dict = field(default_factory=dict)

    @property
    def pending(self) -> bool:
        return self.answer is None and self.type != "info_request"

    def dict(self):
        d = {"id": self.id, "deal": self.deal, "type": self.type, "to": self.to, "at": iso(self.at),
             "message": self.message, "stage": self.stage, "options": self.options, "answer": self.answer,
             "answered_at": iso(self.answered_at), "note": self.note}
        d.update({k: v for k, v in self.meta.items() if k in ("on_behalf_of", "urgent", "evidence")})
        return d


@dataclass
class Alert:
    at: dt.datetime
    deal: str
    stage: str
    level: str          # alert | escalation
    to: str
    message: str
    cc: list[str] = field(default_factory=list)
    kind: str = "stuck"  # stuck | deadline_risk | fraud_nudge

    def dict(self):
        return {"at": iso(self.at), "deal": self.deal, "stage": self.stage, "level": self.level, "to": self.to,
                "message": self.message, "cc": self.cc, "kind": self.kind}


@dataclass
class StageEntry:
    stage: str
    entered_at: dt.datetime
    exited_at: Optional[dt.datetime] = None
    decision: str = "in_progress"      # advanced | waiting | declined | held | funds disbursed | in_progress
    why: str = ""
    saw: str = ""
    memo: str = ""                     # Gemini narrative
    waiting_on: str = ""

    def dict(self):
        return {"stage": self.stage, "entered_at": iso(self.entered_at), "exited_at": iso(self.exited_at),
                "decision": self.decision, "why": self.why, "saw": self.saw, "memo": self.memo,
                "waiting_on": self.waiting_on}


@dataclass
class Fraud:
    flagged: bool = False
    flagged_at: Optional[dt.datetime] = None
    stage_at_flag: Optional[str] = None
    held: bool = False                 # frozen pending Fraud Ops, or hold confirmed
    confirmed: bool = False            # Fraud Ops answered "hold"
    released: bool = False             # Fraud Ops answered "release"
    reason: str = ""
    linked_deals: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)   # old-trick codes / "CROSS_DEAL"
    signature: str = ""
    release_sig: str = ""
    request_id: Optional[int] = None

    def dict(self):
        return {"flagged": self.flagged, "flagged_at": iso(self.flagged_at), "stage_at_flag": self.stage_at_flag,
                "held": self.held, "reason": self.reason, "linked_deals": self.linked_deals,
                "confirmed": self.confirmed, "released": self.released, "sources": self.sources}


@dataclass
class Deal:
    folder: str
    records: list = field(default_factory=list)       # DocRecord
    facts: dict = field(default_factory=dict)
    findings: list = field(default_factory=list)      # validate.findings.Finding (readable issues)
    old_tricks: list = field(default_factory=list)
    first_seen: Optional[dt.datetime] = None
    last_arrival: Optional[dt.datetime] = None
    dirty: bool = True
    settled: bool = False            # the folder has been quiet once: the first landing is complete
    stage: Optional[str] = None
    stage_entered: Optional[dt.datetime] = None
    status: str = "active"            # active | declined | held | funded
    log: list[StageEntry] = field(default_factory=list)
    requests: list[HumanRequest] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    fraud: Fraud = field(default_factory=Fraud)
    watch: list[str] = field(default_factory=list)
    anomaly: dict = field(default_factory=dict)
    sla_fired: set = field(default_factory=set)
    borrower_asked: dict = field(default_factory=dict)   # signature -> request id
    gate_cycle: dict = field(default_factory=dict)       # stage -> number of gate rounds opened
    overrides: set = field(default_factory=set)          # finding codes a human accepted
    memos: dict = field(default_factory=dict)            # e.g. "credit_memo"
    intake_owner: str = ""
    waiting_on: str = ""
    unblock: str = ""
    vendor_status: str = ""
    deadline_flagged: bool = False
    deadline_escalated: bool = False

    @property
    def frozen(self) -> bool:
        return self.fraud.held and not self.fraud.released

    def current(self) -> Optional[StageEntry]:
        return self.log[-1] if self.log and self.log[-1].exited_at is None else None
