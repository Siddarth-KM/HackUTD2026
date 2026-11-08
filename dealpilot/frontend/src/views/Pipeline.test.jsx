import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Pipeline from './Pipeline'
import { href } from '../lib/route'
import { fx, renderView } from '../test/utils'

const col = (name) => screen.getByRole('region', { name })
const cardsIn = (name) => within(col(name)).queryAllByTestId(/^board-card-/)

describe('Pipeline board: every stage on one page', () => {
  it('shows seven columns with their counts, and the totals', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    expect(screen.getByTestId('board')).toBeInTheDocument()
    expect(['Intake', 'Credit', 'Committee', 'Product', 'Committed', 'Closed', 'Stopped'].map((c) => screen.getByTestId(`board-count-${c}`).textContent))
      .toEqual(['5', '7', '0', '0', '0', '0', '0'])
    expect(screen.getByTestId('pipeline-summary')).toHaveTextContent('12 deals · $3,321,500 requested · 4 frozen for fraud review')
    expect(screen.queryByTestId('stage-focus')).toBeNull()
  })
  it('puts each deal in its stage and links it to its page', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    expect(cardsIn('Intake')).toHaveLength(5)
    expect(cardsIn('Credit')).toHaveLength(7)
    const priya = screen.getByTestId("board-card-Priya's Bakery")
    expect(priya).toHaveAttribute('href', href.deal("Priya's Bakery"))
    expect(within(col('Credit')).getByTestId("board-card-Priya's Bakery")).toBe(priya)
  })
  it('shows an empty placeholder in stages with no deals', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    for (const c of ['Committee', 'Product', 'Committed', 'Closed']) expect(screen.getByTestId(`board-empty-${c}`)).toHaveTextContent('No deals here yet')
    expect(screen.getByTestId('board-empty-Stopped')).toHaveTextContent('No declined or stopped deals')
  })
  it('a card carries name, amount, RM, at most two chips, the time bar and what it waits for', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    const g = screen.getByTestId('board-card-Granite Bay Building Supply')
    expect(g).toHaveTextContent('Granite Bay Building Supply LLC')
    expect(g).toHaveTextContent('$300,000')
    expect(g).toHaveTextContent('RM Elena Ruiz')
    expect(g).toHaveTextContent('Frozen: fraud')
    expect(g).toHaveTextContent('Failed 2 checks')
    expect(g).toHaveTextContent('19.1h of 8h · 239%')
    expect(g).toHaveTextContent('Fraud Ops decision (Victor Hale)')
    expect(within(screen.getByTestId('board-card-Bluebonnet Landscape')).getByRole('img').getAttribute('aria-label')).toBe('25.5h in stage of 8h allowed (319%)')
    for (const c of screen.getAllByTestId(/^board-card-/)) expect(c.querySelectorAll('.chip').length).toBeLessThanOrEqual(2)
  })
  it('colours the bar by how late the deal is', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    const bar = (f) => within(screen.getByTestId(`board-card-${f}`)).getByRole('img').firstChild.style.background
    expect(bar('Harbor Tea Co')).toBe('rgb(115, 153, 198)')          // 3%: accent
    expect(bar("Maria's Pharmacy".replace("Maria's Pharmacy", 'Garza Family Pharmacy'))).toBe('rgb(183, 121, 31)')   // 102%: amber
    expect(bar('Ridgeway Freight Logistics')).toBe('rgb(180, 35, 24)')   // 564%: red
  })
  it('the download button points at the export', () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    const a = screen.getByTestId('pipeline-download')
    expect(a).toHaveAttribute('href', '/api/export?set=sample')
    expect(a).toHaveAttribute('download')
  })
  it('"Find a deal" narrows the board by name or by relationship manager', async () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    await userEvent.type(screen.getByTestId('pipeline-search'), 'bake')
    expect(screen.getAllByTestId(/^board-card-/)).toHaveLength(1)
    expect(cardsIn('Credit')).toHaveLength(1)
    expect(screen.getByTestId('board-empty-Intake')).toHaveTextContent('No matching deals')
    await userEvent.clear(screen.getByTestId('pipeline-search'))
    await userEvent.type(screen.getByTestId('pipeline-search'), 'elena')
    const all = screen.getAllByTestId(/^board-card-/)
    expect(all.length).toBeGreaterThan(3)
    for (const c of all) expect(c).toHaveTextContent('RM Elena Ruiz')
    await userEvent.clear(screen.getByTestId('pipeline-search'))
    expect(screen.getAllByTestId(/^board-card-/)).toHaveLength(12)
  })
  it('clicking a stage name opens that stage', async () => {
    renderView(<Pipeline />, { hash: '#/pipeline' })
    await userEvent.click(screen.getByTestId('board-col-Credit'))
    expect(window.location.hash).toBe('#/pipeline/Credit')
    await userEvent.click(screen.getByTestId('board-col-Stopped'))
    expect(window.location.hash).toBe('#/pipeline/Stopped')
  })
  it('puts funded deals in Closed with a Funded chip, and declined deals in Stopped', () => {
    const funded = fx.fri18.deals.filter((d) => d.status === 'funded')
    expect(funded.length).toBeGreaterThan(0)
    const { unmount } = renderView(<Pipeline />, { state: fx.fri18, hash: '#/pipeline' })
    expect(cardsIn('Closed')).toHaveLength(funded.length)
    for (const c of cardsIn('Closed')) expect(c).toHaveTextContent('Funded')
    expect(cardsIn('Closed')[0]).toHaveTextContent('Funds released')
    unmount()
    renderView(<Pipeline />, { state: fx.declined, hash: '#/pipeline' })
    expect(cardsIn('Stopped')).toHaveLength(1)
    expect(cardsIn('Stopped')[0]).toHaveTextContent('Declined')
  })
})

