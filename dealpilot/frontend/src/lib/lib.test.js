import { describe, expect, it } from 'vitest'
import { fmtClock, fmtDay, fmtShort, initials, money, ordinal, plural } from './format'
import { alertBody, borrowerItems, cap, evidenceParagraphs, humanize, splitRequest } from './text'
import { chipsFor, evidenceLabel, issueChipText, issueTitle, optionSpec, requestKind, slaView, stageNote, stageOf, waitText } from './labels'
import { parseHash, href } from './route'
import { FACTOR_TEXT, factorText, pctText, scoreColor } from './labels'
import { GRAPH_W, layout, neighbours, parseToken, shortLabel } from './graphLayout'
import { fx } from '../test/utils'

const people = fx.wed11.people

describe('format', () => {
  it('shows times in Central time whatever the browser zone is', () => {
    expect(fmtClock('2026-11-04T11:00-06:00')).toBe('Wed, Nov 4 · 11:00 AM CT')
    expect(fmtClock('2026-11-04T17:00:00Z')).toBe('Wed, Nov 4 · 11:00 AM CT')
    expect(fmtShort('2026-11-03T09:20-06:00')).toBe('Tue 9:20 AM')
    expect(fmtShort('2026-11-06T15:00:00-06:00')).toBe('Fri 3:00 PM')
    expect(fmtDay('2026-11-04T11:00-06:00')).toBe('Wednesday, November 4')
    expect(fmtClock('')).toBe('')
    expect(fmtShort('not a date')).toBe('')
  })
  it('formats money, initials, ordinals and plurals', () => {
    expect(money(247500)).toBe('$247,500')
    expect(money(60000.4)).toBe('$60,000')
    expect(money(null)).toBe('—')
    expect(initials('Marcus Lee')).toBe('ML')
    expect(initials('Priscilla Nguyen')).toBe('PN')
    expect([96, 98, 101, 102, 103, 111, 112].map(ordinal)).toEqual(['96th', '98th', '101st', '102nd', '103rd', '111th', '112th'])
    expect(plural(1, 'deal')).toBe('1 deal')
    expect(plural(2, 'deal')).toBe('2 deals')
    expect(plural(1, 'person', 'people')).toBe('1 person')
    expect(plural(3, 'person', 'people')).toBe('3 people')
  })
})

