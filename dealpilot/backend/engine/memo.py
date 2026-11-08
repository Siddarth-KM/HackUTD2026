"""Gemini writes the stage memo (what was SEEN, what was DECIDED, WHY) and the credit memo.

Per the project brief: the stage's `required_to_exit` and `checks` are pulled from the rules (stages.json) and fed
to Gemini; `checks` are ignored when the stage has a human gate (the human does those). The DECISION is made in
Python from deterministic findings; Gemini only explains it, so it can never talk a deal past a missing document.
"""
from __future__ import annotations
import json
from typing import Literal, Optional
from pydantic import BaseModel
from ..ingest.gemini_client import get_client, GeminiUnavailable


class StageMemo(BaseModel):
    saw: str
    decided: Literal["advance", "wait", "hold", "decline"]
    why: str


def stage_rule_view(rules: dict, stage: str) -> dict:
    s = rules["stages"][stage]
    view = {"stage": stage, "required_to_exit": s.get("required_to_exit", [])}
    if not s.get("human_gate"):          # ignore "checks" when a human gate owns the decision
        view["checks"] = s.get("checks", [])
    else:
        view["human_gate"] = s["human_gate"]["type"]
    return view


class StageMemoItem(BaseModel):
    stage: str
    saw: str
    decided: Literal["advance", "wait", "hold", "decline"]
    why: str


class DealMemos(BaseModel):
    stages: list[StageMemoItem]


def write_deal_memos(rules: dict, facts: dict, findings: list, entries: list[dict]) -> dict[str, str]:
    """ONE Gemini request writes the saw / decided / why note for every finished stage of a deal.
    `entries` = [{stage, entered_at, exited_at, decision, why}] where `why` is the deterministic reason already
    decided in code; Gemini explains it, it cannot change it."""
    prompt = (
        "You are DealPilot, writing the audit note for each STAGE of a commercial loan deal.\n"
        "Use ONLY the data below. Do not invent facts. Plain words, max 50 words per field.\n"
        "Each stage's decision was ALREADY made by deterministic checks (see `verdict`); explain it, never change it.\n"
        "For each stage return: saw = what was observed in the folder for that stage; decided = advance|wait|hold|decline matching the verdict; "
        "why = the reason, naming the specific item. Return one item per stage, in order.\n\n"
        + json.dumps({
            "deal_facts": {k: v for k, v in facts.items() if v not in (None, "") and k != "applicant_notes"},
            "issues_found": [{"code": f.code, "text": f.text, "evidence": f.evidence} for f in findings],
            "stages": [{"stage": e["stage"], "rules": stage_rule_view(rules, e["stage"]),
                        "verdict": {"decision": e["decision"], "reasons": e["why"]},
                        "entered_at": e["entered_at"], "exited_at": e["exited_at"]} for e in entries],
        }, default=str, indent=1))
    try:
        res = get_client().extract_text(prompt, "Return the DealMemos JSON.", DealMemos)
    except GeminiUnavailable:
        return {}
    except Exception as e:  # a memo failure must never stop a deal
        return {x["stage"]: f"(memo generation failed: {str(e)[:100]})" for x in entries}
    return {m.stage: f"SAW: {m.saw} DECIDED: {m.decided}. WHY: {m.why}" for m in res.stages}


def write_credit_memo(deal_view: dict) -> Optional[str]:
    prompt = (
        "Write the CREDIT MEMO a committee member will read before approving. It is a system-written summary of what "
        "was seen, decided and why. Use ONLY the data given; do not invent numbers. Sections, each 1-3 sentences: "
        "STATE FACTS ONLY: never speculate about causes, never explain away or reassure about anything unusual (say it is unusual and not explained by the file), and never mention checks that are not in the data. "
        "Request, Borrower, Financial picture (stated revenue vs annualised deposits vs P&L), Issues & how they were handled, "
        "Fraud screen (old-trick checks + cross-deal check result), Credit officer decision, Recommendation.\n\n"
        + json.dumps(deal_view, default=str, indent=1))
    try:
        return get_client().write(prompt)
    except GeminiUnavailable:
        return None
    except Exception as e:
        return f"(credit memo generation failed: {e})"
