import { describe, expect, it } from 'vitest'
import {
  activation,
  ballotDevicesPerDay,
  costPer,
  ctaRates,
  dataHealth,
  dayOf,
  informedPicksShare,
  informedWeekly,
  inputs,
  ladder,
  launchedAt,
  northStar,
  origins,
  profilesRead,
  readersWithoutBallot,
  readingSpread,
  uniques,
  visits,
  weekOf,
  type Range,
  type Row,
} from './usage-measures.ts'

const at = (iso: string) => Date.parse(iso) / 1000
const HOUR = 3600

/** One stored row: an event's labels and count at an hour, no numbers. */
function row(
  hour: number,
  event: string,
  a = '',
  b = '',
  c = '',
  n = 1,
  d1 = 0,
  live = 0,
): Row {
  return [hour, event, a, b, c, n, d1, 0, 0, 0, 0, 0, 0, 0, live]
}

const range = (
  start: string,
  end: string,
  area: Range['area'] = 'all',
  tz = 'UTC',
): Range => ({ start: at(start), end: at(end), area, tz })

// History up to Oct 24, new counts from Oct 24 15:00 UTC.
const H = at('2026-10-20T15:00:00Z')
const LAUNCH = at('2026-10-24T15:00:00Z')
const WEEK = range('2026-10-19T00:00:00Z', '2026-11-02T00:00:00Z')

describe('launchedAt', () => {
  it('is the first hour with any row of the event, or null', () => {
    const rows = [
      row(LAUNCH + HOUR, 'visit', 'ballot', 'direct', 'arrived'),
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived'),
      row(H, 'view', 'ballot', 'landing'),
    ]
    expect(launchedAt(rows, 'visit')).toBe(LAUNCH)
    expect(launchedAt(rows, 'view')).toBe(H)
    expect(launchedAt(rows, 'informed')).toBeNull()
  })
})

describe('weekOf', () => {
  it('weeks start on Monday in the chosen time zone', () => {
    const ts = at('2026-10-26T04:00:00Z')
    expect(dayOf(ts, 'America/Los_Angeles')).toBe('2026-10-25')
    expect(weekOf(ts, 'America/Los_Angeles')).toBe('2026-10-19')
    expect(dayOf(ts, 'UTC')).toBe('2026-10-26')
    expect(weekOf(ts, 'UTC')).toBe('2026-10-26')
  })
})

describe('northStar', () => {
  it('uses informed/election from launch and learn/compared before it', () => {
    const rows = [
      row(H, 'learn', 'compared', 'ca-la', '1', 3),
      row(H, 'learn', 'compared', 'ca-la', '3', 9), // later milestone, not a voter
      row(H, 'learn', 'races', 'ca-la', '1', 7),
      row(LAUNCH, 'informed', 'election', 'reader', 'single', 2),
      row(LAUNCH, 'informed', 'election', 'ballot', 'compared', 1),
      row(LAUNCH, 'informed', 'week', 'ballot', 'compared', 5),
      // A stand-in row after launch is never counted with the new counts.
      row(LAUNCH + HOUR, 'learn', 'compared', 'il-cook', '1', 4),
      row(
        at('2026-10-27T12:00:00Z'),
        'informed',
        'election',
        'other',
        'single',
      ),
    ]
    const m = northStar(rows, WEEK)
    expect(m.value.total).toBe(7)
    expect(m.value.byPath).toEqual({ ballot: 4, reader: 2, other: 1 })
    expect(m.value.byKind).toEqual({ single: 3, compared: 4 })
    expect(m.value.perWeek).toEqual([
      { week: '2026-10-19', ballot: 4, reader: 2, other: 0, estimate: true },
      { week: '2026-10-26', ballot: 0, reader: 0, other: 1, estimate: false },
    ])
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
    expect(m.allAreas).toBe(true)
  })

  it('uses opened-not-read for the North Star before launch', () => {
    const rows = [
      row(H, 'learn', 'compared', 'il-cook', '1', 2),
      row(H + HOUR, 'learn', 'compared', 'ca-la', '1', 5),
    ]
    const m = northStar(rows, WEEK)
    expect(m.value.byPath.ballot).toBe(7)
    expect(m.value.byPath.reader).toBe(0)
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBeNull()
    // Only history was used, and it has an area, so the filter applies.
    expect(m.allAreas).toBe(false)
    expect(northStar(rows, { ...WEEK, area: 'ca-la' }).value.total).toBe(5)
  })
})

