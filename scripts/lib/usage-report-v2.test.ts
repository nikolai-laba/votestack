// A smoke test for the v2 report page: fills the template with a hand-built
// fixture holding rows of every event, before and after the new counts
// began, runs it in a browser-like window and checks each section.

import { readFile } from 'node:fs/promises'
// @ts-expect-error jsdom ships no types, and @types/jsdom would be a new dependency.
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { fillTemplate, measuresScript } from './usage-report-build.ts'

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')
const at = (iso: string) => Date.parse(iso) / 1000
const HOUR = 3600

type Row = (string | number)[]
/** One stored row: [hour, event, a, b, c, n, d1..d8, live]. */
const row = (
  hour: number,
  event: string,
  a = '',
  b = '',
  c = '',
  n = 1,
  d1 = 0,
  live = 0,
): Row => [hour, event, a, b, c, n, d1, 0, 0, 0, 0, 0, 0, 0, live]

const NOW = '2026-10-25T18:00:00Z'
// History on Oct 21; the new counts from Oct 24 15:00 UTC.
const PRE = at('2026-10-21T15:00:00Z')
const LAUNCH = at('2026-10-24T15:00:00Z')
const LATER = at('2026-10-25T12:00:00Z')

const history: Row[] = [
  row(PRE, 'view', 'ballot', 'landing', '', 5),
  row(PRE, 'view', 'profile', 'landing', 'jane-doe', 3),
  row(PRE, 'view', 'races', 'landing', 'il/cook/mayor', 1),
  row(PRE, 'view', 'start', 'app', '', 2),
  row(PRE, 'voter', 'new', 'il-cook', 'timed', 2, 30),
  row(PRE, 'voter', 'new', 'ca-la', 'restored', 1),
  row(PRE, 'voter', 'return', 'ca-la', '', 1),
  row(PRE, 'sample', 'seen', 'ca-la'),
  row(PRE, 'open', 'local', '1', '', 2),
  row(PRE, 'open', 'local', '2'),
  row(PRE, 'pick', 'local', '1'),
  row(PRE, 'pick', 'local', '0'),
  row(PRE, 'half', 'il-cook', '1'),
  row(PRE, 'fill', '50', 'il-cook'),
  // Three ballot-path devices compared two profiles: the North Star stand-in.
  row(PRE, 'learn', 'compared', 'il-cook', '1', 3),
  row(PRE, 'learn', 'researched', 'il-cook', '1'),
  // More researched ballots than ballot-path arrivals, from history.
  row(PRE, 'learn', 'researched', 'ca-la', '1', 12),
  row(PRE, 'learn', 'races', 'ca-la', '1'),
  row(PRE, 'lookup', 'ok', 'il-cook', '0', 2, 900),
  row(PRE, 'lookup', 'not_found', 'ca-la', '0', 1, 400),
  row(PRE, 'lookup', 'ok', 'ca-la', '1', 1, 300),
  row(PRE, 'out', 'profile'),
  row(PRE, 'active', '1', '', '', 1, 60),
  row(PRE, 'banner', 'shown'),
]

const counted: Row[] = [
  row(LAUNCH, 'view', 'ballot', 'landing', '', 4),
  row(LAUNCH, 'voter', 'new', 'ca-la', 'timed', 1, 20),
  row(LAUNCH, 'lookup', 'ok', 'ca-la', '0', 1, 700),
  row(LAUNCH, 'lookup', 'gaps', 'il-cook', '0', 1, 800),
  row(LAUNCH, 'open', 'county', '1'),
  row(LAUNCH, 'pick', 'county', '1'),
  row(LAUNCH, 'learn', 'compared', 'ca-la', '1'),
  ...(
    [
      ['arrived', 4],
      ['browsed', 2],
      ['form', 3],
      ['asked', 2],
      ['lookup', 2],
      ['returned', 1],
      ['informed', 1],
      ['researched', 1],
      ['picked', 1],
    ] as const
  ).map(([step, n]) => row(LAUNCH, 'visit', 'ballot', 'direct', step, n)),
  ...(
    [
      ['arrived', 6],
      ['read', 4],
      ['informed', 2],
      ['form', 2],
      ['asked', 1],
      ['lookup', 1],
    ] as const
  ).map(([step, n]) => row(LATER, 'visit', 'profile', 'search', step, n)),
  row(LATER, 'visit', 'races', 'social', 'arrived', 2),
  row(LATER, 'visit', 'about', 'ai', 'arrived'),
  ...['day', 'week', 'month', 'election'].flatMap((period) => [
    row(LAUNCH, 'device', period, 'new', '', 5),
    row(LAUNCH, 'device', period, 'back', '', 3),
  ]),
  ...['10', '20', '30', '60', 'sources', 'read'].map((mark) =>
    row(LATER, 'read', 'reader', 'candidate', mark, 2),
  ),
  row(LAUNCH, 'read', 'ballot', 'judicial', 'read'),
  // Six newly informed devices from launch: 2 + 4, plus 3 from history = 9.
  row(LAUNCH, 'informed', 'election', 'ballot', 'compared', 2),
  row(LATER, 'informed', 'election', 'reader', 'single', 4),
  row(LATER, 'informed', 'week', 'reader', 'single', 5),
  row(LATER, 'cta', 'top', 'profile', '', 2),
  row(LATER, 'cta', 'form', 'races'),
  row(LATER, 'origin', 'profile', 'search', 'same'),
  row(LATER, 'origin', 'unknown', 'unknown', 'later'),
  row(LAUNCH, 'dropped', 'bot', '', '', 2),
  row(LAUNCH, 'dropped', 'invalid', '', '', 1, 3),
  row(LAUNCH, 'dropped', 'limited'),
  row(LATER + HOUR, 'view', 'profile', 'landing', 'jane-doe', 1, 0, 1),
]

