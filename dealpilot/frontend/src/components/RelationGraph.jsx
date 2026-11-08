import { useEffect, useMemo, useRef, useState } from 'react'
import { money, plural } from '../lib/format'
import { evidenceParagraphs } from '../lib/text'
import { evidenceLabel, familyName } from '../lib/labels'
import { GRAPH_W, layout, neighbours, parseToken, shortLabel } from '../lib/graphLayout'
import { href } from '../lib/route'

const RED = '#B42318'
const GREEN = '#2E7D4F'
const INK = '#0A1F44'
const GRAY = '#4A5568'
const BLUE_EDGE = '#5A82B0'

function liveStatus(d) {
  if (!d) return { text: 'Live application', color: BLUE_EDGE }
  if (d.fraud.released) return { text: 'Released: genuine', color: GREEN }
  if (d.fraud.confirmed) return { text: 'Hold confirmed', color: RED }
  if (d.fraud.flagged) return { text: 'Frozen for fraud review', color: RED }
  return { text: 'Live application', color: BLUE_EDGE }
}

function Key() {
  const item = 'inline-flex items-center gap-2 text-[13px] text-muted'
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2" data-testid="graph-key">
      <span className={item}><svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={RED} strokeWidth="2.5" /></svg>Share rare details</span>
      <span className={item}><svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={BLUE_EDGE} strokeWidth="1.5" strokeDasharray="5 4" /></svg>Member of a linked group</span>
      <span className={item}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill={RED} /></svg>Live application</span>
      <span className={item}><svg width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill={GRAY} transform="rotate(45 6 6)" /></svg>Loan funded earlier</span>
    </div>
  )
}

function Tip({ hot, nodeBy, edgeBy, dealBy, labels, clusters, threshold, people, height }) {
  if (!hot) return null
  let x, y, body
  if (hot.type === 'edge') {
    const e = edgeBy[hot.key]
    const A = nodeBy[e.a]
    const B = nodeBy[e.b]
    x = (e.x1 + e.x2) / 2
    y = (e.y1 + e.y2) / 2
    const name = (n) => dealBy[n.id]?.name || labels[n.id] || n.id
    body = (
      <>
        <span className="text-[14px] font-semibold text-ink">{name(A)} and {name(B)}</span>
        <span className="text-[13px] text-label">Share {plural(e.shared.length + e.extra.length, 'rare detail')}</span>
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-text2">
          {e.shared.slice(0, 5).map((s, i) => <li key={i}>{evidenceLabel(parseToken(s.token))}</li>)}
          {e.extra.map((s, i) => <li key={`x${i}`}>{s}</li>)}
          {e.shared.length > 5 && <li>and {e.shared.length - 5} more</li>}
        </ul>
      </>
    )
  } else {
    const n = nodeBy[hot.key]
    x = n.x
    y = n.y
    const d = dealBy[n.id]
    if (n.kind === 'hub') {
      const c = clusters[n.group]
      body = (
        <>
          <span className="text-[14px] font-semibold text-ink">Group {n.group + 1}</span>
          <span className="text-[13px] text-text2">{plural(c.members.length, 'deal')} · link strength {c.score} (flag threshold {threshold})</span>
          <span className="text-[13px] text-label">Evidence: {c.families.map(familyName).join(', ')}</span>
        </>
      )
    } else if (n.kind === 'history') {
      body = (
        <>
          <span className="text-[14px] font-semibold text-ink">{labels[n.id] || n.id}</span>
          <span className="text-[13px] text-text2">{n.id} · loan funded earlier, now linked to fraud</span>
        </>
      )
    } else {
      const st = liveStatus(d)
      const checks = n.kind === 'lone' && d ? evidenceParagraphs(d.fraud.reason, people).map((p) => p.title).filter(Boolean) : []
      body = (
        <>
          <span className="text-[14px] font-semibold text-ink">{d?.name || n.id}</span>
          <span className="text-[13px] text-text2">{d ? `${money(d.amount)} · ` : ''}{st.text}</span>
          {n.kind === 'live' && d && <span className="text-[13px] text-label">Linked to {plural(d.fraud.linked_deals.length, 'deal')}</span>}
          {checks.length > 0 && <span className="text-[13px] text-label">Failed: {checks.join('; ')}</span>}
          {d && <span className="text-[12px] text-label">Click to open the deal</span>}
        </>
      )
    }
  }
  const left = Math.min(78, Math.max(22, (x / GRAPH_W) * 100))
  const below = y < 120
  return (
    <div role="status" data-testid="graph-tip"
         className="pointer-events-none absolute z-10 flex w-[280px] max-w-[90%] flex-col gap-1 border border-rule bg-white px-3.5 py-3 shadow-[0_2px_10px_rgba(10,31,68,.12)]"
         style={{ left: `${left}%`, top: `${(y / height) * 100}%`, transform: below ? 'translate(-50%, 22px)' : 'translate(-50%, calc(-100% - 22px))' }}>
      {body}
    </div>
  )
}

