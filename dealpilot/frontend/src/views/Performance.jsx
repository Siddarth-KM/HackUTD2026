import { useApp } from '../lib/useDealPilot'
import { fmtShort, money, plural } from '../lib/format'
import { ALERT_KINDS, alertBody, humanize, personName } from '../lib/text'
import { BOARD_COLUMNS, slaView, stageOf, waitText } from '../lib/labels'
import { href } from '../lib/route'
import BarChart from '../components/BarChart'
import Button from '../components/Button'
import Chip from '../components/Chip'
import PageTitle from '../components/PageTitle'
import SlaBar from '../components/SlaBar'
import Stat from '../components/Stat'

const ALERT_CAP = 80          // /api/state returns the newest 80 alerts
const LATEST = 5

// Time used in the current stage, bucketed at the alert (100%), escalation (150%) and second escalation (200%) lines.
export const SLA_BUCKETS = [
  { key: 'ontime', label: 'On time', sub: 'under 100%', color: '#7399C6', test: (p) => p < 100 },
  { key: 'alerted', label: 'Alerted', sub: '100–149%', color: '#B7791F', test: (p) => p >= 100 && p < 150 },
  { key: 'escalated', label: 'Escalated', sub: '150–199%', color: '#B42318', test: (p) => p >= 150 && p < 200 },
  { key: 'twice', label: 'Escalated twice', sub: '200% or more', color: '#7A1A12', test: (p) => p >= 200 },
]

/** Every number on the page, from /api/state alone (exported for tests). */
export function performanceNumbers(state) {
  const active = state.deals.filter((d) => d.status === 'active')
  const inStage = active.filter((d) => d.sla)
  const late = inStage.filter((d) => d.sla.pct >= 100).sort((a, b) => b.sla.pct - a.sla.pct)
  const escalations = state.alerts.filter((a) => a.level === 'escalation')
  const dealBy = Object.fromEntries(state.deals.map((d) => [d.folder, d]))
  const atRisk = [...new Set(state.alerts.filter((a) => a.kind === 'deadline_risk').map((a) => a.deal))]
    .map((f) => dealBy[f]).filter((d) => d && d.status === 'active' && d.stage !== 'Closed')
  const byStage = BOARD_COLUMNS.map((c) => ({ stage: c, n: state.deals.filter((d) => stageOf(d) === c).length }))
  const buckets = SLA_BUCKETS.map((b) => ({ ...b, n: inStage.filter((d) => b.test(d.sla.pct)).length }))
  const total = state.deals.reduce((s, d) => s + (d.amount || 0), 0)
  return { active, inStage, late, escalations, atRisk, byStage, buckets, total, capped: state.alerts.length >= ALERT_CAP }
}

