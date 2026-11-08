// The two sections added to Fraud review: the relationship graph and the unusual-profile scores.
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Fraud from './Fraud'
import { href } from '../lib/route'
import { clone, fx, renderView } from '../test/utils'

describe('Fraud review layout', () => {
  it('adds the new sections without removing any: groups, graph, checks, scores, past loans', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    const order = ['fraud-cluster', 'fraud-graph', 'fraud-checks', 'fraud-profiles', 'fraud-history'].map((id) => screen.getByTestId(id))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

describe('Relationship graph', () => {
  it('draws the group hub, its 5 members, the 10 shared-detail lines and 5 membership lines', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    const g = screen.getByTestId('fraud-graph')
    expect(within(g).getByTestId('graph-hub-group-1')).toBeInTheDocument()
    for (const m of fx.wed11.clusters[0].members) {
      expect(within(g).queryByTestId(`graph-node-${m}`) || within(g).queryByTestId(`graph-history-${m}`), m).not.toBeNull()
    }
    expect(within(g).getAllByTestId(/^graph-edge-/)).toHaveLength(10)
    expect(within(g).getAllByTestId(/^graph-member-/)).toHaveLength(5)
    expect(screen.getByTestId('graph-svg').getAttribute('aria-label'))
      .toBe('Group 1: 3 live deals and 2 past loans share 7 rare details. 1 more deal failed a known-fraud check on its own.')
  })
  it('shows a deal that failed a known-fraud check on its own as a lone node', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.getByTestId('graph-node-Granite Bay Building Supply')).toHaveAttribute('href', href.deal('Granite Bay Building Supply'))
    expect(screen.getByTestId('fraud-graph')).toHaveTextContent('FAILED A KNOWN-FRAUD CHECK')
  })
  it('live deals link to their page; past loans and the hub are not links', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    for (const m of ['Ridgeway Freight Logistics', 'Pecan Grove Catering', 'Summit Peak Flooring']) {
      const el = screen.getByTestId(`graph-node-${m}`)
      expect(el.tagName.toLowerCase()).toBe('a')
      expect(el).toHaveAttribute('href', href.deal(m))
    }
    expect(screen.getByTestId('graph-history-H-2608-002').tagName.toLowerCase()).toBe('g')
    expect(screen.getByTestId('graph-hub-group-1').tagName.toLowerCase()).toBe('g')
  })
  it('hovering a line says, in words, what the two deals share', async () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.queryByTestId('graph-tip')).toBeNull()
    const edge = screen.getByTestId('graph-edge-Pecan Grove Catering|Ridgeway Freight Logistics')
    await userEvent.hover(edge)
    const tip = screen.getByTestId('graph-tip')
    expect(tip).toHaveTextContent('Pecan Grove Catering and Ridgeway Freight Logistics LLC')
    expect(tip).toHaveTextContent('Share 7 rare details')
    expect(tip).toHaveTextContent('Tax preparer phone 214-555-0187')
    expect(tip).not.toHaveTextContent(/preparer_phone|people:/)
    await userEvent.unhover(edge)
    expect(screen.queryByTestId('graph-tip')).toBeNull()
  })
  it('hovering or focusing a node shows what it is', async () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    await userEvent.hover(screen.getByTestId('graph-node-Ridgeway Freight Logistics'))
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('Ridgeway Freight Logistics LLC')
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('$247,500 · Frozen for fraud review')
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('Linked to 4 deals')
    fireEvent.focus(screen.getByTestId('graph-history-H-2608-002'))
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('Trinity Bend Plumbing LLC')
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('loan funded earlier')
    fireEvent.focus(screen.getByTestId('graph-node-Granite Bay Building Supply'))
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('Failed: Bank statement does not add up; Revenue inflated')
    fireEvent.focus(screen.getByTestId('graph-hub-group-1'))
    expect(screen.getByTestId('graph-tip')).toHaveTextContent('link strength 26.3 (flag threshold 8)')
  })
  it('hovering a deal dims the deals it is not linked to', async () => {
    const s = clone(fx.wed11)
    s.clusters[0].edges = s.clusters[0].edges.filter((e) => !(e.a === 'H-2608-002' || e.b === 'H-2608-002'))
    renderView(<Fraud />, { state: s, hash: '#/fraud' })
    await userEvent.hover(screen.getByTestId('graph-node-Ridgeway Freight Logistics'))
    expect(screen.getByTestId('graph-node-Pecan Grove Catering')).toHaveAttribute('opacity', '1')
    expect(screen.getByTestId('graph-history-H-2608-002')).toHaveAttribute('opacity', '0.25')
  })
  it('a released deal turns green', () => {
    const s = clone(fx.wed11)
    s.deals.find((x) => x.folder === 'Pecan Grove Catering').fraud.released = true
    renderView(<Fraud />, { state: s, hash: '#/fraud' })
    expect(screen.getByTestId('graph-node-Pecan Grove Catering').querySelector('circle')).toHaveAttribute('fill', '#2E7D4F')
    expect(screen.getByTestId('graph-node-Ridgeway Freight Logistics').querySelector('circle')).toHaveAttribute('fill', '#B42318')
  })
  it('says so when nothing is linked', () => {
    const s = clone(fx.wed11)
    s.clusters = []
    s.deals.forEach((d) => { d.fraud = { ...d.fraud, flagged: false, sources: [] } })
    renderView(<Fraud />, { state: s, hash: '#/fraud' })
    expect(screen.getByTestId('graph-empty')).toHaveTextContent('No linked deals right now')
  })
})

