import { useApp } from '../lib/useDealPilot'
import { fmtShort, money, plural } from '../lib/format'
import { cap, evidenceParagraphs, personName } from '../lib/text'
import { evidenceLabel, familyName } from '../lib/labels'
import { href } from '../lib/route'
import Button from '../components/Button'
import Chip from '../components/Chip'
import PageTitle from '../components/PageTitle'

const isHistory = (id) => /^H-\d/.test(id)

function Cluster({ c, dealBy, threshold, people }) {
  const live = c.members.filter((m) => !isHistory(m))
  const past = c.members.filter(isHistory)
  const extras = [...new Set(c.edges.flatMap((e) => e.extra || []))]
  const n = c.members.length
  return (
    <section className="card flex flex-col gap-[22px] px-7 py-[26px]" data-testid="fraud-cluster">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="label !text-[#9B1C12]">Linked group · {plural(n, 'deal')}</span>
          <h2 className="h2" data-testid="cluster-headline">
            {past.length
              ? `${plural(live.length, 'live application')} tied to ${plural(past.length, 'loan')} funded earlier`
              : `${plural(live.length, 'live application')} linked to each other`}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="serif text-[36px] leading-none text-[#9B1C12]" data-testid="cluster-score">{c.score}</span>
          <span className="text-[12px] text-label">link strength · flag threshold {threshold}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">Evidence types</span>
        {c.families.map((f) => <Chip key={f} tone="blue">{familyName(f)}</Chip>)}
      </div>

      <div className="flex flex-wrap gap-3">
        {c.members.map((m) => {
          const d = dealBy[m]
          if (isHistory(m) || !d) {
            return (
              <div key={m} data-testid={`cluster-member-${m}`} className="flex min-w-[200px] flex-[1_1_200px] flex-col gap-1 border border-rule bg-white px-4 py-3.5">
                <Chip tone="gray" className="self-start">Funded earlier</Chip>
                <span className="serif text-[18px] font-semibold text-ink">{c.labels[m] || m}</span>
                <span className="text-[13px] text-label">{m}</span>
              </div>
            )
          }
          const tag = d.fraud.released ? 'Live · released' : d.fraud.confirmed ? 'Live · hold confirmed' : 'Live · frozen'
          return (
            <a key={m} href={href.deal(m)} data-testid={`cluster-member-${m}`} className="card-link flex min-w-[200px] flex-[1_1_200px] flex-col gap-1 border border-rule bg-white px-4 py-3.5 hover:border-accent">
              <Chip tone={d.fraud.released ? 'ok' : 'risk'} className="self-start">{tag}</Chip>
              <span className="serif text-[18px] font-semibold text-ink">{d.name}</span>
              <span className="text-[13px] text-label">{money(d.amount)} · flagged at {d.fraud.stage_at_flag || d.stage}, {fmtShort(d.fraud.flagged_at)}</span>
            </a>
          )
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse" data-testid="cluster-evidence">
          <thead><tr><th scope="col" className="td label">What they share</th><th scope="col" className="td label">Evidence type</th><th scope="col" className="td label">How rare it is</th></tr></thead>
          <tbody>
            {c.evidence.map((ev, i) => (
              <tr key={i} data-testid={`evidence-row-${i}`}>
                <td className="td font-medium">{evidenceLabel(ev)}</td>
                <td className="td text-muted">{familyName(ev.family)}</td>
                <td className="td">On {ev.freq} of {ev.pop} {ev.live_only ? 'current ' : ''}deals{ev.shared_by >= ev.freq ? ', all in this group' : `; ${ev.shared_by} of them are in this group`}</td>
              </tr>
            ))}
            {extras.map((x, i) => (
              <tr key={`x${i}`} data-testid={`evidence-extra-${i}`}><td className="td font-medium">{x}</td><td className="td text-muted">Direct evidence</td><td className="td">Conclusive on its own</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Fraud() {
  const { state } = useApp()
  const people = state.people
  const dealBy = Object.fromEntries(state.deals.map((d) => [d.folder, d]))
  const frozen = state.deals.filter((d) => d.fraud.flagged && !d.fraud.released)
  const tricks = state.deals.filter((d) => d.fraud.flagged && d.fraud.sources.some((s) => s !== 'CROSS_DEAL'))
  const holds = state.pending.filter((r) => r.type === 'fraud_hold' || r.type === 'fraud_release')
  const labels = Object.assign({}, ...state.clusters.map((c) => c.labels))

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-8 pb-[72px] pt-10" data-testid="view-fraud">
      <PageTitle label={`${plural(frozen.length, 'live deal')} frozen`} title="Fraud review" subWidth="max-w-[760px]"
        sub="Deals are held only for two reasons: they share rare details with other deals across at least two independent kinds of evidence, or they fail a known-fraud check. A single unusual deal is never held; it only gets a note for the credit officer.">
        {holds.length > 0 && <Button kind="primary" href={href.tasks(holds[0].to)} data-testid="fraud-answer">Answer {plural(holds.length, 'hold request')}</Button>}
      </PageTitle>

      {frozen.length === 0 && state.clusters.length === 0 && (
        <div className="card p-7 text-[15px] text-muted" data-testid="fraud-empty">Nothing is frozen right now. Groups and failed checks appear here the moment they are found.</div>
      )}

      {state.clusters.map((c) => <Cluster key={c.members.join('|')} c={c} dealBy={dealBy} threshold={state.cluster_threshold} people={people} />)}

      {tricks.length > 0 && (
        <section className="flex flex-col gap-3.5" data-testid="fraud-checks">
          <h2 className="h2">Failed a known-fraud check</h2>
          {tricks.map((d) => (
            <article key={d.folder} className="card flex flex-col gap-3 px-[26px] py-[22px]" data-testid={`fraud-check-${d.folder}`}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <a href={href.deal(d.folder)} data-testid={`fraud-check-link-${d.folder}`} className="serif text-[22px] font-semibold !text-ink no-underline hover:underline">{d.name}</a>
                <span className="text-[14px] text-label">{money(d.amount)} · RM {personName(d.rm, people)} · {d.fraud.released ? 'released' : `frozen at ${d.fraud.stage_at_flag || d.stage}`}</span>
              </div>
              {evidenceParagraphs(d.fraud.reason, people).map((p, i) => (
                <div key={i} className="flex flex-col gap-1">
                  {p.title && <span className="label !text-[#9B1C12]">{p.title}</span>}
                  <span className="text-[14px] leading-relaxed text-text2">{cap(p.body)}</span>
                </div>
              ))}
            </article>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2.5" data-testid="fraud-history">
        <h2 className="h2">Past loans now linked to fraud</h2>
        <p className="m-0 text-[14px] text-muted">These were funded before this week. They are reported so Collections and Fraud Operations can review them.</p>
        <div className="flex flex-wrap gap-2.5">
          {state.history_flags.length === 0 && <span className="text-[14px] text-label">None</span>}
          {state.history_flags.map((id) => <Chip key={id} tone="risk" className="!h-8 !text-[12px]" data-testid={`history-${id}`}>{id}{labels[id] ? ` · ${labels[id]}` : ''}</Chip>)}
        </div>
      </section>
    </main>
  )
}
