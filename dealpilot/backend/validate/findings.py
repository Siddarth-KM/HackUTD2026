from __future__ import annotations
from dataclasses import dataclass, asdict


@dataclass
class Finding:
    code: str            # submission-format issue string, e.g. "MISSING_DOC:tax_return"
    stage: str           # stage whose required_to_exit this blocks ("" = informational only)
    text: str            # plain-words explanation (also used in the borrower request)
    evidence: str = ""   # numbers / values behind it
    blocks: bool = True  # blocks exit from `stage` until resolved

    def dict(self):
        return asdict(self)
