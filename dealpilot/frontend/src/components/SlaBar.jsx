/** Time-in-stage bar: accent while on time, amber from 100% of the limit, red from 150%. */
export default function SlaBar({ view, caption, label, track = '#E6EAF0', captionClass = 'text-[12px] text-label' }) {
  if (!view) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={label || caption} className="h-1.5" style={{ background: track }}>
        <div className="h-1.5" style={{ width: view.width, background: view.color }} />
      </div>
      <span className={captionClass}>{caption}</span>
    </div>
  )
}