describe('informedWeekly', () => {
  it('groups newly informed voters by week, stand-in before launch', () => {
    const rows = [
      row(H, 'learn', 'compared', 'ca-la', '1', 3),
      row(LAUNCH, 'informed', 'election', 'reader', 'single', 2),
      row(
        at('2026-10-27T12:00:00Z'),
        'informed',
        'election',
        'ballot',
        'compared',
        6,
      ),
    ]
    const m = informedWeekly(rows, WEEK)
    expect(m.value).toEqual([
      { week: '2026-10-19', n: 5 },
      { week: '2026-10-26', n: 6 },
    ])
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
    // From launch only: no estimate.
    const after = informedWeekly(
      rows,
      range('2026-10-26T00:00:00Z', '2026-11-02T00:00:00Z'),
    )
    expect(after.value).toEqual([{ week: '2026-10-26', n: 6 }])
    expect(after.estimate).toBe(false)
  })
})

describe('profilesRead', () => {
  it('counts read/read from launch and opened profiles before it', () => {
    const rows = [
      row(H, 'open', 'county', '1', '', 4),
      row(H, 'open', 'judges', '2', '', 2),
      row(H, 'open', 'retention', '1', '', 1),
      row(LAUNCH, 'read', 'reader', 'candidate', 'read', 3),
      row(LAUNCH, 'read', 'reader', 'candidate', '10', 8),
      row(LAUNCH, 'read', 'ballot', 'judicial', 'read', 1),
      row(LAUNCH + HOUR, 'open', 'county', '1', '', 50),
    ]
    const m = profilesRead(rows, WEEK)
    expect(m.value.total).toBe(11)
    expect(m.value.byPath).toEqual({ ballot: 8, reader: 3, other: 0 })
    expect(m.value.byKind).toEqual({ candidate: 7, judicial: 3, retention: 1 })
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
    expect(m.allAreas).toBe(true)
  })
})

describe('readingSpread', () => {
  it('sums each read mark, with no stand-in', () => {
    const rows = [
      row(LAUNCH, 'read', 'reader', 'candidate', '10', 9),
      row(LAUNCH, 'read', 'ballot', 'judicial', '10', 1),
      row(LAUNCH, 'read', 'reader', 'candidate', '20', 6),
      row(LAUNCH, 'read', 'reader', 'candidate', 'sources', 2),
      row(LAUNCH, 'read', 'reader', 'candidate', 'read', 6),
    ]
    const m = readingSpread(rows, WEEK)
    expect(m.value).toEqual({
      '10': 10,
      '20': 6,
      '30': 0,
      '60': 0,
      sources: 2,
      read: 6,
    })
    expect(m.estimate).toBe(false)
    expect(m.countedFrom).toBe(LAUNCH)
  })
})

describe('visits', () => {
  it('counts visit/arrived from launch and landings before it', () => {
    const rows = [
      row(H, 'view', 'profile', 'landing', 'ann-lee', 5),
      row(H, 'view', 'ballot', 'landing', '', 2),
      row(H, 'view', 'ballot', 'app', '', 40),
      row(LAUNCH, 'visit', 'races', 'search', 'arrived', 3),
      row(LAUNCH, 'visit', 'start', 'direct', 'arrived', 1),
      row(LAUNCH, 'visit', 'start', 'direct', 'form', 1),
    ]
    const m = visits(rows, WEEK)
    expect(m.value.total).toBe(11)
    expect(m.value.byEntry).toEqual({
      profile: 5,
      ballot: 2,
      races: 3,
      start: 1,
    })
    expect(m.value.byPath).toEqual({ ballot: 3, reader: 8, other: 0 })
    expect(m.value.bySource).toEqual({ search: 3, direct: 1 })
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
    // Sources aren't known before launch.
    const before = visits(
      rows,
      range('2026-10-19T00:00:00Z', '2026-10-22T00:00:00Z'),
    )
    expect(before.value.total).toBe(7)
    expect(before.value.bySource).toBeNull()
  })

  it('switches from history to new counts at launch without double counting', () => {
    const rows = [
      row(H, 'view', 'ballot', 'landing'),
      row(H + 2 * HOUR, 'visit', 'ballot', 'direct', 'arrived'),
      row(H + 2 * HOUR, 'view', 'ballot', 'landing'),
    ]
    expect(launchedAt(rows, 'visit')).toBe(H + 2 * HOUR)
    const m = visits(rows, WEEK)
    expect(m.value.total).toBe(2)
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(H + 2 * HOUR)
  })

  it('ignores the area filter for events without a region', () => {
    const rows = [
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived', 4),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'arrived', 2),
    ]
    // From launch, so nothing comes from history.
    const m = visits(rows, { ...WEEK, start: LAUNCH, area: 'ca-la' })
    expect(m.value.total).toBe(6)
    expect(m.allAreas).toBe(true)
    expect(m.estimate).toBe(false)
  })
})