const DATA = {
  generatedAt: NOW,
  rolledUpTo: LATER,
  liveNote: '1 rows read from Analytics Engine',
  excludedNote: '',
  rows: [...history, ...counted],
  reports: [['2026-10-22T10:00:00Z', 'open', 'bio', 'il-2026-11']],
  signups: [['2026-10-22T10:00:00Z', '60601', 'area', 'banner']],
  candidates: { 'jane-doe': ['Jane Doe', 'Mayor', 'il-cook'] },
  races: { 'il/cook/mayor': ['Mayor', 'local', 'il-cook'] },
  releases: [
    {
      version: '1.5.1',
      date: '2026-10-23',
      note: 'Profiles for offices with one candidate.',
    },
    { version: '1.5.0', date: '2026-09-01', note: 'Before the range.' },
  ],
  coverage: { candidates: 120, races: 40, areas: 2 },
  costs: { monthly: [{ name: 'Hosting', usd: 31, from: '2026-10' }] },
}

// The scripts are type-checked without the DOM library, and jsdom ships no
// types, so the few window types used here are spelled out.
type ErrorEvent = { error?: Error; message: string }
type PageWindow = {
  addEventListener(type: 'error', listener: (ev: ErrorEvent) => void): void
}
type EventTarget = { dispatchEvent(ev: unknown): boolean }
type Select = { value: string } & EventTarget
type Section = {
  hidden: boolean
  querySelectorAll(sel: string): { length: number }
}
type Styled = { style: { width: string } }

async function load(data: object = DATA) {
  const html = fillTemplate(
    await read('./usage-report-v2.html'),
    data,
    measuresScript(await read('./usage-measures.ts')),
  )
  const errors: string[] = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', (...args: unknown[]) =>
    errors.push(args.join(' ')),
  )
  virtualConsole.on('jsdomError', (err: Error) =>
    errors.push(String(err.stack ?? err)),
  )
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole,
    beforeParse(window: PageWindow) {
      window.addEventListener('error', (ev: ErrorEvent) =>
        errors.push(String(ev.error?.stack ?? ev.message)),
      )
    },
  })
  return { dom, doc: dom.window.document, errors }
}

