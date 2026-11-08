/** A summary tile: label, big serif number, one-line note, and a coloured top rule. */
export default function Stat({ label, value, note, color, id, basis = 220 }) {
  return (
    <div className="card flex flex-1 flex-col gap-1.5 px-[22px] py-5" style={{ borderTop: `3px solid ${color}`, flexBasis: basis }} data-testid={`stat-${id}`}>
      <span className="label">{label}</span>
      <span className="serif text-[40px] leading-none text-ink" data-testid={`stat-${id}-value`}>{value}</span>
      <span className="text-[13px] text-label" data-testid={`stat-${id}-note`}>{note}</span>
    </div>
  )
}
