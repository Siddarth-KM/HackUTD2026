import { useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { fmtShort } from '../lib/format'
import { ALERT_KINDS, alertBody, personName } from '../lib/text'
import { href } from '../lib/route'
import Button from '../components/Button'
import Chip from '../components/Chip'
import PageTitle from '../components/PageTitle'

const FILTERS = [['all', 'All'], ['stuck', 'Stuck deals'], ['deadline_risk', 'Deadline at risk'], ['fraud_nudge', 'Fraud hold unanswered']]
const PAGE = 12

export default function Alerts() {
  const { state } = useApp()
  const people = state.people
  const [filter, setFilter] = useState('all')
  const [all, setAll] = useState(false)
  const count = (k) => (k === 'all' ? state.alerts.length : state.alerts.filter((a) => a.kind === k).length)
  const rows = state.alerts.filter((a) => filter === 'all' || a.kind === filter)
  const shown = all ? rows : rows.slice(0, PAGE)

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-6 px-8 pb-[72px] pt-10" data-testid="view-alerts">
      <PageTitle label="Who was told, and why" title="Alerts" subWidth="max-w-[760px]"
        sub="A deal alerts its owner when it reaches the stage time limit, escalates to their manager at 1.5 times the limit, and to the head of lending operations at 2 times. Each alert says what the deal is waiting for and what would unblock it." />

      <div role="group" aria-label="Filter alerts" className="flex flex-wrap gap-2.5">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" data-testid={`alerts-filter-${k}`} aria-pressed={filter === k} className={`pill ${filter === k ? 'pill-on' : ''}`}
                  onClick={() => { setFilter(k); setAll(false) }}>
            {label} <span className="font-medium" data-testid={`alerts-count-${k}`}>{count(k)}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 && <div className="card p-7 text-[15px] text-muted" data-testid="alerts-empty">No alerts{filter === 'all' ? ' yet' : ' of this kind'}. Deals alert at 100% of the stage time limit, escalate at 150%, and again at 200%.</div>}
      {rows.length > 0 && (
        <div className="card" data-testid="alerts-list">
          {shown.map((a, i) => (
            <article key={i} data-testid={`alert-row-${i}`} className="flex flex-wrap gap-x-5 gap-y-2 border-b border-hair px-[22px] py-[18px] last:border-b-0">
              <div className="flex basis-[120px] flex-col gap-1.5">
                <span className="text-[14px] font-semibold text-ink">{fmtShort(a.at)}</span>
                <Chip tone={a.level === 'escalation' ? 'risk' : 'warn'} className="self-start">{a.level === 'escalation' ? 'Escalation' : 'Alert'}</Chip>
              </div>
              <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <a href={href.deal(a.deal)} data-testid={`alert-deal-${i}`} className="serif text-[19px] font-semibold !text-ink no-underline hover:underline">{a.deal_name}</a>
                  <span className="label">{ALERT_KINDS[a.kind] || a.kind}</span>
                </div>
                <span className="text-[14px] leading-relaxed text-text2">{alertBody(a.message, people)}</span>
                <span className="text-[13px] text-label">
                  Sent to <b className="font-semibold text-body">{personName(a.to, people)}</b>
                  {a.cc?.length > 0 && ` · copied to ${a.cc.map((c) => personName(c, people)).join(', ')}`}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
      {!all && rows.length > PAGE && <Button className="self-center" data-testid="alerts-more" onClick={() => setAll(true)}>Show {rows.length - PAGE} older alerts</Button>}
    </main>
  )
}