describe('Pipeline stage view: the previous layout, one stage at a time', () => {
  it('shows the stage with large cards, full chips and "Waiting for"', () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Intake' })
    expect(screen.getByTestId('stage-focus')).toBeInTheDocument()
    expect(screen.queryByTestId('board')).toBeNull()
    expect(screen.getByTestId('focus-title')).toHaveTextContent('Intake')
    expect(screen.getByText(/5 deals · documents checked automatically/)).toBeInTheDocument()
    expect(screen.getAllByTestId(/^focus-card-/)).toHaveLength(5)
    const g = screen.getByTestId('focus-card-Granite Bay Building Supply')
    expect(g).toHaveTextContent('Bank statement does not add up')
    expect(g).toHaveTextContent('Revenue inflated')
    expect(g).toHaveTextContent('19.1h in stage of 8h allowed (239%)')
    expect(g).toHaveTextContent('Waiting for')
    expect(g).toHaveTextContent('Fraud Operations decision on the hold request (Victor Hale)')
    expect(g).toHaveAttribute('href', href.deal('Granite Bay Building Supply'))
  })
  it('has a strip of all seven stages; the open one is selected; each switches stage', async () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Credit' })
    const strip = screen.getAllByTestId(/^pipeline-strip-/)
    expect(strip).toHaveLength(7)
    expect(screen.getByTestId('pipeline-strip-Credit')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('pipeline-strip-Intake')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByTestId(/^focus-card-/)).toHaveLength(7)
    await userEvent.click(screen.getByTestId('pipeline-strip-Intake'))
    expect(window.location.hash).toBe('#/pipeline/Intake')
    await userEvent.click(screen.getByTestId('pipeline-strip-Stopped'))
    expect(window.location.hash).toBe('#/pipeline/Stopped')
  })
  it('"Back to all stages" returns to the board', async () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Credit' })
    await userEvent.click(screen.getByTestId('pipeline-back'))
    expect(window.location.hash).toBe('#/pipeline')
  })
  it('an empty stage says so', () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Committee' })
    expect(screen.getByTestId('focus-empty')).toHaveTextContent('No deals are in this stage right now.')
    expect(screen.getByText(/under \$250,000 Priscilla Nguyen, otherwise Harold Benson/)).toBeInTheDocument()
  })
  it('search also narrows the stage view', async () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Credit' })
    await userEvent.type(screen.getByTestId('pipeline-search'), 'harbor')
    expect(screen.getAllByTestId(/^focus-card-/)).toHaveLength(1)
  })
  it('an unknown stage falls back to the board', () => {
    renderView(<Pipeline />, { hash: '#/pipeline/Nowhere' })
    expect(screen.getByTestId('board')).toBeInTheDocument()
  })
})
