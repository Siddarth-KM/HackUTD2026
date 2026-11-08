import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Header from './Header'
import Banner from './Banner'
import BusyBar from './BusyBar'
import ConfirmDialog from './ConfirmDialog'
import { parseHash } from '../lib/route'
import { clone, fx, mockApi, renderView } from '../test/utils'

const route = (h) => parseHash(h)

describe('Header', () => {
  it('shows the live counts on the three tabs that have them', () => {
    renderView(<Header route={route('#/tasks')} />)
    expect(screen.getByTestId('nav-count-tasks')).toHaveTextContent('8')
    expect(screen.getByTestId('nav-count-alerts')).toHaveTextContent('22')
    expect(screen.getByTestId('nav-count-fraud')).toHaveTextContent('4')
    expect(screen.queryByTestId('nav-count-pipeline')).toBeNull()
    expect(screen.queryByTestId('nav-count-simulation')).toBeNull()
  })
  it('hides a count when it is zero', () => {
    const s = clone(fx.wed11)
    s.pending = []
    s.alerts = []
    s.deals.forEach((d) => { d.fraud.flagged = false })
    renderView(<Header route={route('#/tasks')} />, { state: s })
    for (const k of ['tasks', 'alerts', 'fraud']) expect(screen.queryByTestId(`nav-count-${k}`)).toBeNull()
  })
  it('links every tab to its screen and marks the open one', () => {
    renderView(<Header route={route('#/alerts')} />)
    const want = { tasks: '#/tasks', pipeline: '#/pipeline', alerts: '#/alerts', fraud: '#/fraud', simulation: '#/simulation' }
    for (const [k, h] of Object.entries(want)) expect(screen.getByTestId(`nav-${k}`)).toHaveAttribute('href', h)
    expect(screen.getByTestId('nav-alerts')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('nav-tasks')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('header-brand')).toHaveAttribute('href', '#/tasks')
  })
  it('keeps Pipeline marked while a deal is open', () => {
    renderView(<Header route={route('#/deal/Bluebonnet%20Landscape')} />)
    expect(screen.getByTestId('nav-pipeline')).toHaveAttribute('aria-current', 'page')
  })
  it('shows the simulated time in Central time', () => {
    renderView(<Header route={route('#/tasks')} />)
    expect(screen.getByTestId('header-time')).toHaveTextContent('Wed, Nov 4 · 11:00 AM CT')
  })
  it('"+1 hour" and "+1 day" advance the clock', async () => {
    const calls = mockApi({ 'POST /clock/advance': {} })
    renderView(<Header route={route('#/tasks')} />)
    await userEvent.click(screen.getByTestId('header-advance-1h'))
    await userEvent.click(screen.getByTestId('header-advance-1d'))
    expect(calls).toEqual([
      { method: 'POST', path: '/clock/advance', body: { by: '1h' } },
      { method: 'POST', path: '/clock/advance', body: { by: '1d' } },
    ])
  })
  it('disables the clock buttons while busy', () => {
    renderView(<Header route={route('#/tasks')} />, { busy: true })
    expect(screen.getByTestId('header-advance-1h')).toBeDisabled()
    expect(screen.getByTestId('header-advance-1d')).toBeDisabled()
  })
  it('shows which reader is in use: Gemini, the test parser, or no key', () => {
    const gem = { ...clone(fx.wed11), mode: 'Gemini gemini-3.5-flash-lite', gemini_ready: true }
    const { unmount } = renderView(<Header route={route('#/tasks')} />, { state: gem })
    expect(screen.getByTestId('header-status')).toHaveTextContent('Gemini')
    unmount()
    const { unmount: u2 } = renderView(<Header route={route('#/tasks')} />)
    expect(screen.getByTestId('header-status')).toHaveTextContent('Test parser')
    u2()
    renderView(<Header route={route('#/tasks')} />, { state: { ...clone(fx.wed11), mode: 'NO GEMINI KEY', gemini_ready: false } })
    expect(screen.getByTestId('header-status')).toHaveTextContent('No Gemini key')
  })
})

describe('Banner', () => {
  const quiet = () => clone(fx.wed11)
  it('is silent when everything is fine', () => {
    renderView(<Banner />, { state: { ...quiet(), gemini_ready: true } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('says so when there is no Gemini key', () => {
    renderView(<Banner />, { state: { ...quiet(), gemini_ready: false } })
    expect(screen.getByTestId('banner-nokey')).toHaveTextContent('No Gemini key, so nothing can be read')
  })
  it('says when the quota is used up, and that new files wait', () => {
    const s = { ...quiet(), gemini: { parked: { 'gemini-3.5-flash-lite': 42 } }, stalled: true }
    renderView(<Banner />, { state: s })
    expect(screen.getByTestId('banner-quota')).toHaveTextContent('resets in about 42 min')
    expect(screen.getByTestId('banner-quota')).toHaveTextContent('New files are on hold')
  })
  it('lists files that could not be read', () => {
    renderView(<Banner />, { state: { ...quiet(), errors: [{ path: 'X/a.pdf', error: 'unreadable' }] } })
    expect(screen.getByTestId('banner-extract')).toHaveTextContent('X/a.pdf: unreadable')
  })
  it('shows a lost connection', () => {
    renderView(<Banner />, { extra: { netError: 'Cannot reach the DealPilot server: boom' } })
    expect(screen.getByTestId('banner-net')).toHaveTextContent('Cannot reach the DealPilot server')
  })
  it('shows a refused action and lets the user dismiss it', async () => {
    const clearError = vi.fn()
    renderView(<Banner />, { extra: { error: 'cannot move the clock backwards; reset first', clearError } })
    expect(screen.getByTestId('banner-error')).toHaveTextContent('cannot move the clock backwards; reset first')
    await userEvent.click(screen.getByTestId('banner-dismiss'))
    expect(clearError).toHaveBeenCalledTimes(1)
  })
})

describe('BusyBar', () => {
  it('appears only while working', () => {
    const { rerender } = render(<BusyBar busy={false} />)
    expect(screen.queryByTestId('busy-bar')).toBeNull()
    rerender(<BusyBar busy />)
    expect(screen.getByTestId('busy-bar')).toHaveTextContent('Working…')
  })
})

describe('ConfirmDialog', () => {
  const setup = (props = {}) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="Sure?" body="This cannot be undone." okLabel="Do it" onConfirm={onConfirm} onCancel={onCancel} {...props} />)
    return { onConfirm, onCancel }
  }
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="x" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('names the dialog and focuses the safe button (Cancel)', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Sure?' })).toHaveAccessibleDescription('This cannot be undone.')
    expect(screen.getByTestId('confirm-cancel')).toHaveFocus()
  })
  it('confirm and cancel call their handlers', async () => {
    const { onConfirm, onCancel } = setup()
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(screen.getByTestId('confirm-ok')).toHaveTextContent('Do it')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
  it('Escape and a click on the backdrop cancel', async () => {
    const { onCancel } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('dialog').parentElement)
    expect(onCancel).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
