import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { fmtDay, fmtShort, initials, plural } from '../lib/format'
import { borrowerItems } from '../lib/text'
import { requestKind } from '../lib/labels'
import { href } from '../lib/route'
import Button from '../components/Button'
import Chip from '../components/Chip'
import PageTitle from '../components/PageTitle'
import Stat from '../components/Stat'
import RequestCard, { shortRole } from '../components/RequestCard'

function Group({ who, tasks, dealBy, people, state }) {
  const [all, setAll] = useState(false)
  const shown = !all && tasks.length > 3 ? tasks.slice(0, 2) : tasks
  const hidden = tasks.length - shown.length
  const kinds = new Set(tasks.slice(shown.length).map((t) => t.type))
  const label = kinds.size === 1 ? requestKind([...kinds][0]).plural : 'requests'
  const p = people[who] || { name: who, role: '' }
  return (
    <section className="flex flex-col gap-3.5" data-testid={`task-group-${who}`}>
      <div className="flex items-center gap-3.5 border-b border-rule pb-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#E3ECF6] text-[14px] font-bold text-ink" aria-hidden="true">{initials(p.name)}</span>
        <div className="flex flex-col">
          <span className="text-[17px] font-semibold text-ink">{p.name}</span>
          <span className="text-[13px] text-label">{shortRole(p.role)}</span>
        </div>
        <Chip tone="gray" className="ml-auto">{tasks.length} waiting</Chip>
      </div>
      {shown.map((r) => <RequestCard key={r.id} r={r} deal={dealBy[r.deal]} people={people} state={state} />)}
      {hidden > 0 && <Button className="self-start" data-testid={`task-more-${who}`} onClick={() => setAll(true)}>Show {hidden} more {label}</Button>}
    </section>
  )
}

export default function Tasks() {
  const { state, route } = useApp()
  const people = state.people
  const [as, setAs] = useState(route.query.as || 'all')
  useEffect(() => { setAs(route.query.as || 'all') }, [route.query.as])

  const dealBy = useMemo(() => Object.fromEntries(state.deals.map((d) => [d.folder, d])), [state.deals])
  const escalated = (r) => dealBy[r.deal]?.sla?.pct >= 100 || state.alerts.some((a) => a.deal === r.deal && a.kind === 'fraud_nudge')
  const rank = (r) => (r.urgent ? 0 : 2) + (escalated(r) ? 0 : 1)
  const sorted = useMemo(
    () => [...state.pending].sort((a, b) => rank(a) - rank(b) || String(a.at).localeCompare(String(b.at))),
    [state.pending, state.alerts, state.deals], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const groups = useMemo(() => {
    const m = new Map()
    sorted.forEach((r) => m.set(r.to, [...(m.get(r.to) || []), r]))
    return [...m.entries()]
  }, [sorted])
  const visible = as === 'all' ? groups : groups.filter(([who]) => who === as)

  const active = state.deals.filter((d) => d.status === 'active')
  const urgent = active.filter((d) => d.needed_by)
  const frozen = state.deals.filter((d) => d.fraud.flagged && !d.fraud.released)
  const late = active.filter((d) => d.sla && d.sla.pct >= 100)

  const borrower = useMemo(() => {
    const last = new Map()
    state.unanswered_info.forEach((r) => last.set(r.deal, r))
    return [...last.values()]
      .filter((r) => dealBy[r.deal]?.status === 'active' && dealBy[r.deal].issues.some((c) => /^(MISSING|MISMATCH)/.test(c)))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 6)
  }, [state.unanswered_info, dealBy])

  const n = state.pending.length
  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-8 px-8 pb-[72px] pt-10" data-testid="view-tasks">
      <PageTitle label={fmtDay(state.now)} title="My tasks"
        sub={n === 0
          ? 'Nothing is waiting on a person right now. New requests appear here the moment a deal needs a decision.'
          : `${plural(n, 'decision is', 'decisions are')} waiting on people. Urgent and overdue items are listed first. Nothing moves forward until the right person answers.`}>
        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="viewas">Viewing as</label>
          <select id="viewas" data-testid="tasks-viewas" className="field min-w-[260px]" value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="all">Everyone ({n} waiting)</option>
            {groups.map(([who, list]) => (
              <option key={who} value={who}>{people[who]?.name || who} · {shortRole(people[who]?.role)} ({list.length})</option>
            ))}
          </select>
        </div>
      </PageTitle>

      <section aria-label="Summary" className="flex flex-wrap gap-4">
        <Stat id="waiting" label="Waiting on a person" value={n} note={`Across ${plural(groups.length, 'person', 'people')}`} color="#0A1F44" />
        <Stat id="urgent" label="Urgent" value={urgent.length}
              note={urgent.length ? `${urgent[0].name} needs funds ${fmtShort(urgent[0].needed_by)}` : 'No deadlines at risk'} color="#B42318" />
        <Stat id="frozen" label="Frozen for fraud review" value={frozen.length} note="Nothing moves until Fraud Ops answers" color="#B42318" />
        <Stat id="late" label="Past stage time limit" value={late.length} note="Owners and managers have been alerted" color="#B7791F" />
      </section>

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-9">
          {visible.length === 0 && (
            <div className="card p-7 text-[15px] leading-relaxed text-muted" data-testid="tasks-empty">
              No pending requests{as !== 'all' ? ' for this person' : ''}. People are asked only at these points: credit decision, committee approval,
              commitment sign-off, funding release, and fraud holds.
            </div>
          )}
          {visible.map(([who, list]) => <Group key={who} who={who} tasks={list} dealBy={dealBy} people={people} state={state} />)}
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5" aria-label="Waiting on borrowers">
          <div className="flex flex-col gap-1 border-b border-rule pb-3">
            <span className="text-[17px] font-semibold text-ink">Waiting on borrowers</span>
            <span className="text-[13px] text-label">Requests already sent. The deal continues as soon as the papers arrive.</span>
          </div>
          {borrower.length === 0 && <p className="m-0 text-[14px] text-label" data-testid="borrowers-empty">No borrower is being asked for anything right now.</p>}
          {borrower.map((r) => (
            <a key={r.id} href={href.deal(r.deal)} data-testid={`borrower-${r.id}`} className="card card-link flex flex-col gap-1.5 px-[18px] py-4">
              <div className="flex justify-between gap-2.5">
                <span className="font-semibold text-ink">{dealBy[r.deal]?.name || r.deal}</span>
                <span className="whitespace-nowrap text-[12px] text-label">Sent {fmtShort(r.at)}</span>
              </div>
              <span className="text-[14px] leading-relaxed text-muted">{borrowerItems(r.message, people).join(' · ')}</span>
            </a>
          ))}
        </aside>
      </div>
    </main>
  )
}
