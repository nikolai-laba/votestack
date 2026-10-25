import { describe, expect, it } from 'vitest'
import { sectionFor } from '../ballot/sections.ts'
import type { SavedBallot } from '../picks/store.ts'
import type { Contest } from '../shared/ballot.ts'
import { USAGE_LEVELS, type UsageEvent } from '../shared/metrics.ts'
import { COOK } from '../shared/regions.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { STORAGE_KEY } from '../picks/store.ts'
import { SEEN_KEY } from './devices.ts'
import { READS_KEY } from './reading.ts'
import { OFF_KEY, SAMPLE_KEY, USAGE_KEY, createUsage } from './usage.ts'
import { VISIT_KEY } from './visits.ts'

const E = COOK.election.id

const base = {
  electionId: COOK.election.id,
  authorityId: 'ocd-division/country:us/state:il/county:cook',
  sources: [],
  lastVerified: '2026-10-01',
}

const race = (id: string, districtId: string, names: string[]): Contest => ({
  ...base,
  id,
  kind: 'candidate',
  districtId,
  title: id,
  office: id,
  voteFor: 1,
  candidates: names.map((name) => ({ name })),
})

const ballot: SavedBallot = {
  election: COOK.election,
  coverage: { status: 'complete', notes: [] },
  contests: [
    race('cd', 'ocd-division/country:us/state:il/cd:7', ['Ann Lee', 'Bo Kim']),
    race('mayor', 'ocd-division/country:us/state:il/place:oak_park', [
      'Cy Day',
      'Di Fox',
    ]),
    {
      ...base,
      id: 'ret',
      kind: 'retention',
      districtId: 'ocd-division/country:us/state:il/county:cook',
      title: 'Retain',
      office: 'Judge',
      judge: 'Ed Ray',
    },
  ],
}

function setup(day = '2026-10-20') {
  const sent: UsageEvent[][] = []
  const storage = new MemoryStorage()
  const session = new MemoryStorage()
  let today = day
  const usage = createUsage({
    storage: () => storage,
    session: () => session,
    now: () => 1_000_000,
    referrer: () => '',
    host: () => 'votestack.org',
    send: (events) => {
      sent.push(events)
      return true
    },
    today: () => today,
    clock: () => 12,
  })
  return {
    usage,
    storage,
    session,
    sent,
    setDay: (d: string) => (today = d),
  }
}

