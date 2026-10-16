import { describe, expect, it, vi } from 'vitest'
import type { Ballot, Contest } from '../shared/ballot.ts'
import { LOS_ANGELES } from '../shared/regions.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { STORAGE_KEY, createBallotStore, parseStored } from './store.ts'
import {
  hiddenPickCount,
  pickCountText,
  pickCounts,
  swapText,
} from './summary.ts'

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'e1',
  authorityId: `${IL}/county:cook`,
  districtId: IL,
  sources: [],
  lastVerified: '2026-10-04',
}
const mwrd: Contest = {
  ...base,
  kind: 'candidate',
  id: 'mwrd',
  title: 'Commissioner, Water Reclamation District',
  office: 'Commissioner',
  voteFor: 2,
  candidates: [{ name: 'Ann Lee' }, { name: 'Bo Diaz' }, { name: 'Cy Fox' }],
}
const judge: Contest = {
  ...base,
  kind: 'retention',
  id: 'r1',
  title: 'Retention',
  office: 'Judge',
  judge: 'John Roe',
}
const measure: Contest = {
  ...base,
  kind: 'measure',
  id: 'm1',
  title: 'Transit question',
  question: 'Shall…?',
}
const ballot: Ballot = {
  election: { id: 'e1', name: 'General', date: '2026-11-03', divisionId: IL },
  precinct: { id: 'cook:1', name: 'Oak Park 22', districtIds: [IL] },
  contests: [mwrd, judge, measure],
  coverage: { status: 'complete', notes: [] },
  publishedProfiles: ['ann-lee'],
}

function storeWith(storage: Storage | null = new MemoryStorage()) {
  return { storage, store: createBallotStore(() => storage) }
}

