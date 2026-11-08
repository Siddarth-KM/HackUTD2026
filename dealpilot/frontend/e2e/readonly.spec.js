// Everything that only READS: one shared Wednesday 11:00 state, no test changes the server, so the week is replayed once.
import fs from 'node:fs'
import { test, expect, T, snapshot, getState, getDeal, open, columnOf } from './helpers.js'

test.describe.configure({ mode: 'serial' })
let api
let S
test.beforeAll(async ({ playwright }) => {
  api = await snapshot(playwright, T.wed11)
  S = await getState(api)
})
test.afterAll(async () => { await api.dispose() })

const frozen = () => S.deals.filter((d) => d.fraud.flagged && !d.fraud.released).length

test('tabs: counts equal the server, every link opens its screen, the open tab is marked', async ({ page }) => {
  await open(page, '')
  await expect(page.getByTestId('nav-count-tasks')).toHaveText(String(S.pending.length))
  await expect(page.getByTestId('nav-count-alerts')).toHaveText(String(S.alerts.length))
  await expect(page.getByTestId('nav-count-fraud')).toHaveText(String(frozen()))
  await expect(page.getByTestId('header-time')).toHaveText('Wed, Nov 4 · 11:00 AM CT')
  await expect(page.getByTestId('header-status')).toContainText('Test parser')
  for (const [nav, view] of [['pipeline', 'view-pipeline'], ['alerts', 'view-alerts'], ['fraud', 'view-fraud'], ['simulation', 'view-simulation'], ['tasks', 'view-tasks']]) {
    await page.getByTestId(`nav-${nav}`).click()
    await expect(page.getByTestId(view)).toBeVisible()
    await expect(page.getByTestId(`nav-${nav}`)).toHaveAttribute('aria-current', 'page')
  }
  await page.getByTestId('nav-fraud').click()
  await page.getByTestId('header-brand').click()
  await expect(page.getByTestId('view-tasks')).toBeVisible()
})

test('My tasks: groups, tiles and what borrowers owe match the server', async ({ page }) => {
  await open(page, '#/tasks')
  await expect(page.getByTestId('stat-waiting-value')).toHaveText(String(S.pending.length))
  await expect(page.getByTestId('stat-frozen-value')).toHaveText(String(frozen()))
  await expect(page.getByTestId('stat-urgent-value')).toHaveText('1')
  const groups = [...new Set(S.pending.map((r) => r.to))]
  await expect(page.getByTestId(/^task-group-/)).toHaveCount(groups.length)
  await expect(page.getByTestId('task-group-marcus.lee')).toBeVisible()
  const first = page.getByTestId(/^task-card-/).first()
  await expect(first).toContainText('Urgent')
  await expect(first).toContainText('Covering for Dana Whitfield')
  await expect(page.getByTestId('task-evidence-4')).toContainText('Tax preparer phone 214-555-0187')
  await expect(page.getByTestId('task-evidence-4')).not.toContainText('appears on only')
})

test('Waiting on borrowers: each card opens its deal', async ({ page }) => {
  await open(page, '#/tasks')
  const cards = page.getByTestId(/^borrower-/)
  expect(await cards.count()).toBeGreaterThanOrEqual(3)
  await cards.first().click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
})

test('Pipeline: every stage on one page, counts equal the server, cards open their deal', async ({ page }) => {
  await open(page, '#/pipeline')
  const expected = {}
  for (const c of ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed', 'Stopped']) expected[c] = S.deals.filter((d) => columnOf(d) === c).length
  for (const [c, n] of Object.entries(expected)) await expect(page.getByTestId(`board-count-${c}`)).toHaveText(String(n))
  await expect(page.getByTestId('pipeline-summary')).toContainText(`${S.deals.length} deals`)
  await expect(page.getByTestId('pipeline-summary')).toContainText('$3,321,500 requested')
  await expect(page.getByTestId(/^board-card-/)).toHaveCount(S.deals.length)
  // the whole board is visible without sideways scrolling at 1440px
  const fits = await page.getByTestId('board').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(fits, 'seven columns fit at 1440px').toBe(true)
  const priya = S.deals.find((d) => d.folder === "Priya's Bakery")
  await page.getByTestId("board-card-Priya's Bakery").click()
  await expect(page.getByTestId('page-title')).toHaveText(priya.legal_name)
  await page.getByTestId('deal-back').click()
  await expect(page.getByTestId('board')).toBeVisible()
})

test('Pipeline: find a deal narrows the board, clearing restores it', async ({ page }) => {
  await open(page, '#/pipeline')
  await page.getByTestId('pipeline-search').fill('granite')
  await expect(page.getByTestId(/^board-card-/)).toHaveCount(1)
  await page.getByTestId('pipeline-search').fill('')
  await expect(page.getByTestId(/^board-card-/)).toHaveCount(S.deals.length)
})

test('Pipeline: Download results gives the submission JSON', async ({ page }) => {
  await open(page, '#/pipeline')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pipeline-download').click()])
  const body = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))
  expect(body).toHaveProperty('deals')
  expect(Object.keys(body.deals).length).toBe(S.deals.length)
  expect(body.history_flags).toEqual(expect.arrayContaining(['H-2608-002', 'H-2609-008']))
})

