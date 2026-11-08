import { evidenceLabel, familyName } from '../lib/labels'
import { cap, evidenceParagraphs } from '../lib/text'

/**
 * Why a deal was flagged, in plain words. A deal that belongs to a linked group gets the group's shared attributes as a short
 * list ("Tax preparer phone 214-555-0187 · on 5 of 269 deals"); a deal that failed a known-fraud check gets one titled
 * paragraph per check. Anything else falls back to the backend's own sentence.
 */
export default function FraudEvidence({ folder, deal, state, people, fallback = '', max = 6 }) {
  const cluster = state.clusters.find((c) => c.members.includes(folder))
  const reason = deal?.fraud?.reason || fallback
  const checks = evidenceParagraphs(reason, people).filter((p) => p.title)
  const names = cluster ? cluster.members.filter((m) => m !== folder).map((m) => cluster.labels[m] || m) : []
  const generic = !cluster && !checks.length ? evidenceParagraphs(reason, people) : []
  const extras = cluster ? [...new Set(cluster.edges.flatMap((e) => e.extra || []))] : []

  return (
    <div className="flex flex-col gap-2.5" data-testid="fraud-evidence">
      {cluster && (
        <>
          <p className="m-0 text-[14px] leading-relaxed text-text2">
            Linked to {names.length} other {names.length === 1 ? 'deal' : 'deals'}: {names.join(', ')}. They share rare details across {cluster.families.length} independent kinds of evidence ({cluster.families.map(familyName).join(', ')}).
          </p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-relaxed text-text2">
            {cluster.evidence.slice(0, max).map((ev, i) => (
              <li key={i}>{evidenceLabel(ev)} <span className="text-label">· on {ev.freq} of {ev.pop} deals</span></li>
            ))}
            {extras.map((x, i) => <li key={`x${i}`}>{cap(x)}</li>)}
          </ul>
        </>
      )}
      {checks.map((p, i) => (
        <p key={i} className="m-0 text-[14px] leading-relaxed text-text2"><b className="mr-1">{p.title}.</b>{cap(p.body)}</p>
      ))}
      {generic.map((p, i) => <p key={i} className="m-0 text-[14px] leading-relaxed text-text2">{p.body}</p>)}
    </div>
  )
}
