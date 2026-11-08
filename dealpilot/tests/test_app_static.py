"""The built React console is served by FastAPI; the fraud evidence is available as data for the Fraud review screen."""
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from backend import app as A
from backend.dataset import Dataset
from backend.engine.pipeline import Pipeline
from tests.support.fixture_parser import fixture_extract


@pytest.fixture()
def client():
    return TestClient(A.app)


def test_index_and_assets_are_served_from_dist(client, tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path.parent / "secret.txt").write_text("nope", encoding="utf-8")
    monkeypatch.setattr(A, "DIST", tmp_path)
    r = client.get("/")
    assert r.status_code == 200 and "id=root" in r.text and r.headers["cache-control"] == "no-cache"
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/assets/..%2fsecret.txt").status_code == 404           # no path traversal out of assets/
    assert client.get("/assets/../secret.txt").status_code in (404, 422)


def test_missing_build_shows_a_plain_hint_not_a_crash(client, tmp_path, monkeypatch):
    monkeypatch.setattr(A, "DIST", tmp_path / "nothing-here")
    r = client.get("/")
    assert r.status_code == 503 and "npm run build" in r.text
    assert client.get("/api/health").status_code == 200                         # the API is unaffected


def test_loading_a_missing_pack_is_a_clear_400_and_leaves_the_running_week_alone(client):
    p = Pipeline(Dataset.load(), extractor=fixture_extract, personas=False)
    A.STATE["pipe"], A.STATE["fixture"] = p, True
    r = client.post("/api/dataset/load", json={"replace": True, "root": "C:\\no\\such\\pack"})
    assert r.status_code == 400 and "Could not find" in r.json()["detail"] and "pack" in r.json()["detail"]
    assert A.STATE["pipe"] is p                                                # not replaced
    r = client.post("/api/dataset/load", json={"replace": False, "arrivals": "C:\\no\\such\\drop.jsonl"})
    assert r.status_code == 400 and "Could not find" in r.json()["detail"]
    r = client.post("/api/dataset/load", json={"replace": False, "folder": "C:\\no\\such\\folder"})
    assert r.status_code == 400 and len(p.ds.extra_shared) == 0


def test_loading_a_garbled_arrivals_file_is_a_400(client, tmp_path):
    p = Pipeline(Dataset.load(), extractor=fixture_extract, personas=False)
    A.STATE["pipe"], A.STATE["fixture"] = p, True
    bad = tmp_path / "bad.jsonl"
    bad.write_text("this is not json\n", encoding="utf-8")
    r = client.post("/api/dataset/load", json={"replace": False, "arrivals": str(bad)})
    assert r.status_code == 400 and "Could not load those files" in r.json()["detail"]


def test_state_carries_threshold_and_cluster_evidence_as_data():
    p = Pipeline(Dataset.load(), extractor=fixture_extract, personas=False)
    p.advance(dt.timedelta(days=2, hours=3))
    A.STATE["pipe"], A.STATE["fixture"] = p, True
    s = TestClient(A.app).get("/api/state").json()
    assert s["cluster_threshold"] == 8.0
    ring = next(c for c in s["clusters"] if "Ridgeway Freight Logistics" in c["members"])
    ev = ring["evidence"]
    assert len(ev) >= 7 and {e["family"] for e in ev} >= {"money", "numeric", "people", "provenance"}
    assert all(e["shared_by"] >= 2 and e["freq"] >= 2 and e["pop"] >= e["freq"] for e in ev)
    # explain() is built on evidence(): every one of its top rows appears in the sentence form unchanged
    for e in ev[:7]:
        assert f"{e['key'].replace('_', ' ')} '{e['value']}' appears on only {e['freq']} of {e['pop']}" in ring["reason"]