test('Pipeline stage view: open a stage, switch stages, go back', async ({ page }) => {
  await open(page, '#/pipeline')
  await page.getByTestId('board-col-Credit').click()
  await expect(page.getByTestId('stage-focus')).toBeVisible()
  await expect(page.getByTestId('focus-title')).toHaveText('Credit')
  const credit = S.deals.filter((d) => columnOf(d) === 'Credit').length
  await expect(page.getByTestId(/^focus-card-/)).toHaveCount(credit)
  await page.getByTestId('pipeline-strip-Intake').click()
  await expect(page.getByTestId('focus-title')).toHaveText('Intake')
  await expect(page.getByTestId('pipeline-strip-Intake')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('focus-card-Granite Bay Building Supply')).toContainText('Bank statement does not add up')
  await page.getByTestId('pipeline-strip-Committee').click()
  await expect(page.getByTestId('focus-empty')).toBeVisible()
  await page.getByTestId('pipeline-strip-Intake').click()
  await page.getByTestId('focus-card-Bluebonnet Landscape').click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('stage-focus')).toBeVisible()
  await page.getByTestId('pipeline-back').click()
  await expect(page.getByTestId('board')).toBeVisible()
})

test('Alerts: filters and counts match the server; show older; deal link', async ({ page }) => {
  await open(page, '#/alerts')
  const count = (k) => (k === 'all' ? S.alerts.length : S.alerts.filter((a) => a.kind === k).length)
  for (const k of ['all', 'stuck', 'deadline_risk', 'fraud_nudge']) await expect(page.getByTestId(`alerts-count-${k}`)).toHaveText(String(count(k)))
  await expect(page.getByTestId(/^alert-row-/)).toHaveCount(12)
  await page.getByTestId('alerts-more').click()
  await expect(page.getByTestId(/^alert-row-/)).toHaveCount(S.alerts.length)
  await page.getByTestId('alerts-filter-deadline_risk').click()
  await expect(page.getByTestId(/^alert-row-/)).toHaveCount(count('deadline_risk'))
  await expect(page.getByTestId('alert-row-0')).toContainText('Deadline at risk')
  await page.getByTestId('alerts-filter-fraud_nudge').click()
  await expect(page.getByTestId(/^alert-row-/)).toHaveCount(count('fraud_nudge'))
  await page.getByTestId('alerts-filter-stuck').click()
  await expect(page.getByTestId(/^alert-row-/)).toHaveCount(Math.min(12, count('stuck')))
  await page.getByTestId('alerts-filter-all').click()
  await page.getByTestId('alert-deal-0').click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
})

test('Fraud review: the group, its evidence, and the way to answer', async ({ page }) => {
  await open(page, '#/fraud')
  const ring = S.clusters[0]
  await expect(page.getByTestId('cluster-headline')).toHaveText('3 live applications tied to 2 loans funded earlier')
  await expect(page.getByTestId('cluster-score')).toHaveText(String(ring.score))
  await expect(page.getByTestId('fraud-cluster')).toContainText(`flag threshold ${S.cluster_threshold}`)
  await expect(page.getByTestId(/^cluster-member-/)).toHaveCount(5)
  await expect(page.getByTestId('cluster-evidence')).toContainText('Tax preparer phone 214-555-0187')
  expect(await page.getByTestId(/^evidence-row-/).count()).toBe(ring.evidence.length)
  await expect(page.getByTestId('fraud-check-Granite Bay Building Supply')).toContainText('Revenue inflated')
  await expect(page.getByTestId('history-H-2608-002')).toBeVisible()
  await expect(page.getByTestId('history-H-2609-008')).toBeVisible()
  await page.getByTestId('cluster-member-Ridgeway Freight Logistics').click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
  await expect(page.getByTestId('deal-fraud-chip')).toHaveText(/Awaiting Fraud Ops decision/i)
  await page.goBack()
  await page.getByTestId('fraud-check-link-Granite Bay Building Supply').click()
  await expect(page.getByTestId('page-title')).toContainText('Granite Bay')
  await page.goBack()
  await page.getByTestId('fraud-answer').click()
  await expect(page.getByTestId('tasks-viewas')).toHaveValue('victor.hale')
  await expect(page.getByTestId(/^task-group-/)).toHaveCount(1)
})

