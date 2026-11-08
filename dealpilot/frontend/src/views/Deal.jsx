import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { api } from '../lib/api'
import { fmtClock, fmtShort, money, plural } from '../lib/format'
import { ALERT_KINDS, alertBody, borrowerItems, cap, humanize, personName, splitRequest } from '../lib/text'
import FraudEvidence from '../components/FraudEvidence'
import { STAGES, answerDone, docLabel, factorText, issueTitle, pctText, requestKind, slaView, waitText } from '../lib/labels'
import { href } from '../lib/route'
import Button from '../components/Button'
import Chip from '../components/Chip'
import SlaBar from '../components/SlaBar'
import RequestCard from '../components/RequestCard'

const DECISION = { advanced: 'advanced', waiting: 'waiting', in_progress: 'in progress', declined: 'declined', held: 'held', 'funds disbursed': 'funds sent' }
const DOT = { advanced: '#2E7D4F', 'funds disbursed': '#2E7D4F', waiting: '#B7791F', in_progress: '#7399C6', declined: '#B42318', held: '#B42318' }
const VENDOR_STATUS = { known: 'known vendor', new: 'new to the bank', lookalike: 'looks like a known vendor but a different account' }

function groupDocs(docs) {
  const sorted = [...docs].sort((a, b) => String(a.arrived).localeCompare(String(b.arrived)))
  const stmts = sorted.filter((d) => d.type === 'bank_statement')
  const rows = sorted.filter((d) => d.type !== 'bank_statement').map((d) => ({ key: d.file, type: docLabel(d.type), file: d.file, tool: d.producer || '', warnings: d.warnings || [], legible: d.legible }))
  if (stmts.length) {
    rows.push({
      key: 'statements', type: `Bank statements (${stmts.length})`, tool: stmts[0].producer || '', legible: stmts.every((s) => s.legible),
      file: stmts.length === 1 ? stmts[0].file : `${stmts.length} files: ${stmts[0].file} … ${stmts[stmts.length - 1].file}`,
      warnings: stmts.flatMap((s) => s.warnings || []),
    })
  }
  return rows
}

function factRows(d, people) {
  const f = d.facts || {}
  const rows = [
    ['Legal name', f.legal_name], ['Also known as', f.dba], ['EIN', f.ein],
    ['Amount', f.amount_requested != null && money(f.amount_requested)], ['Product', f.product],
    ['Purpose', [f.purpose_category && cap(f.purpose_category), f.purpose].filter(Boolean).join(': ')],
    ['Term', f.term_months && `${f.term_months} months`], ['Guarantor', f.guarantor_name],
    ['Stated revenue', f.annual_revenue_stated != null && money(f.annual_revenue_stated)],
    ['Funds needed by', f.needed_by && fmtClock(f.needed_by)], ['Address', f.business_address],
    ['Registered agent', f.registered_agent], ['Preparer', [f.preparer_name, f.preparer_firm].filter(Boolean).join(' · ')],
  ]
  if (f.equipment_vendor) rows.push(['Vendor', `${f.equipment_vendor} (${VENDOR_STATUS[d.vendor_status] || d.vendor_status}) …${f.vendor_account_last4}`])
  else if (f.product === 'Equipment Loan') rows.push(['Vendor', 'None on file yet'])
  rows.push(['Relationship manager', personName(d.rm, people)], ['Applicant note', f.applicant_notes])
  return rows.filter((r) => r[1])
}

