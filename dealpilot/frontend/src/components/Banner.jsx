import { useApp } from '../lib/useDealPilot'

function Row({ testid, children, onDismiss }) {
  return (
    <div role="alert" data-testid={testid} className="flex items-start justify-between gap-4 border-b border-[#F0D2CE] bg-[#FBE7E5] px-8 py-3 text-[14px] leading-snug text-[#7A1109]">
      <span className="mx-auto w-full max-w-[1360px]">{children}</span>
      {onDismiss && <button type="button" data-testid="banner-dismiss" className="btn !h-8 shrink-0 !px-3 !text-[13px]" onClick={onDismiss}>Dismiss</button>}
    </div>
  )
}

/** Everything that stops work or fails: no Gemini key, quota used up, unreadable files, a refused action, a lost connection. */
export default function Banner() {
  const app = useApp()
  const s = app.state
  const parked = Object.entries(s?.gemini?.parked || {})
  return (
    <>
      {s && !s.gemini_ready && (
        <Row testid="banner-nokey">No Gemini key, so nothing can be read. Put <code>GEMINI_API_KEY</code> in <code>dealpilot/.env</code> and restart the server. There is deliberately no fallback reader.</Row>
      )}
      {s && s.gemini_ready && parked.length > 0 && (
        <Row testid="banner-quota">
          Gemini quota is used up on {parked.map(([m, mins]) => `${m} (resets in about ${mins} min)`).join(', ')}.
          {s.stalled ? ' New files are on hold until a model is available; nothing is guessed.' : ''} Turn on billing for the API key to lift the free-tier limit.
        </Row>
      )}
      {s && s.gemini_ready && parked.length === 0 && s.errors?.length > 0 && (
        <Row testid="banner-extract">Some files could not be read: {s.errors.map((e) => `${e.path}: ${e.error}`).join(' | ')}</Row>
      )}
      {app.netError && <Row testid="banner-net">{app.netError}</Row>}
      {app.error && <Row testid="banner-error" onDismiss={app.clearError}>{app.error}</Row>}
    </>
  )
}
