# DealPilot

Reads a bank's shared loan folder, extracts the deal facts with Gemini, walks each deal through
Intake → Credit → Committee → Product → Committed → Closed, asks the right human at every sign-off, alerts and
escalates stuck deals, and finds fraud that only shows **across** deals.

> **Rule of the house:** Gemini *reads* documents and *writes* memos. Plain Python *decides* everything that matters
> (is a document missing, did the arithmetic reconcile, may the deal advance, who must be asked, is a deal linked to a ring).
> Gemini can never talk a deal past a missing document or flag a deal on its own.

## Run it

```powershell
cd dealpilot
python -m venv .venv ; .venv\Scripts\Activate.ps1 ; pip install -r requirements.txt
copy .env.example .env          # then put your key in .env  (GEMINI_API_KEY=...)  -- never in .env.example
python -m uvicorn backend.app:app --port 8000      # open http://localhost:8000  (serves the built console in frontend/dist)
python -m pytest tests -q                           # backend tests, no API key needed
```

**The console** is a React + Vite + Tailwind app in `frontend/` (light-blue, Goldman-inspired look; Inter + Source Serif 4, self-hosted).
`frontend/dist` is committed, so running the server needs no Node. To change the UI:

```powershell
cd frontend
npm install
npm run dev            # http://localhost:5173, proxies /api to the server on :8000
npm run build          # rebuilds frontend/dist
npm test               # ~130 component tests (Vitest + Testing Library, mocked API)
npx playwright install chromium     # once
npm run test:e2e       # ~75 browser tests against the REAL backend (test parser, Gemini off): every button, link, input and switch
```

Screens: **My tasks** (answer requests, grouped by person), **Pipeline** (every stage on one board; click a stage name for the
one-stage view, click a deal for its page), **Deal page** (issues with Accept / Accept all, history, requests, documents, facts),
**Alerts**, **Fraud review**, **Simulation & data** (clock, simulated colleagues, load a pack or weekend drop, download, reset).
`e2e/interactions.json` lists every control and the spec that exercises it; `quality.spec.js` fails if a screen gains a control
without a test id or without a test.

| Command | What it does |
|---|---|
| `python tests\run_sample.py` | whole sim week on the sample, test parser (no key). `--gemini` = real extraction |
| `python tests\compare_gemini.py "<folder>"` | real Gemini extraction vs the test parser, field by field |
| `python -m synth.generate --trick identity --seed 7` | a new data pack + `ground_truth.json` |
| `python -m synth.score --all` | generate every trick x seeds, run the engine, score READ / MOVE / FRAUD |

## How it works

```
shared folder ──▶ extract (Gemini, batched, cached) ──▶ merge facts ──▶ validate ──▶ cross-deal fraud graph ──▶ stage machine
 (files land on      per document: type by CONTENT,        application      missing /      rare shared attributes      humans · SLA ·
  the sim clock)     numbers re-checked against the         is primary      mismatch /      across independent           deadlines
                     PDF text layer, gaps re-read                            old tricks      evidence families
```

**Read.** One Gemini call handles up to 4 documents (≤3 bank statements). Results are cached by file hash, independent
of model. Every amount Gemini returns must exist in the PDF's own text layer or the file is re-read once and flagged
`EXTRACTION_UNVERIFIED` (so a transcription slip is never mistaken for statement tampering). Per-type required fields
trigger a targeted re-read when the model omits one. CSV exports are parsed in code.

**Missing ≠ rejected ≠ fraud.** A missing document, missing page or mismatch becomes an issue plus a plain-words
`info_request` to the borrower. The deal waits **only at the stage whose `required_to_exit` needs it**; earlier stages
advance. The system never declines (decline is a credit-officer option) and these features never enter the fraud score.

**Move.** Driven by `rules/stages.json` and `contacts/teams.json`. Humans are asked for credit decision, committee
approval (by amount, with out-of-office → backup chain), commitment sign-off, funding release, and fraud holds.
Alerts at 100 % of SLA, escalation at 150 %, second escalation to `lauren.kim` at 200 %; every alert says whose deal,
which stage and for how long, what it waits for, and what would unblock it. Urgent deals (`needed by`) are marked URGENT
and get a deadline-risk alert when the projected finish (history medians) misses the date.

**Fraud.** Two layers:
1. *Old tricks* (`known_fraud_checks.md`): statement tamper, revenue inflation (>1.5× annualised deposits), ID mismatch
   (nickname-tolerant), duplicate EIN, mailbox address. Deterministic arithmetic.
