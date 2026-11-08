import { useState } from 'react'

const W = 500
const H = 250
const M = { left: 34, right: 8, top: 26, bottom: 50 }

function niceTop(max) {
  const m = Math.max(max, 1)
  const step = m <= 5 ? 1 : m <= 10 ? 2 : Math.ceil(m / 4)
  return { top: Math.ceil(m / step) * step, step }
}

// Bar with a 4px rounded data end at the top, anchored square to the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

/**
 * A single-series vertical bar chart in the console's own colours. One axis, a quiet grid, the count printed on each bar,
 * a hover/focus tooltip, and a hidden table for screen readers.
 * bars: [{key, label, sub?, value, color, href?, linkId?, tip}]
 */
export default function BarChart({ bars, title, testid }) {
  const [hot, setHot] = useState(null)
  const { top, step } = niceTop(Math.max(0, ...bars.map((b) => b.value)))
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const band = plotW / bars.length
  const bw = Math.min(48, band * 0.56)
  const y = (v) => M.top + plotH - (v / top) * plotH
  const ticks = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  const on = (key) => ({ onMouseEnter: () => setHot(key), onMouseLeave: () => setHot(null), onFocus: () => setHot(key), onBlur: () => setHot(null) })
  const hotBar = bars.find((b) => b.key === hot)
  const hotIdx = bars.findIndex((b) => b.key === hot)

  return (
    <div className="overflow-x-auto" data-testid={testid}>
      <div className="relative min-w-[440px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#B8C2CF' : '#EEF0F3'} strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#5A6577">{t}</text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = M.left + band * (i + 0.5)
            const h = (b.value / top) * plotH
            const shape = (
              <>
                <rect x={cx - band / 2} y={M.top} width={band} height={plotH + M.bottom} fill={hot === b.key ? '#EEF3F9' : 'transparent'} />
                {b.value > 0 && <path d={barPath(cx - bw / 2, y(b.value), bw, h)} fill={b.color} data-testid={`${testid}-bar-${b.key}`} />}
                <text x={cx} y={M.top + plotH + 19} textAnchor="middle" fontSize="12" fontWeight="500" fill="#2B3442">{b.label}</text>
                {b.sub && <text x={cx} y={M.top + plotH + 35} textAnchor="middle" fontSize="11" fill="#5A6577">{b.sub}</text>}
              </>
            )
            const count = (
              <text x={cx} y={y(b.value) - 7} textAnchor="middle" fontSize="13" fontWeight="600" fill="#0A1F44"
                    pointerEvents="none" aria-hidden="true" data-testid={`${testid}-value-${b.key}`}>{b.value}</text>
            )
            // In a linked bar the count sits outside the <a>, so the link's visible text is just its name ("Intake").
            return b.href ? (
              <g key={b.key}>
                <a href={b.href} aria-label={b.tip} data-testid={b.linkId} {...on(b.key)}>{shape}</a>
                {count}
              </g>
            ) : (
              <g key={b.key} tabIndex={0} role="img" aria-label={b.tip} {...on(b.key)}>{shape}{count}</g>
            )
          })}
        </svg>
        {hotBar && (
          <div role="status" data-testid={`${testid}-tip`}
               className="pointer-events-none absolute z-10 border border-rule bg-white px-3 py-2 text-[13px] text-ink shadow-[0_2px_10px_rgba(10,31,68,.12)]"
               style={{ left: `${Math.min(80, Math.max(20, ((M.left + band * (hotIdx + 0.5)) / W) * 100))}%`, top: `${(y(hotBar.value) / H) * 100}%`, transform: 'translate(-50%, calc(-100% - 22px))', whiteSpace: 'nowrap' }}>
            {hotBar.tip}
          </div>
        )}
        <table className="sr-only">
          <caption>{title}</caption>
          <tbody>{bars.map((b) => <tr key={b.key}><th scope="row">{b.label}{b.sub ? ` (${b.sub})` : ''}</th><td>{b.value}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}
