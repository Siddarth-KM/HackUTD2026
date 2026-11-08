import { useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { api } from '../lib/api'
import { fmtShort, hoursBetween, money } from '../lib/format'
import { personName, splitRequest } from '../lib/text'
import { optionSpec, requestKind } from '../lib/labels'
import { href } from '../lib/route'
import Button from './Button'
import Chip from './Chip'
import ConfirmDialog from './ConfirmDialog'
import FraudEvidence from './FraudEvidence'

export const shortRole = (r) => String(r || '').split(' — ')[0]
// Buttons appear in the order the mockup shows them (Approve, Ask for info, Decline), not the backend's list order.
const order = (kind, value) => { const i = Object.keys(kind.options).indexOf(value); return i < 0 ? 99 : i }

/**
 * One request waiting on a person, with its answer buttons. Used on My tasks and on a deal's own page.
 * testPrefix: test ids are `${testPrefix}-card-<id>`, `-note-<id>`, `-answer-<id>-<value>`, `-error-<id>`, `-evidence-<id>`.
 * onDealPage: the page header already names the deal, so say whose decision it is instead; the page shows the fraud evidence itself.
 * onAnswered(value, result): called after the server accepted the answer.
 */
export default function RequestCard({ r, deal, people, state, testPrefix = 'task', onDealPage = false, onAnswered }) {
  const { act } = useApp()
  const kind = requestKind(r.type)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(null)
  const { summary, evidence } = splitRequest(r.message, people)
  const isFraud = r.type === 'fraud_hold' || r.type === 'fraud_release'
  const body = isFraud && deal ? `Frozen at ${deal.stage || 'Intake'} until you decide. Nothing advances on this deal until you answer.` : summary
  const nudge = state.alerts.some((a) => a.deal === r.deal && a.kind === 'fraud_nudge')
  const waited = Math.floor(hoursBetween(r.at, state.now))
  const id = (part) => `${testPrefix}-${part}-${r.id}`

  const chips = []
  if (r.urgent) chips.push(<Chip key="u" tone="risk">Urgent</Chip>)
  if (r.on_behalf_of) chips.push(<Chip key="b" tone="blue">Covering for {personName(r.on_behalf_of, people)} (out of office)</Chip>)
  if (isFraud) {
    chips.push(<Chip key="f" tone="risk">Deal frozen</Chip>)
    if (nudge) chips.push(<Chip key="n" tone="warn">Unanswered {waited}h · escalated</Chip>)
    const linked = deal?.fraud?.linked_deals?.length || 0
    if (linked && deal.fraud.sources.includes('CROSS_DEAL')) chips.push(<Chip key="g" tone="risk">Part of a {linked + 1}-deal group</Chip>)
  } else if (deal?.sla?.pct >= 100) {
    chips.push(<Chip key="p" tone="warn">Past time limit</Chip>)
  }
  if (deal?.anomaly?.unusual) chips.push(<Chip key="a" tone="gray">Unusual profile: for information only</Chip>)

  const submit = async (value) => {
    setConfirm(null)
    const res = await act(() => api(`/humans/${r.id}/answer`, { answer: value, note }))
    if (res?.ok && onAnswered) onAnswered(value, res.value)
  }
  const choose = (value) => {
    const spec = optionSpec(r.type, value)
    if ((kind.noteRequired || []).includes(value) && !note.trim()) {
      setErr('Please write what you need from the borrower in the note box first.')
      return
    }
    setErr('')
    if (spec.confirm) setConfirm({ value, ...spec.confirm })
    else submit(value)
  }
  const who = people[r.to] || { name: r.to, role: '' }

  return (
    <article className="card flex flex-col gap-3.5 px-6 py-[22px]" data-testid={id('card')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label !text-link">{kind.label}</span>
        {chips}
        <span className="ml-auto text-[13px] text-label">Received {fmtShort(r.at)}</span>
      </div>
      {onDealPage ? (
        <div className="text-[15px] text-text2" data-testid={id('who')}>
          Waiting on <b className="font-semibold text-ink">{who.name}</b>{who.role ? ` · ${shortRole(who.role)}` : ''}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <a href={href.deal(r.deal)} data-testid={id('deal')} className="serif text-[24px] font-semibold !text-ink no-underline hover:underline">{deal?.name || r.deal}</a>
          {deal && <span className="text-[16px] font-semibold">{money(deal.amount)}</span>}
          {deal && <span className="text-[14px] text-label">RM {personName(deal.rm, people)}</span>}
        </div>
      )}
      <p className="m-0 text-[15px] leading-relaxed text-text2">{body}</p>
      {isFraud && !onDealPage && (
        <div className="flex flex-col gap-2.5 border border-[#F0D2CE] bg-[#FBF4F3] px-4 py-3.5" data-testid={id('evidence')}>
          <span className="label !text-[#9B1C12]">Why it was flagged</span>
          <FraudEvidence folder={r.deal} deal={deal} state={state} people={people} fallback={evidence} />
        </div>
      )}
      {isFraud && onDealPage && <p className="m-0 text-[14px] text-label">See the fraud evidence below.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[240px] flex-[1_1_280px] flex-col gap-1.5">
          <label className="label" htmlFor={`${testPrefix}-note-input-${r.id}`}>{kind.noteLabel}</label>
          <input id={`${testPrefix}-note-input-${r.id}`} data-testid={id('note')} className="field w-full" placeholder="Optional note for the file" value={note}
                 onChange={(e) => { setNote(e.target.value); setErr('') }} />
        </div>
        <div className="flex flex-wrap gap-2.5">
          {[...r.options].sort((a, b) => order(kind, a) - order(kind, b)).map((value) => {
            const spec = optionSpec(r.type, value)
            return <Button key={value} kind={spec.style} data-testid={`${testPrefix}-answer-${r.id}-${value}`} onClick={() => choose(value)}>{spec.label}</Button>
          })}
        </div>
      </div>
      {err && <p role="alert" data-testid={id('error')} className="m-0 text-[13px] font-semibold text-[#9B1C12]">{err}</p>}
      <ConfirmDialog open={!!confirm} title={confirm?.title} body={confirm?.body} okLabel={confirm?.ok}
                     tone={confirm?.value === 'approve' ? 'primary' : 'risk'}
                     onConfirm={() => submit(confirm.value)} onCancel={() => setConfirm(null)} />
    </article>
  )
}
