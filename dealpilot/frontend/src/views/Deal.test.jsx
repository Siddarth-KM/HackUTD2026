import { describe, expect, it } from 'vitest'
import { act as rtlAct, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Deal from './Deal'
import { href } from '../lib/route'
import { clone, deferred, failure, fx, mockApi, renderView } from '../test/utils'

const URL = (f) => `/deals/${encodeURIComponent(f)}`
const open = async (folder, deal, routes = {}, opts = {}) => {
  const calls = mockApi({ [`GET ${URL(folder)}`]: deal, ...routes })
  const r = renderView(<Deal />, { hash: href.deal(folder), ...opts })
  await screen.findByTestId('view-deal')
  return { calls, ...r }
}
const issue = (code) => screen.getByTestId(`deal-issue-${code}`)

describe('Deal page: what it shows', () => {
  it('Bluebonnet: header, stepper, right-now, issues, facts, documents', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet)
    expect(screen.getByTestId('page-title')).toHaveTextContent('Bluebonnet Landscape Services LLC')
    expect(screen.getByTestId('deal-stage-chip')).toHaveTextContent('Intake')
    expect(screen.getByTestId('deal-fraud-chip')).toHaveTextContent('No fraud flag')
    expect(screen.getByTestId('deal-chips')).toHaveTextContent('Waiting on borrower')
    expect(screen.getByText(/\$250,000 · Equipment Loan · 60 months · RM Elena Ruiz · Guarantor Carlos Medina/)).toBeInTheDocument()
    expect(screen.getByTestId('deal-step-Intake')).toHaveTextContent('Waiting on borrower')
    expect(screen.getByTestId('deal-step-Credit')).not.toHaveTextContent('Done')
    expect(screen.getByTestId('deal-now')).toHaveTextContent('Requested amount differs between documents')
    expect(screen.getByTestId('deal-now')).toHaveTextContent('25.5h in stage of 8h allowed (319%)')
    expect(screen.getByTestId('deal-now')).toHaveTextContent('Latest alert: Stuck deal sent to Lauren Kim')
    expect(screen.getByTestId('deal-unblock')).toHaveTextContent('To unblock: the borrower sends or clarifies the item listed under Issues')
    expect(screen.getByTestId('deal-back')).toHaveAttribute('href', '#/pipeline')
    const facts = screen.getByTestId('deal-facts')
    expect(facts).toHaveTextContent('61-1873390')
    expect(facts).toHaveTextContent('Equipment Loan')
    expect(facts).toHaveTextContent('None on file yet')
    expect(facts).toHaveTextContent('Elena Ruiz')
    expect(facts).not.toHaveTextContent('Also known as')
    expect(screen.getByTestId('deal-docs')).toHaveTextContent('Documents received (13)')
    expect(screen.getByTestId('deal-docs')).toHaveTextContent('Bank statements (6)')
    expect(screen.getByTestId('deal-docs')).toHaveTextContent('Loan application')
  })
  it('lists requests and alerts newest first, with names and no codes', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet)
    const t = screen.getByTestId('deal-events').textContent
    const at = ['Wed 1:31 AM', 'Tue 9:31 PM', 'Tue 5:31 PM', 'Tue 10:05 AM'].map((x) => t.indexOf(x))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)                  // newest first
    for (const name of ['Lauren Kim', 'Raj Patel', 'Olivia Chen']) expect(t).toContain(name)
    expect(t).toMatch(/Awaiting documents/)
    expect(t).not.toMatch(/\b[a-z]+\.[a-z]+\b(?!\.)/)    // no raw ids such as olivia.chen
  })
  it('shows the stage history', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet)
    expect(screen.getByTestId('deal-log-Intake')).toHaveTextContent('Intake · waiting')
    expect(screen.getByTestId('deal-log-Intake')).toHaveTextContent('Since Tue 9:31 AM')
  })
  it('shows the statistical profile for information only', async () => {
    await open('Okafor Advisory - James', fx.okafor)
    expect(screen.getByTestId('deal-profile')).toHaveTextContent('Unusual compared with the bank’s usual deals')
    expect(screen.getByTestId('deal-profile')).toHaveTextContent('it never blocks a deal')
    expect(screen.getByTestId('deal-profile')).not.toHaveTextContent(/z=|deposits_to_rev/)
  })
  it('shows an urgent chip with the deadline', async () => {
    await open("Priya's Bakery", fx.priya)
    expect(screen.getByTestId('deal-chips')).toHaveTextContent('Urgent · funds needed Fri 3:00 PM')
  })
  it('Granite Bay: frozen, failed checks explained, nothing to accept', async () => {
    await open('Granite Bay Building Supply', fx.granite)
    expect(screen.getByTestId('deal-fraud-chip')).toHaveTextContent('Awaiting Fraud Ops decision')
    expect(screen.getByTestId('deal-step-Intake')).toHaveTextContent('Frozen: fraud review')
    expect(screen.getByTestId('deal-now')).toHaveTextContent('Fraud Operations decision on the hold request (Victor Hale)')
    expect(screen.getByTestId('deal-fraud')).toHaveTextContent('Bank statement does not add up.')
    expect(screen.getByTestId('deal-fraud')).toHaveTextContent('August 2026: opening 79,275.96')
    expect(issue('OLD_TRICK:STMT_TAMPER')).toHaveTextContent('Fraud check failed')
    expect(issue('OLD_TRICK:REV_INFLATION')).toHaveTextContent('Revenue inflated')
    expect(screen.queryByTestId('deal-accept-all')).toBeNull()
    expect(screen.queryByTestId('deal-accept-OLD_TRICK:STMT_TAMPER')).toBeNull()
  })
  it('Ridgeway: names the group, links live deals and keeps funded-earlier ones plain', async () => {
    await open('Ridgeway Freight Logistics', fx.ridgeway)
    const box = screen.getByTestId('deal-fraud')
    expect(box).toHaveTextContent('Linked to 4 other deals')
    expect(box).toHaveTextContent('Tax preparer phone 214-555-0187')
    const live = fx.ridgeway.fraud.linked_deals.filter((id) => fx.wed11.deals.some((d) => d.folder === id))
    const history = fx.ridgeway.fraud.linked_deals.filter((id) => /^H-/.test(id))
    expect(live.length).toBeGreaterThan(0)
    expect(history.length).toBe(2)
    for (const id of live) expect(screen.getByTestId(`deal-linked-${id}`)).toHaveAttribute('href', href.deal(id))
    for (const id of history) {
      expect(within(box).getByText(id)).toBeInTheDocument()
      expect(screen.queryByTestId(`deal-linked-${id}`)).toBeNull()
    }
  })
  it('a funded deal: every step done, funds released', async () => {
    const folder = fx.funded.folder
    const state = fx.fri18
    await open(folder, fx.funded, {}, { state })
    expect(screen.getByTestId('deal-stage-chip')).toHaveTextContent('Funded')
    expect(screen.getByTestId('deal-now')).toHaveTextContent('Funds have been released.')
    for (const s of ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed']) expect(screen.getByTestId(`deal-step-${s}`)).toHaveTextContent('Done')
  })
  it('a declined deal says so', async () => {
    await open(fx.declinedDeal.folder, fx.declinedDeal, {}, { state: fx.declined })
    expect(screen.getByTestId('deal-stage-chip')).toHaveTextContent('Declined')
    expect(screen.getByTestId('deal-step-Credit')).toHaveTextContent('Declined')
  })
  it('an unknown deal shows a plain message with a way back', async () => {
    mockApi({})
    renderView(<Deal />, { hash: href.deal('Nope') })
    expect(await screen.findByTestId('deal-missing')).toHaveTextContent('could not find that deal')
  })
})

