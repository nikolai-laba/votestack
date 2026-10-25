import { describe, expect, it } from 'vitest'
import {
  droppedPoint,
  isAutomatedAgent,
  lookupPoint,
  mondayOf,
  pathOf,
  usagePage,
  usagePoint,
  visitSource,
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
      blobs: ['voter', 'new', 'il-cook', 'timed'],
      doubles: [42, 2, 0, 0, 1000, 9, 0, 0],
    })
  })

  it('leaves out a time to the ballot that is missing or too long', () => {
    const at = (secs?: number) =>
      usagePoint({ e: 'voter', kind: 'new', region: 'ca-la', secs })
    expect(at()?.blobs[3]).toBe('restored')
    expect(at(1800)?.blobs[3]).toBe('timed')
    expect(at(12_402)).toEqual({
      blobs: ['voter', 'new', 'ca-la', 'long'],
      doubles: [0, 0, 0, 0, 0, 0, 0, 0],
    })
    expect(
      usagePoint({ e: 'voter', kind: 'return', region: 'ca-la' })?.blobs[3],
    ).toBe('')
  })

  it('counts fill and learning milestones, and refuses other values', () => {
    expect(usagePoint({ e: 'fill', region: 'ca-la', pct: 75 })).toEqual({
      blobs: ['fill', '75', 'ca-la', ''],
      doubles: [],
    })
    expect(usagePoint({ e: 'fill', region: 'ca-la', pct: 60 })).toBe(null)
    expect(
      usagePoint({ e: 'learn', region: 'il-cook', kind: 'races', n: 3 }),
    ).toEqual({ blobs: ['learn', 'races', 'il-cook', '3'], doubles: [] })
    expect(
      usagePoint({ e: 'learn', region: 'il-cook', kind: 'compared', n: 5 }),
    ).toBe(null)
    expect(
      usagePoint({ e: 'learn', region: 'il-cook', kind: 'clicks', n: 1 }),
    ).toBe(null)
  })

  it('counts sample ballots seen, and devices that then looked up their own', () => {
    expect(
      usagePoint({ e: 'sample', step: 'seen', region: 'il-cook' }),
    ).toEqual({ blobs: ['sample', 'seen', 'il-cook', ''], doubles: [] })
    expect(
      usagePoint({ e: 'sample', step: 'own', region: 'x' })?.blobs,
    ).toEqual(['sample', 'own', 'none', ''])
    expect(usagePoint({ e: 'sample', step: 'maybe', region: 'il-cook' })).toBe(
      null,
    )
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
    expect(usagePage('/support').page).toBe('support')
    expect(usagePage('/nope').page).toBe('other')
  })
})

describe('sign-up banner events', () => {
  it('counts the sign-up banner shown and closed, nothing else', () => {
    expect(usagePoint({ e: 'banner', act: 'shown' })).toEqual({
      blobs: ['banner', 'shown', '', ''],
      doubles: [],
    })
    expect(usagePoint({ e: 'banner', act: 'closed' })).toEqual({
      blobs: ['banner', 'closed', '', ''],
      doubles: [],
    })
    expect(usagePoint({ e: 'banner', act: 'opened' })).toBeNull()
    expect(usagePoint({ e: 'banner' })).toBeNull()
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

describe('v2 events', () => {
  it('labels a visit step', () => {
    expect(
      usagePoint({
        e: 'visit',
        entry: 'profile',
        source: 'search',
        step: 'read',
      }),
    ).toEqual({ blobs: ['visit', 'profile', 'search', 'read'], doubles: [] })
  })

  it('labels device, read, informed, cta and origin', () => {
    expect(
      usagePoint({ e: 'device', period: 'week', seen: 'new' })?.blobs,
    ).toEqual(['device', 'week', 'new', ''])
    expect(
      usagePoint({
        e: 'read',
        path: 'reader',
        kind: 'retention',
        mark: 'sources',
      })?.blobs,
    ).toEqual(['read', 'reader', 'retention', 'sources'])
    expect(
      usagePoint({
        e: 'informed',
        period: 'election',
        path: 'ballot',
        kind: 'compared',
      })?.blobs,
    ).toEqual(['informed', 'election', 'ballot', 'compared'])
    expect(
      usagePoint({ e: 'cta', link: 'top', page: 'profile' })?.blobs,
    ).toEqual(['cta', 'top', 'profile', ''])
    expect(
      usagePoint({
        e: 'origin',
        entry: 'unknown',
        source: 'unknown',
        when: 'later',
      })?.blobs,
    ).toEqual(['origin', 'unknown', 'unknown', 'later'])
  })

  it('refuses unknown v2 values', () => {
    const visit = {
      e: 'visit',
      entry: 'profile',
      source: 'search',
      step: 'read',
    }
    expect(usagePoint({ ...visit, step: 'scrolled' })).toBeNull()
    expect(usagePoint({ ...visit, source: 'google' })).toBeNull()
    expect(usagePoint({ e: 'device', period: 'year', seen: 'new' })).toBeNull()
    expect(usagePoint({ e: 'device', period: 'day', seen: 'old' })).toBeNull()
    const read = { e: 'read', path: 'reader', kind: 'candidate', mark: '10' }
    expect(usagePoint({ ...read, mark: '45' })).toBeNull()
    expect(usagePoint({ ...read, kind: 'judicial_candidate' })).toBeNull()
    expect(usagePoint({ e: 'cta', link: 'footer', page: 'profile' })).toBeNull()
    expect(
      usagePoint({
        e: 'origin',
        entry: 'ballot',
        source: 'search',
        when: 'soon',
      }),
    ).toBeNull()
  })

  it('sorts referrers into categories', () => {
    const host = 'votestack.org'
    const cases: [string, string][] = [
      ['https://www.google.com/', 'search'],
      ['https://gemini.google.com/app', 'ai'],
      ['https://mail.google.com/', 'email'],
      ['https://l.facebook.com/x', 'social'],
      ['https://news.example.org/a', 'other'],
      ['', 'direct'],
      ['https://votestack.org/races', 'direct'],
      ['not a url', 'direct'],
      ['https://www.bing.com/search?q=x', 'search'],
      ['https://chatgpt.com/', 'ai'],
    ]
    for (const [referrer, source] of cases)
      expect(visitSource(referrer, host)).toBe(source)
  })

  it('maps pages to paths', () => {
    expect(pathOf('profile')).toBe('reader')
    expect(pathOf('races')).toBe('reader')
    expect(pathOf('ballot')).toBe('ballot')
    expect(pathOf('start')).toBe('ballot')
    expect(pathOf('about')).toBe('other')
  })

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19')
    expect(mondayOf('2026-10-26')).toBe('2026-10-26')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')
  })

  it('counts dropped batches', () => {
    expect(droppedPoint('bot')).toEqual({
      blobs: ['dropped', 'bot', '', ''],
      doubles: [],
    })
    expect(droppedPoint('invalid', 3).doubles).toEqual([3])
  })
})