describe('ladder', () => {
  it('counts visits per step on one path, with history overall only', () => {
    const rows = [
      row(H, 'view', 'start', 'landing', '', 10),
      row(H, 'view', 'profile', 'landing', 'ann-lee', 7),
      row(H, 'voter', 'new', 'il-cook', 'timed', 4),
      row(H, 'voter', 'new', 'il-cook', 'restored', 9),
      row(H, 'learn', 'researched', 'il-cook', '1', 2),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'arrived', 5),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'lookup', 3),
      row(LAUNCH, 'visit', 'start', 'search', 'arrived', 1),
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived', 6),
      row(LAUNCH, 'visit', 'profile', 'search', 'read', 4),
    ]
    const ballot = ladder(rows, WEEK, 'ballot')
    expect(Object.keys(ballot.value)).toEqual(['all'])
    expect(ballot.value.all).toMatchObject({
      arrived: 16,
      lookup: 7,
      researched: 2,
      read: 0,
    })
    expect(ballot.estimate).toBe(true)
    expect(ballot.countedFrom).toBe(LAUNCH)

    const reader = ladder(rows, WEEK, 'reader')
    expect(reader.value.all).toMatchObject({ arrived: 13, read: 4, lookup: 0 })

    // Splits come from the new counts only.
    const bySource = ladder(rows, WEEK, 'ballot', 'source')
    expect(Object.keys(bySource.value).sort()).toEqual(['direct', 'search'])
    expect(bySource.value.direct).toMatchObject({ arrived: 5, lookup: 3 })
    expect(bySource.value.search.arrived).toBe(1)
    expect(bySource.estimate).toBe(false)
    const byEntry = ladder(rows, WEEK, 'ballot', 'entry')
    expect(Object.keys(byEntry.value).sort()).toEqual(['ballot', 'start'])
  })
})

describe('readersWithoutBallot', () => {
  it('splits reader visits that never reach the form by whether they read', () => {
    const rows = [
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived', 10),
      row(LAUNCH, 'visit', 'profile', 'search', 'read', 6),
      row(LAUNCH, 'visit', 'races', 'search', 'form', 2),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'arrived', 50),
    ]
    const m = readersWithoutBallot(rows, WEEK)
    expect(m.value).toEqual({ read: 4, notRead: 4 })
    // Worked out from separate step totals, so always an estimate.
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
    expect(m.allAreas).toBe(true)
  })
})

describe('ctaRates', () => {
  it('gives clicks per 100 reader-path visits', () => {
    const rows = [
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived', 40),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'arrived', 100),
      row(LAUNCH, 'cta', 'top', 'profile', '', 4),
      row(LAUNCH, 'cta', 'form', 'races', '', 1),
    ]
    const m = ctaRates(rows, WEEK)
    expect(m.value).toEqual({ top: 10, mid: 0, back: 0, race: 0, form: 2.5 })
    expect(m.estimate).toBe(false)
    expect(m.countedFrom).toBe(LAUNCH)
  })
})

describe('origins', () => {
  it('groups ballots by first arrival, same visit or later', () => {
    const rows = [
      row(LAUNCH, 'origin', 'profile', 'search', 'same', 2),
      row(LAUNCH, 'origin', 'profile', 'search', 'later', 3),
      row(LAUNCH, 'origin', 'unknown', 'unknown', 'later', 1),
    ]
    const m = origins(rows, WEEK)
    expect(m.value).toEqual([
      { entry: 'profile', source: 'search', same: 2, later: 3 },
      { entry: 'unknown', source: 'unknown', same: 0, later: 1 },
    ])
    expect(m.estimate).toBe(false)
    expect(m.countedFrom).toBe(LAUNCH)
  })
})

