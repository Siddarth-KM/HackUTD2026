"""Who is asked / alerted for what. Driven by contacts/teams.json, sim/assignments.json and rules/stages.json."""
from __future__ import annotations
import datetime as dt
import re
from typing import Optional
from ..dataset import Dataset
from .state import TZ, parse_iso

_OOO = re.compile(r"OUT OF OFFICE\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s+through\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?", re.I)


class Router:
    def __init__(self, ds: Dataset):
        self.ds = ds
        self.people = ds.people
        self.rules = ds.rules
        self._rr = 0
        self._intake: dict[str, str] = {}

    # ---------------------------------------------------------------- availability
    def out_of_office(self, pid: str, at: dt.datetime) -> bool:
        note = (self.people.get(pid) or {}).get("notes", "") or ""
        m = _OOO.search(note)
        if not m:
            return False
        start = parse_iso(f"{m[1]}T{m[2] or '00:00'}")
        end = parse_iso(f"{m[3]}T{m[4] or '23:59'}")
        return start <= at <= end

    def available(self, pid: str, at: dt.datetime) -> str:
        """pid, or the first available person following the backup chain."""
        seen, cur = set(), pid
        while cur and cur not in seen:
            seen.add(cur)
            if not self.out_of_office(cur, at):
                return cur
            cur = (self.people.get(cur) or {}).get("backup")
        return pid

    # ---------------------------------------------------------------- stage owners / gate recipients
    def intake_owner(self, folder: str) -> str:
        if folder not in self._intake:
            self._intake[folder] = ["olivia.chen", "jordan.webb"][self._rr % 2]
            self._rr += 1
        return self._intake[folder]

    def rm(self, folder: str) -> str:
        return (self.ds.assignments.get(folder) or {}).get("relationship_manager", "brian.foster")

    def credit_officer(self, folder: str, at: dt.datetime) -> tuple[str, Optional[str]]:
        """(who to ask, who it was originally assigned to if we had to use the backup)."""
        assigned = (self.ds.assignments.get(folder) or {}).get("credit_officer", "marcus.lee")
        who = self.available(assigned, at)
        return who, (assigned if who != assigned else None)

    def committee_approver(self, amount: Optional[float]) -> str:
        r = self.rules["stages"]["Committee"]["routing"]
        return r["delegated_approver"] if (amount or 0) <= r["delegated_max_amount"] else r["full_committee_chair"]

    def stage_owner(self, stage: str, folder: str, amount: Optional[float], at: dt.datetime) -> str:
        if stage == "Intake":
            return self.intake_owner(folder)
        if stage == "Credit":
            return self.credit_officer(folder, at)[0]
        if stage == "Committee":
            return self.available(self.committee_approver(amount), at)
        if stage == "Product":
            return "kevin.alvarez"
        if stage == "Committed":
            return self.rm(folder)
        if stage == "Closed":
            return "tasha.reed"
        raise KeyError(stage)

    def fraud_ops(self, at: dt.datetime) -> str:
        return self.available("victor.hale", at)

    def escalates_to(self, pid: str) -> Optional[str]:
        return (self.people.get(pid) or {}).get("escalates_to")

    def final_escalation(self) -> str:
        return self.rules["stuck_deals"]["second_escalation_to"]

    def sla_hours(self, stage: str, amount: Optional[float]) -> float:
        s = self.rules["stages"][stage]
        if stage == "Committee" and amount is not None and amount <= s["routing"]["delegated_max_amount"]:
            return float(s.get("sla_hours_delegated", s["sla_hours"]))
        return float(s["sla_hours"])
