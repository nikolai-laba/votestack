// The measures in the v2 usage report (spec section 2), worked out from the
// report's hourly rows for a date range, area and time zone. Each measure
// uses the new counts from the hour its event was first seen (`launchedAt`)
// and the history stand-in for the hours before, never both for the same
// hour, and says when a stand-in was used (`estimate`) and when its new
// counts begin (`countedFrom`). Every function is pure. The module is turned
// into plain JavaScript and inlined into the v2 page (scripts/usage-report.ts)
// so the page's date and area filters still work, which is why it imports
// nothing (labels and `pathOf` are redeclared from src/shared/metrics.ts) and
// uses only TypeScript that can be stripped.

/** One count as written into the report: [hour (Unix seconds), event, a, b, c, n, d1…d8, live (1 = not rolled up yet)]. */
export type Row = [
  hour: number,
  event: string,
  a: string,
  b: string,
  c: string,
  n: number,
  d1: number,
  d2: number,
  d3: number,
  d4: number,
  d5: number,
  d6: number,
  d7: number,
  d8: number,
  live: number,
]

/** A date range as [start, end) in Unix seconds, the area picked and the time zone days and weeks are taken in. */
export type Range = {
  start: number
  end: number
  area: 'all' | 'il-cook' | 'ca-la'
  tz: string
}

/**
 * A measure's value, whether any of it came from a history stand-in, whether
 * it covers every area whatever area is picked (its counts carry no region),
 * and the first hour of its new counts (null before they begin).
 */
export type Measured<T> = {
  value: T
  estimate: boolean
  allAreas: boolean
  countedFrom: number | null
}

export type VisitPath = 'ballot' | 'reader' | 'other'
export type VisitStep =
  | 'arrived'
  | 'browsed'
  | 'read'
  | 'informed'
  | 'form'
  | 'asked'
  | 'lookup'
  | 'returned'
  | 'researched'
  | 'picked'
export type ReadKind = 'candidate' | 'judicial' | 'retention'
export type CtaLink = 'top' | 'mid' | 'back' | 'race' | 'form'
export type Costs = {
  monthly: { name: string; usd: number; from: string; to?: string }[]
}

const VISIT_STEPS: VisitStep[] = [
  'arrived',
  'browsed',
  'read',
  'informed',
  'form',
  'asked',
  'lookup',
  'returned',
  'researched',
  'picked',
]
const STEP_SET = new Set<string>(VISIT_STEPS)
const CTA_LINKS: CtaLink[] = ['top', 'mid', 'back', 'race', 'form']

// Row fields.
const H = 0,
  E = 1,
  A = 2,
  B = 3,
  C = 4,
  N = 5,
  LIVE = 14

/** Events split by area: their region is label b. */
const REGION_EVENTS = new Set(['voter', 'learn', 'lookup', 'fill', 'sample'])

/** The path of a visit by its entry page, as in metrics.ts. */
function pathOf(page: string): VisitPath {
  if (page === 'ballot' || page === 'start') return 'ballot'
  if (page === 'profile' || page === 'races') return 'reader'
  return 'other'
}

/** A path label as stored on read and informed rows. */
const asPath = (label: string): VisitPath =>
  label === 'ballot' || label === 'reader' ? label : 'other'

// ---- Time --------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>()
const partsCache = new Map<string, { day: string; hour: number }>()

/** The calendar day and hour of a moment in a time zone. */
function parts(ts: number, tz: string): { day: string; hour: number } {
  const hour = Math.floor(ts / 3600) * 3600
  const key = `${tz}|${hour}`
  let p = partsCache.get(key)
  if (!p) {
    let f = formats.get(tz)
    if (!f) {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      })
      formats.set(tz, f)
    }
    const o: Record<string, string> = {}
    for (const x of f.formatToParts(new Date(hour * 1000))) o[x.type] = x.value
    p = { day: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) % 24 }
    partsCache.set(key, p)
  }
  return p
}

/** The calendar day (YYYY-MM-DD) of a moment in a time zone. */
export function dayOf(ts: number, tz: string): string {
  return parts(ts, tz).day
}

/** A day (YYYY-MM-DD) moved by a number of days. */
function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const mondayOf = (day: string) =>
  addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))

/** The date of the Monday that starts the week of a moment, in a time zone. */
export function weekOf(ts: number, tz: string): string {
  return mondayOf(dayOf(ts, tz))
}

