import { describe, expect, it } from 'vitest'
import {
  isAutomatedAgent,
  lookupPoint,
  usagePage,
  usagePoint,
} from './metrics.ts'

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

describe('isAutomatedAgent', () => {
  it('flags crawlers, previews and automated browsers', () => {
    for (const agent of [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/141.0.7390.122 Safari/537.36',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
      'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'curl/8.7.1',
      '',
      null,
    ]) {
      expect(isAutomatedAgent(agent)).toBe(true)
    }
  })

  it('counts ordinary browsers', () => {
    for (const agent of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 15; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0',
      'Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    ]) {
      expect(isAutomatedAgent(agent)).toBe(false)
    }
  })
})
