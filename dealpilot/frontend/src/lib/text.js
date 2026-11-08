// Turns the backend's engineering-style sentences into plain words for a loan officer.
// Everything here is deterministic string cleanup: ids become names, ISO times become "Tue 9:20 AM", month codes become
// "June 2026". Text it does not recognise is left exactly as the backend wrote it.
import { fmtShort, MONTHS } from './format'
import { oldTrickTitle } from './labels'

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g

export function personName(id, people = {}) {
  return people[id]?.name || id || ''
}

export function cap(s) {
  const t = String(s || '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** ids -> names, ISO timestamps -> "Tue 9:20 AM", "2026-06" -> "June 2026" */
export function humanize(text, people = {}) {
  if (!text) return ''
  let t = String(text)
  t = t.replace(/\b([a-z]+\.[a-z]+)\b/g, (m, id) => people[id]?.name || m)
  t = t.replace(ISO, (m) => fmtShort(m) || m)
  t = t.replace(/\b(20\d{2})-(0[1-9]|1[0-2])\b(?!-)/g, (m, y, mo) => `${MONTHS[Number(mo) - 1]} ${y}`)
  t = t.replace(/page\(s\) \[([\d, ]+)\] of (\d+)/g, (m, p, n) => `page ${p.trim()} of ${n}`)
  return t
}

/**
 * Splits a human-request message into the part worth reading and the "why it was flagged" evidence.
 * The head ("Credit decision needed for X (RM y).", "(Routed to you because ...)", "Options: ...") is dropped because the
 * screen already shows those facts as labels, chips and buttons.
 */
export function splitRequest(message, people = {}) {
  let m = String(message || '').replace(/^URGENT - /, '')
  m = m.replace(/\s*Options:.*$/s, '')
  let evidence = ''
  const w = m.indexOf(' Why: ')
  if (w >= 0) {
    evidence = m.slice(w + 6).replace(/\s*Reply '[^']*'.*$/s, '').trim()
    m = m.slice(0, w)
  }
  m = m.replace(/^.*?\(RM [^)]*\)\.\s*/s, '')
  m = m.replace(/\(Routed to you because[^)]*\)\s*/, '')
  m = m.replace(/Known-fraud checks have been run \([^)]*\)\.?\s*/, '')
  m = m.replace(/ML watch score:.*?\)\.\s*/s, '')                       // shown as a chip instead, never jargon in the text
  m = m.replace(/\s*\(old-trick checks and cross-deal check\)/, '')
  m = m.replace(/^Request:\s*/, '')
  return { summary: humanize(m.trim(), people), evidence: humanize(evidence, people) }
}

/** Evidence text -> paragraphs; "OLD_TRICK:STMT_TAMPER: ..." becomes a titled paragraph. */
export function evidenceParagraphs(text, people = {}) {
  const raw = String(text || '').trim()
  if (!raw) return []
  return raw
    .split(/\s*(?=OLD_TRICK:)/)
    .map((chunk) => {
      const m = /^OLD_TRICK:([A-Z_]+):\s*(.*)$/s.exec(chunk.trim())
      if (m) return { title: oldTrickTitle(m[1]), body: humanize(m[2].trim(), people) }
      return { title: '', body: humanize(chunk.trim(), people) }
    })
    .filter((p) => p.body || p.title)
}

/** The things we asked the borrower for, as a list. */
export function borrowerItems(message, people = {}) {
  let t = String(message || '')
  const i = t.indexOf('following.')
  if (i >= 0) t = t.slice(i + 'following.'.length)
  t = t.replace(/\s*You told us funds are needed by.*$/s, '')
  return t
    .split(/\(\d+\)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => humanize(s.replace(/\s*Please send it\.?$/, '').replace(/\.$/, ''), people))
}

const ALERT_PREFIX = /^(STILL AT RISK - )?(DEADLINE AT RISK|STUCK DEAL|SECOND ESCALATION \(200% of SLA\)|ESCALATION \(150% of SLA\)|FRAUD HOLD UNANSWERED for \d+h):\s*/i

export function alertBody(message, people = {}) {
  return humanize(String(message || '').replace(ALERT_PREFIX, ''), people)
}

export const ALERT_KINDS = {
  stuck: 'Stuck deal',
  deadline_risk: 'Deadline at risk',
  fraud_nudge: 'Fraud hold unanswered',
}