describe('ballot store', () => {
  it('saves the ballot without its precinct, under one versioned key', () => {
    const { storage, store } = storeWith()
    store.saveBallot(ballot)
    const stored = JSON.parse(storage!.getItem(STORAGE_KEY)!)
    expect(stored.version).toBe(1)
    expect(stored.ballot.precinct).toBeUndefined()
    expect(JSON.stringify(stored)).not.toContain('Oak Park 22')
    expect(stored.ballot.contests).toHaveLength(3)
    expect(storage!.length).toBe(1)
    // A fresh page load reads it back.
    expect(createBallotStore(() => storage).getSnapshot().ballot).toEqual(
      stored.ballot,
    )
  })

  it('ignores data from another version or that is malformed', () => {
    expect(parseStored(JSON.stringify({ version: 2, ballot: ballot }))).toEqual(
      { version: 1, ballot: null, picks: {} },
    )
    expect(parseStored('{not json')).toMatchObject({ ballot: null })
    expect(
      parseStored(
        JSON.stringify({
          version: 1,
          ballot: { election: 'x' },
          picks: { e1: { mwrd: ['ann-lee', 7], r1: 'yes' } },
        }),
      ),
    ).toEqual({
      version: 1,
      ballot: null,
      picks: { e1: { mwrd: ['ann-lee'] } },
    })
  })

  it('swaps in a pick past the vote-for limit and lets picks be undone', () => {
    const { store } = storeWith()
    store.saveBallot(ballot)
    expect(store.toggle(mwrd, 'ann-lee')).toEqual({ kind: 'picked' })
    expect(store.toggle(mwrd, 'bo-diaz')).toEqual({ kind: 'picked' })
    // A third pick in a vote-for-2 race replaces the earliest one.
    expect(store.toggle(mwrd, 'cy-fox')).toEqual({
      kind: 'picked',
      replaced: 'ann-lee',
    })
    expect(store.getSnapshot().picks.e1.mwrd).toEqual(['bo-diaz', 'cy-fox'])
    expect(swapText(mwrd as never, 'cy-fox', 'ann-lee')).toBe(
      'Picked Cy Fox instead of Ann Lee.',
    )
    // The earliest is by when it was picked, not ballot order.
    expect(store.toggle(mwrd, 'ann-lee')).toEqual({
      kind: 'picked',
      replaced: 'bo-diaz',
    })
    expect(store.getSnapshot().picks.e1.mwrd).toEqual(['cy-fox', 'ann-lee'])
    expect(store.toggle(mwrd, 'cy-fox')).toEqual({ kind: 'unpicked' })
    expect(store.toggle(mwrd, 'bo-diaz')).toEqual({ kind: 'picked' })
    expect(store.getSnapshot().picks.e1.mwrd).toEqual(['ann-lee', 'bo-diaz'])
  })

  it('replaces the pick in a vote-for-1 race', () => {
    const { store } = storeWith()
    const gov = { ...mwrd, id: 'gov', voteFor: 1 } as Contest
    store.toggle(gov, 'ann-lee')
    expect(store.toggle(gov, 'bo-diaz')).toEqual({
      kind: 'picked',
      replaced: 'ann-lee',
    })
    expect(store.getSnapshot().picks.e1.gov).toEqual(['bo-diaz'])
  })

  it('switches yes and no, and clears an answer picked again', () => {
    const { store } = storeWith()
    store.toggle(judge, 'yes')
    store.toggle(judge, 'no')
    expect(store.getSnapshot().picks.e1.r1).toEqual(['no'])
    store.toggle(judge, 'no')
    expect(store.getSnapshot().picks).toEqual({})
  })

  it('counts each race, judge and referendum once', () => {
    const { store } = storeWith()
    store.saveBallot(ballot)
    store.toggle(mwrd, 'ann-lee')
    store.toggle(mwrd, 'bo-diaz')
    store.toggle(measure, 'no')
    const counts = pickCounts(ballot, store.getSnapshot().picks)
    expect(counts.picked).toBe(2)
    expect(pickCountText(counts)).toBe(
      '1 of 1 race, 0 of 1 judge up for retention and 1 of 1 referendum',
    )
    expect(pickCountText(counts, LOS_ANGELES.measureWords)).toBe(
      '1 of 1 race, 0 of 1 judge up for retention and 1 of 1 measure',
    )
  })

  it('works in memory when storage is blocked, and says so', () => {
    const blocked = {
      getItem: vi.fn(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
      removeItem: vi.fn(),
    } as unknown as Storage
    const { store } = storeWith(blocked)
    expect(store.getSnapshot().persistent).toBe(false)
    store.saveBallot(ballot)
    expect(store.toggle(mwrd, 'ann-lee')).toEqual({ kind: 'picked' })
    expect(store.getSnapshot().picks.e1.mwrd).toEqual(['ann-lee'])

    // No storage at all (the getter itself throws in some browsers).
    const none = storeWith(null).store
    expect(none.getSnapshot().persistent).toBe(false)
    none.toggle(judge, 'yes')
    expect(none.getSnapshot().picks.e1.r1).toEqual(['yes'])
  })

  it('falls back to memory when a write fails later', () => {
    const storage = new MemoryStorage()
    const { store } = storeWith(storage)
    expect(store.getSnapshot().persistent).toBe(true)
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    store.toggle(judge, 'yes')
    expect(store.getSnapshot()).toMatchObject({
      persistent: false,
      picks: { e1: { r1: ['yes'] } },
    })
  })

  it('follows changes made in another tab', () => {
    const storage = new MemoryStorage()
    const { store } = storeWith(storage)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const other = createBallotStore(() => storage)
    other.saveBallot(ballot)
    other.toggle(judge, 'yes')
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot().picks.e1.r1).toEqual(['yes'])

    // Other keys are none of its business.
    listener.mockClear()
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('hides picks for races not on a new ballot until they are removed', () => {
    const { store } = storeWith()
    store.saveBallot(ballot)
    store.toggle(mwrd, 'ann-lee')
    store.toggle(judge, 'yes')
    // A new address: the judge isn't on this ballot.
    store.saveBallot({ ...ballot, contests: [mwrd, measure] })
    const state = store.getSnapshot()
    expect(hiddenPickCount(state.ballot, state.picks)).toBe(1)
    expect(pickCounts(state.ballot!, state.picks).picked).toBe(1)

    store.removeHiddenPicks()
    expect(store.getSnapshot().picks).toEqual({ e1: { mwrd: ['ann-lee'] } })
  })

  it('clears every pick but keeps the ballot', () => {
    const { storage, store } = storeWith()
    store.saveBallot(ballot)
    store.toggle(judge, 'yes')
    store.clearPicks()
    expect(store.getSnapshot()).toMatchObject({ picks: {} })
    expect(JSON.parse(storage!.getItem(STORAGE_KEY)!).picks).toEqual({})
    expect(store.getSnapshot().ballot).not.toBeNull()
  })
})
