// Plain-English names for everything the backend reports in codes. One place, so wording stays consistent.
import { fmtShort, monthName, MONTHS, money } from './format'

export const STAGES = ['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed']
export const BOARD_COLUMNS = [...STAGES, 'Stopped']
export const STEP_LABEL = {
  Intake: 'Step 1', Credit: 'Step 2', Committee: 'Step 3', Product: 'Step 4', Committed: 'Step 5', Closed: 'Step 6',
  Stopped: 'Declined or held',
}

export const prettify = (s) => String(s || '').replace(/[_:]+/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
export const titleCase = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase())

// ------------------------------------------------------------------ stages
export function stageOf(deal) {
  if (deal.status === 'declined' || deal.status === 'held') return 'Stopped'
  return deal.stage || 'Intake'
}

export function stageNote(stage, people = {}) {
  switch (stage) {
    case 'Intake': return 'documents checked automatically, no human sign-off'
    case 'Credit': return 'a credit officer decides'
    case 'Committee': {
      const find = (needle) => Object.values(people).find((p) => (p.role || '').includes(needle))?.name
      const small = find('delegated approver')
      const big = find('Committee Chair')
      return small && big
        ? `approver chosen by amount: under $250,000 ${small}, otherwise ${big}`
        : 'approver chosen by the loan amount'
    }
    case 'Product': return 'vendor and pricing checked automatically'
    case 'Committed': return 'the relationship manager issues the commitment letter and gets it signed'
    case 'Closed': return 'the funding officer releases the money'
    case 'Stopped': return 'deals that were declined or stopped'
    default: return ''
  }
}

// ------------------------------------------------------------------ SLA bar (alert at 100%, escalate at 150%)
export function slaView(sla) {
  if (!sla) return null
  const pct = sla.pct
  return {
    pct,
    width: `${Math.min(pct, 200) / 2}%`,
    color: pct >= 150 ? '#B42318' : pct >= 100 ? '#B7791F' : '#7399C6',
    caption: `${sla.elapsed}h in stage of ${sla.hours}h allowed (${pct}%)`,
    short: `${sla.elapsed}h of ${sla.hours}h · ${pct}%`,
  }
}

// ------------------------------------------------------------------ documents
export const DOC_LABELS = {
  application: 'Loan application',
  guarantor_id: "Guarantor's photo ID",
  certificate_of_formation: 'Certificate of formation',
  ein_letter: 'IRS EIN letter',
  financial_statements: 'Financial statements',
  tax_return: 'Business tax return',
  extension_7004: 'Tax extension (Form 7004)',
  request_letter: 'Request letter',
  bank_statement: 'Bank statement',
  equipment_quote: 'Vendor quote',
  collections_notice: 'Collections notice',
  other: 'Other document',
}
export const docLabel = (t) => DOC_LABELS[t] || prettify(t)

// ------------------------------------------------------------------ issues
export const OLD_TRICKS = {
  STMT_TAMPER: 'Bank statement does not add up',
  REV_INFLATION: 'Revenue inflated',
  ID_MISMATCH: 'ID does not match',
  DUP_EIN: 'EIN used by another business',
  SHELL_ADDRESS: 'Mailbox address',
}
export const oldTrickTitle = (c) => OLD_TRICKS[c] || prettify(c)

const MISMATCH_TITLES = {
  legal_name: 'Business name differs between documents',
  ein: 'EIN differs between documents',
  amount_requested: 'Loan amount differs between documents',
  guarantor_name: "Guarantor's name differs between documents",
  guarantor_dob: "Guarantor's date of birth differs between documents",
  guarantor_address: "Guarantor's address differs between documents",
  annual_revenue: 'Revenue differs between documents',
  bank_balance: 'Bank balance differs between documents',
}

const SHORT_MISSING = { equipment_quote: 'Quote missing', tax_return: 'Tax return missing' }

function split(code) {
  const i = String(code).indexOf(':')
  return i < 0 ? [code, ''] : [code.slice(0, i), code.slice(i + 1)]
}

export function issueTitle(code) {
  const [kind, rest] = split(code)
  if (kind === 'MISSING_DOC') {
    const m = /^bank_statement_(\d{4}-\d{2})$/.exec(rest)
    return m ? `Bank statement missing: ${monthName(m[1])}` : `${docLabel(rest)} missing`
  }
  if (kind === 'MISSING_PAGE') {
    const m = /^bank_statement_(\d{4}-\d{2})$/.exec(rest)
    return m ? `Statement page missing: ${monthName(m[1])}` : 'Page missing'
  }
  if (kind === 'MISMATCH') return MISMATCH_TITLES[rest] || `${prettify(rest)} differs between documents`
  if (kind === 'OLD_TRICK') return oldTrickTitle(rest)
  if (kind === 'EXTRACTION_UNVERIFIED') return 'A number could not be verified against the document'
  return prettify(code)
}

