import { useEffect, useState } from 'react'
import { useApp } from '../lib/useDealPilot'
import { api } from '../lib/api'
import { fmtClock } from '../lib/format'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import PageTitle from '../components/PageTitle'

const ADVANCE = [['30m', '+30 min'], ['1h', '+1 hour'], ['6h', '+6 hours'], ['1d', '+1 day']]
const FRIDAY = '2026-11-06T18:00-06:00'

function Card({ title, children, className = '', id }) {
  return (
    <section className={`card box-border flex flex-col gap-3.5 px-[26px] py-6 ${className}`} data-testid={id}>
      <h2 className="h2 !text-[22px]">{title}</h2>
      {children}
    </section>
  )
}
const P = ({ children, ...r }) => <p className="m-0 text-[14px] leading-relaxed text-muted" {...r}>{children}</p>
const Kv = ({ k, v, id }) => (
  <div className="flex justify-between gap-3 border-b border-hair py-[9px] text-[14px]">
    <span className="text-label">{k}</span><span className="font-semibold" data-testid={id}>{v}</span>
  </div>
)

export default function Simulation() {
  const { state, act, version, busy } = useApp()
  const [health, setHealth] = useState(null)
  const [jump, setJump] = useState('2026-11-04T09:00-06:00')
  const [root, setRoot] = useState('')
  const [arr, setArr] = useState('')
  const [folder, setFolder] = useState('')
  const [dlg, setDlg] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => { api('/health').then(setHealth).catch(() => setHealth(null)) }, [version])

  const clock = (path, body) => { setMsg(''); return act(() => api(path, body)) }
  const load = async (replace) => {
    setDlg(null); setMsg('')
    const r = await act(() => api('/dataset/load', { root: root || null, arrivals: arr || null, folder: folder || null, replace }))
    if (r.ok) setMsg(replace ? 'Started fresh on this pack.' : 'Added the drop to the running week.')
  }
  const reset = async () => { setDlg(null); setMsg(''); const r = await act(() => api('/clock/reset', {})); if (r.ok) setMsg('Back to the start of the week.') }

  const fixture = String(state.mode).startsWith('FIXTURE')
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-7 px-8 pb-[72px] pt-10" data-testid="view-simulation">
      <PageTitle label="For demos and testing" title="Simulation & data" subWidth="max-w-[760px]"
        sub="DealPilot replays a working week. Move the clock, let simulated colleagues answer for you, load a new set of loan files, or download the results." />
      {msg && <div role="status" data-testid="sim-msg" className="border border-[#BFDCCB] bg-[#E4F2EA] px-[18px] py-3.5 text-[14px] text-[#1B4D31]">{msg}</div>}

      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card title="Clock" id="sim-clock">
          <div className="flex flex-col gap-1">
            <span className="serif text-[30px] text-ink" data-testid="sim-time">{fmtClock(state.now)}</span>
            <P data-testid="sim-arrived">{state.n_arrived} of {state.n_total} files have arrived in the shared folder.</P>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {ADVANCE.map(([by, label]) => <Button key={by} data-testid={`sim-advance-${by}`} onClick={() => clock('/clock/advance', { by })}>{label}</Button>)}
          </div>
          <Button kind="primary" className="self-start" data-testid="sim-run-friday" onClick={() => clock('/clock/set', { t: FRIDAY })}>Run to Friday 6:00 PM</Button>
          <div className="flex flex-col gap-1.5 border-t border-hair pt-1.5">
            <label className="label" htmlFor="settime">Jump to a time</label>
            <div className="flex gap-2.5">
              <input id="settime" data-testid="sim-jump-input" className="field w-full" value={jump} onChange={(e) => setJump(e.target.value)} />
              <Button data-testid="sim-jump-go" onClick={() => clock('/clock/set', { t: jump })}>Go</Button>
            </div>
            <span className="text-[12px] text-label">The clock only moves forward. Use Reset to start over.</span>
          </div>
        </Card>

        <Card title="Simulated colleagues" id="sim-personas-card">
          <P>When on, the people in the workflow answer their own requests: some quickly, some slowly, and some are out of office. When off, every request waits for you in My tasks.</P>
          <button type="button" role="switch" aria-checked={state.personas} data-testid="sim-personas" disabled={busy}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3.5 border-0 bg-transparent p-0 text-[15px] font-semibold text-ink"
                  onClick={() => clock('/personas', { enabled: !state.personas })}>
            <span className="relative h-[30px] w-[52px] shrink-0 rounded-full" style={{ background: state.personas ? '#7399C6' : '#B8C2CF', boxShadow: state.personas ? 'inset 0 0 0 1px #5A82B0' : 'none' }}>
              <span className="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow" style={{ left: state.personas ? 25 : 3 }} />
            </span>
            {state.personas ? 'On: colleagues answer on their own' : 'Off: I answer every request'}
          </button>
        </Card>

        <Card title="Results" id="sim-results">
          <P>The full record of the week: what was read from every file, each stage decision, who was asked, alerts sent, and fraud holds. Stage notes are written by Gemini as the file is prepared.</P>
          <Button kind="primary" href="/api/export?set=sample" download className="self-start" data-testid="sim-download">Download results (JSON)</Button>
        </Card>

        <Card title="System" id="sim-system">
          <Kv k="Reading documents with" v={fixture ? 'Test parser (Gemini not used)' : health?.gemini_key ? 'Gemini · connected' : 'No Gemini key'} id="sim-reader" />
          <Kv k="Model" v={health?.model || '—'} id="sim-model" />
          <Kv k="Gemini requests this session" v={health ? health.gemini_calls : '—'} id="sim-calls" />
          <Kv k="Files answered from cache" v={health ? health.cache_hits : '—'} id="sim-cache" />
        </Card>

        <Card title="Load loan files" className="col-span-full" id="sim-load">
          <P>Point DealPilot at a new data pack, or add a weekend drop of new files to the week that is running.</P>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {[['Data pack folder', 'root', root, setRoot, 'C:\\path\\to\\pack'], ['Arrivals file', 'arr', arr, setArr, 'C:\\path\\to\\arrivals.jsonl'], ['Shared folder with the files', 'folder', folder, setFolder, 'C:\\path\\to\\shared_folder']]
              .map(([label, id, val, set, ph]) => (
                <div key={id} className="flex flex-col gap-1.5">
                  <label className="label" htmlFor={`load-${id}`}>{label}</label>
                  <input id={`load-${id}`} data-testid={`sim-load-${id}`} className="field w-full" placeholder={ph} value={val} onChange={(e) => set(e.target.value)} />
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button kind="primary" data-testid="sim-load-fresh" onClick={() => setDlg('fresh')}>Start fresh on this pack</Button>
            <Button data-testid="sim-load-append" onClick={() => load(false)}>Add to the running week</Button>
          </div>
        </Card>

        <Card title="Reset the simulation" className="col-span-full !border-[#F0D2CE]" id="sim-reset-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <P>Clears every deal, request and alert and starts the week again. You will be asked to confirm.</P>
            <Button kind="risk" data-testid="sim-reset" onClick={() => setDlg('reset')}>Reset…</Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog open={dlg === 'reset'} title="Reset the simulation?" body="This clears every deal, request and alert and returns the clock to the start of the week."
                     okLabel="Reset everything" onConfirm={reset} onCancel={() => setDlg(null)} />
      <ConfirmDialog open={dlg === 'fresh'} title="Start fresh on this pack?" body="The current week is thrown away and DealPilot starts over with the files you pointed at."
                     okLabel="Start fresh" tone="primary" onConfirm={() => load(true)} onCancel={() => setDlg(null)} />
    </main>
  )
}
