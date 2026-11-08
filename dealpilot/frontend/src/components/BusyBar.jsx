/** Shown while an action runs (reading documents with Gemini can take a while). */
export default function BusyBar({ busy }) {
  if (!busy) return null
  return (
    <div role="status" aria-live="polite" data-testid="busy-bar" className="border-b border-mist-edge bg-mist">
      <div className="relative h-[3px] overflow-hidden bg-mist-edge">
        <div className="absolute inset-y-0 left-0 w-1/4 bg-accent-edge" style={{ animation: 'dp-busy 1.2s linear infinite' }} />
      </div>
      <p className="m-0 mx-auto max-w-[1360px] px-8 py-2 text-[13px] text-ink">Working… reading documents with Gemini can take a while the first time.</p>
    </div>
  )
}