describe('Deal page: accepting issues', () => {
  const accepted = (deal, code, patch = {}) => {
    const d = clone(deal)
    const f = d.findings.find((x) => x.code === code)
    Object.assign(f, { accepted: true, blocking_now: false, later: false })
    Object.assign(d, patch)
    return d
  }

  it('a later-stage issue says it applies later; accepting shows a message and marks it accepted', async () => {
    const after = accepted(fx.bluebonnet, 'MISSING_DOC:equipment_quote')
    const message = 'Accepted MISSING_DOC:equipment_quote. Takes effect when the deal reaches Product. Still blocking Intake: requested amount differs.'
    const { calls } = await open('Bluebonnet Landscape', fx.bluebonnet, { [`POST ${URL('Bluebonnet Landscape')}/override`]: { result: { message }, deal: after } })
    expect(issue('MISSING_DOC:equipment_quote')).toHaveTextContent('Blocks Product (step 4)')
    expect(screen.getByTestId('deal-accept-MISSING_DOC:equipment_quote')).toHaveTextContent('Accept now (applies at Product)')
    expect(screen.getByTestId('deal-accept-MISMATCH:amount_requested')).toHaveTextContent('Accept and continue')
    expect(issue('MISMATCH:amount_requested')).toHaveTextContent('Blocking Intake now')
    await userEvent.click(screen.getByTestId('deal-accept-MISSING_DOC:equipment_quote'))
    expect(calls.at(-1)).toEqual({ method: 'POST', path: `${URL('Bluebonnet Landscape')}/override`, body: { code: 'MISSING_DOC:equipment_quote' } })
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('Takes effect when the deal reaches Product')
    expect(issue('MISSING_DOC:equipment_quote')).toHaveTextContent('Accepted')
    expect(screen.queryByTestId('deal-accept-MISSING_DOC:equipment_quote')).toBeNull()
    expect(screen.getByTestId('deal-accept-MISMATCH:amount_requested')).toBeInTheDocument()
  })
  it('accepting the blocking issue moves the deal on', async () => {
    const after = accepted(accepted(fx.bluebonnet, 'MISMATCH:amount_requested', { stage: 'Credit' }), 'MISSING_DOC:equipment_quote')
    const { calls } = await open('Bluebonnet Landscape', fx.bluebonnet, { [`POST ${URL('Bluebonnet Landscape')}/override`]: { result: { message: 'Deal moved Intake -> Credit.' }, deal: after } })
    await userEvent.click(screen.getByTestId('deal-accept-MISMATCH:amount_requested'))
    expect(calls.at(-1).body).toEqual({ code: 'MISMATCH:amount_requested' })
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('Deal moved Intake -> Credit.')
    expect(screen.getByTestId('deal-stage-chip')).toHaveTextContent('Credit')
    expect(screen.getByTestId('deal-step-Intake')).toHaveTextContent('Done')
  })
  it('"Accept all" appears only with two or more blockers, and sends all_stage', async () => {
    const { calls } = await open('Garza Family Pharmacy', fx.garza, { [`POST ${URL('Garza Family Pharmacy')}/override`]: { result: { message: 'Accepted 2 issues.' }, deal: fx.garza } })
    const btn = screen.getByTestId('deal-accept-all')
    expect(btn).toHaveTextContent(/^Accept all 2 open issues for Intake and continue$/)
    await userEvent.click(btn)
    expect(calls.at(-1)).toEqual({ method: 'POST', path: `${URL('Garza Family Pharmacy')}/override`, body: { all_stage: true } })
    expect(await screen.findByTestId('deal-done')).toHaveTextContent('Accepted 2 issues.')
  })
  it('no "Accept all" when only one issue blocks the current stage', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet)
    expect(screen.queryByTestId('deal-accept-all')).toBeNull()
  })
  it('each issue button is disabled while another action runs', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet, {}, { busy: true })
    expect(screen.getByTestId('deal-accept-MISMATCH:amount_requested')).toBeDisabled()
    expect(screen.getByTestId('deal-memos')).toBeDisabled()
  })
  it('a refused accept leaves the page as it was (the banner shows the reason)', async () => {
    const { act } = await open('Bluebonnet Landscape', fx.bluebonnet, { [`POST ${URL('Bluebonnet Landscape')}/override`]: failure(400, 'not an open blocking issue') })
    await userEvent.click(screen.getByTestId('deal-accept-MISMATCH:amount_requested'))
    await waitFor(() => expect(act).toHaveBeenCalled())
    expect(screen.queryByTestId('deal-done')).toBeNull()
    expect(issue('MISMATCH:amount_requested')).toHaveTextContent('Blocking Intake now')
  })
})

