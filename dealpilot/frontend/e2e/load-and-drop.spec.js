// "Load loan files": start fresh on a pack, accept-all on a deal missing two Intake papers, and the weekend drop.
// The trimmed arrivals file is the sample week WITHOUT Garza's photo ID and EIN letter (built in global-setup).
import { test, expect, T, TRIMMED, DROP, SHARED, setTime, getDeal, open } from './helpers.js'

test.describe.configure({ mode: 'serial' })
const GARZA = 'Garza Family Pharmacy'
const DEAL = `#/deal/${encodeURIComponent(GARZA)}`

async function startFreshOn(page, arrivals) {
  await open(page, '#/simulation')
  await page.getByTestId('sim-load-arr').fill(arrivals)
  await page.getByTestId('sim-load-fresh').click()
  await expect(page.getByRole('dialog')).toContainText('Start fresh on this pack?')
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('sim-msg')).toHaveText('Started fresh on this pack.')
  await expect(page.getByTestId('sim-time')).toHaveText('Mon, Nov 2 · 8:00 AM CT')
}

test('weekend drop: two papers missing, the drop arrives, the issues resolve on their own', async ({ page, request }) => {
  await startFreshOn(page, TRIMMED)
  await setTime(request, T.wed11)
  await open(page, DEAL)
  await expect(page.getByTestId('deal-issue-MISSING_DOC:guarantor_id')).toContainText('Blocking Intake now')
  await expect(page.getByTestId('deal-issue-MISSING_DOC:ein_letter')).toContainText('Blocking Intake now')
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Intake')
  // add the dropped files to the running week (they arrive Wed 12:00), then move the clock past them
  await open(page, '#/simulation')
  await page.getByTestId('sim-load-arr').fill(DROP)
  await page.getByTestId('sim-load-folder').fill(SHARED)                 // where the dropped files live
  await page.getByTestId('sim-load-append').click()
  await expect(page.getByTestId('sim-msg')).toHaveText('Added the drop to the running week.')
  await page.getByTestId('header-advance-1h').click()
  await expect(page.getByTestId('header-time')).toContainText('12:00 PM')
  await open(page, DEAL)
  await expect(page.getByTestId('deal-issue-MISSING_DOC:guarantor_id')).toHaveCount(0)
  await expect(page.getByTestId('deal-issue-MISSING_DOC:ein_letter')).toHaveCount(0)
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Credit')
  await expect(page.getByTestId('deal-docs')).toContainText("Guarantor's photo ID")
  await expect(page.getByTestId('deal-docs')).toContainText('IRS EIN letter')
  const d = await getDeal(request, GARZA)
  expect(d.findings.some((f) => f.blocks && f.stage === 'Intake')).toBe(false)
})

test('accept all: one click on a deal with two open Intake issues moves it to Credit', async ({ page, request }) => {
  await startFreshOn(page, TRIMMED)
  await setTime(request, T.wed11)
  await open(page, DEAL)
  const btn = page.getByTestId('deal-accept-all')
  await expect(btn).toHaveText('Accept all 2 open issues for Intake and continue')
  const asked = (await getDeal(request, GARZA)).requests.filter((r) => r.type === 'info_request').length
  await btn.click()
  await expect(page.getByTestId('deal-done')).toContainText('Intake -> Credit')
  await expect(page.getByTestId('deal-stage-chip')).toHaveText('Credit')
  await expect(page.getByTestId('deal-issue-MISSING_DOC:guarantor_id')).toContainText('Accepted')
  await expect(page.getByTestId('deal-issue-MISSING_DOC:ein_letter')).toContainText('Accepted')
  await expect(page.getByTestId('deal-accept-all')).toHaveCount(0)
  const d = await getDeal(request, GARZA)
  expect(d.accepted_log).toHaveLength(2)
  expect(d.requests.filter((r) => r.type === 'info_request').length).toBe(asked)   // accepting never writes to the borrower again
})

test('loading a pack that does not exist shows the reason instead of failing silently', async ({ page }) => {
  page.allow('/api/dataset/load')
  await open(page, '#/simulation')
  await page.getByTestId('sim-load-root').fill('C:\\no\\such\\pack')
  await page.getByTestId('sim-load-fresh').click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('banner-error')).toContainText('Could not find C:\\no\\such\\pack')
  await page.getByTestId('banner-dismiss').click()
  await expect(page.getByTestId('banner-error')).toHaveCount(0)
  await expect(page.getByTestId('sim-time')).toBeVisible()          // the running week is untouched
})
