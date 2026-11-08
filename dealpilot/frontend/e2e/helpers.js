import { test as base, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TRIMMED = path.join(here, '.tmp', 'arrivals_trimmed.jsonl')
export const DROP = path.join(here, '.tmp', 'garza_drop.jsonl')
export const SHARED = path.resolve(here, '..', '..', 'data', 'participant', 'shared_folder')

export const BASE = 'http://127.0.0.1:8765'

export const T = {
  mon8: '2026-11-02T08:00-06:00',
  wed9: '2026-11-04T09:00-06:00',
  wed11: '2026-11-04T11:00-06:00',
  fri18: '2026-11-06T18:00-06:00',
}

/**
 * Every test fails on a browser console error, an uncaught page error, a failed request, or an HTTP error the test did not
 * announce with allow('/api/path'). That is how "no broken endpoint behind any button" is enforced.
 */
export const test = base.extend({
  allow: async ({}, use) => {
    const allowed = []
    await use((p) => allowed.push(p))
  },
  page: async ({ page, allow }, use, info) => {
    const problems = []
    const allowed = []
    const wrapped = (p) => allowed.push(p)
    info.annotations.push({ type: 'guard', description: 'fails on console/page/network errors' })
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      if (/Failed to load resource/.test(m.text()) && allowed.length) return
      problems.push(`console: ${m.text()}`)
    })
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    page.on('requestfailed', (r) => { if (!/\/api\/export/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`) })
    page.on('response', (r) => {
      if (r.status() >= 400 && !allowed.some((p) => r.url().includes(p))) problems.push(`http ${r.status()}: ${r.url()}`)
    })
    page.allow = wrapped
    await use(page)
    expect(problems, 'browser problems (console / network)').toEqual([])
  },
})
export { expect }

/** Start every spec from the sample week at Monday 08:00 with the simulated colleagues OFF. */
export async function fresh(request, { arrivals } = {}) {
  const r = await request.post('/api/dataset/load', { data: { replace: true, arrivals: arrivals || null, root: null, folder: null } })
  expect(r.ok()).toBeTruthy()
  const p = await request.post('/api/personas', { data: { enabled: false } })
  expect(p.ok()).toBeTruthy()
}

export async function setTime(request, t) {
  const r = await request.post('/api/clock/set', { data: { t } })
  expect(r.ok(), await r.text()).toBeTruthy()
}

export const getState = async (request) => (await request.get('/api/state')).json()
export const getDeal = async (request, folder) => (await request.get(`/api/deals/${encodeURIComponent(folder)}`)).json()

export async function open(page, hash = '') {
  await page.goto('/' + hash)
  await expect(page.getByTestId('header-time')).not.toHaveText('…')
}

/** Click something that triggers an action and wait for the busy bar to come and go. */
export async function settled(page) {
  await expect(page.getByTestId('busy-bar')).toHaveCount(0)
}

/** One API context for a whole describe block: reset to the sample week and run to `t` ONCE (replaying the week takes ~25 s). */
export async function snapshot(playwright, t, opts) {
  const ctx = await playwright.request.newContext({ baseURL: BASE })
  await fresh(ctx, opts)
  if (t) await setTime(ctx, t)
  return ctx
}

/** The stage a deal sits in on the board. */
export const columnOf = (d) => (d.status === 'declined' || d.status === 'held' ? 'Stopped' : d.stage || 'Intake')