describe('Deal page: Gemini stage notes', () => {
  it('no finished stage yet: says so', async () => {
    await open('Bluebonnet Landscape', fx.bluebonnet, { [`POST ${URL('Bluebonnet Landscape')}/memos`]: { ...fx.bluebonnet, memos_ok: true } })
    await userEvent.click(screen.getByTestId('deal-memos'))
    expect(await screen.findByTestId('deal-memo-msg')).toHaveTextContent('no finished stages')
  })
  it('Gemini unavailable: says so, and the page stays usable', async () => {
    await open(fx.funded.folder, fx.funded, { [`POST ${URL(fx.funded.folder)}/memos`]: { ...fx.funded, memos_ok: false } }, { state: fx.fri18 })
    await userEvent.click(screen.getByTestId('deal-memos'))
    expect(await screen.findByTestId('deal-memo-msg')).toHaveTextContent("Gemini isn't available right now, so no notes were written.")
    expect(screen.getByTestId('deal-history')).toBeInTheDocument()
  })
  it('notes written: shows them in the stage history', async () => {
    const withMemo = clone(fx.funded)
    withMemo.log[0].memo = 'SAW: all papers present. DECIDED: advance. WHY: nothing missing.'
    await open(fx.funded.folder, fx.funded, { [`POST ${URL(fx.funded.folder)}/memos`]: { ...withMemo, memos_ok: true } }, { state: fx.fri18 })
    await userEvent.click(screen.getByTestId('deal-memos'))
    expect(await screen.findByTestId('deal-memo-msg')).toHaveTextContent('Stage notes are written below.')
    expect(screen.getByTestId('deal-history')).toHaveTextContent('SAW: all papers present.')
  })
})

describe('Deal page: data freshness', () => {
  it('drops an older answer that arrives after a newer one', async () => {
    const slow = deferred()
    const fast = deferred()
    let n = 0
    mockApi({ [`GET ${URL('Bluebonnet Landscape')}`]: () => (++n === 1 ? slow.promise : fast.promise) })
    const r = renderView(<Deal />, { hash: href.deal('Bluebonnet Landscape') })
    r.rerenderWith({ state: clone(fx.wed11) })                      // a poll brought new state: second request starts
    const newer = { ...clone(fx.bluebonnet), name: 'NEWER NAME', facts: { ...fx.bluebonnet.facts, legal_name: 'Newer Name LLC' } }
    const older = { ...clone(fx.bluebonnet), name: 'OLDER NAME', facts: { ...fx.bluebonnet.facts, legal_name: 'Older Name LLC' } }
    await rtlAct(async () => { fast.resolve(new Response(JSON.stringify(newer))); await Promise.resolve() })
    expect(await screen.findByTestId('page-title')).toHaveTextContent('Newer Name LLC')
    await rtlAct(async () => { slow.resolve(new Response(JSON.stringify(older))); await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.getByTestId('page-title')).toHaveTextContent('Newer Name LLC')
  })
})
