// Fixed, deterministic layout for the fraud relationship graph (no physics): each linked group is a ring of its members
// around a group hub; deals flagged only by a known-fraud check sit in a row underneath.

export const GRAPH_W = 1000
const isHistory = (id) => /^H-\d/.test(id)

/** "people:preparer_phone=2145550187" -> {family, key, value} (the shape evidenceLabel() reads). */
export function parseToken(token) {
  const t = String(token || '')
  const c = t.indexOf(':')
  const rest = c < 0 ? t : t.slice(c + 1)
  const e = rest.indexOf('=')
  return { family: c < 0 ? '' : t.slice(0, c), key: e < 0 ? rest : rest.slice(0, e), value: e < 0 ? '' : rest.slice(e + 1) }
}

export const shortLabel = (s, n = 30) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s))

/**
 * clusters: state.clusters; lone: ids of flagged deals that are in no cluster; width: viewBox width.
 * Returns {nodes:[{key,id,kind,x,y,group,anchor,lx,ly}], edges:[{key,kind,a,b,x1,y1,x2,y2,score,shared,group}], height, loneY}.
 * kind: hub | live | history | lone.  Edge kind: link (shares rare details) | member (hub to member).
 */
export function layout(clusters = [], lone = [], width = GRAPH_W) {
  const nodes = []
  const edges = []
  const n = clusters.length
  const region = n ? width / n : width
  let ringH = 0
  const radius = (m) => Math.max(95, Math.min(region / 2 - 110, 60 + 22 * m))
  for (const c of clusters) ringH = Math.max(ringH, 2 * radius(c.members.length) + 110)

  clusters.forEach((c, gi) => {
    const r = radius(c.members.length)
    const cx = region * (gi + 0.5)
    const cy = ringH / 2
    const hubKey = `hub:${gi}`
    nodes.push({ key: hubKey, id: `group-${gi + 1}`, kind: 'hub', x: cx, y: cy, group: gi, anchor: 'middle', lx: cx, ly: cy + 34 })
    const pos = {}
    c.members.forEach((m, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / c.members.length
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle'
      const lx = x + (anchor === 'start' ? 16 : anchor === 'end' ? -16 : 0)
      const ly = anchor === 'middle' ? y + (sin < 0 ? -18 : 28) : y + 5
      const key = `${gi}:${m}`
      pos[m] = { x, y, key }
      nodes.push({ key, id: m, kind: isHistory(m) ? 'history' : 'live', x, y, group: gi, anchor, lx, ly })
      edges.push({ key: `member:${gi}:${m}`, kind: 'member', a: hubKey, b: key, x1: cx, y1: cy, x2: x, y2: y, group: gi })
    })
    for (const e of c.edges || []) {
      const A = pos[e.a]
      const B = pos[e.b]
      if (!A || !B) continue
      edges.push({ key: `${e.a}|${e.b}`, kind: 'link', a: A.key, b: B.key, x1: A.x, y1: A.y, x2: B.x, y2: B.y,
        score: e.score, shared: e.shared || [], extra: e.extra || [], group: gi })
    }
  })

  let height = n ? ringH : 0
  let loneY = null
  if (lone.length) {
    loneY = height + 70
    const step = width / lone.length
    lone.forEach((id, i) => {
      const x = step * (i + 0.5)
      nodes.push({ key: `lone:${id}`, id, kind: 'lone', x, y: loneY, group: null, anchor: 'middle', lx: x, ly: loneY + 30 })
    })
    height = loneY + 50
  }
  return { nodes, edges, height, loneY }
}

/** Keys of the nodes touching `key` (a node key) plus the node itself. */
export function neighbours(edges, key) {
  const out = new Set([key])
  for (const e of edges) {
    if (e.a === key) out.add(e.b)
    if (e.b === key) out.add(e.a)
  }
  return out
}