describe('uniques', () => {
  it('counts devices per period and stickiness for the latest month', () => {
    const d1 = at('2026-10-25T12:00:00Z')
    const d2 = at('2026-10-26T12:00:00Z')
    const rows = [
      row(d1, 'device', 'day', 'new', '', 6),
      row(d1, 'device', 'day', 'back', '', 2),
      row(d2, 'device', 'day', 'back', '', 4),
      row(d1, 'device', 'week', 'new', '', 6),
      row(d2, 'device', 'week', 'back', '', 3),
      row(d1, 'device', 'month', 'new', '', 6),
      row(d1, 'device', 'month', 'back', '', 4),
      row(d1, 'device', 'election', 'new', '', 6),
      row(d2, 'device', 'election', 'back', '', 3),
    ]
    const m = uniques(
      rows,
      range('2026-10-25T00:00:00Z', '2026-10-27T00:00:00Z'),
    )
    expect(m.value.day).toEqual([
      { day: '2026-10-25', new: 6, back: 2 },
      { day: '2026-10-26', new: 0, back: 4 },
    ])
    expect(m.value.week).toEqual([
      { week: '2026-10-19', new: 6, back: 0 },
      { week: '2026-10-26', new: 0, back: 3 },
    ])
    expect(m.value.month).toEqual([{ month: '2026-10', new: 6, back: 4 }])
    expect(m.value.election).toEqual({ new: 6, back: 3 })
    // (8 + 4) / 2 days, over 10 devices this month.
    expect(m.value.stickiness).toBeCloseTo(0.6)
    expect(m.estimate).toBe(false)
    expect(m.countedFrom).toBe(d1)
    expect(m.allAreas).toBe(true)
    expect(uniques([], WEEK).value.stickiness).toBeNull()
  })

  it('takes stickiness over the whole month when the range starts mid-month', () => {
    // One device first seen Oct 1 comes back Oct 16; another is first seen Oct 16.
    const oct1 = at('2026-10-01T12:00:00Z')
    const oct16 = at('2026-10-16T12:00:00Z')
    const rows = [
      row(oct1, 'device', 'day', 'new'),
      row(oct1, 'device', 'month', 'new'),
      row(oct16, 'device', 'day', 'back'),
      row(oct16, 'device', 'day', 'new'),
      row(oct16, 'device', 'month', 'new'),
    ]
    const r = range('2026-10-15T00:00:00Z', '2026-10-17T00:00:00Z')
    // (0 + 2) / 2 days, over the 2 devices seen in October.
    expect(uniques(rows, r).value.stickiness).toBeCloseTo(0.5)
    // The range's last month (November) has no month counts yet.
    const intoNov = range('2026-10-15T00:00:00Z', '2026-11-02T00:00:00Z')
    expect(uniques(rows, intoNov).value.stickiness).toBeNull()
  })
})

describe('ballotDevicesPerDay', () => {
  it('adds new and returning ballot devices per day, with the area filter', () => {
    const rows = [
      row(at('2026-10-25T12:00:00Z'), 'voter', 'new', 'il-cook', 'timed', 3),
      row(at('2026-10-25T13:00:00Z'), 'voter', 'return', 'il-cook', '', 2),
      row(at('2026-10-25T13:00:00Z'), 'voter', 'new', 'ca-la', 'timed', 7),
    ]
    const r = range('2026-10-25T00:00:00Z', '2026-10-27T00:00:00Z', 'il-cook')
    expect(ballotDevicesPerDay(rows, r)).toEqual([
      { day: '2026-10-25', n: 5 },
      { day: '2026-10-26', n: 0 },
    ])
  })
})

describe('inputs', () => {
  it('gives search-to-form, lookup success and profiles per ballot', () => {
    const rows = [
      row(LAUNCH, 'visit', 'profile', 'search', 'arrived', 20),
      row(LAUNCH, 'visit', 'profile', 'search', 'form', 5),
      row(LAUNCH, 'visit', 'start', 'direct', 'form', 9),
      row(H, 'lookup', 'ok', 'il-cook', '0', 6, 900),
      row(H, 'lookup', 'gaps', 'il-cook', '0', 2, 900),
      row(H, 'lookup', 'not_found', 'il-cook', '0', 2, 900),
      row(H, 'lookup', 'error', 'il-cook', '1', 30, 900),
      row(H, 'voter', 'new', 'il-cook', 'timed', 4),
      row(H, 'open', 'county', '1', '', 10),
    ]
    const v = inputs(rows, WEEK)
    expect(v.searchToForm.value).toBe(0.25)
    expect(v.searchToForm.estimate).toBe(false)
    expect(v.searchToForm.countedFrom).toBe(LAUNCH)
    expect(v.lookupSuccess).toBe(0.8)
    expect(v.profilesPerBallot).toEqual({
      value: 2.5,
      estimate: false,
      allAreas: false,
      countedFrom: null,
    })
    const none = inputs([], WEEK)
    expect(none.searchToForm.value).toBeNull()
    expect(none.lookupSuccess).toBeNull()
    expect(none.profilesPerBallot.value).toBeNull()
  })

  it('counts profiles per ballot across all areas, since opens have no area', () => {
    const rows = [
      row(H, 'voter', 'new', 'il-cook', 'timed', 3),
      row(H, 'voter', 'new', 'ca-la', 'timed', 1),
      row(H, 'open', 'county', '1', '', 10),
    ]
    const v = inputs(rows, { ...WEEK, area: 'ca-la' })
    expect(v.profilesPerBallot.value).toBe(2.5)
    expect(v.profilesPerBallot.allAreas).toBe(true)
  })
})

