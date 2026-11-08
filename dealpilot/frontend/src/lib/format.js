// Times are shown in the bank's time zone (Central), whatever the browser's zone is.
const TZ = 'America/Chicago'

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-06" -> "June 2026" */
export function monthName(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ym
}

function parts(iso, opts) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const out = {}
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).formatToParts(d)) out[p.type] = p.value
  return out
}

/** "Wed, Nov 4 · 11:00 AM CT" */
export function fmtClock(iso) {
  const p = parts(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return p ? `${p.weekday}, ${p.month} ${p.day} · ${p.hour}:${p.minute} ${p.dayPeriod} CT` : ''
}

/** "Tue 9:20 AM" */
export function fmtShort(iso) {
  const p = parts(iso, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return p ? `${p.weekday} ${p.hour}:${p.minute} ${p.dayPeriod}` : ''
}

/** "Wednesday, November 4" */
export function fmtDay(iso) {
  const p = parts(iso, { weekday: 'long', month: 'long', day: 'numeric' })
  return p ? `${p.weekday}, ${p.month} ${p.day}` : ''
}

/** "$247,500" */
export function money(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—'
  return '$' + Math.round(Number(n)).toLocaleString('en-US')
}

export function initials(name) {
  const w = String(name || '').split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase()
}

export function ordinal(n) {
  const v = Math.round(n)
  const s = ['th', 'st', 'nd', 'rd']
  const m = v % 100
  return v + (s[(m - 20) % 10] || s[m] || s[0])
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + 's'}`
}

export function hoursBetween(fromIso, toIso) {
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return (b - a) / 3600000
}
