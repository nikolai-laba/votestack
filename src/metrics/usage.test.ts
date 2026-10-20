import { describe, expect, it } from 'vitest'
import { sectionFor } from '../ballot/sections.ts'
import type { SavedBallot } from '../picks/store.ts'
import type { Contest } from '../shared/ballot.ts'
import { USAGE_LEVELS, type UsageEvent } from '../shared/metrics.ts'
import { COOK } from '../shared/regions.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { OFF_KEY, USAGE_KEY, createUsage } from './usage.ts'

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
  let today = day
  const usage = createUsage({
    storage: () => storage,
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
    expect(sent).toEqual([[{ e: 'view', page: 'support', from: 'app' }]])
  })

  it('sends the queue in one batch and empties it', () => {
    const { usage, sent } = setup()
    usage.view('ballot', 'landing')
    usage.out('profile')
    usage.active(0.4, true)
    usage.flush()
    expect(sent).toEqual([
      [
        { e: 'view', page: 'ballot', from: 'landing' },
        { e: 'out', page: 'profile' },
      ],
    ])
    expect(usage.pending()).toEqual([])
  })
})