/** An element's text with runs of white space made single spaces. */
const text = (el: { textContent: string | null } | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ')

describe('the v2 report page', () => {
  it('renders the first four sections without errors', async () => {
    const { doc, errors } = await load()
    expect(errors).toEqual([])
    for (const id of ['h-week', 'h-people', 'h-sources', 'h-paths']) {
      const section = doc.getElementById(id)
      expect(section, id).not.toBeNull()
      expect(
        section!.querySelectorAll('.tile .value, .chart svg, .hbars').length,
        id,
      ).toBeGreaterThan(0)
    }
    for (const id of ['h-depth', 'h-funders', 'h-guard', 'h-explore'])
      expect(doc.getElementById(id), id).not.toBeNull()
  })

  it('shows the North Star total, tagged as an estimate', async () => {
    const { doc } = await load()
    const star = doc.getElementById('north-star')
    expect(text(star?.querySelector('.value') ?? null)).toBe('9')
    expect(text(star)).toContain('Informed voters this election')
    expect(text(star)).toContain('estimate')
    expect(text(doc.getElementById('h-week'))).toContain(
      'Newly informed per week',
    )
    expect(text(doc.getElementById('h-week'))).toContain(
      'The weeks add up to the count for the dates picked.',
    )
  })

  it('counts devices over the whole election, whatever dates are picked', async () => {
    const { dom, doc, errors } = await load()
    // The device rows are from Oct 24 15:00 UTC, before the last 24 hours.
    const dates = doc.getElementById('f-range') as Select
    dates.value = '1'
    dates.dispatchEvent(new dom.window.Event('change'))
    const devices = doc.getElementById('devices-tile')
    expect(text(devices?.querySelector('.value'))).toBe('8')
    expect(text(devices)).toContain('0 new, 0 from before')
    expect(errors).toEqual([])
  })

  it('tags when the new counts began, and when they have not', async () => {
    const { doc } = await load()
    const visits = text(doc.getElementById('visits-tile'))
    expect(visits).toContain('estimate')
    expect(visits).toContain('counted from Oct 24')

    // Before launch: history rows only.
    const before = await load({ ...DATA, rows: history })
    expect(before.errors).toEqual([])
    expect(text(before.doc.getElementById('h-paths'))).toContain(
      'not counted yet',
    )
    expect(text(before.doc.getElementById('reader-note'))).toContain(
      'arrivals only',
    )
  })

  it('keeps the ladder bars within 100%', async () => {
    const { doc } = await load()
    const widths = [...doc.querySelectorAll('#ballot-steps .hbar-track')].map(
      (el) => parseFloat((el as unknown as Styled).style.width),
    )
    expect(Math.max(...widths)).toBeLessThanOrEqual(100)
    const shares = [
      ...text(doc.getElementById('ballot-steps')).matchAll(/\(([\d.]+)%\)/g),
    ].map((x) => Number(x[1]))
    expect(shares.length).toBeGreaterThan(0)
    expect(Math.max(...shares)).toBeLessThanOrEqual(100)
  })

  it('tags estimates and always tags readers without a ballot', async () => {
    const { doc } = await load()
    expect(text(doc.getElementById('profiles-read'))).toContain('estimate')
    expect(text(doc.getElementById('readers-without'))).toContain('estimate')
    expect(text(doc.getElementById('reader-ladder'))).toContain('arrivals only')
  })

  it('marks visits as all areas once an area is picked', async () => {
    const { dom, doc, errors } = await load()
    expect(text(doc.getElementById('visits-tile'))).not.toContain('all areas')
    const area = doc.getElementById('f-area') as { value: string } & EventTarget
    area.value = 'ca-la'
    area.dispatchEvent(new dom.window.Event('change'))
    expect(text(doc.getElementById('visits-tile'))).toContain('all areas')
    expect(errors).toEqual([])
  })

  it('draws a release marker on the weekly trend chart', async () => {
    const { doc } = await load()
    const chart = doc.getElementById('informed-chart')
    const marker = chart?.querySelector('[data-release="1.5.1"]')
    expect(marker).toBeTruthy()
    expect(text(marker!)).toContain('1.5.1')
    expect(chart!.querySelector('[data-release="1.5.0"]')).toBeNull()
  })

  it('renders sections 5 to 8 without errors', async () => {
    const { doc, errors } = await load()
    expect(errors).toEqual([])
    for (const id of ['h-depth', 'h-funders', 'h-guard', 'h-explore']) {
      const section = doc.getElementById(id) as Section | null
      expect(section, id).not.toBeNull()
      expect(section!.hidden, id).toBe(false)
      expect(
        section!.querySelectorAll('.tile .value, .hbars, table, .heat').length,
        id,
      ).toBeGreaterThan(0)
    }
  })

  it('shows funders the outcomes, coverage and cost per informed voter', async () => {
    const { doc } = await load()
    const funders = text(doc.getElementById('h-funders'))
    for (const label of [
      'Informed voters this election',
      'Profiles read',
      'Ballots looked up',
      'Researched ballots',
      'Informed picks',
      'Candidates covered',
    ])
      expect(funders).toContain(label)
    expect(funders).toContain('120')
    // $31 for October, 7 of its 31 days picked, over 9 informed voters.
    const cost = doc.getElementById('cost-informed')
    expect(text(cost)).toContain('Cost per informed voter')
    expect(text(cost?.querySelector('.value'))).toBe('$0.78')
    expect(text(doc.getElementById('funder-informed'))).toContain('estimate')
  })

  it('asks for running costs when there are none', async () => {
    const { doc, errors } = await load({ ...DATA, costs: null })
    expect(errors).toEqual([])
    expect(text(doc.getElementById('h-funders'))).toContain(
      'Add running costs to .private/usage-costs.json to see this',
    )
    expect(doc.getElementById('cost-informed')).toBeNull()
  })

  it('says what the counts do not measure', async () => {
    const { doc } = await load()
    const list = text(doc.getElementById('not-measured'))
    expect(list).toMatch(/people rather than devices/i)
    expect(list).toMatch(/what voters do after the visit/i)
    expect(list).toMatch(/turnout/i)
  })

  it('shows data health in detail beside the guardrails', async () => {
    const { doc } = await load()
    const guard = text(doc.getElementById('h-guard'))
    expect(guard).toContain('Email sign-ups')
    expect(guard).toContain('Error reports on profiles')
    expect(guard).toContain('When people come')
    const health = text(doc.getElementById('health-detail'))
    expect(health).toContain('Automated')
    expect(health).toContain('Rate limited')
    expect(health).toContain('Hours not rolled up yet')
  })

  it('explores any event, grouped any way', async () => {
    const { dom, doc, errors } = await load()
    const event = doc.getElementById('x-event') as Select
    event.value = 'visit'
    event.dispatchEvent(new dom.window.Event('change'))
    expect(text(doc.getElementById('x-table'))).toContain('Count')
    expect(errors).toEqual([])
  })
})
