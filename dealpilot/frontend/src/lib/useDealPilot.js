import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'

export const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

/**
 * Owns the console's data: polls /api/state, and runs every action through act() so that
 *  - buttons are disabled and a progress bar shows while it runs,
 *  - a backend error becomes a visible message (never a silent no-op),
 *  - the state is refreshed right after.
 * act(fn) resolves to {ok:true, value} or {ok:false, error}.
 */
export function useDealPilot({ pollMs = 5000 } = {}) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [netError, setNetError] = useState('')
  const [version, setVersion] = useState(0)          // bumps after each action: lets screens re-read /api/health, etc.
  const seq = useRef(0)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const s = await api('/state')
      if (mine === seq.current) { setState(s); setNetError('') }
    } catch (e) {
      if (mine === seq.current) setNetError(`Cannot reach the DealPilot server: ${e.message}`)
    }
  }, [])

  const act = useCallback(async (fn) => {
    busyRef.current = true
    setBusy(true)
    setError('')
    let result
    try {
      result = { ok: true, value: await fn() }
    } catch (e) {
      const msg = e?.message || String(e)
      setError(msg)
      result = { ok: false, error: msg }
    }
    await refresh()
    busyRef.current = false
    setBusy(false)
    setVersion((v) => v + 1)
    return result
  }, [refresh])

  useEffect(() => {
    refresh()
    const t = setInterval(() => {
      if (!document.hidden && !busyRef.current) refresh()
    }, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  return { state, busy, error, netError, version, act, refresh, clearError: () => setError('') }
}
