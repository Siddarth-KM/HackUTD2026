import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Tasks from './Tasks'
import { href } from '../lib/route'
import { clone, fx, mockApi, renderView } from '../test/utils'

const card = (id) => screen.getByTestId(`task-card-${id}`)
const ids = () => screen.getAllByTestId(/^task-card-/).map((e) => e.dataset.testid.replace('task-card-', ''))

function withRequests(extra) {
  const s = clone(fx.wed11)
  s.pending.push(...extra.map((r, i) => ({
    id: 100 + i, at: '2026-11-04T10:00-06:00', stage: 'Closed', answer: null, note: '', deal: 'Garza Family Pharmacy', message: `${r.type} needed for Maria's Pharmacy (RM brian.foster). Please decide. Options: ${r.options.join(' / ')}.`, ...r,
  })))
  return s
}

describe('My tasks: layout and ordering', () => {
  it('groups requests by person, most pressing first', () => {
    renderView(<Tasks />)
    expect(screen.getAllByTestId(/^task-group-/).map((e) => e.dataset.testid)).toEqual(['task-group-marcus.lee', 'task-group-victor.hale', 'task-group-aisha.grant'])
    expect(within(screen.getByTestId('task-group-marcus.lee')).getAllByTestId(/^task-card-/).map((e) => e.dataset.testid)).toEqual(['task-card-6', 'task-card-1', 'task-card-5'])
    expect(screen.getByTestId('task-group-victor.hale')).toHaveTextContent('4 waiting')
  })
  it('shows the four summary tiles from the live data', () => {
    renderView(<Tasks />)
    expect(screen.getByTestId('stat-waiting-value')).toHaveTextContent('8')
    expect(screen.getByTestId('stat-urgent-value')).toHaveTextContent('1')
    expect(screen.getByTestId('stat-urgent')).toHaveTextContent("Priya's Bakery needs funds Fri 3:00 PM")
    expect(screen.getByTestId('stat-frozen-value')).toHaveTextContent('4')
    expect(screen.getByTestId('stat-late-value')).toHaveTextContent('6')
    expect(screen.getByTestId('page-label')).toHaveTextContent('Wednesday, November 4')
  })
  it('shows only two of a long list until asked, and names what is hidden', async () => {
    renderView(<Tasks />)
    expect(within(screen.getByTestId('task-group-victor.hale')).getAllByTestId(/^task-card-/)).toHaveLength(2)
    await userEvent.click(screen.getByTestId('task-more-victor.hale'))
    expect(screen.getByTestId('task-group-victor.hale').querySelectorAll('[data-testid^="task-card-"]')).toHaveLength(4)
    expect(screen.queryByTestId('task-more-victor.hale')).toBeNull()
  })
  it('names the hidden requests ("Show 2 more fraud holds")', () => {
    renderView(<Tasks />)
    expect(screen.getByTestId('task-more-victor.hale')).toHaveTextContent('Show 2 more fraud holds')
  })
  it('filters to one person with "Viewing as", and can start preset from a link', async () => {
    const { unmount } = renderView(<Tasks />)
    const select = screen.getByTestId('tasks-viewas')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Everyone (8 waiting)', 'Marcus Lee · Credit Officer (3)', 'Victor Hale · Fraud Analyst (4)', 'Aisha Grant · Credit Officer (1)'])
    await userEvent.selectOptions(select, 'victor.hale')
    expect(screen.getAllByTestId(/^task-group-/)).toHaveLength(1)
    expect(screen.getByTestId('task-group-victor.hale')).toBeInTheDocument()
    await userEvent.selectOptions(select, 'all')
    expect(screen.getAllByTestId(/^task-group-/)).toHaveLength(3)
    unmount()
    renderView(<Tasks />, { hash: '#/tasks?as=aisha.grant' })
    expect(screen.getAllByTestId(/^task-group-/).map((e) => e.dataset.testid)).toEqual(['task-group-aisha.grant'])
  })
  it('says so when nobody is waiting', () => {
    const s = clone(fx.wed11)
    s.pending = []
    renderView(<Tasks />, { state: s })
    expect(screen.getByTestId('tasks-empty')).toBeInTheDocument()
    expect(screen.getByTestId('stat-waiting-value')).toHaveTextContent('0')
  })
  it('lists what borrowers still owe, in words', () => {
    renderView(<Tasks />)
    const aside = screen.getByRole('complementary', { name: 'Waiting on borrowers' })
    expect(within(aside).getAllByRole('link')).toHaveLength(4)
    expect(aside).toHaveTextContent('Lone Star Family Dental')
    expect(aside).toHaveTextContent('Bluebonnet Landscape Services LLC')
    expect(aside).toHaveTextContent('page 2 of 2')
    expect(aside).toHaveTextContent('Bank statement for June 2026 is missing')
  })
  it('links each deal name and each borrower card to the deal page', () => {
    renderView(<Tasks />)
    expect(screen.getByTestId('task-deal-6')).toHaveAttribute('href', href.deal("Priya's Bakery"))
    const aside = screen.getByRole('complementary', { name: 'Waiting on borrowers' })
    for (const a of within(aside).getAllByRole('link')) expect(a.getAttribute('href')).toMatch(/^#\/deal\//)
  })
})

describe('My tasks: a card reads like plain English', () => {
  it('shows the right chips and no jargon', () => {
    renderView(<Tasks />)
    expect(card(6)).toHaveTextContent('Urgent')
    expect(card(6)).toHaveTextContent('Covering for Dana Whitfield (out of office)')
    expect(card(6)).toHaveTextContent('$35,000')
    expect(card(6)).toHaveTextContent('RM Elena Ruiz')
    expect(card(6)).toHaveTextContent('Funds needed by Fri 3:00 PM')
    expect(card(1)).toHaveTextContent('Past time limit')
    expect(card(5)).toHaveTextContent('Unusual profile: for information only')
    expect(card(5)).not.toHaveTextContent(/ML watch|z=|deposits_to_rev/)
    expect(card(6)).not.toHaveTextContent(/old-trick|Options:|URGENT -|\(RM /)
  })
  it('puts the buttons in the mockup order', () => {
    renderView(<Tasks />)
    expect(within(card(6)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve', 'Ask borrower for more info', 'Decline'])
    expect(within(card(4)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Place hold', 'Release: deal is genuine'])
  })
  it('explains a fraud hold in words, with the shared details', async () => {
    renderView(<Tasks />)
    const c = card(4)
    expect(c).toHaveTextContent('Deal frozen')
    expect(c).toHaveTextContent(/Unanswered \d+h · escalated/)
    expect(c).toHaveTextContent('Part of a 5-deal group')
    expect(c).toHaveTextContent('Frozen at Intake until you decide')
    const ev = within(c).getByTestId('task-evidence-4')
    expect(ev).toHaveTextContent('Why it was flagged')
    expect(ev).toHaveTextContent('Linked to 4 other deals')
    expect(ev).toHaveTextContent('Tax preparer phone 214-555-0187')
    expect(ev).toHaveTextContent('Vendor bank account …4471 (Metroplex Equipment Supply)')
    expect(ev).not.toHaveTextContent(/appears on only|shared by|people, provenance/)
    await userEvent.click(screen.getByTestId('task-more-victor.hale'))
    const g = within(card(10)).getByTestId('task-evidence-10')
    expect(g).toHaveTextContent('Bank statement does not add up.')
    expect(g).toHaveTextContent('Revenue inflated.')
  })
})

describe('My tasks: every button calls the right endpoint', () => {
  it('Approve sends the answer with the note, with no confirmation', async () => {
    const calls = mockApi({ 'POST /humans/6/answer': {} })
    renderView(<Tasks />)
    await userEvent.type(screen.getByTestId('task-note-6'), 'covered by revenue')
    await userEvent.click(screen.getByTestId('task-answer-6-approve'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls).toEqual([{ method: 'POST', path: '/humans/6/answer', body: { answer: 'approve', note: 'covered by revenue' } }])
  })
  it('"Ask borrower for more info" needs a note first, then sends it', async () => {
    const calls = mockApi({ 'POST /humans/6/answer': {} })
    renderView(<Tasks />)
    await userEvent.click(screen.getByTestId('task-answer-6-request_info'))
    expect(screen.getByTestId('task-error-6')).toHaveTextContent('Please write what you need from the borrower')
    expect(calls).toHaveLength(0)
    await userEvent.type(screen.getByTestId('task-note-6'), '2025 P&L please')
    expect(screen.queryByTestId('task-error-6')).toBeNull()
    await userEvent.click(screen.getByTestId('task-answer-6-request_info'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/6/answer', body: { answer: 'request_info', note: '2025 P&L please' } }])
  })
  it('Decline asks first; Cancel does nothing, Confirm sends', async () => {
    const calls = mockApi({ 'POST /humans/6/answer': {} })
    renderView(<Tasks />)
    await userEvent.click(screen.getByTestId('task-answer-6-decline'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Decline this loan?')
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls).toHaveLength(0)
    await userEvent.click(screen.getByTestId('task-answer-6-decline'))
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/6/answer', body: { answer: 'decline', note: '' } }])
  })
  it('Place hold sends at once; Release asks first', async () => {
    const calls = mockApi({ 'POST /humans/4/answer': {} })
    renderView(<Tasks />)
    await userEvent.click(screen.getByTestId('task-answer-4-hold'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/4/answer', body: { answer: 'hold', note: '' } }])
    await userEvent.click(screen.getByTestId('task-answer-4-release'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Release this deal?')
    expect(calls).toHaveLength(1)
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(calls[1]).toEqual({ method: 'POST', path: '/humans/4/answer', body: { answer: 'release', note: '' } })
  })
  it('Release funds asks first, because it sends the money', async () => {
    const calls = mockApi({ 'POST /humans/100/answer': {} })
    renderView(<Tasks />, { state: withRequests([{ type: 'funding_release', to: 'tasha.reed', options: ['approve', 'decline'] }]) })
    const c = card(100)
    expect(within(c).getAllByRole('button').map((b) => b.textContent)).toEqual(['Release funds', 'Decline'])
    await userEvent.click(screen.getByTestId('task-answer-100-approve'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Release the money?')
    expect(calls).toHaveLength(0)
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/100/answer', body: { answer: 'approve', note: '' } }])
  })
  it('Commitment sign-off confirms the letter; Decline asks first', async () => {
    const calls = mockApi({ 'POST /humans/100/answer': {} })
    renderView(<Tasks />, { state: withRequests([{ type: 'commitment_signoff', to: 'brian.foster', options: ['approve', 'decline'] }]) })
    expect(within(card(100)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Confirm letter signed', 'Decline'])
    await userEvent.click(screen.getByTestId('task-answer-100-approve'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/100/answer', body: { answer: 'approve', note: '' } }])
    await userEvent.click(screen.getByTestId('task-answer-100-decline'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('Committee approval: approve / decline', async () => {
    const calls = mockApi({ 'POST /humans/100/answer': {} })
    renderView(<Tasks />, { state: withRequests([{ type: 'committee_approval', to: 'harold.benson', options: ['approve', 'decline'] }]) })
    await userEvent.click(screen.getByTestId('task-answer-100-approve'))
    expect(calls[0].body.answer).toBe('approve')
  })
  it('Fraud release: Keep the hold sends; Release the hold asks first', async () => {
    const calls = mockApi({ 'POST /humans/100/answer': {} })
    renderView(<Tasks />, { state: withRequests([{ type: 'fraud_release', to: 'monica.salas', options: ['release', 'keep_hold'] }]) })
    await userEvent.click(screen.getByTestId('task-answer-100-keep_hold'))
    expect(calls).toEqual([{ method: 'POST', path: '/humans/100/answer', body: { answer: 'keep_hold', note: '' } }])
    await userEvent.click(screen.getByTestId('task-answer-100-release'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Release the hold?')
  })
  it('every button is disabled while another action is running', () => {
    renderView(<Tasks />, { busy: true })
    for (const b of within(card(6)).getAllByRole('button')) expect(b).toBeDisabled()
  })
  it('shows nothing when the answer fails: the error banner (in the app shell) handles it', async () => {
    mockApi({})
    const { act } = renderView(<Tasks />)
    await userEvent.click(screen.getByTestId('task-answer-6-approve'))
    expect(act).toHaveBeenCalledTimes(1)
    await expect(act.mock.results[0].value).resolves.toMatchObject({ ok: false })
  })
})