describe('text cleanup', () => {
  it('turns ids, ISO times and month codes into plain words and leaves other text alone', () => {
    expect(humanize('waiting on victor.hale since 2026-11-03T16:07-06:00', people)).toBe('waiting on Victor Hale since Tue 4:07 PM')
    expect(humanize('bank statement for 2026-06 is missing', people)).toBe('bank statement for June 2026 is missing')
    expect(humanize('needed by 2026-11-06', people)).toBe('needed by 2026-11-06')          // a full date is not a month code
    expect(humanize('missing page(s) [2] of 2', people)).toBe('missing page 2 of 2')
    expect(humanize('e.g. nothing special', people)).toBe('e.g. nothing special')
    expect(humanize('', people)).toBe('')
    expect(cap('abc')).toBe('Abc')
  })
  it('splits a credit request into a readable summary (no head, no options, no jargon)', () => {
    const msg = fx.wed11.pending.find((r) => r.id === 5).message
    expect(msg).toMatch(/ML watch score/)
    const { summary, evidence } = splitRequest(msg, people)
    expect(summary).toMatch(/^\$1,200,000 Revolving Line of Credit, 24 months\./)
    expect(summary).not.toMatch(/ML watch|Options:|Known-fraud|old-trick|\(RM/)
    expect(evidence).toBe('')
  })
  it('drops the routed-to-you note and URGENT prefix, and keeps the deadline in words', () => {
    const { summary } = splitRequest(fx.wed11.pending.find((r) => r.id === 6).message, people)
    expect(summary).not.toMatch(/URGENT|Routed to you/)
    expect(summary).toMatch(/Funds needed by Fri 3:00 PM\./)
  })
  it('pulls the evidence out of a fraud hold request', () => {
    const { summary, evidence } = splitRequest(fx.wed11.pending.find((r) => r.id === 10).message, people)
    expect(summary).toMatch(/Nothing will advance on this deal until you answer\./)
    expect(evidence).toMatch(/^OLD_TRICK:REV_INFLATION/)
    expect(evidence).not.toMatch(/Reply 'hold'/)
  })
  it('titles each known-fraud check in its own paragraph', () => {
    const paras = evidenceParagraphs(fx.granite.fraud.reason, people)
    expect(paras.map((p) => p.title)).toEqual(['Bank statement does not add up', 'Revenue inflated'])
    expect(paras[0].body).toMatch(/August 2026: opening 79,275\.96/)
    expect(evidenceParagraphs('', people)).toEqual([])
    expect(evidenceParagraphs('plain sentence', people)).toEqual([{ title: '', body: 'plain sentence' }])
  })
  it('lists what the borrower was asked for', () => {
    const msg = fx.wed11.unanswered_info.find((r) => r.deal === 'Bluebonnet Landscape').message
    const items = borrowerItems(msg, people)
    expect(items).toHaveLength(2)
    expect(items[0]).toBe('Equipment loan requires a vendor quote (vendor identity and remit-to account)')
    expect(items[1]).toMatch(/^Requested amount differs between documents/)
    expect(borrowerItems('Hello X - to keep your loan moving we still need the following. (1) Bank statement for 2026-06 is missing. Please send it.', people))
      .toEqual(['Bank statement for June 2026 is missing'])
  })
  it('strips the SHOUTING prefix of an alert and keeps the rest', () => {
    const a = fx.wed11.alerts
    const stuck = a.find((x) => x.kind === 'stuck')
    expect(alertBody(stuck.message, people)).not.toMatch(/^STUCK DEAL/)
    for (const x of a) expect(alertBody(x.message, people)).not.toMatch(/^(ESCALATION|SECOND ESCALATION|STUCK DEAL|FRAUD HOLD UNANSWERED|STILL AT RISK|DEADLINE AT RISK)/)
    expect(alertBody('FRAUD HOLD UNANSWERED for 4h: X was flagged.', people)).toBe('X was flagged.')
  })
})

describe('labels', () => {
  it('names every issue code in words', () => {
    expect(issueTitle('MISSING_DOC:bank_statement_2026-06')).toBe('Bank statement missing: June 2026')
    expect(issueTitle('MISSING_PAGE:bank_statement_2026-08')).toBe('Statement page missing: August 2026')
    expect(issueTitle('MISSING_DOC:equipment_quote')).toBe('Vendor quote missing')
    expect(issueTitle('MISSING_DOC:tax_return')).toBe('Business tax return missing')
    expect(issueTitle('MISMATCH:amount_requested')).toBe('Loan amount differs between documents')
    expect(issueTitle('OLD_TRICK:SHELL_ADDRESS')).toBe('Mailbox address')
    expect(issueTitle('SOMETHING_NEW')).toBe('Something new')
    for (const c of ['MISSING_DOC:application', 'MISSING_DOC:guarantor_id', 'MISSING_DOC:certificate_of_formation', 'MISSING_DOC:ein_letter', 'MISSING_DOC:financial_statements',
      'MISMATCH:legal_name', 'MISMATCH:ein', 'MISMATCH:guarantor_name', 'MISMATCH:guarantor_dob', 'MISMATCH:guarantor_address', 'MISMATCH:annual_revenue', 'MISMATCH:bank_balance',
      'OLD_TRICK:DUP_EIN', 'OLD_TRICK:ID_MISMATCH', 'OLD_TRICK:REV_INFLATION', 'OLD_TRICK:STMT_TAMPER', 'EXTRACTION_UNVERIFIED']) {
      expect(issueTitle(c), c).not.toMatch(/_|:/)
    }
  })
  it('has short and full chip wording', () => {
    expect(issueChipText('MISSING_DOC:equipment_quote', true)).toBe('Quote missing')
    expect(issueChipText('MISSING_DOC:equipment_quote', false)).toBe('Vendor quote missing')
    expect(issueChipText('MISSING_DOC:bank_statement_2026-06', true)).toBe('June statement missing')
    expect(issueChipText('MISSING_PAGE:bank_statement_2026-08', true)).toBe('Statement page missing')
    expect(issueChipText('MISMATCH:amount_requested', true)).toBe('Amount mismatch')
    expect(issueChipText('MISMATCH:ein', true)).toBe('Details mismatch')
  })
  it('builds board chips: frozen + linked, failed checks, issues, urgent, unusual, none', () => {
    const by = (f) => fx.wed11.deals.find((d) => d.folder === f)
    expect(chipsFor(by('Ridgeway Freight Logistics'), { short: true }).map((c) => c.text)).toEqual(['Frozen: fraud', 'Linked to 4 deals'])
    expect(chipsFor(by('Granite Bay Building Supply'), { short: true }).map((c) => c.text)).toEqual(['Frozen: fraud', 'Failed 2 checks'])
    expect(chipsFor(by('Granite Bay Building Supply')).map((c) => c.text)).toEqual(['Frozen: fraud review', 'Bank statement does not add up', 'Revenue inflated'])
    expect(chipsFor(by('Bluebonnet Landscape'), { short: true }).map((c) => c.text)).toEqual(['Amount mismatch', 'Quote missing'])
    expect(chipsFor(by("Priya's Bakery"), { short: true })[0]).toEqual({ text: 'Urgent · Fri 3:00 PM', tone: 'risk' })
    expect(chipsFor(by('Okafor Advisory - James'), { short: true })[0].text).toBe('Unusual profile (info)')
    expect(chipsFor(by('Harbor Tea Co'), { short: true })).toEqual([{ text: 'No open issues', tone: 'ok' }])
    expect(chipsFor({ status: 'funded', fraud: {}, issues: [] })[0]).toEqual({ text: 'Funded', tone: 'ok' })
    expect(chipsFor({ status: 'declined', fraud: {}, issues: [] })[0]).toEqual({ text: 'Declined', tone: 'warn' })
  })
  it('draws the time bar: accent below 100%, amber from 100, red from 150, capped at 200', () => {
    const v = (pct) => slaView({ pct, elapsed: 1, hours: 2 })
    expect(v(0)).toMatchObject({ width: '0%', color: '#7399C6' })
    expect(v(99).color).toBe('#7399C6')
    expect(v(100).color).toBe('#B7791F')
    expect(v(149).color).toBe('#B7791F')
    expect(v(150).color).toBe('#B42318')
    expect(v(564).width).toBe('100%')
    expect(v(50).width).toBe('25%')
    expect(slaView({ pct: 102, elapsed: 49.1, hours: 48 }).short).toBe('49.1h of 48h · 102%')
    expect(slaView(null)).toBeNull()
  })
  it('places deals in columns and describes what they wait for', () => {
    expect(stageOf({ status: 'active', stage: 'Credit' })).toBe('Credit')
    expect(stageOf({ status: 'declined', stage: 'Credit' })).toBe('Stopped')
    expect(stageOf({ status: 'held', stage: 'Intake' })).toBe('Stopped')
    expect(stageOf({ status: 'funded', stage: 'Closed' })).toBe('Closed')
    expect(stageOf({ status: 'active', stage: null })).toBe('Intake')
    const ridge = fx.wed11.deals.find((d) => d.folder === 'Ridgeway Freight Logistics')
    expect(waitText(ridge, people, true)).toBe('Fraud Ops decision (Victor Hale)')
    expect(waitText(ridge, people)).toBe('Fraud Operations decision on the hold request (Victor Hale)')
    expect(waitText({ status: 'funded' }, people)).toBe('Funds released')
    expect(stageNote('Committee', people)).toMatch(/under \$250,000 Priscilla Nguyen, otherwise Harold Benson/)
    expect(stageNote('Committee', {})).toBe('approver chosen by the loan amount')
  })
  it('knows every request type and button, and which need a confirmation', () => {
    expect(optionSpec('credit_decision', 'request_info').label).toBe('Ask borrower for more info')
    expect(optionSpec('credit_decision', 'decline').confirm).toBeTruthy()
    expect(optionSpec('credit_decision', 'approve').confirm).toBeUndefined()
    expect(optionSpec('funding_release', 'approve')).toMatchObject({ label: 'Release funds', confirm: expect.any(Object) })
    expect(optionSpec('commitment_signoff', 'approve').label).toBe('Confirm letter signed')
    expect(optionSpec('fraud_hold', 'hold')).toMatchObject({ label: 'Place hold', style: 'riskSolid' })
    expect(optionSpec('fraud_hold', 'release').confirm).toBeTruthy()
    expect(optionSpec('fraud_release', 'keep_hold').label).toBe('Keep the hold')
    expect(optionSpec('mystery', 'do_thing').label).toBe('Do thing')
    expect(requestKind('credit_decision').noteRequired).toEqual(['request_info'])
  })
  it('turns shared fraud attributes into sentences', () => {
    const ev = (key, value) => evidenceLabel({ key, value })
    expect(ev('preparer_phone', '2145550187')).toBe('Tax preparer phone 214-555-0187')
    expect(ev('vendor_acct', 'metroplex equipment supply|4471')).toBe('Vendor bank account …4471 (Metroplex Equipment Supply)')
    expect(ev('round_deposit_share', '90-100')).toBe('90 to 100% of deposits are round-dollar amounts')
    expect(ev('deposit_days', 'mon,thu')).toBe('Deposits only on Mondays and Thursdays')
    expect(ev('near_limit', '250k')).toBe('Amount just under the $250,000 limit')
    expect(ev('agent', 'commerce street agent services')).toBe('Registered agent Commerce Street Agent Services')
    expect(ev('layout_application', 'abc')).toBe('Identical application layout')
    expect(ev('something_else', 'x')).toBe('something else x')
  })
})

describe('routes', () => {
  it('parses every hash', () => {
    expect(parseHash('')).toMatchObject({ name: 'tasks' })
    expect(parseHash('#/pipeline')).toMatchObject({ name: 'pipeline', stage: null })
    expect(parseHash('#/pipeline/Credit')).toMatchObject({ name: 'pipeline', stage: 'Credit' })
    expect(parseHash(href.deal("Priya's Bakery"))).toMatchObject({ name: 'deal', folder: "Priya's Bakery" })
    expect(parseHash('#/tasks?as=victor.hale').query).toEqual({ as: 'victor.hale' })
    expect(parseHash('#/alerts').name).toBe('alerts')
    expect(parseHash('#/fraud').name).toBe('fraud')
    expect(parseHash('#/simulation').name).toBe('simulation')
    expect(parseHash('#/performance').name).toBe('performance')
    expect(href.performance()).toBe('#/performance')
    expect(parseHash('#/nonsense').name).toBe('tasks')
  })
})

describe('unusual-profile factors', () => {
  const MODEL_FEATURES = ['log_amount', 'amount_to_rev', 'log_revenue', 'age_years', 'round_share', 'deposit_count', 'deposit_cv', 'deposits_to_rev', 'term']
  it('has words for every feature the model scores, in both directions', () => {
    for (const f of MODEL_FEATURES) {
      expect(FACTOR_TEXT[f], f).toHaveLength(2)
      const up = factorText({ feature: f, z: 2 })
      const down = factorText({ feature: f, z: -2 })
      expect(up).not.toBe(down)
      for (const t of [up, down]) {
        expect(t).toMatch(/^[A-Z]/)
        expect(t).toContain('a bit')
        expect(t).not.toMatch(/_|\{s\}|z=/)
      }
    }
  })
  it('says "a bit" below 3 standard deviations and "much" from 3, with the sign giving the direction', () => {
    expect(factorText({ feature: 'deposit_cv', z: 7.35 })).toBe('Deposits swing much more from month to month than usual')
    expect(factorText({ feature: 'deposit_cv', z: -1.76 })).toBe('Deposits are a bit steadier month to month than usual')
    expect(factorText({ feature: 'deposits_to_rev', z: -24.14 })).toBe('Bank deposits are much lower than the stated revenue suggests')
    expect(factorText({ feature: 'round_share', z: 2.99 })).toContain('a bit')
    expect(factorText({ feature: 'round_share', z: 3 })).toContain('much')
    expect(factorText({ feature: 'mystery_metric', z: -4 })).toBe('Mystery metric is much lower than usual')
  })
  it('shows the percentile rounded down, so 98th always means the unusual line was reached', () => {
    expect(pctText(0.947)).toBe('94th')
    expect(pctText(0.955)).toBe('95th')
    expect(pctText(0.979)).toBe('97th')
    expect(pctText(0.98)).toBe('98th')
    expect(pctText(1)).toBe('100th')
    expect(pctText(0.763)).toBe('76th')
  })
  it('colours the score bar: accent below the 95th, amber from the 95th, red from the 98th', () => {
    expect(scoreColor(0.94)).toBe('#7399C6')
    expect(scoreColor(0.95)).toBe('#B7791F')
    expect(scoreColor(0.979)).toBe('#B7791F')
    expect(scoreColor(0.98)).toBe('#B42318')
  })
})

describe('relationship graph layout', () => {
  const clusters = fx.wed11.clusters
  it('reads an evidence token into the shape evidenceLabel uses', () => {
    expect(parseToken('people:preparer_phone=2145550187')).toEqual({ family: 'people', key: 'preparer_phone', value: '2145550187' })
    expect(parseToken('money:vendor_acct=metroplex equipment supply|4471')).toEqual({ family: 'money', key: 'vendor_acct', value: 'metroplex equipment supply|4471' })
    expect(evidenceLabel(parseToken('people:preparer_phone=2145550187'))).toBe('Tax preparer phone 214-555-0187')
  })
  it('places one hub and every member exactly once, inside the picture', () => {
    const g = layout(clusters, ['Granite Bay Building Supply'])
    const ids = g.nodes.filter((n) => n.kind !== 'hub').map((n) => n.id)
    expect(ids.sort()).toEqual([...clusters[0].members, 'Granite Bay Building Supply'].sort())
    expect(g.nodes.filter((n) => n.kind === 'hub')).toHaveLength(1)
    expect(g.nodes.filter((n) => n.kind === 'history').map((n) => n.id)).toEqual(['H-2608-002', 'H-2609-008'])
    expect(g.nodes.find((n) => n.id === 'Granite Bay Building Supply').kind).toBe('lone')
    for (const n of g.nodes) {
      for (const v of [n.x, n.y, n.lx, n.ly]) expect(Number.isFinite(v)).toBe(true)
      expect(n.x).toBeGreaterThan(0)
      expect(n.x).toBeLessThan(GRAPH_W)
      expect(n.ly).toBeLessThan(g.height)
      expect(n.y).toBeGreaterThan(0)
    }
  })
  it('draws a red link for every pair that shares details and a dashed link from the hub to each member', () => {
    const g = layout(clusters, [])
    expect(g.edges.filter((e) => e.kind === 'link')).toHaveLength(clusters[0].edges.length)
    expect(g.edges.filter((e) => e.kind === 'member')).toHaveLength(clusters[0].members.length)
    expect(g.loneY).toBeNull()
  })
  it('is deterministic, and grows taller when there are deals flagged on their own', () => {
    expect(layout(clusters, [])).toEqual(layout(clusters, []))
    expect(layout(clusters, ['x']).height).toBeGreaterThan(layout(clusters, []).height)
    expect(layout([], []).nodes).toEqual([])
    const two = layout([clusters[0], { ...clusters[0], members: ['A', 'B'], edges: [{ a: 'A', b: 'B', score: 9, shared: [] }] }], [])
    expect(two.nodes.filter((n) => n.kind === 'hub')).toHaveLength(2)
    expect(new Set(two.nodes.map((n) => n.key)).size).toBe(two.nodes.length)
  })
  it('lights up a node and its neighbours', () => {
    const g = layout(clusters, [])
    const hub = neighbours(g.edges, 'hub:0')
    expect(hub.size).toBe(1 + clusters[0].members.length)
    const one = neighbours(g.edges, '0:Ridgeway Freight Logistics')
    expect(one.has('0:Pecan Grove Catering')).toBe(true)
    expect(one.has('hub:0')).toBe(true)
  })
  it('shortens long labels', () => {
    expect(shortLabel('Short')).toBe('Short')
    expect(shortLabel('A'.repeat(40))).toHaveLength(30)
  })
})
