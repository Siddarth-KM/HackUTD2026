import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Alerts from './Alerts'
import { href } from '../lib/route'
import { clone, fx, renderView } from '../test/utils'

const rows = () => screen.queryAllByTestId(/^alert-row-/)
const count = (k) => Number(screen.getByTestId(`alerts-count-${k}`).textContent)

describe('Alerts', () => {
  it('counts every kind and lists the newest first, twelve at a time', async () => {
    renderView(<Alerts />, { hash: '#/alerts' })
    const a = fx.wed11.alerts
    expect(count('all')).toBe(a.length)
    expect(count('stuck')).toBe(a.filter((x) => x.kind === 'stuck').length)
    expect(count('deadline_risk')).toBe(a.filter((x) => x.kind === 'deadline_risk').length)
    expect(count('fraud_nudge')).toBe(a.filter((x) => x.kind === 'fraud_nudge').length)
    expect(rows()).toHaveLength(12)
    expect(rows()[0]).toHaveTextContent('Wed 10:40 AM')
    await userEvent.click(screen.getByTestId('alerts-more'))
    expect(rows()).toHaveLength(a.length)
    expect(screen.queryByTestId('alerts-more')).toBeNull()
  })
  it('the "show older" button says how many are left', () => {
    renderView(<Alerts />, { hash: '#/alerts' })
    expect(screen.getByTestId('alerts-more')).toHaveTextContent(`Show ${fx.wed11.alerts.length - 12} older alerts`)
  })
  it('each filter shows only that kind, and pressing All brings everything back', async () => {
    renderView(<Alerts />, { hash: '#/alerts' })
    for (const [k, label] of [['stuck', 'Stuck deal'], ['deadline_risk', 'Deadline at risk'], ['fraud_nudge', 'Fraud hold unanswered']]) {
      await userEvent.click(screen.getByTestId(`alerts-filter-${k}`))
      expect(screen.getByTestId(`alerts-filter-${k}`)).toHaveAttribute('aria-pressed', 'true')
      expect(rows().length).toBe(Math.min(12, count(k)))
      for (const r of rows()) expect(r).toHaveTextContent(label)
    }
    await userEvent.click(screen.getByTestId('alerts-filter-all'))
    expect(rows()).toHaveLength(12)
  })
  it('each row says who was told, who was copied, and links to the deal', () => {
    renderView(<Alerts />, { hash: '#/alerts' })
    const first = rows()[0]
    expect(first).toHaveTextContent('Sent to')
    expect(first).toHaveTextContent('Aisha Grant')
    expect(first).toHaveTextContent('copied to Elena Ruiz')
    expect(first).not.toHaveTextContent(/STUCK DEAL|aisha\.grant/)
    const link = within(first).getByTestId('alert-deal-0')
    expect(link.getAttribute('href')).toMatch(/^#\/deal\//)
    expect(link).toHaveAttribute('href', href.deal(fx.wed11.alerts[0].deal))
  })
  it('marks alerts and escalations differently', () => {
    renderView(<Alerts />, { hash: '#/alerts' })
    expect(rows()[0]).toHaveTextContent('Alert')
    const esc = rows().find((r) => r.textContent.includes('Escalation'))
    expect(esc).toBeTruthy()
  })
  it('explains the rule when there are no alerts', () => {
    const s = clone(fx.wed11)
    s.alerts = []
    renderView(<Alerts />, { state: s, hash: '#/alerts' })
    expect(screen.getByTestId('alerts-empty')).toHaveTextContent('Deals alert at 100% of the stage time limit')
    expect(screen.queryByTestId('alerts-list')).toBeNull()
  })
})