describe('usage counts', () => {
  it('uses only levels the Worker accepts', () => {
    for (const c of ballot.contests)
      expect(USAGE_LEVELS).toContain(sectionFor(c))
  })

  it('counts a device once per election, then once per later day', () => {
    const first = setup()
    first.usage.voter(ballot, 30)
    first.usage.voter(ballot, 30)
    expect(first.usage.pending()).toEqual([
      {
        e: 'voter',
        kind: 'new',
        region: 'il-cook',
        secs: 30,
        races: { federal: 1, local: 1, retention: 1 },
      },
    ])

    // A new page on the same device, the same day: nothing new.
    const again = createUsage({
      storage: () => first.storage,
      send: () => true,
      today: () => '2026-10-20',
      clock: () => 0,
    })
    again.voter(ballot)
    expect(again.pending()).toEqual([])

    const later = createUsage({
      storage: () => first.storage,
      send: () => true,
      today: () => '2026-10-22',
      clock: () => 0,
    })
    later.voter(ballot)
    expect(later.pending()).toEqual([
      { e: 'voter', kind: 'return', region: 'il-cook' },
    ])
  })

  it('keeps no address and no picks in its device record', () => {
    const { usage, storage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    const record = storage.getItem(USAGE_KEY) ?? ''
    expect(record).not.toMatch(/street|address|precinct/i)
  })

  it('counts the first and a second profile opened in a race, once each', () => {
    const { usage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    usage.open(ballot, 'ann-lee')
    usage.open(ballot, 'bo-kim')
    expect(usage.pending().filter((e) => e.e === 'open')).toEqual([
      { e: 'open', level: 'federal', nth: 1 },
      { e: 'open', level: 'federal', nth: 2 },
    ])
  })

  it('counts first picks, informed or not, and shares of the ballot filled without judges', () => {
    const { usage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    const picks = { [E]: { cd: ['ann-lee'] } }
    usage.picks(ballot, picks, {})
    usage.picks(ballot, picks, {})
    // Two candidate races count (the retention race doesn't): one is half.
    expect(usage.pending().slice(2)).toEqual([
      { e: 'pick', level: 'federal', informed: true },
      { e: 'fill', region: 'il-cook', pct: 25 },
      { e: 'fill', region: 'il-cook', pct: 50 },
    ])
    usage.picks(ballot, { [E]: { cd: ['ann-lee'], mayor: ['cy-day'] } }, {})
    expect(usage.pending().slice(5)).toEqual([
      { e: 'pick', level: 'local', informed: false },
      { e: 'fill', region: 'il-cook', pct: 75 },
      { e: 'fill', region: 'il-cook', pct: 100 },
    ])
  })

  it('counts research milestones below federal, comparing, and researched once', () => {
    const { usage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    // A federal profile alone isn't research below federal.
    expect(usage.pending().filter((e) => e.e === 'learn')).toEqual([])
    usage.open(ballot, 'cy-day')
    usage.open(ballot, 'ann-lee')
    usage.open(ballot, 'bo-kim')
    usage.open(ballot, 'di-fox')
    expect(usage.pending().filter((e) => e.e === 'learn')).toEqual([
      { e: 'learn', region: 'il-cook', kind: 'races', n: 1 },
      { e: 'learn', region: 'il-cook', kind: 'compared', n: 1 },
      { e: 'learn', region: 'il-cook', kind: 'researched', n: 1 },
    ])
  })

  it('counts a ballot already filled and researched when it is next shown, once', () => {
    const { usage, storage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    usage.open(ballot, 'bo-kim')
    const picks = { [E]: { cd: ['ann-lee'], mayor: ['cy-day'] } }
    // Coming back: nothing changes on the page, but the ballot is shown.
    const back = createUsage({
      storage: () => storage,
      send: () => true,
      today: () => '2026-10-25',
      clock: () => 0,
    })
    back.voter(ballot)
    back.catchUp(ballot, picks)
    back.catchUp(ballot, picks)
    expect(back.pending()).toEqual([
      { e: 'voter', kind: 'return', region: 'il-cook' },
      { e: 'fill', region: 'il-cook', pct: 25 },
      { e: 'fill', region: 'il-cook', pct: 50 },
      { e: 'fill', region: 'il-cook', pct: 75 },
      { e: 'fill', region: 'il-cook', pct: 100 },
    ])
    // Its compared race was counted when it was opened, not again here.
    expect(usage.pending().filter((e) => e.e === 'learn')).toEqual([
      { e: 'learn', region: 'il-cook', kind: 'compared', n: 1 },
      { e: 'learn', region: 'il-cook', kind: 'researched', n: 1 },
    ])
  })

  it('counts research from profiles opened before milestones were counted', () => {
    const { storage } = setup()
    const before = createUsage({
      storage: () => storage,
      send: () => true,
      today: () => '2026-10-18',
      clock: () => 0,
    })
    before.voter(ballot)
    // A record from before milestones: profiles opened, nothing reached.
    const record = JSON.parse(storage.getItem(USAGE_KEY) ?? '{}')
    record[E].opened = { mayor: ['cy-day', 'di-fox'] }
    delete record[E].reached
    storage.setItem(USAGE_KEY, JSON.stringify(record))
    const back = createUsage({
      storage: () => storage,
      send: () => true,
      today: () => '2026-10-20',
      clock: () => 0,
    })
    back.catchUp(ballot, {})
    expect(back.pending()).toEqual([
      { e: 'learn', region: 'il-cook', kind: 'races', n: 1 },
      { e: 'learn', region: 'il-cook', kind: 'compared', n: 1 },
      { e: 'learn', region: 'il-cook', kind: 'researched', n: 1 },
    ])
  })

  it('never counts picks made before the page opened', () => {
    const { usage } = setup()
    usage.voter(ballot)
    const picks = { [E]: { mayor: ['cy-day'] } }
    usage.picks(ballot, picks, picks)
    expect(usage.pending().filter((e) => e.e === 'pick')).toEqual([])
  })

  it('counts a sample once per device, and the device later looking up its own', () => {
    const { usage, storage } = setup()
    usage.sample(ballot)
    usage.sample(ballot)
    const later = createUsage({
      storage: () => storage,
      send: () => true,
      today: () => '2026-10-21',
      clock: () => 0,
    })
    later.sample(ballot)
    later.voter(ballot, 20)
    expect(usage.pending()).toEqual([
      { e: 'sample', step: 'seen', region: 'il-cook' },
    ])
    expect(later.pending().map((e) => e.e)).toEqual(['voter', 'sample'])
    expect(later.pending()[1]).toEqual({
      e: 'sample',
      step: 'own',
      region: 'il-cook',
    })
  })

  it('counts nothing in a browser where counting is off, until it is on again', () => {
    const { usage, storage, sent } = setup()
    usage.view('ballot', 'landing')
    usage.setCounting(false)
    expect(storage.getItem(OFF_KEY)).toBe('1')
    usage.view('about', 'app')
    usage.voter(ballot, 30)
    usage.flush()
    expect(sent).toEqual([])
    usage.setCounting(true)
    usage.view('support', 'app')
    usage.flush()
    expect(sent).toEqual([
      [
        { e: 'view', page: 'support', from: 'app' },
        { e: 'visit', entry: 'ballot', source: 'direct', step: 'browsed' },
      ],
    ])
  })

  it('counts nothing for the rest of a page skipped, without turning counting off', () => {
    const { usage, storage, sent } = setup()
    usage.view('report', 'landing', 'ann-lee')
    usage.skipPage()
    usage.view('profile', 'app', 'ann-lee')
    usage.active(30, false)
    usage.flush()
    expect(sent).toEqual([])
    expect(storage.getItem(OFF_KEY)).toBeNull()
  })

  it('sends the queue in one batch and empties it', () => {
    const { usage, sent } = setup()
    usage.view('ballot', 'landing')
    usage.out('profile')
    usage.active(0.4, true)
    usage.flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].map((e) => e.e)).toEqual([
      'view',
      'visit',
      'device',
      'device',
      'device',
      'device',
      'out',
    ])
    expect(usage.pending()).toEqual([])
  })

  it('counts the sign-up banner shown and closed as they happen', () => {
    const { usage } = setup()
    usage.banner('shown')
    usage.banner('closed')
    expect(usage.pending()).toEqual([
      { e: 'banner', act: 'shown' },
      { e: 'banner', act: 'closed' },
    ])
  })
})

describe('visits, devices and reading in the counter', () => {
  const kinds = (events: UsageEvent[]) => events.map((e) => e.e)
  const steps = (events: UsageEvent[]) =>
    events.flatMap((e) => (e.e === 'visit' ? [e.step] : []))

  it('starts a visit and counts the device on the first page', () => {
    const { usage } = setup()
    usage.view('profile', 'landing', 'x')
    expect(usage.pending()).toEqual([
      { e: 'view', page: 'profile', from: 'landing', key: 'x' },
      { e: 'visit', entry: 'profile', source: 'direct', step: 'arrived' },
      { e: 'device', period: 'day', seen: 'new' },
      { e: 'device', period: 'week', seen: 'new' },
      { e: 'device', period: 'month', seen: 'new' },
      { e: 'device', period: 'election', seen: 'new' },
    ])
    usage.view('about', 'app')
    expect(steps(usage.pending())).toEqual(['arrived', 'browsed'])
    expect(kinds(usage.pending()).filter((e) => e === 'device')).toHaveLength(4)
  })

  it('counts nothing new when counting is off or the page is skipped', () => {
    const v2 = [VISIT_KEY, SEEN_KEY, READS_KEY]
    const off = setup()
    off.usage.setCounting(false)
    off.usage.view('profile', 'landing', 'x')
    off.usage.step('picked')
    off.usage.cta('top', 'profile')
    off.usage.reading({ key: 'x', kind: 'candidate' }, 70, true, [['x']])
    off.usage.voter(ballot, 5)
    expect(off.usage.pending()).toEqual([])
    for (const k of v2) {
      expect(off.session.getItem(k)).toBeNull()
      expect(off.storage.getItem(k)).toBeNull()
    }

    const skip = setup()
    skip.usage.skipPage()
    skip.usage.view('profile', 'landing', 'x')
    skip.usage.step('picked')
    skip.usage.cta('top', 'profile')
    skip.usage.reading({ key: 'x', kind: 'candidate' }, 70, true, [['x']])
    expect(skip.usage.pending()).toEqual([])
    for (const k of v2) {
      expect(skip.session.getItem(k)).toBeNull()
      expect(skip.storage.getItem(k)).toBeNull()
    }
  })

  it('counts a lookup and its origin', () => {
    const { usage } = setup()
    usage.view('start', 'landing')
    usage.voter(ballot, 30)
    const rest = usage.pending().slice(6)
    expect(rest.filter((e) => e.e !== 'voter')).toEqual([
      { e: 'visit', entry: 'start', source: 'direct', step: 'lookup' },
      { e: 'origin', entry: 'start', source: 'direct', when: 'same' },
    ])
  })

  it('counts a returning ballot', () => {
    const { usage, storage } = setup()
    usage.voter(ballot, 30)
    usage.view('ballot', 'landing')
    const again = createUsage({
      storage: () => storage,
      session: () => new MemoryStorage(),
      now: () => 5,
      referrer: () => '',
      host: () => 'votestack.org',
      send: () => true,
      today: () => '2026-10-21',
      clock: () => 0,
    })
    again.view('ballot', 'landing')
    again.voter(ballot)
    expect(steps(again.pending())).toEqual(['arrived', 'returned'])
    expect(kinds(again.pending())).not.toContain('origin')
  })

  it('counts a ballot restored from before counting as returned', () => {
    const { usage } = setup()
    usage.view('ballot', 'landing')
    usage.voter(ballot)
    expect(steps(usage.pending())).toEqual(['arrived', 'returned'])
    expect(kinds(usage.pending())).toContain('origin')
  })

  it('counts researched and picked steps', () => {
    const { usage } = setup()
    usage.view('ballot', 'landing')
    usage.voter(ballot, 5)
    usage.open(ballot, 'cy-day')
    usage.open(ballot, 'di-fox')
    expect(steps(usage.pending())).not.toContain('picked')
    expect(steps(usage.pending())).toContain('researched')
    usage.picks(ballot, { [E]: { mayor: ['cy-day'] } }, {})
    expect(steps(usage.pending())).toContain('picked')
  })

  it('counts researched on catchUp for an already researched ballot', () => {
    const { usage, storage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'cy-day')
    usage.open(ballot, 'di-fox')
    const back = createUsage({
      storage: () => storage,
      session: () => new MemoryStorage(),
      now: () => 5,
      referrer: () => '',
      host: () => 'votestack.org',
      send: () => true,
      today: () => '2026-10-25',
      clock: () => 0,
    })
    back.view('ballot', 'landing')
    back.catchUp(ballot, {})
    expect(steps(back.pending())).toContain('researched')
  })

  it("hands reading to the reading module with the visit's path", () => {
    const { usage } = setup()
    usage.view('profile', 'landing', 'ann-lee')
    usage.reading({ key: 'ann-lee', kind: 'candidate' }, 21, false, [
      ['ann-lee'],
    ])
    const reads = usage.pending().filter((e) => e.e === 'read')
    expect(reads.length).toBeGreaterThan(0)
    for (const r of reads) expect(r).toMatchObject({ path: 'reader' })
  })

  it('counts a link click', () => {
    const { usage } = setup()
    usage.cta('top', 'profile')
    expect(usage.pending()).toEqual([
      { e: 'cta', link: 'top', page: 'profile' },
    ])
  })

  it('treats a device with a saved ballot as back', () => {
    for (const key of [STORAGE_KEY, USAGE_KEY, SAMPLE_KEY]) {
      const { usage, storage } = setup()
      storage.setItem(key, '{}')
      usage.view('ballot', 'landing')
      expect(usage.pending().filter((e) => e.e === 'device')).toEqual(
        ['day', 'week', 'month', 'election'].map((period) => ({
          e: 'device',
          period,
          seen: 'back',
        })),
      )
    }
  })
})