describe('Unusual-profile scores', () => {
  const rows = () => screen.getAllByTestId(/^profile-row-/).map((r) => r.getAttribute('data-testid').replace('profile-row-', ''))
  it('lists deals highest score first, with plain-word factors and no raw model output', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(rows().slice(0, 4)).toEqual(['Okafor Advisory - James', 'Pecan Grove Catering', 'Summit Peak Flooring', 'Ridgeway Freight Logistics'])
    const james = screen.getByTestId('profile-row-Okafor Advisory - James')
    expect(james).toHaveTextContent('Unusual')
    expect(screen.getByTestId('profile-pct-Okafor Advisory - James')).toHaveTextContent('100th')
    expect(james).toHaveTextContent('Bank deposits are much higher than the stated revenue suggests')
    expect(james).toHaveTextContent('Loan amount is a bit larger than usual')
    expect(screen.getByTestId('profiles-table')).not.toHaveTextContent(/deposit_cv|deposits_to_rev|"z"|\{/)
    expect(screen.getByTestId('profile-row-Bluebonnet Landscape')).toHaveTextContent('Within range')
  })
  it('marks frozen deals, and shows watch notes under the deal without list brackets', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.getByTestId('profile-row-Ridgeway Freight Logistics')).toHaveTextContent('Frozen: fraud')
    const w = screen.getByTestId('profile-watch-Ridgeway Freight Logistics')
    expect(w).toHaveTextContent('Bank statements were produced by the same software as the borrower')
    expect(w).toHaveTextContent('differs from the known account(s) 9902')
    expect(w.textContent).not.toContain("['9902']")
    expect(screen.queryByTestId('profile-watch-Okafor Advisory - James')).toBeNull()
  })
  it('shows the top 8 plus every unusual or flagged deal; "Show all" reveals the rest', async () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(rows()).toHaveLength(9)                                   // top 8 + Granite Bay (flagged, 78th)
    expect(rows()).toContain('Granite Bay Building Supply')
    expect(rows()).not.toContain('Garza Family Pharmacy')
    expect(screen.getByTestId('profile-more')).toHaveTextContent('Show all 12 deals')
    await userEvent.click(screen.getByTestId('profile-more'))
    expect(rows()).toHaveLength(12)
    expect(rows().at(-1)).toBe('Garza Family Pharmacy')               // lowest score last
    expect(screen.queryByTestId('profile-more')).toBeNull()
  })
  it('each deal name opens its deal page', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.getByTestId('profile-deal-Okafor Advisory - James')).toHaveAttribute('href', href.deal('Okafor Advisory - James'))
  })
  it('follows the shared state: a new score re-sorts the table', () => {
    const { rerenderWith } = renderView(<Fraud />, { hash: '#/fraud' })
    const s2 = clone(fx.wed11)
    s2.deals.find((d) => d.folder === 'Harbor Tea Co').anomaly = { percentile: 0.995, unusual: true, top: [{ feature: 'term', z: 4 }] }
    rerenderWith({ state: s2 })
    expect(rows().slice(0, 2)).toEqual(['Okafor Advisory - James', 'Harbor Tea Co'])   // 100th, then the new 99.5th
    expect(screen.getByTestId('profile-row-Harbor Tea Co')).toHaveTextContent('Loan term is much longer than usual')
  })
})
