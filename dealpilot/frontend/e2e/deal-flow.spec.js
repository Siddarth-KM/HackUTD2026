// Accepting issues on the deal page, then walking the deal through EVERY human gate in the UI until the money is released.
import { test, expect, T, snapshot, getDeal, open } from './helpers.js'

test.describe.configure({ mode: 'serial' })
let api
const FOLDER = 'Bluebonnet Landscape'
test.beforeAll(async ({ playwright }) => { api = await snapshot(playwright, T.wed11) })
test.afterAll(async () => { await api.dispose() })

async function revealAll(page) {
  for (let i = 0; i < 5; i += 1) {
    const more = page.locator('[data-testid^="task-more-"]')
    if (!(await more.count())) return
    await more.first().click()
  }
}

/** Find this deal's open request of a given kind in My tasks and press its approve-type button. */
async function answerGate(page, kindLabel, buttonSuffix, confirm = false) {
  await open(page, '#/tasks')
  await revealAll(page)
  const card = page.getByTestId(/^task-card-/).filter({ hasText: 'Bluebonnet' }).filter({ hasText: kindLabel })
  await expect(card, `${kindLabel} request for Bluebonnet`).toHaveCount(1)
  await card.locator(`[data-testid$="-${buttonSuffix}"]`).click()
  if (confirm) await page.getByTestId('confirm-ok').click()
  await expect(card).toHaveCount(0)
}

test('accept the later-stage issue first: it says it applies at Product', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent(FOLDER)}`)
  await page.getByTestId('deal-accept-MISSING_DOC:equipment_quote').click()
  await expect(page.getByTestId('deal-done')).toContainText('Takes effect when the deal reaches Product')
  await expect(page.getByTestId('deal-issue-MISSING_DOC:equipment_quote')).toContainText('Accepted')
  await expect(page.getByTestId('deal-accept-MISSING_DOC:equipment_quote')).toHaveCount(0)
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Intake')
  const d = await getDeal(api, FOLDER)
  expect(d.findings.find((f) => f.code === 'MISSING_DOC:equipment_quote')).toMatchObject({ accepted: true })
  expect(d.stage).toBe('Intake')
})

test('accept the blocking issue: the deal moves to Credit', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent(FOLDER)}`)
  await page.getByTestId('deal-accept-MISMATCH:amount_requested').click()
  await expect(page.getByTestId('deal-done')).toContainText('Intake -> Credit')
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Credit')
  await expect(page.getByTestId('deal-step-Intake')).toContainText('Done')
  await expect(page.getByTestId('deal-log-Intake')).toContainText('human-accepted issue')
  expect((await getDeal(api, FOLDER)).stage).toBe('Credit')
})

test('every gate answered from My tasks: credit, committee, commitment, funding release (confirmed)', async ({ page }) => {
  await answerGate(page, 'Credit decision', 'approve')
  await answerGate(page, 'Committee approval', 'approve')
  // Product is automatic: the accepted missing quote lets it pass
  await answerGate(page, 'Commitment letter sign-off', 'approve')
  await answerGate(page, 'Funding release', 'approve', true)
  const d = await getDeal(api, FOLDER)
  expect(d.stage).toBe('Closed')
  // the funding request warned the officer about the accepted missing quote
  const fr = d.requests.find((r) => r.type === 'funding_release')
  expect(fr.message).toContain('No vendor quote is on file')
})

test('after the disbursement time the deal shows as funded, with every step done and the accepted issues on record', async ({ page }) => {
  await open(page, '#/tasks')
  await page.getByTestId('header-advance-1h').click()
  await expect(page.getByTestId('header-time')).toContainText('12:00 PM')
  await open(page, `#/deal/${encodeURIComponent(FOLDER)}`)
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Funded')
  await expect(page.getByTestId('deal-now')).toContainText('Funds have been released.')
  for (const s of ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed']) await expect(page.getByTestId(`deal-step-${s}`)).toContainText('Done')
  await expect(page.getByTestId('deal-log-Product')).toContainText('MISSING_DOC:equipment_quote')
  await page.getByTestId('nav-pipeline').click()
  await expect(page.getByTestId('board-card-Bluebonnet Landscape')).toContainText('Funded')
  await expect(page.getByTestId('board-count-Closed')).toHaveText('1')
})
