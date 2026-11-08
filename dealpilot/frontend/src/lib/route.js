import { useEffect, useState } from 'react'

/** Hash routes: #/tasks  #/pipeline  #/pipeline/<Stage>  #/deal/<folder>  #/alerts  #/fraud  #/simulation  (no router library). */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '')
  const [path, qs = ''] = raw.split('?')
  const seg = path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const query = Object.fromEntries(new URLSearchParams(qs))
  const name = seg[0] || 'tasks'
  if (name === 'deal') return { name: 'deal', folder: seg.slice(1).join('/'), query }
  if (name === 'pipeline') return { name: 'pipeline', stage: seg[1] || null, query }
  if (['tasks', 'alerts', 'fraud', 'simulation'].includes(name)) return { name, query }
  return { name: 'tasks', query }
}

export const href = {
  tasks: (as) => (as ? `#/tasks?as=${encodeURIComponent(as)}` : '#/tasks'),
  pipeline: () => '#/pipeline',
  stage: (s) => `#/pipeline/${encodeURIComponent(s)}`,
  deal: (folder) => `#/deal/${encodeURIComponent(folder)}`,
  alerts: () => '#/alerts',
  fraud: () => '#/fraud',
  simulation: () => '#/simulation',
}

export function go(target) {
  window.location.hash = String(target).replace(/^#/, '')
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo?.(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
