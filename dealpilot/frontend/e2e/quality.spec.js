// Fidelity to the approved mockup (computed styles), accessibility on every screen, pictures for review, and the
// "no untested control" guard. Read-only: one shared Wednesday 11:00 state.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, T, snapshot, open } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, 'screenshots')

let api
test.beforeAll(async ({ playwright }) => { api = await snapshot(playwright, T.wed11); fs.mkdirSync(OUT, { recursive: true }) })
test.afterAll(async () => { await api.dispose() })

const SCREENS = [
  ['tasks', '#/tasks'],
  ['pipeline', '#/pipeline'],
  ['pipeline-credit', '#/pipeline/Credit'],
  ['deal-bluebonnet', '#/deal/Bluebonnet%20Landscape'],
  ['deal-priya', "#/deal/Priya's%20Bakery"],
  ['deal-granite', '#/deal/Granite%20Bay%20Building%20Supply'],
  ['deal-ridgeway', '#/deal/Ridgeway%20Freight%20Logistics'],
  ['performance', '#/performance'],
  ['alerts', '#/alerts'],
  ['fraud', '#/fraud'],
  ['simulation', '#/simulation'],
]

const css = (page, testid, prop) => page.getByTestId(testid).first().evaluate((el, p) => getComputedStyle(el)[p], prop)

test('design tokens match the mockup: colours, fonts, sizes', async ({ page }) => {
  await open(page, '#/fraud')
  await page.evaluate(() => document.fonts.ready)
  // header band: the Goldman-style light blue, with dark text
  expect(await page.locator('header').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(115, 153, 198)')
  expect(await page.locator('header').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(10, 31, 68)')
  // page background and cards
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(245, 247, 250)')
  expect(await css(page, 'fraud-cluster', 'borderTopColor')).toBe('rgb(217, 222, 229)')
  // type: Inter for text, Source Serif 4 for titles, H1 44px
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Inter/)
  expect(await css(page, 'page-title', 'fontFamily')).toMatch(/Source Serif 4/)
  expect(await css(page, 'page-title', 'fontSize')).toBe('44px')
  expect(await css(page, 'page-title', 'color')).toBe('rgb(10, 31, 68)')
  expect(await page.evaluate(() => document.fonts.check('500 44px "Source Serif 4"') && document.fonts.check('600 14px Inter'))).toBe(true)
  // primary button: light blue fill, dark text, 44px high, 2px corners
  const btn = page.getByTestId('fraud-answer')
  expect(await btn.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.height, c.borderRadius, c.fontWeight] }))
    .toEqual(['rgb(115, 153, 198)', 'rgb(10, 31, 68)', '44px', '2px', '600'])
  // active tab: bold with a 3px dark underline; count badge dark with white text
  const nav = page.getByTestId('nav-fraud')
  expect(await nav.evaluate((el) => { const c = getComputedStyle(el); return [c.fontWeight, c.borderBottomColor, c.borderBottomWidth] })).toEqual(['700', 'rgb(10, 31, 68)', '3px'])
  expect(await css(page, 'nav-count-fraud', 'backgroundColor')).toBe('rgb(10, 31, 68)')
  expect(await css(page, 'nav-count-fraud', 'color')).toBe('rgb(255, 255, 255)')
  // chips: 11px, uppercase, 24px high
  const chip = page.locator('.chip').first()
  expect(await chip.evaluate((el) => { const c = getComputedStyle(el); return [c.fontSize, c.textTransform, c.height] })).toEqual(['11px', 'uppercase', '24px'])
  // outline button: dark border on white
  await open(page, '#/pipeline')
  expect(await page.getByTestId('pipeline-download').evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopColor, c.backgroundColor] })).toEqual(['rgb(10, 31, 68)', 'rgb(255, 255, 255)'])
  // board column header: light-blue top rule
  expect(await css(page, 'board-col-Credit', 'borderTopColor')).toBe('rgb(115, 153, 198)')
})

test('new sections use the same colours and fonts as the rest of the site', async ({ page }) => {
  await open(page, '#/performance')
  await page.evaluate(() => document.fonts.ready)
  expect(await css(page, 'chart-stage-bar-Intake', 'fill')).toBe('rgb(115, 153, 198)')
  expect(await css(page, 'stat-perf-late', 'borderTopColor')).toBe('rgb(183, 121, 31)')
  expect(await css(page, 'stat-perf-late-value', 'fontFamily')).toMatch(/Source Serif 4/)
  expect(await css(page, 'page-title', 'fontSize')).toBe('44px')
  await open(page, '#/fraud')
  expect(await page.locator('[data-testid="fraud-graph"] h2').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Source Serif 4/)
  expect(await page.locator('[data-testid="fraud-profiles"] h2').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(10, 31, 68)')
  expect(await css(page, 'fraud-graph', 'borderTopColor')).toBe('rgb(217, 222, 229)')
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Inter/)
})