/** The fraud relationship graph: who is linked to whom, from the same /api/state data as the rest of the page. */
export default function RelationGraph({ state }) {
  const [hot, setHot] = useState(null)
  const scroller = useRef(null)
  const dealBy = useMemo(() => Object.fromEntries(state.deals.map((d) => [d.folder, d])), [state.deals])
  const labels = useMemo(() => Object.assign({}, ...state.clusters.map((c) => c.labels || {})), [state.clusters])
  const inCluster = new Set(state.clusters.flatMap((c) => c.members))
  const lone = state.deals.filter((d) => d.fraud.flagged && !inCluster.has(d.folder)).map((d) => d.folder)
  const g = useMemo(() => layout(state.clusters, lone, GRAPH_W), [state.clusters, lone.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  // On a phone the picture is wider than the screen: start with the middle (the group) in view.
  useEffect(() => {
    const el = scroller.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [g.nodes.length])
  const nodeBy = Object.fromEntries(g.nodes.map((n) => [n.key, n]))
  const edgeBy = Object.fromEntries(g.edges.map((e) => [e.key, e]))

  const lit = !hot ? null : hot.type === 'node' ? neighbours(g.edges, hot.key) : new Set([edgeBy[hot.key].a, edgeBy[hot.key].b])
  const dim = (key) => (lit && !lit.has(key) ? 0.25 : 1)
  const edgeDim = (e) => (!hot ? 1 : hot.type === 'edge' ? (hot.key === e.key ? 1 : 0.15) : (e.a === hot.key || e.b === hot.key ? 1 : 0.12))
  const on = (type, key) => ({ onMouseEnter: () => setHot({ type, key }), onMouseLeave: () => setHot(null), onFocus: () => setHot({ type, key }), onBlur: () => setHot(null) })

  const summary = [
    ...state.clusters.map((c, i) => {
      const past = c.members.filter((m) => /^H-\d/.test(m)).length
      return `Group ${i + 1}: ${plural(c.members.length - past, 'live deal')} and ${plural(past, 'past loan')} share ${plural((c.evidence || []).length, 'rare detail')}.`
    }),
    lone.length ? `${plural(lone.length, 'more deal')} failed a known-fraud check on ${lone.length === 1 ? 'its' : 'their'} own.` : '',
  ].filter(Boolean).join(' ')

  return (
    <section className="card flex flex-col gap-4 px-7 py-[26px]" data-testid="fraud-graph">
      <div className="flex flex-col gap-2">
        <span className="label">Relationship graph</span>
        <h2 className="h2">How the flagged deals connect</h2>
        <p className="m-0 max-w-[760px] text-[14px] leading-relaxed text-muted">Hover a deal or a line to see what links them. Click a live deal to open it.</p>
      </div>
      <Key />
      {g.nodes.length === 0 ? (
        <div className="border border-dashed border-field px-5 py-8 text-center text-[14px] text-label" data-testid="graph-empty">
          No linked deals right now. The graph fills in the moment a group or failed check is found.
        </div>
      ) : (
        <div className="overflow-x-auto" ref={scroller}>
          <div className="relative min-w-[640px]">
            <svg viewBox={`0 0 ${GRAPH_W} ${g.height}`} className="block h-auto w-full" role="group" aria-label={summary} data-testid="graph-svg">
              {g.edges.filter((e) => e.kind === 'member').map((e) => (
                <line key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={BLUE_EDGE} strokeWidth="1.5" strokeDasharray="6 5"
                      opacity={edgeDim(e)} data-testid={`graph-member-${nodeBy[e.b].id}`} />
              ))}
              {g.edges.filter((e) => e.kind === 'link').map((e) => {
                const A = nodeBy[e.a]
                const B = nodeBy[e.b]
                const words = `${dealBy[A.id]?.name || labels[A.id] || A.id} and ${dealBy[B.id]?.name || labels[B.id] || B.id} share ${plural(e.shared.length, 'rare detail')}`
                return (
                  <g key={e.key} tabIndex={0} role="img" aria-label={words} data-testid={`graph-edge-${e.key}`} className="cursor-help" {...on('edge', e.key)}>
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={RED} strokeWidth={1.5 + Math.min(e.score || 0, 30) / 15}
                          strokeOpacity={hot?.key === e.key ? 0.95 : 0.55} opacity={edgeDim(e)} />
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth="14" />
                  </g>
                )
              })}
              {g.loneY != null && (
                <text x={GRAPH_W / 2} y={g.loneY - 34} textAnchor="middle" fontSize="12" fontWeight="600"
                      letterSpacing="1.4" fill="#5A6577">FAILED A KNOWN-FRAUD CHECK</text>
              )}
              {g.nodes.map((n) => {
                const d = dealBy[n.id]
                const name = n.kind === 'hub' ? `Group ${n.group + 1}` : d?.name || labels[n.id] || n.id
                const st = liveStatus(d)
                const shape = n.kind === 'hub'
                  ? <><circle cx={n.x} cy={n.y} r="17" fill={INK} /><text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">G{n.group + 1}</text></>
                  : n.kind === 'history'
                    ? <rect x={n.x - 9} y={n.y - 9} width="18" height="18" fill={GRAY} transform={`rotate(45 ${n.x} ${n.y})`} stroke="#fff" strokeWidth="2" />
                    : <circle cx={n.x} cy={n.y} r="12" fill={n.kind === 'lone' ? RED : st.color} stroke="#fff" strokeWidth="2" />
                const isLink = (n.kind === 'live' || n.kind === 'lone') && d
                const shown = shortLabel(name)
                const label = (
                  <text x={n.lx} y={n.ly} textAnchor={n.anchor} fontSize="14" fontWeight={n.kind === 'hub' ? 600 : 500} fill={INK}
                        paintOrder="stroke" stroke="#fff" strokeWidth="4" strokeLinejoin="round">
                    {shown}
                  </text>
                )
                const common = { opacity: dim(n.key), ...on('node', n.key) }
                if (isLink) {
                  return (
                    <a key={n.key} href={href.deal(n.id)} data-testid={`graph-node-${n.id}`} aria-label={`${shown === d.name ? d.name : `${shown} (${d.name})`}: ${st.text}. Open the deal.`} {...common}>
                      <title>{d.name}</title>{shape}{label}
                    </a>
                  )
                }
                return (
                  <g key={n.key} tabIndex={0} role="img" aria-label={n.kind === 'hub' ? `Group ${n.group + 1}` : `${name}, loan funded earlier (${n.id})`}
                     data-testid={`graph-${n.kind}-${n.id}`} className="cursor-help" {...common}>
                    <title>{name}</title>{shape}{label}
                  </g>
                )
              })}
            </svg>
            <Tip hot={hot} nodeBy={nodeBy} edgeBy={edgeBy} dealBy={dealBy} labels={labels} clusters={state.clusters}
                 threshold={state.cluster_threshold} people={state.people} height={g.height} />
          </div>
        </div>
      )}
    </section>
  )
}
