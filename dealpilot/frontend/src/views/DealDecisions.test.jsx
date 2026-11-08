// Answering the requests that wait on a deal, from the deal's own page (no trip back to My tasks).
import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Deal from './Deal'
import { href } from '../lib/route'
import { answerDone } from '../lib/labels'
import { clone, fx, mockApi, renderView } from '../test/utils'

const URL = (f) => `/deals/${encodeURIComponent(f)}`
const open = async (folder, deal, routes = {}, opts = {}) => {
  const calls = mockApi({ [`GET ${URL(folder)}`]: deal, ...routes })
  const r = renderView(<Deal />, { hash: href.deal(folder), ...opts })
  await screen.findByTestId('view-deal')
  return { calls, ...r }
}
// The state the server returns after an answer: the same week, with this deal moved on.
const after = (folder, patch) => {
  const s = clone(fx.wed11)
  Object.assign(s.deals.find((d) => d.folder === folder), patch)
  return { request: {}, state: s }
}
const posts = (calls) => calls.filter((c) => c.method === 'POST')

describe('Deal page: decisions waiting on this deal', () => {
  it("Priya's Bakery shows its credit decision at the top, with whose decision it is and the same buttons as My tasks", async () => {
    await open("Priya's Bakery", fx.priya)
    const box = screen.getByTestId('deal-decisions')
    expect(box).toHaveTextContent('Decision waiting')
    expect(screen.getByTestId('deal-req-who-6')).toHaveTextContent('Waiting on Marcus Lee · Credit Officer')
    expect(within(box).getByText('Credit decision')).toBeInTheDocument()
    expect(within(box).getByText('Urgent')).toBeInTheDocument()
    const buttons = within(box).getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Approve', 'Ask borrower for more info', 'Decline'])
    // it sits above "Right now"
    expect(box.compareDocumentPosition(screen.getByTestId('deal-now')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // the page header already names the deal, so the card does not repeat the deal link
    expect(screen.queryByTestId('deal-req-deal-6')).toBeNull()
  })

  it('Approve sends the answer and the note, then says where the deal went', async () => {
    const { calls } = await open("Priya's Bakery", fx.priya, { 'POST /humans/6/answer': after("Priya's Bakery", { stage: 'Committee' }) })
    await userEvent.type(screen.getByTestId('deal-req-note-6'), 'Strong cash flow')
    await userEvent.click(screen.getByTestId('deal-req-answer-6-approve'))
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/humans/6/answer', body: { answer: 'approve', note: 'Strong cash flow' } }])
    expect(await screen.findByTestId('deal-done')).toHaveTextContent("Done. Approved. Priya's Bakery moved from Credit to Committee.")
  })

  it('"Ask borrower for more info" needs a note first, then sends it', async () => {
    const { calls } = await open("Priya's Bakery", fx.priya, { 'POST /humans/6/answer': after("Priya's Bakery", {}) })
    await userEvent.click(screen.getByTestId('deal-req-answer-6-request_info'))
    expect(screen.getByTestId('deal-req-error-6')).toHaveTextContent('Please write what you need from the borrower')
    expect(posts(calls)).toEqual([])
    await userEvent.type(screen.getByTestId('deal-req-note-6'), 'Send the June statement')
    expect(screen.queryByTestId('deal-req-error-6')).toBeNull()
    await userEvent.click(screen.getByTestId('deal-req-answer-6-request_info'))
    expect(posts(calls)[0].body).toEqual({ answer: 'request_info', note: 'Send the June statement' })
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('The borrower has been asked for more information. It stays at Credit.')
  })

  it('Decline asks first: Cancel sends nothing, Confirm declines and says the deal is stopped', async () => {
    const { calls } = await open("Priya's Bakery", fx.priya, { 'POST /humans/6/answer': after("Priya's Bakery", { status: 'declined' }) })
    await userEvent.click(screen.getByTestId('deal-req-answer-6-decline'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Decline this loan?')
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posts(calls)).toEqual([])
    await userEvent.click(screen.getByTestId('deal-req-answer-6-decline'))
    await userEvent.click(screen.getByTestId('confirm-ok'))
    expect(posts(calls)[0].body).toEqual({ answer: 'decline', note: '' })
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('Declined. The deal is stopped.')
  })

  it('a frozen deal shows the fraud hold buttons without repeating the evidence; Release asks first', async () => {
    const { calls } = await open('Ridgeway Freight Logistics', fx.ridgeway, { 'POST /humans/4/answer': after('Ridgeway Freight Logistics', { frozen: true }) })
    const box = screen.getByTestId('deal-decisions')
    expect(screen.getByTestId('deal-req-who-4')).toHaveTextContent('Waiting on Victor Hale')
    expect(within(box).getAllByRole('button').map((b) => b.textContent)).toEqual(['Place hold', 'Release: deal is genuine'])
    expect(screen.queryByTestId('deal-req-evidence-4')).toBeNull()
    expect(box).toHaveTextContent('See the fraud evidence below.')
    expect(screen.getByTestId('deal-fraud')).toBeInTheDocument()                     // the page's own evidence card
    await userEvent.click(screen.getByTestId('deal-req-answer-4-release'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Release this deal?')
    await userEvent.click(screen.getByTestId('confirm-cancel'))
    await userEvent.click(screen.getByTestId('deal-req-answer-4-hold'))             // no confirmation for holding
    expect(posts(calls)).toEqual([{ method: 'POST', path: '/humans/4/answer', body: { answer: 'hold', note: '' } }])
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('Hold placed. The deal stays frozen.')
  })

  it('a deal with nothing waiting looks exactly as before', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet)
    expect(screen.queryByTestId('deal-decisions')).toBeNull()
  })

  it('the box disappears once the request is answered (the next poll no longer lists it)', async () => {
    const { rerenderWith } = await open("Priya's Bakery", fx.priya)
    expect(screen.getByTestId('deal-decisions')).toBeInTheDocument()
    const s = clone(fx.wed11)
    s.pending = s.pending.filter((r) => r.id !== 6)
    rerenderWith({ state: s })
    await waitFor(() => expect(screen.queryByTestId('deal-decisions')).toBeNull())
  })

  it('several requests on one deal are all shown, oldest first', async () => {
    const s = clone(fx.wed11)
    const extra = { ...s.pending.find((r) => r.id === 6), id: 99, type: 'committee_approval', options: ['approve', 'decline'], at: '2026-11-04T10:30-06:00', to: 'susan.ortiz' }
    s.pending.push(extra)
    await open("Priya's Bakery", fx.priya, {}, { state: s })
    expect(screen.getByTestId('deal-decisions')).toHaveTextContent('2 decisions waiting')
    const cards = screen.getAllByTestId(/^deal-req-card-/).map((c) => c.getAttribute('data-testid'))
    expect(cards).toEqual(['deal-req-card-6', 'deal-req-card-99'])
  })

  it('buttons are disabled while any action is running', async () => {
    await open("Priya's Bakery", fx.priya, {}, { busy: true })
    for (const b of within(screen.getByTestId('deal-decisions')).getAllByRole('button')) expect(b).toBeDisabled()
  })
})

describe('answerDone', () => {
  const before = { name: 'Harbor Tea', stage: 'Credit', status: 'active' }
  it('names what happened and where the deal is now', () => {
    expect(answerDone('credit_decision', 'approve', before, { name: 'Harbor Tea', stage: 'Committee', status: 'active' })).toBe('Approved. Harbor Tea moved from Credit to Committee.')
    expect(answerDone('credit_decision', 'decline', before, { stage: 'Credit', status: 'declined' })).toBe('Declined. The deal is stopped.')
    expect(answerDone('funding_release', 'approve', { ...before, stage: 'Closed' }, { name: 'Harbor Tea', stage: 'Closed', status: 'funded' })).toBe('Funds released. Harbor Tea is funded.')
    expect(answerDone('commitment_signoff', 'approve', { ...before, stage: 'Committed' }, { name: 'Harbor Tea', stage: 'Closed', status: 'active' })).toBe('Commitment letter confirmed as signed. Harbor Tea moved from Committed to Closed.')
    expect(answerDone('fraud_hold', 'release', { ...before, stage: 'Intake' }, { name: 'Harbor Tea', stage: 'Intake', status: 'active', frozen: false })).toBe('Released as genuine. It stays at Intake.')
    expect(answerDone('fraud_release', 'keep_hold', before, { stage: 'Intake', status: 'held' })).toBe('Hold kept. The deal is stopped.')
    expect(answerDone('fraud_release', 'release', before, null)).toBe('Hold released.')
  })
})