/** Short wording for a chip. `short` is the compact board-card form. */
export function issueChipText(code, short) {
  const [kind, rest] = split(code)
  if (kind === 'MISSING_DOC') {
    const m = /^bank_statement_(\d{4}-\d{2})$/.exec(rest)
    if (m) return `${MONTHS[Number(m[1].slice(5)) - 1]} statement missing`
    return short && SHORT_MISSING[rest] ? SHORT_MISSING[rest] : `${docLabel(rest)} missing`
  }
  if (kind === 'MISSING_PAGE') return 'Statement page missing'
  if (kind === 'MISMATCH') return rest === 'amount_requested' ? 'Amount mismatch' : 'Details mismatch'
  if (kind === 'OLD_TRICK') return oldTrickTitle(rest)
  return issueTitle(code)
}

const issueRank = (c) => (c.startsWith('MISMATCH') ? 0 : c.startsWith('MISSING') ? 1 : 2)

/** Chips for a deal card. Same rules for the board (short, first two shown) and the stage view (all, full wording). */
export function chipsFor(deal, { short = false } = {}) {
  const chips = []
  const f = deal.fraud || {}
  const active = f.flagged && !f.released
  if (deal.status === 'funded') chips.push({ text: 'Funded', tone: 'ok' })
  if (deal.status === 'declined') chips.push({ text: 'Declined', tone: 'warn' })
  if (active) {
    chips.push({ text: short ? 'Frozen: fraud' : 'Frozen: fraud review', tone: 'risk' })
    const tricks = (deal.issues || []).filter((c) => c.startsWith('OLD_TRICK'))
    if ((f.sources || []).includes('CROSS_DEAL') && (f.linked_deals || []).length) {
      chips.push({ text: `Linked to ${f.linked_deals.length} deals`, tone: 'risk' })
    }
    if (short && tricks.length) chips.push({ text: tricks.length === 1 ? issueChipText(tricks[0]) : `Failed ${tricks.length} checks`, tone: 'risk' })
    if (!short) tricks.forEach((c) => chips.push({ text: issueChipText(c), tone: 'risk' }))
  }
  ;(deal.issues || [])
    .filter((c) => !c.startsWith('OLD_TRICK'))
    .sort((a, b) => issueRank(a) - issueRank(b))
    .forEach((c) => chips.push({ text: issueChipText(c, short), tone: 'warn' }))
  if (deal.needed_by && deal.status === 'active') chips.push({ text: `Urgent · ${fmtShort(deal.needed_by)}`, tone: 'risk' })
  if (deal.anomaly?.unusual) chips.push({ text: short ? 'Unusual profile (info)' : 'Unusual profile (info only)', tone: 'gray' })
  if (!chips.length) chips.push({ text: 'No open issues', tone: 'ok' })
  return chips
}

/** What a deal is waiting for, in words. */
export function waitText(deal, people = {}, short = false) {
  if (deal.status === 'funded') return 'Funds released'
  if (deal.status === 'declined') return 'Deal declined'
  const raw = deal.waiting_on || ''
  if (deal.frozen) {
    const id = /\(([a-z]+\.[a-z]+)\)/.exec(raw)?.[1]
    const who = people[id]?.name || ''
    return short ? `Fraud Ops decision${who ? ` (${who})` : ''}` : `Fraud Operations decision on the hold request${who ? ` (${who})` : ''}`
  }
  if (!raw) return 'Moving through the stage'
  return raw
}