/** Unix seconds of midnight at the start of a day in a time zone. */
function zonedMidnight(day: string, tz: string): number {
  const target = Date.parse(`${day}T00:00:00Z`) / 1000
  let guess = target
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, tz)
    const shown =
      Date.parse(`${p.day}T${String(p.hour).padStart(2, '0')}:00:00Z`) / 1000
    guess -= shown - target
  }
  return guess
}

/** Unix seconds of the start and end of a month (YYYY-MM) in a time zone. */
function monthBounds(month: string, tz: string): [number, number] {
  const next = addDays(`${month}-28`, 4).slice(0, 7)
  return [zonedMidnight(`${month}-01`, tz), zonedMidnight(`${next}-01`, tz)]
}

/** Every calendar day the range touches, in its time zone. */
function daysIn(r: Range): string[] {
  if (r.end <= r.start) return []
  const out: string[] = []
  const last = dayOf(r.end - 1, r.tz)
  for (let d = dayOf(r.start, r.tz); d <= last; d = addDays(d, 1)) out.push(d)
  return out
}

/** The Monday of every week the range touches. */
function weeksIn(r: Range): string[] {
  if (r.end <= r.start) return []
  const out: string[] = []
  const last = weekOf(r.end - 1, r.tz)
  for (let w = weekOf(r.start, r.tz); w <= last; w = addDays(w, 7)) out.push(w)
  return out
}

// ---- Rows --------------------------------------------------------------

/** The first hour with any row of an event, or null if it has none. */
export function launchedAt(rows: Row[], event: string): number | null {
  let first: number | null = null
  for (const row of rows)
    if (row[E] === event && (first === null || row[H] < first)) first = row[H]
  return first
}

/**
 * Rows of one event in [from, to) that match a test, with the area filter
 * applied when the event has a region.
 */
function pick(
  rows: Row[],
  r: Range,
  event: string,
  from: number,
  to: number,
  test: (row: Row) => boolean = () => true,
): Row[] {
  const byArea = r.area !== 'all' && REGION_EVENTS.has(event)
  return rows.filter(
    (row) =>
      row[E] === event &&
      row[H] >= from &&
      row[H] < to &&
      (!byArea || row[B] === r.area) &&
      test(row),
  )
}

const sum = (rows: Row[]) => rows.reduce((t, row) => t + row[N], 0)
const ratio = (n: number, d: number) => (d > 0 ? n / d : null)

/**
 * Where a range splits between a stand-in and the new counts of an event:
 * history covers [start, cut) and the new counts [cut, end).
 */
function splitAt(rows: Row[], r: Range, event: string) {
  const launched = launchedAt(rows, event)
  const cut = Math.max(r.start, Math.min(r.end, launched ?? Infinity))
  return {
    launched,
    cut,
    /** Some of the range comes before the new counts. */
    history: r.start < cut,
    /** Some of the range has the new counts. */
    counted: cut < r.end,
  }
}

/** Rows of an event from its launch, for measures with no stand-in. */
function counted(rows: Row[], r: Range, event: string) {
  const s = splitAt(rows, r, event)
  return { s, rows: pick(rows, r, event, s.cut, r.end) }
}

const byPath = (): Record<VisitPath, number> => ({
  ballot: 0,
  reader: 0,
  other: 0,
})
const steps = () =>
  Object.fromEntries(VISIT_STEPS.map((s) => [s, 0])) as Record<
    VisitStep,
    number
  >
function add(into: Record<string, number>, key: string, n: number) {
  into[key] = (into[key] ?? 0) + n
}

// ---- Informed voters ---------------------------------------------------

/** One count of informed voters: [hour, path, kind, n]. */
type Informed = [number, VisitPath, 'single' | 'compared', number]

/** First informed in the election, from launch; before it, devices that compared two profiles in a race (ballot path). */
function informedRows(rows: Row[], r: Range) {
  const s = splitAt(rows, r, 'informed')
  const history = pick(
    rows,
    r,
    'learn',
    r.start,
    s.cut,
    (row) => row[A] === 'compared' && row[C] === '1',
  ).map((row): Informed => [row[H], 'ballot', 'compared', row[N]])
  const fresh = pick(
    rows,
    r,
    'informed',
    s.cut,
    r.end,
    (row) => row[A] === 'election',
  ).map((row): Informed => [
    row[H],
    asPath(row[B]),
    row[C] === 'single' ? 'single' : 'compared',
    row[N],
  ])
  return { s, all: [...history, ...fresh] }
}

