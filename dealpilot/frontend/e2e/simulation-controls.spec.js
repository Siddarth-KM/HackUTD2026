// Every clock and simulation control, from the header and the Simulation page, ending with a whole week run by simulated colleagues.
import { test, expect, T, snapshot, getState, open, columnOf } from './helpers.js'

test.describe.configure({ mode: 'serial' })
let api
const RING = ['Ridgeway Freight Logistics', 'Pecan Grove Catering', 'Summit Peak Flooring']
const BAD = [...RING, 'Granite Bay Building Supply']

test.beforeAll(async ({ playwright }) => { api = await snapshot(playwright, null) })     // Monday 08:00
test.afterAll(async () => { await api.dispose() })

const apiNow = async () => (await getState(api)).now
const timeIs = async (page, text) => {
  await expect(page.getByTestId('sim-time')).toHaveText(text)
}

test('header: +1 hour and +1 day move the clock', async ({ page }) => {
  await open(page, '#/tasks')
  await expect(page.getByTestId('header-time')).toHaveText('Mon, Nov 2 · 8:00 AM CT')
  await page.getByTestId('header-advance-1h').click()
  await expect(page.getByTestId('header-time')).toHaveText('Mon, Nov 2 · 9:00 AM CT')
  await page.getByTestId('header-advance-1d').click()
  await expect(page.getByTestId('header-time')).toHaveText('Tue, Nov 3 · 9:00 AM CT')
  expect(await apiNow()).toContain('2026-11-03T09:00')
})

test('Simulation page: +30 min, +1 hour, +6 hours, +1 day', async ({ page }) => {
  await open(page, '#/simulation')
  await timeIs(page, 'Tue, Nov 3 · 9:00 AM CT')
  await page.getByTestId('sim-advance-30m').click()
  await timeIs(page, 'Tue, Nov 3 · 9:30 AM CT')
  await page.getByTestId('sim-advance-1h').click()
  await timeIs(page, 'Tue, Nov 3 · 10:30 AM CT')
  await page.getByTestId('sim-advance-6h').click()
  await timeIs(page, 'Tue, Nov 3 · 4:30 PM CT')
  await page.getByTestId('sim-advance-1d').click()
  await timeIs(page, 'Wed, Nov 4 · 4:30 PM CT')
  expect(await apiNow()).toContain('2026-11-04T16:30')
  const s = await getState(api)
  await expect(page.getByTestId('sim-arrived')).toContainText(`${s.n_arrived} of ${s.n_total} files`)
})

test('Jump to a time: forward works, backwards is refused with the reason', async ({ page }) => {
  page.allow('/api/clock/set')
  await open(page, '#/simulation')
  await page.getByTestId('sim-jump-input').fill('2026-11-05T09:00-06:00')
  await page.getByTestId('sim-jump-go').click()
  await timeIs(page, 'Thu, Nov 5 · 9:00 AM CT')
  await page.getByTestId('sim-jump-input').fill('2026-11-04T09:00-06:00')
  await page.getByTestId('sim-jump-go').click()
  await expect(page.getByTestId('banner-error')).toHaveText(/cannot move the clock backwards/)
  await timeIs(page, 'Thu, Nov 5 · 9:00 AM CT')                          // unchanged
  await page.getByTestId('banner-dismiss').click()
  await expect(page.getByTestId('banner-error')).toHaveCount(0)
})

test('Simulated colleagues: the switch turns on and off and the server agrees', async ({ page }) => {
  await open(page, '#/simulation')
  const sw = page.getByTestId('sim-personas')
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  expect((await getState(api)).personas).toBe(true)
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  expect((await getState(api)).personas).toBe(false)
})

test('Reset: Cancel keeps the week, Confirm starts it again', async ({ page }) => {
  await open(page, '#/simulation')
  await page.getByTestId('sim-reset').click()
  await expect(page.getByRole('dialog')).toContainText('Reset the simulation?')
  await page.getByTestId('confirm-cancel').click()
  await timeIs(page, 'Thu, Nov 5 · 9:00 AM CT')
  await page.getByTestId('sim-reset').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('sim-msg')).toHaveText('Back to the start of the week.')
  await timeIs(page, 'Mon, Nov 2 · 8:00 AM CT')
  await expect(page.getByTestId('sim-arrived')).toContainText('0 of')
  const s = await getState(api)
  expect(s.deals).toHaveLength(0)
})