test('Deal page: Granite Bay is frozen with its failed checks explained and nothing to accept', async ({ page }) => {
  await open(page, '#/deal/Granite%20Bay%20Building%20Supply')
  const d = await getDeal(api, 'Granite Bay Building Supply')
  await expect(page.getByTestId('page-title')).toHaveText(d.facts.legal_name)
  await expect(page.getByTestId('deal-fraud')).toContainText('Bank statement does not add up.')
  await expect(page.getByTestId('deal-fraud')).toContainText('Revenue inflated.')
  await expect(page.getByTestId('deal-step-Intake')).toContainText('Frozen: fraud review')
  await expect(page.getByTestId('deal-now')).toContainText('Fraud Operations decision')
  await expect(page.getByTestId(/^deal-accept/)).toHaveCount(0)
})

test('Deal page: Ridgeway names its group; linked live deals open, funded-earlier ones are plain', async ({ page }) => {
  await open(page, '#/deal/Ridgeway%20Freight%20Logistics')
  await expect(page.getByTestId('deal-fraud')).toContainText('Linked to 4 other deals')
  await expect(page.getByTestId('deal-fraud')).toContainText('H-2608-002')
  await expect(page.getByTestId('deal-linked-H-2608-002')).toHaveCount(0)
  await page.getByTestId('deal-linked-Pecan Grove Catering').click()
  await expect(page.getByTestId('page-title')).toContainText('Pecan Grove')
})

test('Deal page: Bluebonnet shows facts, issues, history, requests and every document', async ({ page }) => {
  await open(page, '#/deal/Bluebonnet%20Landscape')
  const d = await getDeal(api, 'Bluebonnet Landscape')
  await expect(page.getByTestId('deal-facts')).toContainText(d.facts.ein)
  await expect(page.getByTestId('deal-issue-MISMATCH:amount_requested')).toContainText('Blocking Intake now')
  await expect(page.getByTestId('deal-issue-MISSING_DOC:equipment_quote')).toContainText('Blocks Product (step 4)')
  await expect(page.getByTestId('deal-log-Intake')).toContainText('Intake · waiting')
  await expect(page.getByTestId('deal-events')).toContainText('Awaiting documents')
  await expect(page.getByTestId('deal-docs')).toContainText(`Documents received (${d.docs.length})`)
  await expect(page.getByTestId('deal-unblock')).toBeVisible()
  await expect(page.getByTestId('deal-accept-all')).toHaveCount(0)
})

test('Deal page: "Write stage notes with Gemini" says plainly when Gemini is not available', async ({ page }) => {
  await open(page, '#/deal/Garza%20Family%20Pharmacy')
  await page.getByTestId('deal-memos').click()
  await expect(page.getByTestId('deal-memo-msg')).toHaveText("Gemini isn't available right now, so no notes were written.")
  await expect(page.getByTestId('deal-history')).toBeVisible()
  await open(page, '#/deal/Bluebonnet%20Landscape')
  await page.getByTestId('deal-memos').click()
  await expect(page.getByTestId('deal-memo-msg')).toContainText('no finished stages')
})

test('Deal page: an unknown deal shows a friendly message with a way back', async ({ page, allow }) => {
  page.allow('/api/deals/')
  await open(page, '#/deal/Not%20A%20Deal')
  await expect(page.getByTestId('deal-missing')).toBeVisible()
  await page.getByTestId('deal-missing-back').click()
  await expect(page.getByTestId('view-pipeline')).toBeVisible()
})

test('Simulation: the System card shows the real health numbers', async ({ page }) => {
  const h = await (await api.get('/api/health')).json()
  await open(page, '#/simulation')
  await expect(page.getByTestId('sim-reader')).toHaveText('Test parser (Gemini not used)')
  await expect(page.getByTestId('sim-calls')).toHaveText(String(h.gemini_calls))
  await expect(page.getByTestId('sim-cache')).toHaveText(String(h.cache_hits))
  await expect(page.getByTestId('sim-time')).toHaveText('Wed, Nov 4 · 11:00 AM CT')
  await expect(page.getByTestId('sim-arrived')).toContainText(`${S.n_arrived} of ${S.n_total} files`)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('sim-download').click()])
  expect(JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))).toHaveProperty('deals')
})