/** The North Star: informed voters this election, by path, kind and week. */
export function northStar(
  rows: Row[],
  r: Range,
): Measured<{
  total: number
  byPath: Record<VisitPath, number>
  byKind: Record<'single' | 'compared', number>
  perWeek: {
    week: string
    ballot: number
    reader: number
    other: number
    estimate: boolean
  }[]
}> {
  const { s, all } = informedRows(rows, r)
  const paths = byPath()
  const kinds = { single: 0, compared: 0 }
  // Weeks up to the last one holding any stand-in hours are estimates.
  const lastEstimated = s.history ? weekOf(s.cut - 1, r.tz) : ''
  const weeks = new Map(
    weeksIn(r).map((week) => [
      week,
      {
        week,
        ballot: 0,
        reader: 0,
        other: 0,
        estimate: week <= lastEstimated,
      },
    ]),
  )
  let total = 0
  for (const [hour, path, kind, n] of all) {
    total += n
    paths[path] += n
    kinds[kind] += n
    const w = weeks.get(weekOf(hour, r.tz))
    if (w) w[path] += n
  }
  return {
    value: {
      total,
      byPath: paths,
      byKind: kinds,
      perWeek: [...weeks.values()],
    },
    estimate: s.history,
    allAreas: s.counted,
    countedFrom: s.launched,
  }
}

/** Newly informed voters per week (they add up to the North Star). */
export function informedWeekly(
  rows: Row[],
  r: Range,
): Measured<{ week: string; n: number }[]> {
  const { s, all } = informedRows(rows, r)
  const weeks = new Map(weeksIn(r).map((week) => [week, 0]))
  for (const [hour, , , n] of all) {
    const week = weekOf(hour, r.tz)
    if (weeks.has(week)) weeks.set(week, (weeks.get(week) ?? 0) + n)
  }
  return {
    value: [...weeks].map(([week, n]) => ({ week, n })),
    estimate: s.history,
    allAreas: s.counted,
    countedFrom: s.launched,
  }
}

// ---- Reading -----------------------------------------------------------

const kindOfLevel = (level: string): ReadKind =>
  level === 'judges'
    ? 'judicial'
    : level === 'retention'
      ? 'retention'
      : 'candidate'

/** Profiles read, from launch; before it, profiles opened from a ballot (first and second per race). */
export function profilesRead(
  rows: Row[],
  r: Range,
): Measured<{
  total: number
  byPath: Record<VisitPath, number>
  byKind: Record<ReadKind, number>
}> {
  const s = splitAt(rows, r, 'read')
  const paths = byPath()
  const kinds: Record<ReadKind, number> = {
    candidate: 0,
    judicial: 0,
    retention: 0,
  }
  let total = 0
  for (const row of pick(rows, r, 'open', r.start, s.cut)) {
    total += row[N]
    paths.ballot += row[N]
    kinds[kindOfLevel(row[A])] += row[N]
  }
  for (const row of pick(
    rows,
    r,
    'read',
    s.cut,
    r.end,
    (x) => x[C] === 'read',
  )) {
    total += row[N]
    paths[asPath(row[A])] += row[N]
    if (row[B] in kinds) kinds[row[B] as ReadKind] += row[N]
  }
  return {
    value: { total, byPath: paths, byKind: kinds },
    estimate: s.history,
    allAreas: true,
    countedFrom: s.launched,
  }
}

/** How many profiles reached each reading mark. */
export function readingSpread(
  rows: Row[],
  r: Range,
): Measured<Record<'10' | '20' | '30' | '60' | 'sources' | 'read', number>> {
  const { s, rows: reads } = counted(rows, r, 'read')
  const value = { '10': 0, '20': 0, '30': 0, '60': 0, sources: 0, read: 0 }
  for (const row of reads)
    if (row[C] in value) value[row[C] as keyof typeof value] += row[N]
  return { value, estimate: false, allAreas: true, countedFrom: s.launched }
}

// ---- Visits ------------------------------------------------------------