function Card({ label, title, sub, children, testid }) {
  return (
    <section className="card flex min-w-0 flex-col gap-4 px-6 py-[22px]" data-testid={testid}>
      <div className="flex flex-col gap-1.5">
        <span className="label">{label}</span>
        {title && <h2 className="serif m-0 text-[22px] font-medium text-ink">{title}</h2>}
        {sub && <p className="m-0 text-[14px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

export default function Performance() {
  const { state } = useApp()
  const people = state.people
  const n = performanceNumbers(state)
  const latest = state.alerts.slice(0, LATEST)

  const stageBars = n.byStage.map(({ stage, n: c }) => ({
    key: stage, label: stage, value: c, color: stage === 'Stopped' ? '#8A94A6' : '#7399C6',
    href: href.stage(stage), linkId: `perf-stage-${stage}`, tip: `${stage}: ${plural(c, 'deal')}. Open the stage.`,
  }))
  const slaBars = n.buckets.map((b) => ({ key: b.key, label: b.label, sub: b.sub, value: b.n, color: b.color, tip: `${b.label} (${b.sub}): ${plural(b.n, 'deal')}` }))

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-8 pb-[72px] pt-10" data-testid="view-performance">
      <PageTitle label="How the week is going" title="Performance" subWidth="max-w-[780px]"
        sub="Stage time limits alert the owner at 100%, escalate to their manager at 150%, and to the head of lending operations at 200%. Deadline risk is checked separately against each deal's funding date." />

      <section aria-label="Summary" className="flex flex-wrap gap-4">
        <Stat id="perf-alerts" basis={180} label="Alerts sent" value={state.alerts.length} color="#0A1F44"
              note={n.capped ? `Newest ${ALERT_CAP} shown` : 'Owners told at 100% of the limit'} />
        <Stat id="perf-escalations" basis={180} label="Escalations" value={n.escalations.length} color="#B42318"
              note="Sent up to a manager or higher" />
        <Stat id="perf-deadline" basis={180} label="Deadline at risk" value={n.atRisk.length} color="#B7791F"
              note={n.atRisk.length ? `${n.atRisk[0].name} needs funds ${fmtShort(n.atRisk[0].needed_by)}` : 'No funding dates at risk'} />
        <Stat id="perf-late" basis={180} label="Past time limit" value={n.late.length} color="#B7791F"
              note={`of ${plural(n.inStage.length, 'deal')} in a stage`} />
        <Stat id="perf-money" basis={180} label="Money requested" value={money(n.total)} color="#7399C6"
              note={`across ${plural(state.deals.length, 'deal')}`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card label="Deals by stage" sub="Click a bar to open that stage." testid="perf-by-stage">
          <BarChart bars={stageBars} title="Deals by stage" testid="chart-stage" />
        </Card>
        <Card label="Time used in the current stage" sub={`${plural(n.inStage.length, 'deal')} in a stage right now, grouped by how much of the stage time limit they have used.`} testid="perf-sla">
          <BarChart bars={slaBars} title="Deals by time used in the current stage" testid="chart-sla" />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card label="Over the time limit" title={n.late.length ? `${plural(n.late.length, 'deal')}, worst first` : 'Every deal is on time'} testid="perf-over">
          {n.late.length === 0 && <span className="text-[14px] text-label" data-testid="perf-over-empty">No deal has reached its stage time limit.</span>}
          <ul className="m-0 flex list-none flex-col p-0">
            {n.late.map((d) => {
              const v = slaView(d.sla)
              return (
                <li key={d.folder} className="flex flex-col gap-2 border-b border-hair py-3.5 last:border-b-0" data-testid={`perf-over-row-${d.folder}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <a href={href.deal(d.folder)} data-testid={`perf-over-${d.folder}`} className="serif text-[17px] font-semibold !text-ink no-underline hover:underline">{d.name}</a>
                    <span className="text-[13px] text-label">{stageOf(d)}{d.frozen ? ' · frozen' : ''}</span>
                  </div>
                  <SlaBar view={v} caption={`${d.sla.elapsed}h of ${d.sla.hours}h · ${d.sla.pct}%`} label={v.caption} />
                </li>
              )
            })}
          </ul>
        </Card>
        <Card label="Deadline risk" title={n.atRisk.length ? `${plural(n.atRisk.length, 'deal')} may miss the funding date` : 'No funding dates at risk'} testid="perf-deadline">
          {n.atRisk.length === 0 && <span className="text-[14px] text-label" data-testid="perf-deadline-empty">No deal is at risk of missing the date the borrower needs funds.</span>}
          <ul className="m-0 flex list-none flex-col p-0">
            {n.atRisk.map((d) => (
              <li key={d.folder} className="flex flex-col gap-1.5 border-b border-hair py-3.5 last:border-b-0" data-testid={`perf-deadline-row-${d.folder}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <a href={href.deal(d.folder)} data-testid={`perf-deadline-${d.folder}`} className="serif text-[17px] font-semibold !text-ink no-underline hover:underline">{d.name}</a>
                  <Chip tone="risk">Needs funds {fmtShort(d.needed_by)}</Chip>
                </div>
                <span className="text-[14px] leading-relaxed text-text2">{stageOf(d)} · waiting for {humanize(waitText(d, people), people)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card label="Latest alerts" testid="perf-latest">
        {latest.length === 0 && <span className="text-[14px] text-label" data-testid="perf-latest-empty">No alerts yet.</span>}
        <div className="flex flex-col">
          {latest.map((a, i) => (
            <article key={i} data-testid={`perf-alert-${i}`} className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-hair py-3.5 last:border-b-0">
              <div className="flex basis-[110px] flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink">{fmtShort(a.at)}</span>
                <Chip tone={a.level === 'escalation' ? 'risk' : 'warn'} className="self-start">{a.level === 'escalation' ? 'Escalation' : 'Alert'}</Chip>
              </div>
              <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <a href={href.deal(a.deal)} data-testid={`perf-alert-deal-${i}`} className="serif text-[17px] font-semibold !text-ink no-underline hover:underline">{a.deal_name}</a>
                  <span className="label">{ALERT_KINDS[a.kind] || a.kind}</span>
                </div>
                <span className="clamp2 text-[14px] leading-relaxed text-text2">{alertBody(a.message, people)}</span>
                <span className="text-[13px] text-label">Sent to <b className="font-semibold text-body">{personName(a.to, people)}</b></span>
              </div>
            </article>
          ))}
        </div>
        {state.alerts.length > 0 && (
          <Button className="self-start" href={href.alerts()} data-testid="perf-alerts-all">See all {plural(state.alerts.length, 'alert')}</Button>
        )}
      </Card>
    </main>
  )
}