test('the board header is a bit wider (1400px) than the other screens, as in the mockup', async ({ page }) => {
  await open(page, '#/pipeline')
  const w = await page.locator('header > div').evaluate((el) => el.getBoundingClientRect().width)
  expect(w).toBe(1400)
  await open(page, '#/alerts')
  expect(await page.locator('header > div').evaluate((el) => el.getBoundingClientRect().width)).toBe(1360)
})

for (const [name, hash] of SCREENS) {
  test(`accessibility: ${name} has no serious or critical problems`, async ({ page }) => {
    await open(page, hash)
    await page.waitForTimeout(250)
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  })
}

for (const [name, hash] of SCREENS) {
  for (const [label, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    test(`picture: ${name} (${label})`, async ({ page }) => {
      await page.setViewportSize(size)
      await open(page, hash)
      await page.waitForTimeout(350)
      await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), fullPage: true })
      if (label === 'phone') {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, `${name}: page scrolls sideways at 390px`).toBeLessThanOrEqual(1)
      }
    })
  }
}

test('no untested control: every button, link, input, select and switch has a test id that a spec exercises', async ({ page }) => {
  page.allow('/api/clock/set')
  page.allow('/api/deals/')                                           // the unknown-deal page asks for a deal that does not exist
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'interactions.json'), 'utf8'))
  delete manifest._doc
  const rx = (p) => new RegExp('^' + p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$')
  const rules = Object.entries(manifest).map(([p, spec]) => ({ p, spec, re: rx(p) }))
  const seen = new Set()
  const naked = []
  const collect = async (where) => {
    const items = await page.$$eval('button, a[href], input, select, textarea, [role="switch"]',
      (els) => els.map((e) => ({ id: e.getAttribute('data-testid'), tag: e.tagName, text: (e.textContent || e.placeholder || '').trim().slice(0, 40) })))
    for (const i of items) (i.id ? seen.add(i.id) : naked.push(`${where}: <${i.tag}> "${i.text}"`))
  }
  const visit = async (hash, steps) => { await open(page, hash); await expect(page.locator('[data-testid^="view-"], [data-testid="deal-missing"]').first()).toBeVisible(); await collect(hash); if (steps) { await steps(); await collect(`${hash} (after)`) } }

  await visit('#/tasks', async () => { await page.getByTestId('task-more-victor.hale').click() })
  await visit('#/pipeline')
  await visit('#/pipeline/Credit')
  await visit('#/performance')
  await visit('#/deal/Bluebonnet%20Landscape')
  await visit('#/deal/Ridgeway%20Freight%20Logistics')
  await visit('#/deal/Granite%20Bay%20Building%20Supply')
  await visit('#/deal/Nope')
  await visit('#/alerts', async () => { await page.getByTestId('alerts-more').click() })
  await visit('#/fraud')
  await visit('#/simulation', async () => {
    await page.getByTestId('sim-reset').click()                       // opens the confirmation dialog
    await collect('simulation (dialog open)')
    await page.keyboard.press('Escape')
    await page.getByTestId('sim-jump-go').click()                     // 400: clock cannot go backwards -> error banner with Dismiss
    await expect(page.getByTestId('banner-error')).toBeVisible()
  })
  await open(page, '#/tasks')
  await page.getByTestId('task-answer-1-decline').click()
  await collect('tasks (decline dialog)')

  expect(naked, 'controls without a data-testid').toEqual([])
  const unmapped = [...seen].filter((id) => !rules.some((r) => r.re.test(id)))
  expect(unmapped, 'test ids missing from e2e/interactions.json').toEqual([])
  const optional = new Set(['deal-accept-all'])                       // only shown on a deal with 2+ blockers (load-and-drop.spec.js)
  const unseen = rules.filter((r) => !optional.has(r.p) && ![...seen].some((id) => r.re.test(id))).map((r) => r.p)
  expect(unseen, 'manifest entries that no screen shows (stale?)').toEqual([])
  // each named spec really mentions its control
  const missing = []
  for (const r of rules) {
    const prefix = r.p.split('*')[0]
    const text = fs.readFileSync(path.join(here, r.spec), 'utf8')
    if (!text.includes(prefix)) missing.push(`${r.p} -> ${r.spec}`)
  }
  expect(missing, 'specs that never mention their control').toEqual([])
})
