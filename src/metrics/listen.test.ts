import { afterEach, describe, expect, it } from 'vitest'
import type { UsageEvent } from '../shared/metrics.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { startUsage } from './listen.ts'
import { createUsage } from './usage.ts'

function setup(path: string) {
  history.replaceState(null, '', path)
  const sent: UsageEvent[][] = []
  const counter = createUsage({
    storage: () => new MemoryStorage(),
    session: () => new MemoryStorage(),
    send: (events) => {
      sent.push(events)
      return true
    },
    today: () => '2026-10-22',
    clock: () => 0,
  })
  startUsage(counter)
  counter.view('profile', 'landing', 'ann-lee')
  counter.flush()
  return sent
}

describe('startUsage', () => {
  afterEach(() => history.replaceState(null, '', '/'))

  // Report pages aren't in search results, so a visit that starts on one is
  // almost always a scraper (one swept every report page from residential
  // proxies with a plain Chrome user agent, Oct 2026).
  it('counts nothing for a visit that starts on a report page', () => {
    expect(setup('/candidates/ann-lee/report')).toEqual([])
  })

  it('counts a visit that starts anywhere else', () => {
    // The view comes first; the visit and device events follow it.
    const batches = setup('/candidates/ann-lee')
    expect(batches).toHaveLength(1)
    expect(batches[0][0]).toEqual({
      e: 'view',
      page: 'profile',
      from: 'landing',
      key: 'ann-lee',
    })
  })
})