2. *Cross-deal graph* — the new-trick detector. Every deal (a year of history + all live deals) becomes a bag of tokens
   in independent **families**: *provenance* (PDF tool, document layout fingerprint), *people* (preparer, agent, guarantor
   ID/DOB/SSN4, phones, addresses), *money rails* (vendor + remit account, operating account), *numeric style* (share of
   round-hundred deposits, deposit weekdays, identical monthly totals). Two deals are linked when they share tokens that are
   **rare** (weight ln(N/f)), each underlying fact scored once, across **≥ 2 families**. Conclusive on their own: one ID
   number under two names, one remit account under two vendor names, copied ledgers, money flowing between applicants.
   Calibration on the real history: the two seeded ring deals score 31.0; the best honest pair in a year scores 4.9 on one
   family; the threshold is 8. A single strange deal is a *watch note*, never a hold.
   Once Fraud Ops confirms a deal (or a Collections notice names one), a relaxed search lists its relatives, including
   history deals (`history_flags`).

**ML (honest version).** Supervised learning on the new trick is impossible (2 positives; the hidden trick differs) and
on the old tricks it would only relearn exact rules. An IsolationForest trained on history deals with no fraud label
gives a *watch score* (shown to the credit officer, written into the memo, never a hold: Tyler's startup and James's
international firm are legitimately unusual). The graph calibration is the data-driven part.

## Measured results

Sample week (real Gemini extraction, scripted humans): the 3-deal ring is flagged at **Intake**, 3 minutes after the 4th
deal's first file and before Credit, with both seeded history deals (`H-2608-002`, `H-2609-008`) linked; Granite Bay is
held for statement tampering + revenue inflation; the 8 other deals (Tyler's messy startup, James's international firm, Maria's
renewal, a nickname ID, a transposed EIN, missing pages / documents ...) are **not** blocked. Real Gemini and the test parser
give byte-identical pipeline output on all 13 deals.

`python -m synth.score --all` (6 tricks the detector was never tuned to x 2 seeds, 168 good deals + 50 fraud deals, decoys
included): **50/50 fraud caught, 0 false holds, 0 MOVE problems, issue precision/recall 1.0/1.0, linked-deal recall 1.0**.

| trick | what is shared |
|---|---|
| identity | one ID number / SSN4+DOB under different names |
| vendor_rail | one remit-to account under different vendor names |
| ledger | copied transaction ledgers |
| circular | money flowing between the applicants |
| template | preparer + agent + PDF tool + round-dollar style |
| two_family | only PDF tool + round-dollar style (the borderline case) |

**Honest weakness:** a ring's *first* deal has no peers yet. In 7 of the 12 sweeps it was funded (by a fast scripted human)
before the second deal arrived, so it was linked retroactively, after money went out. Nothing can fix that without delaying
good deals; watch notes are shown on the funding request so the human sees the warning signs.

## Decisions you may want to change

* **Funding release is requested at the end of *Committed*, before the deal enters *Closed*** — `stages.json` says entering
  Closed sends money, so the release must precede it. Closed then lasts 15 min (disbursement).
* **A mismatch at Intake waits** for the borrower (your choice) rather than advancing; `Accept and continue` (or `Accept all N open issues for this stage`) on
  the deal page overrides it. An issue that blocks a later stage can be accepted early; it is marked accepted and takes effect when the deal gets there. Every accept is written into the stage log and the funding-release request.
* **A flagged deal is frozen** until Fraud Ops answers (`hold` / `release`); an unanswered hold request nudges `monica.salas`
  at +2 h and `lauren.kim` at +4 h.
* **A vendor new to the bank passes Product** with a call-back note on the funding request; a *lookalike* vendor (known name,
  different remit account) is blocked at Product and the borrower is asked for verification.
* Stage memos are **lazy** (one Gemini call per deal, on export or on demand) because a free key cannot afford six per deal.

## Limits you should know about

* **Gemini free tier = a few dozen requests per day per model.** The sample alone is ~190 documents. The client batches,
  caches, and falls back across `GEMINI_MODELS` (quotas are per model), and when every model is exhausted ingestion
  **stalls** (files stay unread; nothing is guessed) and the console says so. For judging, enable billing on the key.
* There is **no regex fallback extractor** by design. `tests/support/fixture_parser.py` is a *test-only* stand-in that reads
  the sample's text layer so everything downstream can be tested without a key. Real Gemini and the fixture produced
  identical pipeline output on all 13 sample deals.
* Gemini cannot be bit-for-bit deterministic across prompt/model changes; the cache makes a given run reproducible.
* A ring member that funds **before** any second member exists cannot be linked yet; it is flagged retroactively and reported
  as caught after money went out (see the sweep summary).
