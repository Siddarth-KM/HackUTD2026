// Every answer button on My tasks, against the real backend. One shared Wednesday 11:00 state; each test uses different requests.
import { test, expect, T, snapshot, getState, getDeal, open } from './helpers.js'

test.describe.configure({ mode: 'serial' })
let api
test.beforeAll(async ({ playwright }) => { api = await snapshot(playwright, T.wed11) })
test.afterAll(async () => { await api.dispose() })

const pendingIds = async () => (await getState(api)).pending.map((r) => r.id)

test('Viewing as: one person at a time; Show more reveals the rest of a long list', async ({ page }) => {
  await open(page, '#/tasks')
  const select = page.getByTestId('tasks-viewas')
  await select.selectOption('victor.hale')
  await expect(page.getByTestId(/^task-group-/)).toHaveCount(1)
  await expect(page.getByTestId(/^task-card-/)).toHaveCount(2)
  await page.getByTestId('task-more-victor.hale').click()
  await expect(page.getByTestId(/^task-card-/)).toHaveCount(4)
  await select.selectOption('all')
  await expect(page.getByTestId(/^task-group-/)).toHaveCount(3)
  await page.getByTestId('task-deal-6').click()
  await expect(page.getByTestId('view-deal')).toBeVisible()
})

test('Approve (Priya, credit decision): the request leaves My tasks and the deal moves to Committee', async ({ page }) => {
  await open(page, '#/tasks')
  await expect(page.getByTestId('task-card-6')).toBeVisible()
  await page.getByTestId('task-note-6').fill('Cash flow covers the payroll bridge')
  await page.getByTestId('task-answer-6-approve').click()
  await expect(page.getByTestId('task-card-6')).toHaveCount(0)
  expect(await pendingIds()).not.toContain(6)
  const d = await getDeal(api, "Priya's Bakery")
  expect(d.stage).toBe('Committee')
  expect(d.requests.find((r) => r.id === 6)).toMatchObject({ answer: 'approve', note: 'Cash flow covers the payroll bridge' })
})

test('Ask borrower for more info: needs a note, then sends it to the borrower', async ({ page }) => {
  await open(page, '#/tasks')
  await page.getByTestId('task-answer-1-request_info').click()
  await expect(page.getByTestId('task-error-1')).toContainText('Please write what you need from the borrower')
  expect(await pendingIds()).toContain(1)                                // nothing was sent
  await page.getByTestId('task-note-1').fill('Please send the 2025 depreciation schedule')
  await expect(page.getByTestId('task-error-1')).toHaveCount(0)
  await page.getByTestId('task-answer-1-request_info').click()
  await expect(page.getByTestId('task-card-1')).toHaveCount(0)
  const d = await getDeal(api, 'Garza Family Pharmacy')
  expect(d.requests.find((r) => r.id === 1)).toMatchObject({ answer: 'request_info' })
  expect(d.requests.some((r) => r.type === 'info_request' && r.message.includes('depreciation schedule'))).toBe(true)
})

test('Decline asks first: Cancel changes nothing; Confirm stops the deal and it appears under Stopped', async ({ page }) => {
  await open(page, '#/tasks')
  await page.getByTestId('task-answer-11-decline').click()
  await expect(page.getByRole('dialog')).toContainText('Decline this loan?')
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await pendingIds()).toContain(11)
  await page.getByTestId('task-answer-11-decline').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('task-card-11')).toHaveCount(0)
  expect((await getDeal(api, 'Harbor Tea Co')).status).toBe('declined')
  await page.getByTestId('nav-pipeline').click()
  await expect(page.getByTestId('board-count-Stopped')).toHaveText('1')
  await expect(page.getByTestId('board-card-Harbor Tea Co')).toContainText('Declined')
})

test('Fraud hold: "Place hold" is immediate; "Release" asks first and clears the deal', async ({ page }) => {
  await open(page, '#/tasks')
  await page.getByTestId('task-more-victor.hale').click()
  const frozenBefore = (await getState(api)).deals.filter((d) => d.fraud.flagged && !d.fraud.released).length
  await page.getByTestId('task-answer-4-hold').click()
  await expect(page.getByTestId('task-card-4')).toHaveCount(0)
  expect((await getDeal(api, 'Ridgeway Freight Logistics')).fraud.confirmed).toBe(true)
  await page.getByTestId('task-answer-10-release').click()
  await expect(page.getByRole('dialog')).toContainText('Release this deal?')
  await page.getByTestId('confirm-cancel').click()
  expect(await pendingIds()).toContain(10)
  await page.getByTestId('task-answer-10-release').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('task-card-10')).toHaveCount(0)
  const granite = await getDeal(api, 'Granite Bay Building Supply')
  expect(granite.fraud.released).toBe(true)
  await expect(page.getByTestId('nav-count-fraud')).toHaveText(String(frozenBefore - 1))
})

test('the counts and tiles update after answering', async ({ page }) => {
  await open(page, '#/tasks')
  const s = await getState(api)
  await expect(page.getByTestId('nav-count-tasks')).toHaveText(String(s.pending.length))
  await expect(page.getByTestId('stat-waiting-value')).toHaveText(String(s.pending.length))
})