/** Visits by entry page, path and source; before launch, first pages opened (sources unknown). */
export function visits(
  rows: Row[],
  r: Range,
): Measured<{
  total: number
  byEntry: Record<string, number>
  byPath: Record<VisitPath, number>
  bySource: Record<string, number> | null
}> {
  const s = splitAt(rows, r, 'visit')
  const byEntry: Record<string, number> = {}
  const paths = byPath()
  const bySource: Record<string, number> = {}
  let total = 0
  const count = (entry: string, n: number) => {
    total += n
    add(byEntry, entry, n)
    paths[pathOf(entry)] += n
  }
  for (const row of pick(
    rows,
    r,
    'view',
    r.start,
    s.cut,
    (x) => x[B] === 'landing',
  ))
    count(row[A], row[N])
  for (const row of pick(
    rows,
    r,
    'visit',
    s.cut,
    r.end,
    (x) => x[C] === 'arrived',
  )) {
    count(row[A], row[N])
    add(bySource, row[B], row[N])
  }
  return {
    value: {
      total,
      byEntry,
      byPath: paths,
      bySource: s.counted ? bySource : null,
    },
    estimate: s.history,
    allAreas: true,
    countedFrom: s.launched,
  }
}

/**
 * Visits on one path reaching each step, overall or split by entry page or
 * source. Before launch, overall only: arrivals are first pages opened on
 * that path, and on the ballot path lookups are timed new ballots and
 * researched is `learn/researched` (neither is known by path, so the reader
 * path has none from history). Splits use the new counts only.
 */
export function ladder(
  rows: Row[],
  r: Range,
  path: 'reader' | 'ballot',
  split?: 'entry' | 'source',
): Measured<Record<string, Record<VisitStep, number>>> {
  const s = splitAt(rows, r, 'visit')
  const value: Record<string, Record<VisitStep, number>> = {}
  const group = (key: string) => (value[key] ??= steps())
  const history = !split && s.history
  if (history) {
    const all = group('all')
    for (const row of pick(
      rows,
      r,
      'view',
      r.start,
      s.cut,
      (x) => x[B] === 'landing' && pathOf(x[A]) === path,
    ))
      all.arrived += row[N]
    if (path === 'ballot') {
      all.lookup += sum(
        pick(
          rows,
          r,
          'voter',
          r.start,
          s.cut,
          (x) => x[A] === 'new' && x[C] === 'timed',
        ),
      )
      all.researched += sum(
        pick(rows, r, 'learn', r.start, s.cut, (x) => x[A] === 'researched'),
      )
    }
  }
  for (const row of pick(
    rows,
    r,
    'visit',
    s.cut,
    r.end,
    (x) => pathOf(x[A]) === path,
  )) {
    const key = split === 'entry' ? row[A] : split === 'source' ? row[B] : 'all'
    if (STEP_SET.has(row[C])) group(key)[row[C] as VisitStep] += row[N]
  }
  if (!split) group('all')
  return {
    value,
    estimate: history,
    allAreas: true,
    countedFrom: s.launched,
  }
}

/**
 * Reader-path visits that never reach the address form, split by whether
 * they read a profile. Steps are counted per visit, not together, so this
 * takes visits that reached the form to have read first where the counts
 * allow it, and is always an estimate.
 */
export function readersWithoutBallot(
  rows: Row[],
  r: Range,
): Measured<{ read: number; notRead: number }> {
  const { s, rows: reader } = counted(rows, r, 'visit')
  const at = (step: VisitStep) =>
    sum(reader.filter((row) => row[C] === step && pathOf(row[A]) === 'reader'))
  const noForm = Math.max(0, at('arrived') - at('form'))
  const read = Math.min(noForm, Math.max(0, at('read') - at('form')))
  return {
    value: { read, notRead: noForm - read },
    estimate: true,
    allAreas: true,
    countedFrom: s.launched,
  }
}

/** Clicks on each link toward a ballot, per 100 reader-path visits since those clicks were counted. */
export function ctaRates(
  rows: Row[],
  r: Range,
): Measured<Record<CtaLink, number>> {
  const { s, rows: clicks } = counted(rows, r, 'cta')
  const readers = sum(
    pick(
      rows,
      r,
      'visit',
      s.cut,
      r.end,
      (x) => x[C] === 'arrived' && pathOf(x[A]) === 'reader',
    ),
  )
  const value = Object.fromEntries(CTA_LINKS.map((l) => [l, 0])) as Record<
    CtaLink,
    number
  >
  if (readers > 0)
    for (const row of clicks)
      if (row[A] in value) value[row[A] as CtaLink] += (100 * row[N]) / readers
  return { value, estimate: false, allAreas: true, countedFrom: s.launched }
}