describe('activation', () => {
  it('divides informed by lookups on the ballot path, history before launch', () => {
    const rows = [
      row(H, 'voter', 'new', 'il-cook', 'timed', 6),
      row(H, 'learn', 'researched', 'il-cook', '1', 2),
      row(LAUNCH, 'visit', 'ballot', 'direct', 'lookup', 4),
      row(LAUNCH, 'visit', 'start', 'direct', 'informed', 3),
      row(LAUNCH, 'visit', 'profile', 'search', 'lookup', 50),
      row(LAUNCH, 'voter', 'new', 'il-cook', 'timed', 4), // after launch: not the stand-in
    ]
    const m = activation(rows, WEEK)
    expect(m.value).toBe(0.5) // (2 + 3) / (6 + 4)
    expect(m.estimate).toBe(true)
    expect(m.countedFrom).toBe(LAUNCH)
  })

  it('returns null instead of dividing by zero', () => {
    const m = activation([], WEEK)
    expect(m.value).toBeNull()
    expect(m.countedFrom).toBeNull()
  })
})

describe('informedPicksShare', () => {
  it('is informed picks over all picks, or null', () => {
    const rows = [
      row(H, 'pick', 'county', '1', '', 3),
      row(H, 'pick', 'state', '0', '', 1),
    ]
    expect(informedPicksShare(rows, WEEK)).toBe(0.75)
    expect(informedPicksShare([], WEEK)).toBeNull()
  })
})

describe('costPer', () => {
  it('prorates monthly costs by day', () => {
    const costs = { monthly: [{ name: 'Hosting', usd: 31, from: '2026-10' }] }
    const r = range('2026-10-05T00:00:00Z', '2026-10-15T00:00:00Z')
    const c = costPer(costs, r, { informed: 5, researched: 0 })
    expect(c?.usd).toBeCloseTo(10)
    expect(c?.perInformed).toBeCloseTo(2)
    expect(c?.perResearched).toBeNull()
  })

  it('applies each cost only from its first month through its last', () => {
    const costs = {
      monthly: [
        { name: 'Old', usd: 30, from: '2026-09', to: '2026-09' },
        { name: 'New', usd: 31, from: '2026-10' },
      ],
    }
    // Sep 21 to Oct 11 (UTC): 10 days of September, 10 of October.
    const r = range('2026-09-21T00:00:00Z', '2026-10-11T00:00:00Z')
    expect(costPer(costs, r, { informed: 0, researched: 4 })?.usd).toBeCloseTo(
      20,
    )
    expect(costPer(null, r, { informed: 1, researched: 1 })).toBeNull()
  })
})

describe('dataHealth', () => {
  it('counts dropped batches, missing hours and live hours', () => {
    const start = at('2026-10-25T00:00:00Z')
    const rows = [
      row(start, 'dropped', 'bot', '', '', 3),
      row(start, 'dropped', 'invalid', '', '', 2, 5),
      row(start + HOUR, 'dropped', 'limited', '', '', 1, 0, 1),
      row(start + HOUR, 'view', 'ballot', 'landing', '', 1, 0, 1),
      row(start + 3 * HOUR, 'view', 'ballot', 'landing'),
    ]
    const h = dataHealth(
      rows,
      range('2026-10-25T00:00:00Z', '2026-10-25T05:00:00Z'),
    )
    expect(h).toEqual({
      bot: 3,
      invalid: 2,
      limited: 1,
      missingHours: 2,
      liveHours: 1,
    })
  })
})
