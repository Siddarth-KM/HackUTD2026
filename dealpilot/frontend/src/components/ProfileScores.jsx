import { Fragment, useState } from 'react'
import { plural } from '../lib/format'
import { cap } from '../lib/text'
import { factorText, pctText, scoreColor, stageOf } from '../lib/labels'
import { href } from '../lib/route'
import Button from './Button'
import Chip from './Chip'

const SHOWN = 8
// "…differs from the known account(s) ['9902']" -> "… (9902)": drop the Python list brackets from watch notes.
const tidyList = (s) => String(s).replace(/\[((?:'[^']*'(?:, )?)+)\]/g, (m, inner) => inner.replace(/'/g, ''))

/** Every deal's unusual-profile (ML) score, highest first, with the factors and watch notes behind it. Never blocks a deal. */
export default function ProfileScores({ deals }) {
  const [all, setAll] = useState(false)
  const rows = deals.filter((d) => d.anomaly && d.anomaly.percentile !== undefined)
    .sort((a, b) => b.anomaly.percentile - a.anomaly.percentile || a.name.localeCompare(b.name))
  const keep = (d, i) => i < SHOWN || d.anomaly.unusual || d.fraud.flagged
  const shown = all ? rows : rows.filter(keep)
  const hidden = rows.length - shown.length

  return (
    <section className="card flex flex-col gap-4 px-7 py-[26px]" data-testid="fraud-profiles">
      <div className="flex flex-col gap-2">
        <span className="label">Statistical profile</span>
        <h2 className="h2">Unusual-profile scores</h2>
        <p className="m-0 max-w-[760px] text-[14px] leading-relaxed text-muted">
          Each deal is compared with the bank’s past loans. Above the 98th percentile it is marked unusual. This is for information only and never holds a deal.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="text-[14px] text-label" data-testid="profiles-empty">No deals have been scored yet.</div>
      ) : (
        <div>
          {/* On a phone each row becomes a stacked card (no sideways scrolling to find "Unusual"). */}
          <table className="w-full border-collapse max-md:block" data-testid="profiles-table">
            <thead className="max-md:sr-only">
              <tr>
                <th scope="col" className="td label">Deal</th>
                <th scope="col" className="td label">Score</th>
                <th scope="col" className="td label">Profile</th>
                <th scope="col" className="td label">What stands out</th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {shown.map((d) => {
                const a = d.anomaly
                const pct = pctText(a.percentile)
                const watch = d.watch || []
                const cell = `td max-md:block max-md:!py-1.5 ${watch.length ? '!border-b-0' : ''}`
                return (
                  <Fragment key={d.folder}>
                    <tr data-testid={`profile-row-${d.folder}`} className="max-md:mt-3 max-md:block max-md:border-t max-md:border-rule max-md:pt-3">
                      <td className={cell}>
                        <a href={href.deal(d.folder)} data-testid={`profile-deal-${d.folder}`} className="serif text-[17px] font-semibold !text-ink no-underline hover:underline">{d.name}</a>
                        <div className="text-[12px] text-label">{stageOf(d)}</div>
                      </td>
                      <td className={cell}>
                        <div className="flex items-center gap-2.5">
                          <div role="img" aria-label={`${pct} percentile`} className="h-1.5 w-[120px] shrink-0 bg-[#E6EAF0]">
                            <div className="h-1.5" style={{ width: `${Math.round(a.percentile * 100)}%`, background: scoreColor(a.percentile) }} />
                          </div>
                          <span className="whitespace-nowrap text-[14px] font-semibold text-ink" data-testid={`profile-pct-${d.folder}`}>{pct}</span>
                        </div>
                      </td>
                      <td className={cell}>
                        <div className="flex flex-wrap gap-1.5">
                          {a.unusual ? <Chip tone="risk">Unusual</Chip> : <Chip tone="gray">Within range</Chip>}
                          {d.fraud.flagged && !d.fraud.released && <Chip tone="risk">Frozen: fraud</Chip>}
                        </div>
                      </td>
                      <td className={`${cell} text-text2`}>
                        {a.top?.length
                          ? <ul className="m-0 flex list-none flex-col gap-1 p-0">{a.top.slice(0, 3).map((t) => <li key={t.feature} title={`${t.feature}: ${t.z} standard deviations from typical`}>{factorText(t)}</li>)}</ul>
                          : <span className="text-label">Nothing stands out</span>}
                      </td>
                    </tr>
                    {watch.length > 0 && (
                      <tr data-testid={`profile-watch-${d.folder}`} className="max-md:block">
                        <td colSpan={4} className="td !pt-0 max-md:block">
                          <div className="flex flex-col gap-1 border-l-[3px] border-mist-edge bg-mist px-4 py-2.5">
                            <span className="label">Watch notes</span>
                            <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4 text-[13px] leading-relaxed text-muted">
                              {watch.map((w, i) => <li key={i}>{cap(tidyList(w))}</li>)}
                            </ul>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!all && hidden > 0 && (
        <Button className="self-start" data-testid="profile-more" onClick={() => setAll(true)}>Show all {plural(rows.length, 'deal')}</Button>
      )}
    </section>
  )
}
