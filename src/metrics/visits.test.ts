import { describe, expect, it } from 'vitest'
import { VISIT_TIMEOUT_MS, type UsageEvent } from '../shared/metrics.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { VISIT_KEY, createVisits } from './visits.ts'

const MIN = 60_000

function setup(opts: { session?: Storage | null; referrer?: string } = {}) {
  const session =
    opts.session === undefined ? new MemoryStorage() : opts.session
  const sent: UsageEvent[] = []
  const clock = { now: 1_000_000 }
  const make = () =>
    createVisits({
      session: () => session,
      now: () => clock.now,
      referrer: () => opts.referrer ?? 'https://www.google.com/',
      host: () => 'votestack.org',
      add: (e) => sent.push(e),
    })
  return { session, sent, clock, make, visits: make() }
}

const steps = (sent: UsageEvent[]) =>
  sent.map((e) => (e.e === 'visit' ? e.step : e.e))

describe('visits', () => {
  it('starts a visit on the first page', () => {
    const { visits, sent } = setup()
    visits.shown('profile')
    expect(sent).toEqual([
      { e: 'visit', entry: 'profile', source: 'search', step: 'arrived' },
    ])
  })

  it('counts a second page as browsed, once', () => {
    const { visits, sent } = setup()
    visits.shown('profile')
    visits.shown('ballot')
    visits.shown('about')
    expect(steps(sent)).toEqual(['arrived', 'browsed'])
  })

  it('sends each step once per visit', () => {
    const { visits, sent } = setup()
    visits.shown('start')
    visits.step('form')
    visits.step('form')
    expect(steps(sent)).toEqual(['arrived', 'form'])
  })

  it('starts a new visit after 30 idle minutes', () => {
    const { visits, sent, clock } = setup()
    visits.shown('profile')
    clock.now += VISIT_TIMEOUT_MS + 1
    visits.shown('ballot')
    expect(sent[1]).toEqual({
      e: 'visit',
      entry: 'ballot',
      source: 'search',
      step: 'arrived',
    })
    expect(visits.current()?.entry).toBe('ballot')
  })

  it('a reload in the same tab continues the visit', () => {
    const { visits, sent, clock, make } = setup()
    visits.shown('profile')
    expect(visits.isNew()).toBe(true)
    clock.now += 5 * MIN
    const again = make()
    expect(again.isNew()).toBe(false)
    again.shown('about')
    expect(steps(sent)).toEqual(['arrived', 'browsed'])
    expect(again.current()?.entry).toBe('profile')
  })

  it('ignores steps before any page', () => {
    const { visits, sent } = setup()
    visits.step('asked')
    expect(sent).toEqual([])
    expect(visits.current()).toBeNull()
  })

  it('lasts for the page load when session storage is blocked', () => {
    const { visits, sent } = setup({ session: null })
    visits.shown('profile')
    visits.shown('ballot')
    visits.step('read')
    visits.step('read')
    expect(steps(sent)).toEqual(['arrived', 'browsed', 'read'])
  })

  it('keeps the visit alive with activity', () => {
    const { visits, sent, clock } = setup()
    visits.shown('profile')
    clock.now += 25 * MIN
    visits.step('read')
    clock.now += 25 * MIN
    visits.shown('ballot')
    expect(steps(sent)).toEqual(['arrived', 'read', 'browsed'])
  })

  it('falls back to memory when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('no')
      },
      setItem: () => {
        throw new Error('no')
      },
    } as unknown as Storage
    const { visits, sent } = setup({ session: broken })
    visits.shown('profile')
    visits.shown('ballot')
    expect(steps(sent)).toEqual(['arrived', 'browsed'])
  })

  it('treats unreadable stored data as no visit and reports the entry', () => {
    const { visits, session, sent } = setup()
    ;(session as Storage).setItem(VISIT_KEY, '{nope')
    visits.shown('races')
    expect(steps(sent)).toEqual(['arrived'])
    expect(visits.current()).toMatchObject({
      entry: 'races',
      path: 'reader',
    })
  })
})
