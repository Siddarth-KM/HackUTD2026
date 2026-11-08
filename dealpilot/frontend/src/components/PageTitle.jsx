/** Micro-label, serif H1 and a one-sentence explanation. `children` sits on the right (filters, buttons). */
export default function PageTitle({ label, title, sub, children, subWidth = 'max-w-[760px]' }) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-5">
      <div className={`flex flex-col gap-2 ${subWidth}`}>
        {label && <span className="label" data-testid="page-label">{label}</span>}
        <h1 className="h1" data-testid="page-title">{title}</h1>
        {sub && <p className="m-0 text-[16px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {children}
    </section>
  )
}
