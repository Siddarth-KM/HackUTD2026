import { useApp } from '../lib/useDealPilot'
import { fmtClock } from '../lib/format'
import { api } from '../lib/api'
import { href } from '../lib/route'
import Button from './Button'

const MODE = {
  gemini: { label: 'Gemini', dot: '#14532D', title: 'Documents are read by Gemini' },
  fixture: { label: 'Test parser', dot: '#7A4E00', title: 'Test mode: documents are read by the built-in test parser, not Gemini' },
  nokey: { label: 'No Gemini key', dot: '#9B1C12', title: 'No Gemini key: nothing can be read' },
}

function modeOf(state) {
  if (!state) return MODE.gemini
  if (String(state.mode).startsWith('FIXTURE')) return MODE.fixture
  if (!state.gemini_ready) return MODE.nokey
  return MODE.gemini
}

export default function Header({ route }) {
  const { state, act } = useApp()
  const pending = state?.pending?.length ?? 0
  const alerts = state?.alerts?.length ?? 0
  const frozen = (state?.deals || []).filter((d) => d.fraud.flagged && !d.fraud.released).length
  const mode = modeOf(state)
  const nav = [
    { id: 'tasks', label: 'My tasks', to: href.tasks(), count: pending },
    { id: 'pipeline', label: 'Pipeline', to: href.pipeline() },
    { id: 'performance', label: 'Performance', to: href.performance() },
    { id: 'alerts', label: 'Alerts', to: href.alerts(), count: alerts },
    { id: 'fraud', label: 'Fraud review', to: href.fraud(), count: frozen },
    { id: 'simulation', label: 'Simulation & data', to: href.simulation() },
  ]
  const active = route.name === 'deal' ? 'pipeline' : route.name
  const advance = (by) => act(() => api('/clock/advance', { by }))
  return (
    <header className="bg-accent text-ink">
      <div className={`mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 ${route.name === 'pipeline' ? 'max-w-[1400px] px-6' : 'max-w-[1360px] px-8'}`}>
        <a href={href.tasks()} data-testid="header-brand" className="py-4 font-serif text-[24px] font-semibold !text-ink no-underline">DealPilot</a>
        <nav aria-label="Main" className="order-last flex min-w-0 basis-full overflow-x-auto lg:order-none lg:flex-1 lg:basis-auto lg:overflow-visible">
          {nav.map((n) => (
            <a key={n.id} href={n.to} data-testid={`nav-${n.id}`} className={`nav ${active === n.id ? 'nav-on' : ''}`} aria-current={active === n.id ? 'page' : undefined}>
              {n.label}
              {n.count > 0 && <span className="count" data-testid={`nav-count-${n.id}`}>{n.count}</span>}
            </a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-ink">Simulated time</span>
            <span className="text-[14px] font-semibold" data-testid="header-time">{state ? fmtClock(state.now) : '…'}</span>
          </div>
          <Button kind="ghost" data-testid="header-advance-1h" onClick={() => advance('1h')}>+1 hour</Button>
          <Button kind="ghost" data-testid="header-advance-1d" onClick={() => advance('1d')}>+1 day</Button>
          <span title={mode.title} data-testid="header-status" className="inline-flex items-center gap-1.5 text-[12px] text-ink">
            <svg width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill={mode.dot} /></svg>{mode.label}
          </span>
        </div>
      </div>
    </header>
  )
}
