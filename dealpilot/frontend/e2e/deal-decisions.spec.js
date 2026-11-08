// Answering a deal's waiting requests from its own page (reached from Pipeline), against the real backend.
// One shared Wednesday 11:00 state; each test answers a different request.
import { test, expect, T, snapshot, getState, getDeal, open, columnOf } from './helpers.js'

test.describe.configure({ mode: 'serial' })
let api
test.beforeAll(async ({ playwright }) => { api = await snapshot(playwright, T.wed11) })
test.afterAll(async () => { await api.dispose() })

const pendingIds = async () => (await getState(api)).pending.map((r) => r.id)

test('from Pipeline: open Priya, approve the credit decision on the deal page, the deal moves to Committee', async ({ page }) => {
  await open(page, '#/pipeline')
  const before = await getState(api)
  await expect(page.getByTestId('nav-count-tasks')).toHaveText(String(before.pending.length))
  await page.getByTestId("board-card-Priya's Bakery").click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
  await expect(page.getByTestId('deal-decisions')).toContainText('Decision waiting')
  await expect(page.getByTestId('deal-req-who-6')).toContainText('Waiting on Marcus Lee')
  await page.getByTestId('deal-req-note-6').fill('Cash flow covers the payroll bridge')
  await page.getByTestId('deal-req-answer-6-approve').click()
  await expect(page.getByTestId('deal-done')).toContainText("Approved. Priya's Bakery moved from Credit to Committee.")
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Committee')
  await expect(page.getByTestId('deal-step-Credit')).toContainText('Done')
  expect(await pendingIds()).not.toContain(6)
  const d = await getDeal(api, "Priya's Bakery")
  expect(d.requests.find((r) => r.id === 6)).toMatchObject({ answer: 'approve', note: 'Cash flow covers the payroll bridge' })
  // the committee request the move created is offered right here too, and the tab count follows the server
  const now = await getState(api)
  const next = now.pending.find((r) => r.deal === "Priya's Bakery")
  if (next) await expect(page.getByTestId(`deal-req-card-${next.id}`)).toContainText('Committee approval')
  else await expect(page.getByTestId('deal-decisions')).toHaveCount(0)
  await expect(page.getByTestId('nav-count-tasks')).toHaveText(String(now.pending.length))
})

test('Ask borrower for more info: needs a note, then the borrower request appears on the deal', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent('Garza Family Pharmacy')}`)
  await page.getByTestId('deal-req-answer-1-request_info').click()
  await expect(page.getByTestId('deal-req-error-1')).toContainText('Please write what you need from the borrower')
  expect(await pendingIds()).toContain(1)                                // nothing was sent
  await page.getByTestId('deal-req-note-1').fill('Please send the 2025 depreciation schedule')
  await page.getByTestId('deal-req-answer-1-request_info').click()
  await expect(page.getByTestId('deal-done')).toContainText('The borrower has been asked for more information')
  await expect(page.getByTestId('deal-decisions')).toHaveCount(0)
  await expect(page.getByTestId('deal-events')).toContainText('depreciation schedule')
  expect(await pendingIds()).not.toContain(1)
})

test('Decline asks first: Cancel changes nothing; Confirm stops the deal and the board shows it under Stopped', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent('Harbor Tea Co')}`)
  await page.getByTestId('deal-req-answer-11-decline').click()
  await expect(page.getByRole('dialog')).toContainText('Decline this loan?')
  await page.getByTestId('confirm-cancel').click()
  expect(await pendingIds()).toContain(11)
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Credit')
  await page.getByTestId('deal-req-answer-11-decline').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('deal-done')).toContainText('Declined. The deal is stopped.')
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Declined')
  expect(columnOf(await getDeal(api, 'Harbor Tea Co'))).toBe('Stopped')
  await page.getByTestId('deal-back').click()
  const s = await getState(api)
  await expect(page.getByTestId('board-count-Stopped')).toHaveText(String(s.deals.filter((d) => columnOf(d) === 'Stopped').length))
})

test('a frozen deal: Release (confirmed) on Granite Bay clears it and it leaves the frozen count', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent('Granite Bay Building Supply')}`)
  const frozenBefore = Number(await page.getByTestId('nav-count-fraud').textContent())
  await expect(page.getByTestId('deal-fraud-chip')).toHaveText('Awaiting Fraud Ops decision')
  await expect(page.getByTestId('deal-req-evidence-10')).toHaveCount(0)        // the page's own fraud card explains it
  await expect(page.getByTestId('deal-fraud')).toBeVisible()
  await page.getByTestId('deal-req-answer-10-release').click()
  await expect(page.getByRole('dialog')).toContainText('Release this deal?')
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('deal-done')).toContainText('Released as genuine.')
  await expect(page.getByTestId('deal-fraud-chip')).toHaveText('Fraud hold released')
  await expect(page.getByTestId('nav-count-fraud')).toHaveText(String(frozenBefore - 1))
  expect((await getDeal(api, 'Granite Bay Building Supply')).fraud.released).toBe(true)
})

test('Place hold on Ridgeway from its page: no confirmation, the hold is recorded', async ({ page }) => {
  await open(page, `#/deal/${encodeURIComponent('Ridgeway Freight Logistics')}`)
  await page.getByTestId('deal-req-answer-4-hold').click()
  await expect(page.getByTestId('deal-done')).toContainText('Hold placed.')
  await expect(page.getByTestId('deal-fraud-chip')).toHaveText('Fraud hold confirmed')
  expect(await pendingIds()).not.toContain(4)
})
