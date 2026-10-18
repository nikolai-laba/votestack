import { describe, expect, it } from 'vitest'
import { lookupPoint, usagePage, usagePoint } from './metrics.ts'

describe('usage events', () => {
  it('keeps only the listed fields of a page view', () => {
    expect(
      usagePoint({
        e: 'view',
        page: 'profile',
        from: 'ballot',
        key: 'jane-doe',
        address: '1 Main St',
      }),
    ).toEqual({ blobs: ['view', 'profile', 'ballot', 'jane-doe'], doubles: [] })
  })

  it('drops a key that is not a public page name', () => {
    expect(
      usagePoint({ e: 'view', page: 'profile', from: 'app', key: '1 Main St' })
        ?.blobs[3],
    ).toBe('')
  })

  it('refuses unknown events and values', () => {
    expect(usagePoint({ e: 'pick', level: 'local', choice: 'x' })).toBeNull()
    expect(usagePoint({ e: 'open', level: 'local', nth: 3 })).toBeNull()
    expect(usagePoint({ e: 'ready', answer: 'yes' })).toBeNull()
    expect(usagePoint({ e: 'active', secs: -1, ballot: true })).toBeNull()
    expect(usagePoint(null)).toBeNull()
  })

  it('counts a new voter with the ballot’s races by level', () => {
    expect(
      usagePoint({
        e: 'voter',
        kind: 'new',
        region: 'il-cook',
        secs: 41.6,
        races: { federal: 2, local: 9, judges: 1e9 },
      }),
    ).toEqual({
      blobs: ['voter', 'new', 'il-cook', ''],
      doubles: [42, 2, 0, 0, 1000, 9, 0, 0],
    })
  })

  it('replaces an unknown area with none', () => {
    expect(
      usagePoint({ e: 'half', region: 'Oak Park', informed: true }),
    ).toEqual({ blobs: ['half', 'none', '1', ''], doubles: [] })
    expect(lookupPoint('ok', undefined, false, 12.4).blobs).toEqual([
      'lookup',
      'ok',
      'none',
      '0',
    ])
  })

  it('names the page of each address in the app', () => {
    expect(usagePage('/')).toEqual({ page: 'ballot' })
    expect(usagePage('/candidates/jane-doe')).toEqual({
      page: 'profile',
      key: 'jane-doe',
    })
    expect(usagePage('/candidates/jane-doe/report').page).toBe('report')
    expect(usagePage('/races/il/2026-11-03/united-states-senator')).toEqual({
      page: 'races',
      key: 'il/2026-11-03/united-states-senator',
    })
    expect(usagePage('/races')).toEqual({ page: 'races' })
    expect(usagePage('/about/').page).toBe('about')
    expect(usagePage('/nope').page).toBe('other')
  })
})
