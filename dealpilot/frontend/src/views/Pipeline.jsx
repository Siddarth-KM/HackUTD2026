import { useMemo, useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { money, plural } from '../lib/format'
import { BOARD_COLUMNS, STEP_LABEL, chipsFor, slaView, stageNote, stageOf, waitText } from '../lib/labels'
import { personName, cap, humanize } from '../lib/text'
import { go, href } from '../lib/route'
import Button from '../components/Button'
import Chip from '../components/Chip'
import SlaBar from '../components/SlaBar'

function BoardCard({ d, people }) {
  const sla = slaView(d.sla)
  return (
    <a href={href.deal(d.folder)} data-testid={`board-card-${d.folder}`} className="card card-link box-border flex flex-col gap-2 px-3.5 py-3">
      <span className="serif text-[17px] font-semibold leading-tight text-ink">{d.name}</span>
      <span className="text-[13px] text-muted"><b className="text-body">{money(d.amount)}</b> · RM {personName(d.rm, people)}</span>
      <div className="flex flex-wrap gap-[5px]">
        {chipsFor(d, { short: true }).slice(0, 2).map((c) => <Chip key={c.text} tone={c.tone} wrap>{c.text}</Chip>)}
      </div>
      {sla && <SlaBar view={sla} caption={sla.short} label={sla.caption} captionClass="text-[11.5px] text-label" />}
      <span className="clamp2 border-t border-hair pt-2 text-[12.5px] leading-snug text-text2">{cap(humanize(waitText(d, people, true), people))}</span>
    </a>
  )
}

function FocusCard({ d, people }) {
  const sla = slaView(d.sla)
  return (
    <a href={href.deal(d.folder)} data-testid={`focus-card-${d.folder}`} className="card card-link flex flex-col gap-3 px-5 py-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="serif text-[20px] font-semibold leading-tight text-ink">{d.name}</span>
        <span className="whitespace-nowrap font-semibold">{money(d.amount)}</span>
      </div>
      <span className="text-[13px] text-label">RM {personName(d.rm, people)}</span>
      <div className="flex flex-wrap gap-1.5">
        {chipsFor(d).map((c) => <Chip key={c.text} tone={c.tone}>{c.text}</Chip>)}
      </div>
      {sla && <SlaBar view={sla} caption={sla.caption} />}
      <div className="border-t border-hair pt-2.5 text-[14px] leading-snug text-text2">
        <span className="label mb-1 block">Waiting for</span>{cap(humanize(waitText(d, people), people))}
      </div>
    </a>
  )
}

export default function Pipeline() {
  const { state, route } = useApp()
  const people = state.people
  const [q, setQ] = useState('')
  const focus = BOARD_COLUMNS.includes(route.stage) ? route.stage : null

  const match = (d) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return [d.name, d.legal_name, personName(d.rm, people)].some((s) => String(s || '').toLowerCase().includes(needle))
  }
  const byStage = useMemo(() => {
    const m = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, []]))
    state.deals.filter(match).forEach((d) => m[stageOf(d)]?.push(d))
    return m
  }, [state.deals, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = state.deals.reduce((s, d) => s + (d.amount || 0), 0)
  const frozen = state.deals.filter((d) => d.fraud.flagged && !d.fraud.released).length

  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 pb-[72px] pt-9" data-testid="view-pipeline">
      <section className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <span className="label">All live deals</span>
          <h1 className="h1" data-testid="page-title">Pipeline</h1>
          <p className="m-0 text-[16px] text-muted" data-testid="pipeline-summary">
            {plural(state.deals.length, 'deal')} · {money(total)} requested · {frozen} frozen for fraud review
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="find">Find a deal</label>
            <input id="find" data-testid="pipeline-search" className="field w-[260px]" placeholder="Business name or RM" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button href="/api/export?set=sample" download data-testid="pipeline-download">Download results (JSON)</Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
        <span>Click a stage name to open just that stage. Click a deal to open its page.</span>
        <span className="inline-flex items-center gap-2"><span className="h-1.5 w-6 bg-accent" />On time</span>
        <span className="inline-flex items-center gap-2"><span className="h-1.5 w-6 bg-warn" />Past the time limit</span>
        <span className="inline-flex items-center gap-2"><span className="h-1.5 w-6 bg-risk" />1.5x past the limit</span>
      </div>

      {!focus && (
        <div className="overflow-x-auto pb-2" data-testid="board">
          <div className="grid min-w-[1290px] grid-cols-7 items-start gap-3" style={{ gridTemplateColumns: 'repeat(7, minmax(174px, 1fr))' }}>
            {BOARD_COLUMNS.map((c) => (
              <section key={c} className="flex min-w-0 flex-col gap-2.5" aria-label={c}>
                <button type="button" className="colhead" data-testid={`board-col-${c}`} onClick={() => go(href.stage(c))}>
                  <span className="label">{STEP_LABEL[c]}</span>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[17px] font-semibold text-ink">{c}</span>
                    <span className="serif text-[28px] leading-none text-ink" data-testid={`board-count-${c}`}>{byStage[c].length}</span>
                  </span>
                  <span className="text-[12px] font-semibold text-link">Open stage →</span>
                </button>
                {byStage[c].length === 0 && (
                  <div className="border border-dashed border-field px-3 py-[18px] text-center text-[13px] leading-snug text-label" data-testid={`board-empty-${c}`}>
                    {c === 'Stopped' ? 'No declined or stopped deals' : q ? 'No matching deals' : 'No deals here yet'}
                  </div>
                )}
                {byStage[c].map((d) => <BoardCard key={d.folder} d={d} people={people} />)}
              </section>
            ))}
          </div>
        </div>
      )}

      {focus && (
        <div className="flex flex-col gap-5" data-testid="stage-focus">
          <Button className="self-start" data-testid="pipeline-back" onClick={() => go(href.pipeline())}>← Back to all stages</Button>
          <nav aria-label="Stages" className="flex flex-wrap">
            {BOARD_COLUMNS.map((c) => (
              <button key={c} type="button" data-testid={`pipeline-strip-${c}`} aria-pressed={focus === c}
                      className={`stage-tile ${focus === c ? 'stage-tile-on' : ''}`} onClick={() => go(href.stage(c))}>
                <span className="text-[11px] font-semibold uppercase tracking-[.12em]" style={{ color: focus === c ? '#0A1F44' : '#5A6577' }}>{STEP_LABEL[c]}</span>
                <span className="text-[16px] font-semibold text-ink">{c}</span>
                <span className="serif text-[28px] leading-[1.1] text-ink">{byStage[c].length}</span>
              </button>
            ))}
          </nav>
          <section className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule pb-2.5">
              <h2 className="h2 !text-[28px]" data-testid="focus-title">{focus}</h2>
              <span className="text-[14px] text-label">{plural(byStage[focus].length, 'deal')} · {stageNote(focus, people)}</span>
            </div>
            {byStage[focus].length === 0 && <div className="card p-7 text-[15px] text-muted" data-testid="focus-empty">No deals are in this stage right now.</div>}
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {byStage[focus].map((d) => <FocusCard key={d.folder} d={d} people={people} />)}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
