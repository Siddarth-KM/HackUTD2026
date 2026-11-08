// One fetch wrapper for the whole console. api(path) is a GET; api(path, body) is a POST with a JSON body.
// A non-2xx answer throws Error(detail) so the message the backend wrote (e.g. "cannot move the clock backwards") is shown.
export async function api(path, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  const r = await fetch('/api' + path, init)
  if (!r.ok) {
    let msg = r.statusText || `Request failed (${r.status})`
    try {
      const j = await r.json()
      if (typeof j.detail === 'string') msg = j.detail
      else if (j.detail) msg = JSON.stringify(j.detail)
    } catch { /* keep the status text */ }
    throw new Error(msg)
  }
  return r.json()
}
