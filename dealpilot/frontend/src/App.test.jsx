// The whole app with the REAL data hook and a mocked server: routing, polling, busy state, error banners.
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { clone, deferred, failure, fx, mockApi } from './test/utils'

const stateCalls = (calls) => calls.filter((c) => c.path === '/state').length
const base = (extra = {}) => ({ 'GET /state': () => clone(fx.wed11), 'GET /health': { ok: true, gemini_key: false, model: 'm', gemini_calls: 0, cache_hits: 0 }, ...extra })

describe('App: navigation', () => {
  it('opens on My tasks and moves between every screen from the header', async () => {
    mockApi(base({ 'GET /deals/*': fx.bluebonnet }))
    render(<App />)
    expect(await screen.findByTestId('view-tasks')).toBeInTheDocument()
    const go = async (nav, view) => {
      await userEvent.click(screen.getByTestId(nav))
      expect(await screen.findByTestId(view)).toBeInTheDocument()
    }
    await go('nav-pipeline', 'view-pipeline')
    await go('nav-alerts', 'view-alerts')
    await go('nav-fraud', 'view-fraud')
    await go('nav-simulation', 'view-simulation')
    await go('nav-tasks', 'view-tasks')
    await go('nav-pipeline', 'view-pipeline')
    await userEvent.click(screen.getByTestId('board-col-Credit'))
    expect(await screen.findByTestId('stage-focus')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('pipeline-back'))
    expect(await screen.findByTestId('board')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('board-card-Bluebonnet Landscape'))
    expect(await screen.findByTestId('view-deal')).toBeInTheDocument()
    expect(screen.getByTestId('page-title')).toHaveTextContent('Bluebonnet Landscape Services LLC')
    await userEvent.click(screen.getByTestId('deal-back'))
    expect(await screen.findByTestId('view-pipeline')).toBeInTheDocument()
  })
  it('a task card links to its deal and the browser location follows', async () => {
    mockApi(base({ 'GET /deals/*': fx.priya }))
    render(<App />)
    await screen.findByTestId('view-tasks')
    await userEvent.click(screen.getByTestId('task-deal-6'))
    expect(await screen.findByTestId('view-deal')).toBeInTheDocument()
    expect(window.location.hash).toBe(`#/deal/${encodeURIComponent("Priya's Bakery")}`)
  })
  it('the Fraud page button opens My tasks filtered to the fraud analyst', async () => {
    mockApi(base())
    render(<App />)
    await userEvent.click(await screen.findByTestId('nav-fraud'))
    await userEvent.click(await screen.findByTestId('fraud-answer'))
    expect(await screen.findByTestId('view-tasks')).toBeInTheDocument()
    expect(screen.getByTestId('tasks-viewas')).toHaveValue('victor.hale')
    expect(screen.getAllByTestId(/^task-group-/)).toHaveLength(1)
  })
  it('shows a loading line until the first state arrives', async () => {
    const d = deferred()
    mockApi(base({ 'GET /state': () => d.promise }))
    render(<App />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
    await act(async () => { d.resolve(new Response(JSON.stringify(fx.wed11))) })
    expect(await screen.findByTestId('view-tasks')).toBeInTheDocument()
  })
})

describe('App: actions', () => {
  it('while an action runs the bar shows and buttons are disabled; afterwards the state is re-read', async () => {
    const slow = deferred()
    let state = clone(fx.wed11)
    const calls = mockApi(base({ 'GET /state': () => state, 'POST /clock/advance': () => slow.promise }))
    render(<App />)
    await screen.findByTestId('view-tasks')
    const before = stateCalls(calls)
    await userEvent.click(screen.getByTestId('header-advance-1h'))
    expect(await screen.findByTestId('busy-bar')).toBeInTheDocument()
    expect(screen.getByTestId('header-advance-1d')).toBeDisabled()
    expect(screen.getByTestId('task-answer-6-approve')).toBeDisabled()
    state = { ...clone(fx.wed11), now: '2026-11-04T12:00-06:00' }
    await act(async () => { slow.resolve(new Response('{}')) })
    await waitFor(() => expect(screen.queryByTestId('busy-bar')).toBeNull())
    expect(screen.getByTestId('header-time')).toHaveTextContent('Wed, Nov 4 · 12:00 PM CT')
    expect(stateCalls(calls)).toBeGreaterThan(before)
    expect(screen.getByTestId('header-advance-1d')).toBeEnabled()
  })
  it('a refused action shows the reason in a banner that can be dismissed', async () => {
    mockApi(base({ 'POST /clock/set': failure(400, 'cannot move the clock backwards; reset first') }))
    render(<App />)
    await userEvent.click(await screen.findByTestId('nav-simulation'))
    await userEvent.click(await screen.findByTestId('sim-jump-go'))
    expect(await screen.findByTestId('banner-error')).toHaveTextContent('cannot move the clock backwards; reset first')
    await userEvent.click(screen.getByTestId('banner-dismiss'))
    expect(screen.queryByTestId('banner-error')).toBeNull()
  })
  it('answering a request posts it, then the list is refreshed without that request', async () => {
    let state = clone(fx.wed11)
    const calls = mockApi(base({
      'GET /state': () => state,
      'POST /humans/6/answer': () => { state = { ...clone(fx.wed11), pending: fx.wed11.pending.filter((r) => r.id !== 6) }; return {} },
    }))
    render(<App />)
    await userEvent.click(await screen.findByTestId('task-answer-6-approve'))
    await waitFor(() => expect(screen.queryByTestId('task-card-6')).toBeNull())
    expect(calls.find((c) => c.path === '/humans/6/answer').body).toEqual({ answer: 'approve', note: '' })
    expect(screen.getByTestId('nav-count-tasks')).toHaveTextContent('7')
  })
})

describe('App: keeping fresh', () => {
  it('re-reads the state every five seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    const calls = mockApi(base())
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    const first = stateCalls(calls)
    expect(first).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(stateCalls(calls)).toBe(first + 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(stateCalls(calls)).toBe(first + 3)
  })
  it('shows a banner when the server cannot be reached, and clears it when it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    let down = true
    mockApi(base({ 'GET /state': () => { if (down) throw new Error('offline'); return clone(fx.wed11) } }))
    globalThis.fetch = vi.fn(async (url) => {
      if (down) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(fx.wed11))
    })
    render(<App />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.getByTestId('banner-net')).toHaveTextContent('Cannot reach the DealPilot server')
    down = false
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(screen.queryByTestId('banner-net')).toBeNull()
    expect(screen.getByTestId('view-tasks')).toBeInTheDocument()
  })
})
