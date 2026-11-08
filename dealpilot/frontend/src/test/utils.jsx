import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { AppContext } from '../lib/useDealPilot'
import { parseHash } from '../lib/route'
import wed11 from './fixtures/state_wed11.json'
import fri18 from './fixtures/state_fri18.json'
import declined from './fixtures/state_declined.json'
import bluebonnet from './fixtures/deal_bluebonnet.json'
import granite from './fixtures/deal_granite.json'
import ridgeway from './fixtures/deal_ridgeway.json'
import priya from './fixtures/deal_priya.json'
import okafor from './fixtures/deal_okafor.json'
import funded from './fixtures/deal_funded.json'
import declinedDeal from './fixtures/deal_declined.json'
import garza from './fixtures/deal_garza_two_missing.json'

export const fx = { wed11, fri18, declined, bluebonnet, granite, ridgeway, priya, okafor, funded, declinedDeal, garza }
export const clone = (o) => JSON.parse(JSON.stringify(o))

/**
 * Replaces fetch with a tiny router and records every call: routes are keyed "GET /health" / "POST /humans/6/answer"
 * (the /api prefix is stripped). A key ending in * matches by prefix. A value may be a function of the request body.
 */
export function mockApi(routes = {}) {
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const path = String(url).replace(/^\/api/, '')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    let h = routes[key]
    if (h === undefined) h = Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1]
    if (h === undefined) return new Response(JSON.stringify({ detail: `no mock for ${key}` }), { status: 404 })
    const v = typeof h === 'function' ? await h(body) : h
    if (v instanceof Response) return v
    return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

export const failure = (status, detail) => new Response(JSON.stringify({ detail }), { status, headers: { 'content-type': 'application/json' } })

/** Render one screen inside the app context the real hook provides. */
export function renderView(ui, { state = wed11, hash = '#/tasks', busy = false, extra = {} } = {}) {
  const act = vi.fn(async (fn) => {
    try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: e.message } }
  })
  const value = { state, busy, error: '', netError: '', version: 0, act, refresh: vi.fn(), clearError: vi.fn(), route: parseHash(hash), ...extra }
  const wrap = (v) => <AppContext.Provider value={v}>{ui}</AppContext.Provider>
  const utils = render(wrap(value))
  return { ...utils, act, value, rerenderWith: (patch) => utils.rerender(<AppContext.Provider value={{ ...value, ...patch }}>{ui}</AppContext.Provider>) }
}

export const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
