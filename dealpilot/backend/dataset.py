"""Loads a data pack (sample, weekend drop, synthetic set, hidden set): rules, contacts, assignments,
arrival schedule, and the year of history used as the fraud baseline."""
from __future__ import annotations
import csv, json
from dataclasses import dataclass, field
from pathlib import Path
from . import config


def _csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


@dataclass
class Dataset:
    root: Path
    shared: Path
    rules: dict
    contacts: dict
    assignments: dict
    arrivals: list[dict]
    history: list[dict]
    deposits: dict[str, list[dict]]
    stage_events: list[dict]
    people: dict[str, dict] = field(default_factory=dict)
    extra_shared: list[Path] = field(default_factory=list)   # weekend-drop / synthetic folders

    @staticmethod
    def load(root: Path | str | None = None, arrivals: Path | str | None = None,
             folder: Path | str | None = None) -> "Dataset":
        root = Path(root or config.DATA_DIR)
        # allow pointing at the zip's outer folder
        if not (root / "rules").exists() and (root / "participant" / "rules").exists():
            root = root / "participant"
        rules = json.loads((root / "rules" / "stages.json").read_text(encoding="utf-8"))
        contacts = json.loads((root / "contacts" / "teams.json").read_text(encoding="utf-8"))
        ap = Path(root / "sim" / "assignments.json")
        assignments = json.loads(ap.read_text(encoding="utf-8")) if ap.exists() else {}
        arr_path = Path(arrivals) if arrivals else root / "sim" / "arrivals.jsonl"
        arrivals_rows = []
        if arr_path.exists():
            arrivals_rows = [json.loads(l) for l in arr_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        deposits: dict[str, list[dict]] = {}
        for r in _csv(root / "history" / "monthly_deposits.csv"):
            deposits.setdefault(r["deal_id"], []).append(r)
        ds = Dataset(root, Path(folder) if folder else root / "shared_folder", rules, contacts, assignments,
                     sorted(arrivals_rows, key=lambda r: r["arrive_at"]),
                     _csv(root / "history" / "deals.csv"), deposits, _csv(root / "history" / "stage_events.csv"))
        ds.people = {p["id"]: p for p in contacts["people"]}
        return ds

    def resolve(self, rel: str) -> Path:
        """Find a file named by an arrivals.jsonl path across the sample folder and any drop folders."""
        for root in [self.shared, *self.extra_shared]:
            if (root / rel).exists():
                return root / rel
        return self.shared / rel

    def folders(self) -> list[str]:
        seen = []
        for a in self.arrivals:
            f = a["path"].replace("\\", "/").split("/")[0]
            if f not in seen:
                seen.append(f)
        return seen
