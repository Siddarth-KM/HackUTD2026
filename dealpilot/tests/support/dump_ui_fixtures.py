"""Saves REAL /api/state and /api/deals/<folder> answers (fixture extractor, no Gemini) for the React component tests.

    .venv\\Scripts\\python.exe -m tests.support.dump_ui_fixtures

Output: frontend/src/test/fixtures/*.json.  Re-run whenever the API's shape changes; the Vitest tests then check the UI against it.
"""
import datetime as dt
import json
from pathlib import Path
from urllib.parse import quote

from fastapi.testclient import TestClient

from backend import app as A
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from tests.support.fixture_parser import fixture_extract

OUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test" / "fixtures"


def client_for(p: Pipeline) -> TestClient:
    A.STATE["pipe"], A.STATE["fixture"] = p, True
    return TestClient(A.app)


def save(name: str, obj) -> None:
    (OUT / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")
    print("saved", name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ds = Dataset.load()

    # ---- Wednesday 11:00: ring + Granite Bay flagged, messy deals waiting on borrowers, escalated alerts
    p = Pipeline(ds, extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(days=2, hours=3))
    c = client_for(p)
    save("state_wed11.json", c.get("/api/state").json())
    for folder in ("Bluebonnet Landscape", "Granite Bay Building Supply", "Ridgeway Freight Logistics", "Priya's Bakery", "Okafor Advisory - James"):
        save(f"deal_{folder.split()[0].lower().replace(chr(39) + 's', '')}.json", c.get("/api/deals/" + quote(folder, safe="")).json())

    # ---- Friday 18:00 with simulated colleagues answering: funded deals, held deals
    p2 = Pipeline(ds, extractor=fixture_extract, personas=True)
    p2.advance(dt.timedelta(days=4, hours=10))
    c2 = client_for(p2)
    s = c2.get("/api/state").json()
    save("state_fri18.json", s)
    funded = next((d["folder"] for d in s["deals"] if d["status"] == "funded"), None)
    if funded:
        save("deal_funded.json", c2.get("/api/deals/" + quote(funded, safe="")).json())

    # ---- a declined deal: Harbor Tea declined at Credit
    p3 = Pipeline(ds, extractor=fixture_extract, personas=False)
    p3.advance(dt.timedelta(days=2, hours=3))
    req = next(r for r in p3.requests if r.pending and r.type == "credit_decision" and "Harbor" in r.message)
    p3.answer(req.id, "decline", "Not enough collateral")
    p3.advance(dt.timedelta(minutes=2))
    c3 = client_for(p3)
    save("state_declined.json", c3.get("/api/state").json())
    save("deal_declined.json", c3.get("/api/deals/" + quote(req.deal, safe="")).json())

    # ---- Garza missing two Intake papers (two blockers at once)
    p4 = Pipeline(ds, extractor=fixture_extract, personas=False)
    orig = p4._ingest_due

    def ingest(t):
        orig(t)
        d = p4.deals.get("Garza Family Pharmacy")
        if d:
            d.records = [r for r in d.records if r.doc.doc_type not in ("guarantor_id", "ein_letter")]
    p4._ingest_due = ingest
    p4.advance(dt.timedelta(hours=6))
    c4 = client_for(p4)
    save("deal_garza_two_missing.json", c4.get("/api/deals/" + quote("Garza Family Pharmacy", safe="")).json())


if __name__ == "__main__":
    main()