test('Performance and Fraud scores come from the same poll as the rest: they change with the clock', async ({ page }) => {
  await open(page, '#/performance')
  const s0 = await getState(api)
  await expect(page.getByTestId('stat-perf-alerts-value')).toHaveText(String(s0.alerts.length))
  await expect(page.getByTestId('header-time')).toHaveText('Mon, Nov 2 · 8:00 AM CT')
  await page.getByTestId('header-advance-1d').click()
  await expect(page.getByTestId('header-time')).toHaveText('Tue, Nov 3 · 8:00 AM CT')
  const s1 = await getState(api)
  expect(s1.alerts.length).toBeGreaterThan(s0.alerts.length)               // a day later, deals have passed their limits
  await expect(page.getByTestId('stat-perf-alerts-value')).toHaveText(String(s1.alerts.length))
  const late = s1.deals.filter((d) => d.status === 'active' && d.sla && d.sla.pct >= 100).length
  await expect(page.getByTestId('stat-perf-late-value')).toHaveText(String(late))
  await expect(page.getByTestId('nav-count-alerts')).toHaveText(String(s1.alerts.length))
  await page.getByTestId('nav-fraud').click()
  await expect(page.getByTestId('fraud-profiles')).toBeVisible()
  if (await page.getByTestId('profile-more').count()) await page.getByTestId('profile-more').click()   // only shown when more than the top 8 deals exist
  await expect(page.getByTestId(/^profile-row-/)).toHaveCount(s1.deals.length)
  for (const d of s1.deals) await expect(page.getByTestId(`profile-pct-${d.folder}`)).toContainText(String(Math.floor(d.anomaly.percentile * 100 + 1e-9)))
  expect((await api.post('/api/clock/reset')).ok()).toBeTruthy()               // leave Monday 08:00 for the week-long test
})

test('a whole week with simulated colleagues: the ring and Granite Bay are held, good deals are funded, none wrongly stopped', async ({ page }) => {
  test.setTimeout(420_000)
  await open(page, '#/simulation')
  await page.getByTestId('sim-personas').click()
  await expect(page.getByTestId('sim-personas')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('sim-run-friday').click()
  await expect(page.getByTestId('sim-time')).toHaveText('Fri, Nov 6 · 6:00 PM CT', { timeout: 360_000 })
  const s = await getState(api)
  const by = Object.fromEntries(s.deals.map((d) => [d.folder, d]))
  for (const f of BAD) {
    expect(by[f].status, `${f} must never be funded`).not.toBe('funded')
    expect(by[f].fraud.flagged, `${f} flagged`).toBe(true)
  }
  const good = s.deals.filter((d) => !BAD.includes(d.folder))
  for (const d of good) expect(d.fraud.flagged, `${d.folder} wrongly flagged`).toBe(false)
  const funded = s.deals.filter((d) => d.status === 'funded')
  expect(funded.length).toBeGreaterThanOrEqual(4)
  for (const d of s.deals.filter((x) => columnOf(x) === 'Stopped')) expect(BAD, `${d.folder} wrongly stopped`).toContain(d.folder)
  // the board tells the same story
  await page.getByTestId('nav-pipeline').click()
  await expect(page.getByTestId('board-count-Closed')).toHaveText(String(s.deals.filter((d) => columnOf(d) === 'Closed').length))
  for (const d of funded) await expect(page.getByTestId(`board-card-${d.folder}`)).toContainText('Funded')
  await page.getByTestId('nav-fraud').click()
  await expect(page.getByTestId('history-H-2608-002')).toBeVisible()
  await expect(page.getByTestId('cluster-headline')).toContainText('live applications')
  // the graph and the Performance page tell the same story as the board
  await expect(page.getByTestId('graph-hub-group-1')).toBeAttached()
  for (const f of RING) await expect(page.getByTestId(`graph-node-${f}`)).toBeVisible()
  await page.getByTestId('nav-performance').click()
  await expect(page.getByTestId('chart-stage-value-Closed')).toHaveText(String(s.deals.filter((d) => columnOf(d) === 'Closed').length))
  await expect(page.getByTestId('chart-stage-value-Stopped')).toHaveText(String(s.deals.filter((d) => columnOf(d) === 'Stopped').length))
  await expect(page.getByTestId('stat-perf-alerts-value')).toHaveText(String(s.alerts.length))
  // leave the server clean
  await open(page, '#/simulation')
  await page.getByTestId('sim-personas').click()
})
