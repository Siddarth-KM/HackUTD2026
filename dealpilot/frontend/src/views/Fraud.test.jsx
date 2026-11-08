import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import Fraud from './Fraud'
import { href } from '../lib/route'
import { clone, fx, renderView } from '../test/utils'

describe('Fraud review', () => {
  it('shows the linked group with its strength, evidence types and members', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.getByTestId('page-label')).toHaveTextContent('4 live deals frozen')
    expect(screen.getByTestId('cluster-headline')).toHaveTextContent('3 live applications tied to 2 loans funded earlier')
    expect(screen.getByTestId('cluster-score')).toHaveTextContent('26.3')
    expect(screen.getByTestId('fraud-cluster')).toHaveTextContent('flag threshold 8')
    for (const f of ['Money rails', 'Number patterns', 'People', 'Document source']) expect(screen.getByTestId('fraud-cluster')).toHaveTextContent(f)
    expect(screen.getByTestId('fraud-cluster')).toHaveTextContent('Linked group · 5 deals')
  })
  it('live members link to their page; funded-earlier members do not', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    for (const m of ['Ridgeway Freight Logistics', 'Pecan Grove Catering', 'Summit Peak Flooring']) {
      const el = screen.getByTestId(`cluster-member-${m}`)
      expect(el.tagName).toBe('A')
      expect(el).toHaveAttribute('href', href.deal(m))
      expect(el).toHaveTextContent('Live · frozen')
      expect(el).toHaveTextContent(/flagged at Intake, \w{3} \d+:\d\d (AM|PM)/)
    }
    for (const h of ['H-2608-002', 'H-2609-008']) {
      const el = screen.getByTestId(`cluster-member-${h}`)
      expect(el.tagName).toBe('DIV')
      expect(el).toHaveTextContent('Funded earlier')
    }
    expect(screen.getByTestId('cluster-member-H-2608-002')).toHaveTextContent('Trinity Bend Plumbing LLC')
  })
  it('lists what the deals share, in words, with how rare each is', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    const table = screen.getByTestId('cluster-evidence')
    const body = within(table).getAllByTestId(/^evidence-row-/)
    expect(body.length).toBeGreaterThanOrEqual(7)
    expect(table).toHaveTextContent('Tax preparer phone 214-555-0187')
    expect(table).toHaveTextContent('Vendor bank account …4471 (Metroplex Equipment Supply)')
    expect(table).toHaveTextContent('Deposits only on Mondays and Thursdays')
    expect(table).toHaveTextContent('Amount just under the $250,000 limit')
    expect(body[0]).toHaveTextContent(/On 5 of 269 deals, all in this group/)
    expect(table).not.toHaveTextContent(/preparer_phone|round_deposit_share|metroplex equipment supply\|/)
  })
  it('shows deals that failed a known-fraud check with a titled paragraph per check', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    const g = screen.getByTestId('fraud-check-Granite Bay Building Supply')
    expect(g).toHaveTextContent('$300,000')
    expect(g).toHaveTextContent('frozen at Intake')
    expect(g).toHaveTextContent('Bank statement does not add up')
    expect(g).toHaveTextContent('Revenue inflated')
    expect(g).toHaveTextContent('August 2026: opening 79,275.96')
    expect(screen.queryByTestId('fraud-check-Ridgeway Freight Logistics')).toBeNull()
  })
  it('lists funded-earlier loans now linked to fraud', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    expect(screen.getByTestId('history-H-2608-002')).toHaveTextContent('H-2608-002 · Trinity Bend Plumbing LLC')
    expect(screen.getByTestId('history-H-2609-008')).toBeInTheDocument()
  })
  it('"Answer 4 hold requests" opens My tasks for the person who has to answer', () => {
    renderView(<Fraud />, { hash: '#/fraud' })
    const a = screen.getByTestId('fraud-answer')
    expect(a).toHaveTextContent('Answer 4 hold requests')
    expect(a).toHaveAttribute('href', '#/tasks?as=victor.hale')
  })
  it('says so when nothing is flagged, and hides the answer button', () => {
    const s = clone(fx.wed11)
    s.clusters = []
    s.history_flags = []
    s.pending = []
    s.deals.forEach((d) => { d.fraud = { ...d.fraud, flagged: false, sources: [] } })
    renderView(<Fraud />, { state: s, hash: '#/fraud' })
    expect(screen.getByTestId('fraud-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('fraud-answer')).toBeNull()
    expect(screen.getByTestId('page-label')).toHaveTextContent('0 live deals frozen')
    expect(screen.getByTestId('fraud-history')).toHaveTextContent('None')
  })
  it('a released deal is shown as released, not frozen', () => {
    const s = clone(fx.wed11)
    const d = s.deals.find((x) => x.folder === 'Pecan Grove Catering')
    d.fraud.released = true
    renderView(<Fraud />, { state: s, hash: '#/fraud' })
    expect(screen.getByTestId('cluster-member-Pecan Grove Catering')).toHaveTextContent('Live · released')
    expect(screen.getByTestId('page-label')).toHaveTextContent('3 live deals frozen')
  })
})