// ------------------------------------------------------------------ human requests
export const REQUEST_KINDS = {
  credit_decision: {
    label: 'Credit decision', plural: 'credit decisions', noteLabel: 'Note (needed if you ask for more info)', noteRequired: ['request_info'],
    options: {
      approve: { label: 'Approve', style: 'primary' },
      request_info: { label: 'Ask borrower for more info', style: 'outline' },
      decline: { label: 'Decline', style: 'risk', confirm: { title: 'Decline this loan?', body: 'The deal stops here and moves to Stopped. This cannot be undone.', ok: 'Decline loan' } },
    },
  },
  committee_approval: {
    label: 'Committee approval', plural: 'committee approvals', noteLabel: 'Note for the file',
    options: {
      approve: { label: 'Approve', style: 'primary' },
      decline: { label: 'Decline', style: 'risk', confirm: { title: 'Decline this loan?', body: 'The deal stops here and moves to Stopped. This cannot be undone.', ok: 'Decline loan' } },
    },
  },
  commitment_signoff: {
    label: 'Commitment letter sign-off', plural: 'commitment sign-offs', noteLabel: 'Note for the file',
    options: {
      approve: { label: 'Confirm letter signed', style: 'primary' },
      decline: { label: 'Decline', style: 'risk', confirm: { title: 'Stop this loan?', body: 'The deal stops here and moves to Stopped. This cannot be undone.', ok: 'Stop loan' } },
    },
  },
  funding_release: {
    label: 'Funding release', plural: 'funding releases', noteLabel: 'Note for the file',
    options: {
      approve: { label: 'Release funds', style: 'primary', confirm: { title: 'Release the money?', body: 'This sends the funds. It cannot be undone.', ok: 'Release funds' } },
      decline: { label: 'Decline', style: 'risk', confirm: { title: 'Decline funding?', body: 'The deal stops here and moves to Stopped. This cannot be undone.', ok: 'Decline funding' } },
    },
  },
  fraud_hold: {
    label: 'Fraud hold', plural: 'fraud holds', noteLabel: 'Note for Fraud Operations',
    options: {
      hold: { label: 'Place hold', style: 'riskSolid' },
      release: { label: 'Release: deal is genuine', style: 'outline', confirm: { title: 'Release this deal?', body: 'The deal is cleared and continues through the process.', ok: 'Release deal' } },
    },
  },
  fraud_release: {
    label: 'Fraud release', plural: 'fraud releases', noteLabel: 'Note for Fraud Operations',
    options: {
      release: { label: 'Release the hold', style: 'outline', confirm: { title: 'Release the hold?', body: 'The deal is cleared and continues through the process.', ok: 'Release hold' } },
      keep_hold: { label: 'Keep the hold', style: 'riskSolid' },
    },
  },
}
export const requestKind = (type) => REQUEST_KINDS[type] || { label: prettify(type), plural: 'requests', noteLabel: 'Note', options: {} }
export const optionSpec = (type, value) => requestKind(type).options[value] || { label: prettify(value), style: 'outline' }

// ------------------------------------------------------------------ fraud evidence
export const FAMILY_NAMES = { money: 'Money rails', numeric: 'Number patterns', people: 'People', provenance: 'Document source' }
export const familyName = (f) => FAMILY_NAMES[f] || prettify(f)

const DAYS = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' }
const phone = (d) => (/^\d{10}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d)

/** One shared rare attribute, in words. */
export function evidenceLabel(ev) {
  const v = String(ev.value ?? '')
  switch (ev.key) {
    case 'preparer_phone': return `Tax preparer phone ${phone(v)}`
    case 'preparer': return `Tax preparer ${titleCase(v)}`
    case 'agent': return `Registered agent ${titleCase(v)}`
    case 'agent_addr': return `Registered agent address ${titleCase(v)}`
    case 'vendor_acct': { const [n, l] = v.split('|'); return `Vendor bank account …${l} (${titleCase(n)})` }
    case 'remit': return `Vendor bank account …${v}`
    case 'remit_full': { const [r, l] = v.split('|'); return `Vendor payment account (routing ${r}, …${l})` }
    case 'round_deposit_share': { const [a, b] = v.split('-'); return `${a} to ${b}% of deposits are round-dollar amounts` }
    case 'deposit_days': return `Deposits only on ${v.split(',').map((d) => DAYS[d] || d).join(' and ')}`
    case 'month_total': return `Identical monthly deposit total ${money(v)}`
    case 'producer': return `Documents made with ${v}`
    case 'creator': return `Documents created with ${v}`
    case 'stmt_producer': return `Bank statements made with ${v}`
    case 'single_tool': return `Every file made with ${v}`
    case 'near_limit': { const m = /^(\d+)k$/.exec(v); return `Amount just under the ${m ? `$${m[1]},000` : v} limit` }
    case 'dl': return `Same driver's license number ${v}`
    case 'ssn4_dob': return 'Same SSN last 4 and date of birth'
    case 'person': return `Same person: ${titleCase(v)}`
    case 'biz_addr': return `Business address ${titleCase(v)}`
    case 'home_addr': return `Guarantor home address ${titleCase(v)}`
    case 'phone': return `Phone number ${phone(v)}`
    case 'email_domain': return `Email domain ${v}`
    case 'bank': return `Bank ${titleCase(v)}`
    case 'acct': return `Operating account ${v.replace('|', ' …')}`
    case 'lookalike_vendor': return `Vendor name that imitates a known vendor: ${titleCase(v)}`
    default:
      if (String(ev.key).startsWith('layout_')) return `Identical ${ev.key.slice(7).replace(/_/g, ' ')} layout`
      return `${String(ev.key).replace(/_/g, ' ')} ${v}`
  }
}

export const FEATURE_WORDS = {
  deposit_cv: 'deposits vary a lot from month to month',
  deposits_to_rev: 'bank deposits are far from the stated revenue',
  log_amount: 'the loan is large compared with the bank’s usual loans',
}
export const featureWords = (f) => FEATURE_WORDS[f] || String(f).replace(/_/g, ' ')