/** Ballots looked up by how the device first arrived, in that visit or a later one, most first. */
export function origins(
  rows: Row[],
  r: Range,
): Measured<{ entry: string; source: string; same: number; later: number }[]> {
  const { s, rows: found } = counted(rows, r, 'origin')
  const groups = new Map<
    string,
    { entry: string; source: string; same: number; later: number }
  >()
  for (const row of found) {
    const key = `${row[A]}|${row[B]}`
    let g = groups.get(key)
    if (!g) {
      g = { entry: row[A], source: row[B], same: 0, later: 0 }
      groups.set(key, g)
    }
    if (row[C] === 'same') g.same += row[N]
    else g.later += row[N]
  }
  return {
    value: [...groups.values()].sort(
      (x, y) => y.same + y.later - (x.same + x.later),
    ),
    estimate: false,
    allAreas: true,
    countedFrom: s.launched,
  }
}

// ---- Devices -----------------------------------------------------------

/**
 * Unique devices per day, week, month and election, new and back, and
 * stickiness for the range's last calendar month: average daily devices
 * over that month's days in the range (from launch), over the devices seen
 * in the whole month. A device's month count is sent on its first visit in
 * the month, which can come before the range starts, so the month count is
 * never clipped to the range.
 */
export function uniques(
  rows: Row[],
  r: Range,
): Measured<{
  day: { day: string; new: number; back: number }[]
  week: { week: string; new: number; back: number }[]
  month: { month: string; new: number; back: number }[]
  election: { new: number; back: number }
  stickiness: number | null
}> {
  const { s, rows: seen } = counted(rows, r, 'device')
  const groups = {
    day: new Map<string, { new: number; back: number }>(),
    week: new Map<string, { new: number; back: number }>(),
    month: new Map<string, { new: number; back: number }>(),
  }
  const election = { new: 0, back: 0 }
  for (const row of seen) {
    const kind = row[B] === 'new' ? 'new' : 'back'
    const period = row[A]
    if (period === 'election') {
      election[kind] += row[N]
      continue
    }
    if (period !== 'day' && period !== 'week' && period !== 'month') continue
    const key =
      period === 'day'
        ? dayOf(row[H], r.tz)
        : period === 'week'
          ? weekOf(row[H], r.tz)
          : dayOf(row[H], r.tz).slice(0, 7)
    const g = groups[period].get(key) ?? { new: 0, back: 0 }
    g[kind] += row[N]
    groups[period].set(key, g)
  }
  const list = (m: Map<string, { new: number; back: number }>) =>
    [...m].sort(([x], [y]) => (x < y ? -1 : 1))

  let stickiness: number | null = null
  if (s.counted) {
    const month = dayOf(r.end - 1, r.tz).slice(0, 7)
    const [start, end] = monthBounds(month, r.tz)
    const monthly = sum(
      pick(rows, r, 'device', start, end, (x) => x[A] === 'month'),
    )
    const from = dayOf(s.cut, r.tz)
    const days = daysIn(r).filter((d) => d.startsWith(month) && d >= from)
    const daily = days.reduce((t, d) => {
      const x = groups.day.get(d)
      return t + (x ? x.new + x.back : 0)
    }, 0)
    if (days.length) stickiness = ratio(daily / days.length, monthly)
  }
  const months = list(groups.month)
  return {
    value: {
      day: list(groups.day).map(([day, g]) => ({ day, ...g })),
      week: list(groups.week).map(([week, g]) => ({ week, ...g })),
      month: months.map(([month, g]) => ({ month, ...g })),
      election,
      stickiness,
    },
    estimate: false,
    allAreas: true,
    countedFrom: s.launched,
  }
}

/** Devices with a ballot (new and returning) per day, every day of the range. */
export function ballotDevicesPerDay(
  rows: Row[],
  r: Range,
): { day: string; n: number }[] {
  const days = new Map(daysIn(r).map((d) => [d, 0]))
  for (const row of pick(rows, r, 'voter', r.start, r.end)) {
    const day = dayOf(row[H], r.tz)
    if (days.has(day)) days.set(day, (days.get(day) ?? 0) + row[N])
  }
  return [...days].map(([day, n]) => ({ day, n }))
}

// ---- Inputs and outcomes -----------------------------------------------

/**
 * The inputs to the North Star: the share of search visits that reach the
 * address form, the share of real (non-sample) lookups that find a ballot,
 * and profiles opened per new ballot. Opens carry no area, so profiles per
 * ballot is always worked out over every area.
 */
