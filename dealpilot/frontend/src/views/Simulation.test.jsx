import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Simulation from './Simulation'
import { clone, failure, fx, mockApi, renderView } from '../test/utils'

const HEALTH = { ok: true, gemini_key: true, model: 'gemini-3.5-flash-lite', gemini_calls: 15, cache_hits: 141 }
const setup = (routes = {}, opts = {}) => {
  const calls = mockApi({ 'GET /health': HEALTH, ...routes })
  const r = renderView(<Simulation />, { hash: '#/simulation', ...opts })
  return { calls, ...r }
}
const posts = (calls) => calls.filter((c) => c.method === 'POST')

describe('Simulation & data: clock', () => {
  it('shows the time and how many files have landed', () => {
    setup()
    expect(screen.getByTestId('sim-time')).toHaveTextContent('Wed, Nov 4 · 11:00 AM CT')
    expect(screen.getByTestId('sim-arrived')).toHaveTextContent(`${fx.wed11.n_arrived} of ${fx.wed11.n_total} files have arrived`)
  })
  it.each([['30m'], ['1h'], ['6h'], ['1d']])('the +%s button advances the clock by that much', async (by) => {
    const { calls } = setup({ 'POST /clock/advance': {} })
    await userEvent.click(screen.getByTestId(`sim-advance-${by}`))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/clock/advance', body: { by } }])
  })
  it('"Run to Friday 6:00 PM" sets the clock to Friday 18:00 Central', async () => {
    const { calls } = setup({ 'POST /clock/set': {} })
    await userEvent.click(screen.getByTestId('sim-run-friday'))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/clock/set', body: { t: '2026-11-06T18:00-06:00' } }])
  })
  it('"Jump to a time" sends what was typed', async () => {
    const { calls } = setup({ 'POST /clock/set': {} })
    const input = screen.getByTestId('sim-jump-input')
    expect(input).toHaveValue('2026-11-04T09:00-06:00')
    await userEvent.clear(input)
    await userEvent.type(input, '2026-11-05T10:30-06:00')
    await userEvent.click(screen.getByTestId('sim-jump-go'))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/clock/set', body: { t: '2026-11-05T10:30-06:00' } }])
  })
  it('a refused jump (backwards) shows no success message', async () => {
    const { act } = setup({ 'POST /clock/set': failure(400, 'cannot move the clock backwards; reset first') })
    await userEvent.click(screen.getByTestId('sim-jump-go'))
    await waitFor(() => expect(act).toHaveBeenCalled())
    expect(await act.mock.results[0].value).toMatchObject({ ok: false, error: 'cannot move the clock backwards; reset first' })
    expect(screen.queryByTestId('sim-msg')).toBeNull()
  })
  it('every clock button is disabled while an action runs', () => {
    setup({}, { busy: true })
    for (const id of ['sim-advance-30m', 'sim-advance-1h', 'sim-advance-6h', 'sim-advance-1d', 'sim-run-friday', 'sim-jump-go', 'sim-load-fresh', 'sim-load-append', 'sim-reset']) {
      expect(screen.getByTestId(id), id).toBeDisabled()
    }
    expect(screen.getByTestId('sim-personas')).toBeDisabled()
  })
})

describe('Simulation & data: colleagues, results, system', () => {
  it('the switch turns the simulated colleagues on, and off again', async () => {
    const { calls, unmount } = setup({ 'POST /personas': {} })
    const sw = screen.getByTestId('sim-personas')
    expect(sw).toHaveAttribute('role', 'switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveTextContent('Off: I answer every request')
    await userEvent.click(sw)
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/personas', body: { enabled: true } }])
    unmount()
    const on = clone(fx.wed11)
    on.personas = true
    const second = setup({ 'POST /personas': {} }, { state: on })
    expect(screen.getByTestId('sim-personas')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('sim-personas')).toHaveTextContent('On: colleagues answer on their own')
    await userEvent.click(screen.getByTestId('sim-personas'))
    expect(posts(second.calls)).toEqual([{ method: 'POST', path: '/personas', body: { enabled: false } }])
  })
  it('the download link points at the export file', () => {
    setup()
    const a = screen.getByTestId('sim-download')
    expect(a).toHaveAttribute('href', '/api/export?set=sample')
    expect(a).toHaveAttribute('download')
  })
  it('the System card shows the live health numbers', async () => {
    const s = clone(fx.wed11)
    s.mode = 'Gemini gemini-3.5-flash-lite'
    setup({}, { state: s })
    await waitFor(() => expect(screen.getByTestId('sim-calls')).toHaveTextContent('15'))
    expect(screen.getByTestId('sim-cache')).toHaveTextContent('141')
    expect(screen.getByTestId('sim-model')).toHaveTextContent('gemini-3.5-flash-lite')
    expect(screen.getByTestId('sim-reader')).toHaveTextContent('Gemini · connected')
  })
  it('in test mode it says Gemini is not being used', () => {
    setup()
    expect(screen.getByTestId('sim-reader')).toHaveTextContent('Test parser (Gemini not used)')
  })
  it('re-reads the health numbers after each action', () => {
    const { calls } = setup({}, { extra: { version: 3 } })
    expect(calls.filter((c) => c.path === '/health')).toHaveLength(1)
  })
})

describe('Simulation & data: load files and reset', () => {
  async function fillLoad() {
    await userEvent.type(screen.getByTestId('sim-load-root'), 'C:\\packs\\weekend')
    await userEvent.type(screen.getByTestId('sim-load-arr'), 'C:\\packs\\weekend\\arrivals.jsonl')
  }
  it('"Start fresh" asks first; Cancel does nothing; Confirm loads with replace', async () => {
    const { calls } = setup({ 'POST /dataset/load': {} })
    await fillLoad()
    await userEvent.type(screen.getByTestId('sim-load-folder'), 'C:\\packs\\weekend\\files')
    await userEvent.click(screen.getByTestId('sim-load-fresh'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Start fresh on this pack?')
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(posts(calls)).toHaveLength(0)
    await userEvent.click(screen.getByTestId('sim-load-fresh'))
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/dataset/load', body: { root: 'C:\\packs\\weekend', arrivals: 'C:\\packs\\weekend\\arrivals.jsonl', folder: 'C:\\packs\\weekend\\files', replace: true } }])
    expect(await screen.findByTestId('sim-msg')).toHaveTextContent('Started fresh on this pack.')
  })
  it('"Add to the running week" loads without asking, and leaves empty fields out', async () => {
    const { calls } = setup({ 'POST /dataset/load': {} })
    await userEvent.type(screen.getByTestId('sim-load-arr'), 'drop.jsonl')
    await userEvent.click(screen.getByTestId('sim-load-append'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/dataset/load', body: { root: null, arrivals: 'drop.jsonl', folder: null, replace: false } }])
    expect(await screen.findByTestId('sim-msg')).toHaveTextContent('Added the drop to the running week.')
  })
  it('Reset asks first; Cancel keeps everything; Confirm resets', async () => {
    const { calls } = setup({ 'POST /clock/reset': {} })
    await userEvent.click(screen.getByTestId('sim-reset'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Reset the simulation?')
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(posts(calls)).toHaveLength(0)
    await userEvent.click(screen.getByTestId('sim-reset'))
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/clock/reset', body: {} }])
    expect(await screen.findByTestId('sim-msg')).toHaveTextContent('Back to the start of the week.')
  })
  it('Escape closes the dialog without resetting', async () => {
    const { calls } = setup({ 'POST /clock/reset': {} })
    await userEvent.click(screen.getByTestId('sim-reset'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(calls)).toHaveLength(0)
  })
})
