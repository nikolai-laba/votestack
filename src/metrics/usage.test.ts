import { describe, expect, it } from 'vitest'
import { sectionFor } from '../ballot/sections.ts'
import type { SavedBallot } from '../picks/store.ts'
import type { Contest } from '../shared/ballot.ts'
import { USAGE_LEVELS, type UsageEvent } from '../shared/metrics.ts'
import { COOK } from '../shared/regions.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { USAGE_KEY, createUsage } from './usage.ts'

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
    expect(usage.pending().slice(1)).toEqual([
      { e: 'open', level: 'federal', nth: 1 },
      { e: 'open', level: 'federal', nth: 2 },
    ])
  })

  it('counts first picks, informed or not, and half the ballot without judges', () => {
    const { usage } = setup()
    usage.voter(ballot)
    usage.open(ballot, 'ann-lee')
    const picks = { [E]: { cd: ['ann-lee'] } }
    usage.picks(ballot, picks, {})
    usage.picks(ballot, picks, {})
    expect(usage.pending().slice(2)).toEqual([
      { e: 'pick', level: 'federal', informed: true },
      { e: 'half', region: 'il-cook', informed: true },
    ])
    usage.picks(ballot, { [E]: { cd: ['ann-lee'], mayor: ['cy-day'] } }, {})
    expect(usage.pending().slice(4)).toEqual([
      { e: 'pick', level: 'local', informed: false },
    ])
  })

  it('never counts picks made before the page opened', () => {
    const { usage } = setup()
    usage.voter(ballot)
    const picks = { [E]: { mayor: ['cy-day'] } }
    usage.picks(ballot, picks, picks)
    expect(usage.pending().filter((e) => e.e === 'pick')).toEqual([])
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