function Section({ title, right, children, id }) {
  return (
    <section className="flex flex-col gap-3.5" data-testid={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2 !text-[24px]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export default function Deal() {
  const { state, route, act } = useApp()
  const folder = route.folder
  const enc = encodeURIComponent(folder)
  const people = state.people
  const [d, setD] = useState(null)
  const [missing, setMissing] = useState(false)
  const [done, setDone] = useState('')
  const [memoMsg, setMemoMsg] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    api(`/deals/${enc}`)
      .then((x) => { if (mine === seq.current) { setMissing(false); setD((p) => (JSON.stringify(p) === JSON.stringify(x) ? p : x)) } })
      .catch(() => { if (mine === seq.current) setMissing(true) })
  }, [enc, state])

  const events = useMemo(() => {
    if (!d) return []
    const reqs = d.requests.map((r) => ({
      key: `r${r.id}`, at: r.at,
      kind: r.type === 'info_request' ? 'Borrower request' : requestKind(r.type).label,
      tone: r.type.startsWith('fraud') ? 'risk' : 'blue',
      to: r.to === 'borrower' ? 'Borrower' : personName(r.to, people),
      text: r.type === 'info_request' ? borrowerItems(r.message, people).join('; ') : splitRequest(r.message, people).summary.slice(0, 260),
      status: r.answer ? { tone: 'ok', text: `${r.answer.replace('_', ' ')} · ${fmtShort(r.answered_at)}` }
        : r.type === 'info_request' ? { tone: 'gray', text: 'Awaiting documents' } : { tone: 'warn', text: 'Pending' },
    }))
    const als = d.alerts.map((a, i) => ({
      key: `a${i}${a.at}`, at: a.at, kind: a.level === 'escalation' ? 'Escalation' : 'Alert', tone: a.level === 'escalation' ? 'risk' : 'warn',
      to: personName(a.to, people) + (a.cc?.length ? ` (copied: ${a.cc.map((c) => personName(c, people)).join(', ')})` : ''),
      text: alertBody(a.message, people), status: null,
    }))
    return [...reqs, ...als].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }, [d, people])

  if (missing && !d) {
    return (
      <main className="mx-auto max-w-[1360px] px-8 py-16" data-testid="deal-missing">
        <p className="text-[16px] text-muted">We could not find that deal. <a href={href.pipeline()} data-testid="deal-missing-back">Back to the pipeline</a></p>
      </main>
    )
  }
  if (!d) return <p className="mx-auto max-w-[1360px] px-8 py-16 text-[16px] text-muted" data-testid="deal-loading">Opening the deal…</p>

  const f = d.facts || {}
  const sla = slaView(d.sla)
  const blockingNow = d.findings.filter((x) => x.blocking_now)
  const idx = STAGES.indexOf(d.stage)
  const funded = d.status === 'funded'
  const stepState = (i) => {
    if (funded || i < idx) return { text: 'Done', bar: '#2E7D4F', color: '#0A1F44' }
    if (i === idx) {
      if (d.status === 'declined' || d.status === 'held') return { text: d.status === 'declined' ? 'Declined' : 'Held', bar: '#B42318', color: '#0A1F44' }
      if (d.frozen) return { text: 'Frozen: fraud review', bar: '#B42318', color: '#0A1F44' }
      if (blockingNow.length) return { text: 'Waiting on borrower', bar: '#7399C6', color: '#0A1F44' }
      return { text: 'In progress', bar: '#7399C6', color: '#0A1F44' }
    }
    return { text: '', bar: '#D9DEE5', color: '#5A6577' }
  }
  const fraudPill = d.fraud.flagged
    ? (d.fraud.confirmed ? ['risk', 'Fraud hold confirmed'] : d.fraud.released ? ['ok', 'Fraud hold released'] : ['risk', 'Awaiting Fraud Ops decision'])
    : ['ok', 'No fraud flag']
  const lastAlert = [...d.alerts].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
  const exited = d.log.filter((e) => e.exited_at).length
  const linked = (d.fraud.linked_deals || []).map((id) => ({ id, deal: state.deals.find((x) => x.folder === id) }))

  const accept = async (body) => {
    setDone(''); setMemoMsg('')
    const r = await act(() => api(`/deals/${enc}/override`, body))
    if (r.ok) { setDone(r.value.result.message); setD(r.value.deal) }
  }
  const writeMemos = async () => {
    setDone(''); setMemoMsg('')
    const r = await act(() => api(`/deals/${enc}/memos`, {}))
    if (!r.ok) return
    setD(r.value)
    setMemoMsg(exited === 0 ? 'There are no finished stages to write notes about yet.'
      : r.value.memos_ok ? 'Stage notes are written below.' : "Gemini isn't available right now, so no notes were written.")
  }

  // Requests waiting on a person for this deal: answer them right here instead of going back to My tasks.
  const waiting = state.pending.filter((r) => r.deal === folder).sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const live = state.deals.find((x) => x.folder === folder)
  const answered = (r) => (value, result) => {
    setMemoMsg('')
    const after = result?.state?.deals?.find((x) => x.folder === folder)
    setDone(answerDone(r.type, value, { name: live?.name || d.name, stage: d.stage, status: d.status }, after))
  }

  const facts = factRows(d, people)
  const docs = groupDocs(d.docs)

  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-8 pb-[72px] pt-7" data-testid="view-deal">
      <a href={href.pipeline()} data-testid="deal-back" className="inline-flex items-center gap-1.5 text-[14px] no-underline hover:underline">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>Back to pipeline
      </a>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" data-testid="deal-chips">
          <Chip tone="blue" data-testid="deal-stage-chip">{d.status === 'active' ? d.stage : d.status === 'funded' ? 'Funded' : cap(d.status)}</Chip>
          <Chip tone={fraudPill[0]} data-testid="deal-fraud-chip">{fraudPill[1]}</Chip>
          {blockingNow.length > 0 && <Chip tone="warn">Waiting on borrower</Chip>}
          {d.needed_by && d.status === 'active' && <Chip tone="risk">Urgent · funds needed {fmtShort(d.needed_by)}</Chip>}
        </div>
        <h1 className="h1" data-testid="page-title">{f.legal_name || d.name}</h1>
        <p className="m-0 text-[16px] text-muted">
          {[money(d.amount), f.product, f.term_months && `${f.term_months} months`, `RM ${personName(d.rm, people)}`, f.guarantor_name && `Guarantor ${f.guarantor_name}`].filter(Boolean).join(' · ')}
        </p>
      </section>

      <ol aria-label="Progress" className="m-0 flex list-none flex-wrap p-0" data-testid="deal-stepper">
        {STAGES.map((s, i) => {
          const st = stepState(i)
          return (
            <li key={s} data-testid={`deal-step-${s}`} className="flex flex-[1_1_140px] flex-col gap-0.5 border-r border-hair bg-white px-3.5 py-3" style={{ borderTop: `4px solid ${st.bar}` }}>
              <span className="label">Step {i + 1}</span>
              <span className="text-[15px] font-semibold" style={{ color: st.color }}>{s}</span>
              <span className="text-[12px] text-label">{st.text}</span>
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-7">
          {waiting.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="deal-decisions" aria-label="Decisions waiting on this deal">
              <span className="label !text-link">{waiting.length === 1 ? 'Decision waiting' : `${waiting.length} decisions waiting`}</span>
              {waiting.map((r) => (
                <RequestCard key={r.id} r={r} deal={live} people={people} state={state} testPrefix="deal-req" onDealPage onAnswered={answered(r)} />
              ))}
            </section>
          )}

          {done && <div role="status" data-testid="deal-done" className="border border-[#BFDCCB] bg-[#E4F2EA] px-[18px] py-3.5 text-[14px] leading-relaxed text-[#1B4D31]"><b>Done.</b> {done}</div>}

          <div className="flex flex-col gap-2.5 border border-mist-edge bg-mist px-6 py-[22px]" data-testid="deal-now">
            <span className="label !text-link">Right now</span>
            <p className="m-0 text-[17px] font-medium leading-snug text-ink">{funded ? 'Funds have been released.' : cap(humanize(waitText(d, people), people))}</p>
            {d.status === 'active' && blockingNow.length > 0 && !d.frozen && (
              <p className="m-0 text-[14px] leading-relaxed text-muted" data-testid="deal-unblock">To unblock: the borrower sends or clarifies the item{blockingNow.length > 1 ? 's' : ''} listed under Issues, or you accept {blockingNow.length > 1 ? 'them' : 'it'} there.</p>
            )}
            {d.status === 'active' && d.unblock && !(blockingNow.length > 0 && !d.frozen) && <p className="m-0 text-[14px] leading-relaxed text-muted" data-testid="deal-unblock">{cap(humanize(d.unblock, people))}</p>}
            {sla && d.status === 'active' && <div className="mt-1"><SlaBar view={sla} caption={sla.caption} track="#D5DFEC" captionClass="text-[12px] text-muted" /></div>}
            {lastAlert && d.status === 'active' && <p className="m-0 text-[13px] text-muted">Latest alert: {ALERT_KINDS[lastAlert.kind] || 'Alert'} sent to {personName(lastAlert.to, people)}, {fmtShort(lastAlert.at)}.</p>}
          </div>

          {d.fraud.flagged && (
            <section className="flex flex-col gap-3 border border-[#F0D2CE] bg-[#FBF4F3] px-6 py-[22px]" data-testid="deal-fraud">
              <span className="label !text-[#9B1C12]">Fraud review</span>
              <FraudEvidence folder={d.folder} deal={d} state={state} people={people} />
              {linked.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label">Linked deals</span>
                  {linked.map(({ id, deal }) => deal
                    ? <a key={id} href={href.deal(id)} data-testid={`deal-linked-${id}`} className="chip chip-risk no-underline">{deal.name}</a>
                    : <Chip key={id} tone="gray" title="Funded earlier">{id}</Chip>)}
                </div>
              )}
            </section>
          )}

          <Section id="deal-issues" title="Issues" right={<span className="text-[13px] text-label">Missing or mismatched papers never reject a deal. Accepting an issue lets the deal continue without it.</span>}>
            {blockingNow.length >= 2 && (
              <div>
                <Button kind="primary" data-testid="deal-accept-all" onClick={() => accept({ all_stage: true })}>
                  Accept all {blockingNow.length} open issues for {d.stage} and continue
                </Button>
              </div>
            )}
            {d.findings.length === 0 && <div className="card p-5 text-[14px] text-muted" data-testid="deal-no-issues">No open issues. Everything the current stage needs is here.</div>}
            {d.findings.map((x) => {
              const isTrick = x.code.startsWith('OLD_TRICK')
              const chip = x.accepted ? ['ok', 'Accepted']
                : x.blocking_now ? ['warn', `Blocking ${x.stage} now`]
                  : x.later ? ['gray', `Blocks ${x.stage} (step ${STAGES.indexOf(x.stage) + 1})`]
                    : isTrick ? ['risk', 'Fraud check failed'] : ['gray', 'Informational']
              return (
                <article key={x.code} className="card flex flex-col gap-2 px-[22px] py-[18px]" data-testid={`deal-issue-${x.code}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold text-ink">{issueTitle(x.code)}</span>
                    <Chip tone={chip[0]}>{chip[1]}</Chip>
                  </div>
                  <p className="m-0 text-[14px] leading-relaxed text-text2">{cap(humanize(x.text, people))}</p>
                  {x.evidence && <p className="m-0 bg-page px-3 py-2 text-[14px] text-muted">{humanize(x.evidence, people)}</p>}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                    <code className="text-[12px] text-label">{x.code}</code>
                    {x.blocking_now && <Button kind="primary" data-testid={`deal-accept-${x.code}`} onClick={() => accept({ code: x.code })}>Accept and continue</Button>}
                    {x.later && <Button data-testid={`deal-accept-${x.code}`} onClick={() => accept({ code: x.code })}>Accept now (applies at {x.stage})</Button>}
                  </div>
                </article>
              )
            })}
          </Section>

          {d.watch.length > 0 && (
            <Section id="deal-watch" title="Watch notes">
              <div className="card px-6 py-4">
                <p className="m-0 mb-2 text-[13px] text-label">For information. These never block a deal on their own.</p>
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-text2">{d.watch.map((w) => <li key={w}>{humanize(w, people)}</li>)}</ul>
              </div>
            </Section>
          )}

          <Section id="deal-history" title="Stage history" right={<Button data-testid="deal-memos" onClick={writeMemos}>Write stage notes with Gemini</Button>}>
            {memoMsg && <div role="status" data-testid="deal-memo-msg" className="border border-mist-edge bg-mist px-4 py-3 text-[14px] text-ink">{memoMsg}</div>}
            <div className="card px-[22px] py-1.5">
              {d.log.map((e, i) => (
                <div key={i} className="flex gap-4 border-b border-hair py-3.5 last:border-b-0" data-testid={`deal-log-${e.stage}`}>
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[e.decision] || '#7399C6' }} aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold text-ink">{e.stage} · {DECISION[e.decision] || e.decision}</span>
                    <span className="text-[13px] text-label">{e.exited_at ? `${fmtShort(e.entered_at)} to ${fmtShort(e.exited_at)}` : `Since ${fmtShort(e.entered_at)}`}</span>
                    {e.why && <span className="text-[14px] leading-relaxed text-text2">{humanize(e.why, people)}</span>}
                    {!e.why && e.waiting_on && <span className="text-[14px] leading-relaxed text-text2">Waiting on: {humanize(e.waiting_on, people)}</span>}
                    {e.saw && <span className="text-[13px] text-label">Saw: {e.saw}</span>}
                    {e.memo && <pre className="m-0 whitespace-pre-wrap bg-hair p-2.5 font-sans text-[13px] leading-relaxed text-text2">{e.memo}</pre>}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {d.credit_memo && (
            <Section id="deal-credit-memo" title="Credit memo"><pre className="card m-0 whitespace-pre-wrap p-5 font-sans text-[14px] leading-relaxed text-text2">{d.credit_memo}</pre></Section>
          )}

          <Section id="deal-events" title="Requests and alerts">
            <div className="card px-[22px] py-1.5">
              {events.length === 0 && <p className="m-0 py-4 text-[14px] text-label">Nothing has been sent on this deal yet.</p>}
              {events.map((e) => (
                <div key={e.key} className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 border-b border-hair py-3.5 last:border-b-0">
                  <Chip tone={e.tone}>{e.kind}</Chip>
                  <span className="font-semibold text-ink">{e.to}</span>
                  <span className="text-[13px] text-label">{fmtShort(e.at)}</span>
                  {e.status && <Chip tone={e.status.tone}>{e.status.text}</Chip>}
                  <span className="basis-full text-[14px] leading-relaxed text-text2">{e.text}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="deal-docs" title={`Documents received (${d.docs.length})`}>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead><tr><th scope="col" className="td label">Read as</th><th scope="col" className="td label">File</th><th scope="col" className="td label">Made with</th></tr></thead>
                <tbody>
                  {docs.map((x) => (
                    <tr key={x.key}>
                      <td className="td font-medium">{x.type}{!x.legible && <Chip tone="warn" className="ml-2">Hard to read</Chip>}</td>
                      <td className="td">{x.file}{x.warnings.length > 0 && <Chip tone="warn" className="ml-2" title={x.warnings.join(' | ')}>{x.warnings[0].slice(0, 48)}</Chip>}</td>
                      <td className="td text-label">{x.tool}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <section className="card px-[22px] py-5" data-testid="deal-facts">
            <h2 className="h2 mb-1.5 !text-[20px]">Key facts</h2>
            <dl className="m-0">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-hair py-[11px] text-[14px]">
                  <dt className="shrink-0 basis-[130px] text-label">{k}</dt>
                  <dd className="m-0 text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-2.5 text-[12px] text-label">Read from the borrower's documents by Gemini. Numbers are checked against the files.</p>
          </section>
          {d.anomaly?.percentile !== undefined && (
            <section className="card flex flex-col gap-2 px-[22px] py-5" data-testid="deal-profile">
              <span className="label">Statistical profile</span>
              <span className="text-[15px] font-semibold text-ink">{d.anomaly.unusual ? 'Unusual compared with the bank’s usual deals' : 'Within the bank’s normal range'}</span>
              <span className="text-[14px] leading-relaxed text-muted">
                {pctText(d.anomaly.percentile)} percentile of past deals (flagged as unusual only above the 98th).
                {d.anomaly.top?.length ? ` Most different: ${d.anomaly.top.slice(0, 2).map((t) => factorText(t).replace(/^\w/, (c) => c.toLowerCase())).join('; ')}.` : ''} For information only; it never blocks a deal.
              </span>
            </section>
          )}
        </aside>
      </div>
    </main>
  )
}