export function inputs(
  rows: Row[],
  r: Range,
): {
  searchToForm: Measured<number | null>
  lookupSuccess: number | null
  profilesPerBallot: Measured<number | null>
} {
  const { s, rows: search } = counted(rows, r, 'visit')
  const step = (name: VisitStep) =>
    sum(search.filter((row) => row[B] === 'search' && row[C] === name))
  const lookups = pick(rows, r, 'lookup', r.start, r.end, (x) => x[C] === '0')
  const found = sum(lookups.filter((x) => x[A] === 'ok' || x[A] === 'gaps'))
  const every: Range = { ...r, area: 'all' }
  return {
    searchToForm: {
      value: ratio(step('form'), step('arrived')),
      estimate: false,
      allAreas: true,
      countedFrom: s.launched,
    },
    lookupSuccess: ratio(found, sum(lookups)),
    profilesPerBallot: {
      value: ratio(
        sum(pick(rows, every, 'open', r.start, r.end)),
        sum(pick(rows, every, 'voter', r.start, r.end, (x) => x[A] === 'new')),
      ),
      estimate: false,
      allAreas: r.area !== 'all',
      countedFrom: null,
    },
  }
}

/** New ballots that become informed: ballot-path visits reaching informed over those reaching lookup; before launch, researched ballots over new ballots. */
export function activation(rows: Row[], r: Range): Measured<number | null> {
  const s = splitAt(rows, r, 'visit')
  const ballotVisits = pick(
    rows,
    r,
    'visit',
    s.cut,
    r.end,
    (x) => pathOf(x[A]) === 'ballot',
  )
  const informed =
    sum(pick(rows, r, 'learn', r.start, s.cut, (x) => x[A] === 'researched')) +
    sum(ballotVisits.filter((x) => x[C] === 'informed'))
  // Every new ballot before launch, restored ones included, unlike the
  // ladder's history lookups, which take only timed ones.
  const looked =
    sum(pick(rows, r, 'voter', r.start, s.cut, (x) => x[A] === 'new')) +
    sum(ballotVisits.filter((x) => x[C] === 'lookup'))
  return {
    value: ratio(informed, looked),
    estimate: s.history,
    allAreas: s.counted,
    countedFrom: s.launched,
  }
}

/** Picks made after opening a profile in that race, over all picks. */
export function informedPicksShare(rows: Row[], r: Range): number | null {
  const picks = pick(rows, r, 'pick', r.start, r.end)
  return ratio(sum(picks.filter((x) => x[B] === '1')), sum(picks))
}

/**
 * Running costs over the range, each monthly cost prorated by the share of
 * each month the range covers, from its first month through its last, and
 * divided by informed voters and researched ballots.
 */
export function costPer(
  costs: Costs | null,
  r: Range,
  counts: { informed: number; researched: number },
): {
  usd: number
  perInformed: number | null
  perResearched: number | null
} | null {
  if (!costs) return null
  const months = [...new Set(daysIn(r).map((d) => d.slice(0, 7)))]
  let usd = 0
  for (const month of months) {
    const [start, end] = monthBounds(month, r.tz)
    const share =
      Math.max(0, Math.min(end, r.end) - Math.max(start, r.start)) /
      (end - start)
    for (const c of costs.monthly)
      if (month >= c.from && (!c.to || month <= c.to)) usd += c.usd * share
  }
  return {
    usd,
    perInformed: ratio(usd, counts.informed),
    perResearched: ratio(usd, counts.researched),
  }
}

/** Batches the Worker dropped, whole hours in the range with no rows at all, and hours not rolled up yet. */
export function dataHealth(
  rows: Row[],
  r: Range,
): {
  bot: number
  invalid: number
  limited: number
  missingHours: number
  liveHours: number
} {
  const hours = new Set<number>()
  const live = new Set<number>()
  const dropped: Record<string, number> = {}
  for (const row of rows) {
    if (row[H] < r.start || row[H] >= r.end) continue
    hours.add(row[H])
    if (row[LIVE] === 1) live.add(row[H])
    if (row[E] === 'dropped') add(dropped, row[A], row[N])
  }
  let missingHours = 0
  for (let h = Math.ceil(r.start / 3600) * 3600; h + 3600 <= r.end; h += 3600)
    if (!hours.has(h)) missingHours++
  return {
    bot: dropped.bot ?? 0,
    invalid: dropped.invalid ?? 0,
    limited: dropped.limited ?? 0,
    missingHours,
    liveHours: live.size,
  }
}
