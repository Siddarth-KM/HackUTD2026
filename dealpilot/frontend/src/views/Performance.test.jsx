import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Performance, { performanceNumbers } from './Performance'
import Pipeline from './Pipeline'
import { href } from '../lib/route'
import { clone, fx, renderView } from '../test/utils'

const tile = (id) => screen.getByTestId(`stat-perf-${id}-value`)
const note = (id) => screen.getByTestId(`stat-perf-${id}-note`)
const bar = (chart, key) => screen.getByTestId(`chart-${chart}-value-${key}`)

describe('Performance', () => {
  it('shows the five summary tiles from the live data', () => {
    renderView(<Performance />, { hash: '#/performance' })
    expect(screen.getByTestId('page-title')).toHaveTextContent('Performance')
    expect(tile('alerts')).toHaveTextContent('22')
    expect(tile('escalations')).toHaveTextContent('15')
    expect(tile('deadline')).toHaveTextContent('1')
    expect(note('deadline')).toHaveTextContent("Priya's Bakery needs funds Fri 3:00 PM")
    expect(tile('late')).toHaveTextContent('6')
    expect(note('late')).toHaveTextContent('of 12 deals in a stage')
    expect(tile('money')).toHaveTextContent('$3,321,500')
    expect(note('money')).toHaveTextContent('across 12 deals')
  })
  it('uses the same "past time limit" count as My tasks and the same total as Pipeline', () => {
    const s = fx.wed11
    const n = performanceNumbers(s)
    expect(n.late).toHaveLength(s.deals.filter((d) => d.status === 'active' && d.sla && d.sla.pct >= 100).length)
    expect(n.total).toBe(s.deals.reduce((t, d) => t + d.amount, 0))
  })
  it('says the alert count is capped when the backend hands over its newest 80', () => {
    const s = clone(fx.wed11)
    s.alerts = Array.from({ length: 80 }, (_, i) => ({ ...fx.wed11.alerts[0], at: `2026-11-04T10:${String(i % 60).padStart(2, '0')}-06:00` }))
    renderView(<Performance />, { state: s, hash: '#/performance' })
    expect(note('alerts')).toHaveTextContent('Newest 80 shown')
  })

  it('charts deals by stage with the same counts as the Pipeline board', () => {
    const { unmount } = renderView(<Performance />, { hash: '#/performance' })
    const counts = {}
    for (const st of ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed', 'Stopped']) counts[st] = bar('stage', st).textContent
    expect(counts).toEqual({ Intake: '5', Credit: '7', Committee: '0', Product: '0', Committed: '0', Closed: '0', Stopped: '0' })
    unmount()
    renderView(<Pipeline />, { hash: '#/pipeline' })
    for (const [st, n] of Object.entries(counts)) expect(screen.getByTestId(`board-count-${st}`).textContent, st).toBe(n)
  })
  it('counts Stopped and Closed after the week has run (Friday evening)', () => {
    renderView(<Performance />, { state: fx.fri18, hash: '#/performance' })
    expect(bar('stage', 'Closed')).toHaveTextContent('4')
    expect(bar('stage', 'Stopped')).toHaveTextContent('4')
    expect(bar('stage', 'Intake')).toHaveTextContent('2')
  })
  it('every stage bar is a link that opens that stage', () => {
    renderView(<Performance />, { hash: '#/performance' })
    for (const st of ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed', 'Stopped']) {
      expect(screen.getByTestId(`perf-stage-${st}`)).toHaveAttribute('href', href.stage(st))
    }
  })
  it('groups the deals in a stage by how much of the time limit they used', () => {
    renderView(<Performance />, { hash: '#/performance' })
    expect(['ontime', 'alerted', 'escalated', 'twice'].map((k) => bar('sla', k).textContent)).toEqual(['6', '2', '0', '4'])
    renderView(<Performance />, { state: fx.fri18, hash: '#/performance' })
    expect(['ontime', 'alerted', 'escalated', 'twice'].map((k) => screen.getAllByTestId(`chart-sla-value-${k}`).at(-1).textContent)).toEqual(['0', '0', '1', '4'])
  })
  it('puts the boundaries in the right bucket: 99 on time, 100 alerted, 149 alerted, 150 escalated, 200 twice', () => {
    const s = clone(fx.wed11)
    const pcts = [99, 100, 149, 150, 199, 200]
    s.deals = s.deals.slice(0, 6).map((d, i) => ({ ...d, status: 'active', sla: { hours: 8, elapsed: 1, pct: pcts[i] } }))
    const n = performanceNumbers(s)
    expect(n.buckets.map((b) => b.n)).toEqual([1, 2, 2, 1])
  })
  it('gives every bar a hover tip and a screen-reader table with the same numbers', async () => {
    renderView(<Performance />, { hash: '#/performance' })
    expect(screen.queryByTestId('chart-sla-tip')).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('img', { name: /Escalated twice \(200% or more\): 4 deals/ }))
    expect(screen.getByTestId('chart-sla-tip')).toHaveTextContent('Escalated twice (200% or more): 4 deals')
    const table = screen.getByRole('table', { name: 'Deals by stage', hidden: true })
    expect(within(table).getByRole('row', { name: /Credit\s*7/, hidden: true })).toBeInTheDocument()
  })

  it('lists the deals over the time limit, worst first, each linking to its deal', () => {
    renderView(<Performance />, { hash: '#/performance' })
    const rows = screen.getAllByTestId(/^perf-over-row-/).map((r) => r.getAttribute('data-testid').replace('perf-over-row-', ''))
    expect(rows).toEqual(['Ridgeway Freight Logistics', 'Bluebonnet Landscape', 'Pecan Grove Catering', 'Granite Bay Building Supply', 'Garza Family Pharmacy', 'tyler loopwise loan stuff'])
    expect(screen.getByTestId('perf-over-Ridgeway Freight Logistics')).toHaveAttribute('href', href.deal('Ridgeway Freight Logistics'))
    expect(screen.getByTestId('perf-over-row-Ridgeway Freight Logistics')).toHaveTextContent('45.1h of 8h · 564%')
    expect(screen.getByTestId('perf-over-row-Ridgeway Freight Logistics')).toHaveTextContent('Intake · frozen')
  })
  it('lists the deals at risk of missing their funding date', () => {
    renderView(<Performance />, { hash: '#/performance' })
    const row = screen.getByTestId("perf-deadline-row-Priya's Bakery")
    expect(row).toHaveTextContent('Needs funds Fri 3:00 PM')
    expect(row).toHaveTextContent('waiting for credit decision from Marcus Lee')
    expect(screen.getByTestId("perf-deadline-Priya's Bakery")).toHaveAttribute('href', href.deal("Priya's Bakery"))
  })
  it('shows friendly empty states once nothing is late or at risk', () => {
    const s = clone(fx.fri18)
    s.deals.forEach((d) => { if (d.sla) d.sla.pct = 10 })
    renderView(<Performance />, { state: s, hash: '#/performance' })
    expect(screen.getByTestId('perf-over-empty')).toHaveTextContent('No deal has reached its stage time limit')
    expect(screen.getByTestId('perf-deadline-empty')).toBeInTheDocument()        // Priya funded, so no longer at risk
    expect(tile('late')).toHaveTextContent('0')
    expect(tile('deadline')).toHaveTextContent('0')
    expect(note('deadline')).toHaveTextContent('No funding dates at risk')
  })

  it('shows the 5 newest alerts and a link to all of them', () => {
    renderView(<Performance />, { hash: '#/performance' })
    expect(screen.getAllByTestId(/^perf-alert-\d+$/)).toHaveLength(5)
    expect(screen.getByTestId('perf-alert-0')).toHaveTextContent('Loopwise Labs Inc.')
    expect(screen.getByTestId('perf-alert-0')).toHaveTextContent('Sent to Aisha Grant')
    expect(screen.getByTestId('perf-alert-0')).not.toHaveTextContent('STUCK DEAL:')
    expect(screen.getByTestId('perf-alert-deal-0')).toHaveAttribute('href', href.deal('tyler loopwise loan stuff'))
    const all = screen.getByTestId('perf-alerts-all')
    expect(all).toHaveTextContent('See all 22 alerts')
    expect(all).toHaveAttribute('href', '#/alerts')
  })
  it('handles a week with no alerts', () => {
    const s = clone(fx.wed11)
    s.alerts = []
    renderView(<Performance />, { state: s, hash: '#/performance' })
    expect(screen.getByTestId('perf-latest-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('perf-alerts-all')).toBeNull()
    expect(tile('alerts')).toHaveTextContent('0')
  })
  it('follows the shared state: a later poll changes the numbers', () => {
    const { rerenderWith } = renderView(<Performance />, { hash: '#/performance' })
    expect(tile('late')).toHaveTextContent('6')
    rerenderWith({ state: fx.fri18 })
    expect(tile('late')).toHaveTextContent('5')
    expect(tile('money')).toHaveTextContent('$3,416,500')
  })
  it('the buttons stay clickable', async () => {
    renderView(<Performance />, { hash: '#/performance' })
    await userEvent.click(screen.getByTestId('perf-alerts-all'))
  })
})
