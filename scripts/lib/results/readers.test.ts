import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readChicago } from './chicago.ts'
import { CA_SOS_BASE, caSosPaths, readCaSos } from './ca-sos.ts'
import { readCook } from './cook.ts'
import { readLa } from './la.ts'
import { zonedToIso } from './time.ts'
import { OFFICIAL_URLS } from './types.ts'

const fixture = (name: string) =>
  readFileSync(resolve('scripts/lib/results/fixtures', name), 'utf8')
const fixtureBytes = (name: string) =>
  readFileSync(resolve('scripts/lib/results/fixtures', name))
const RETRIEVED = '2026-11-04T12:00:00.000Z'

describe('zonedToIso', () => {
  it('uses the zone offset in effect on that date', () => {
    const t = { year: 2026, month: 11, day: 3, hour: 22, minute: 18, second: 0 }
    expect(zonedToIso(t, 'America/Chicago')).toBe('2026-11-04T04:18:00.000Z')
    expect(zonedToIso({ ...t, month: 7 }, 'America/Chicago')).toBe(
      '2026-07-04T03:18:00.000Z',
    )
    expect(
      zonedToIso(
        { ...t, hour: 3, minute: 11, second: 55 },
        'America/Los_Angeles',
      ),
    ).toBe('2026-11-03T11:11:55.000Z')
  })
})

describe('readChicago', () => {
  const file = readChicago(
    fixtureBytes('chicago-summary.txt'),
    'Wed, 04 Nov 2026 09:20:55 GMT',
    RETRIEVED,
  )

  it('reads the file metadata', () => {
    expect(file.source).toBe('chicago')
    expect(file.url).toBe(OFFICIAL_URLS.chicago)
    expect(file.retrievedAt).toBe(RETRIEVED)
    expect(file.asOf).toBe('2026-11-04T09:20:55.000Z')
  })

  it('reads the Senate contest', () => {
    const senate = file.contests.find((c) => c.title === 'Senator, U.S.')
    expect(senate?.choices).toEqual([
      { name: 'Don Tracy', votes: 80483 },
      { name: 'Juliana Stratton', votes: 556129 },
      { name: 'Whitfield Harrington Jr', votes: 9350 },
    ])
  })

  it('keeps a retention contest with the file’s own YES/NO names', () => {
    const j = file.contests.find((c) => c.title === 'Bertina E. Lampkin')
    expect(j?.choices.map((c) => c.name)).toEqual(['Yes', 'No'])
    expect(j?.choices[0].votes).toBe(414026)
  })

  const votes = (title: string, name: string) =>
    file.contests
      .find((c) => c.title === title)
      ?.choices.find((c) => c.name === name)?.votes

  it('keeps long contest titles whole', () => {
    expect(
      votes(
        'Judge, 11th Subcircuit (Vacancy of McLean Meyerson)',
        'Jarrett Knox',
      ),
    ).toBe(25132)
  })

  it('keeps long candidate names whole', () => {
    expect(
      votes(
        'Governor & Lieutenant Governor, Illinois',
        'Darren Bailey & Aaron B. Del Mar',
      ),
    ).toBe(75889)
  })

  it('spells accented names exactly and keeps later fields aligned', () => {
    expect(
      votes(
        'Commissioner, Water Reclamation Dist',
        'Eira Lizeth Corral Sepúlveda',
      ),
    ).toBe(426594)
  })

  it('keeps one-precinct questions as separate contests', () => {
    for (const precinct of ['W07 P14', 'W10 P02']) {
      const c = file.contests.filter(
        (x) =>
          x.title ===
          `Govt support for quantum facility at South Works ${precinct}`,
      )
      expect(c).toHaveLength(1)
      expect(c[0].choices.map((x) => x.name)).toEqual(['Yes', 'No'])
    }
  })

  it('throws, rather than merging them, when two contests share a title', () => {
    // A copy of the first Senate line under another contest number (bytes 1 to 5).
    const text = fixture('chicago-summary.txt')
    const senate = text.split('\r\n').find((l) => l.includes('Don Tracy'))!
    const other = `2${'00999'}${senate.slice(6)}`
    expect(() =>
      readChicago(
        Buffer.from(`${text}${other}\r\n`),
        'Wed, 04 Nov 2026 09:20:55 GMT',
        RETRIEVED,
      ),
    ).toThrow(
      /^chicago: contests 00001 and 00999 are both titled "Senator, U\.S\."$/,
    )
    // The same contest's lines, wherever they are, still make one contest.
    const again = readChicago(
      Buffer.from(`${text}${senate.replace('Don Tracy', 'Dan Tracy')}\r\n`),
      'Wed, 04 Nov 2026 09:20:55 GMT',
      RETRIEVED,
    )
    expect(
      again.contests.filter((c) => c.title === 'Senator, U.S.'),
    ).toHaveLength(1)
  })

  it('throws on invalid UTF-8 in a field', () => {
    const bytes = Buffer.from(fixtureBytes('chicago-summary.txt'))
    const at = bytes.indexOf('Sep\xc3\xbalveda', 0, 'latin1')
    expect(at).toBeGreaterThan(0)
    bytes[at + 3] = 0xff
    bytes[at + 4] = 0xff
    expect(() =>
      readChicago(bytes, 'Wed, 04 Nov 2026 09:20:55 GMT', RETRIEVED),
    ).toThrow(/^chicago: /)
  })

  it('throws when there are no contest lines', () => {
    expect(() =>
      readChicago(new Uint8Array(), 'Wed, 04 Nov 2026 09:20:55 GMT', RETRIEVED),
    ).toThrow(/^chicago: /)
  })

  it('throws on a votes field that is not digits', () => {
    const bad = Buffer.from(
      fixture('chicago-summary.txt').replace('0080483', '00x0483'),
    )
    expect(() =>
      readChicago(bad, 'Wed, 04 Nov 2026 09:20:55 GMT', RETRIEVED),
    ).toThrow(/^chicago: /)
  })
})

describe('readCook', () => {
  const file = readCook(fixture('cook-results.html'), RETRIEVED)

  it('reads the file metadata', () => {
    expect(file.source).toBe('cook')
    expect(file.url).toBe(OFFICIAL_URLS.cook)
    expect(file.asOf).toBe('2026-11-04T04:18:00.000Z')
  })

  it('reads the Senate contest without party suffixes or leader marks', () => {
    const senate = file.contests.find((c) => c.title === 'Senator, U.S.')
    expect(senate?.voteFor).toBe(1)
    expect(senate?.choices).toEqual([
      { name: 'Don Tracy', votes: 190799 },
      { name: 'Juliana Stratton', votes: 529610 },
      { name: 'Whitfield Harrington Jr', votes: 10853 },
    ])
  })

  it('keeps a retention contest', () => {
    const j = file.contests.find((c) => c.title === 'Bertina E. Lampkin')
    expect(j?.choices).toEqual([
      { name: 'Yes', votes: 457318 },
      { name: 'No', votes: 147033 },
    ])
  })

  it('reads a contest with only a "No Candidate" row as having no choices', () => {
    const c = file.contests.find(
      (x) => x.title === 'Trustee, La Grange Highlands Sanitary District, 2Yr',
    )
    expect(c).toEqual({
      title: 'Trustee, La Grange Highlands Sanitary District, 2Yr',
      choices: [],
      voteFor: 1,
    })
  })

  it('still throws on any other empty votes cell', () => {
    const html = fixture('cook-results.html').replace(
      />\s*No Candidate\s*</,
      '>Someone Else<',
    )
    expect(() => readCook(html, RETRIEVED)).toThrow(/votes field/)
  })

  it('throws when no contests are found', () => {
    expect(() => readCook('<html></html>', RETRIEVED)).toThrow(/^cook: /)
  })
})

describe('readLa', () => {
  const file = readLa(JSON.parse(fixture('la-results.json')), RETRIEVED)

  it('reads the file metadata', () => {
    expect(file.source).toBe('la')
    expect(file.url).toBe(OFFICIAL_URLS.la)
    expect(file.asOf).toBe('2026-11-04T11:11:55.000Z')
  })

  it('reads the Wiley retention contest as county-only', () => {
    const c = file.contests.find((x) => x.title.endsWith('JOHN WILEY'))
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 1070142 },
      { name: 'NO', votes: 475603 },
    ])
    expect(c?.countyOnly).toBe(true)
    expect(c?.voteFor).toBeUndefined()
  })

  it('reads a measure with its pass rate', () => {
    const c = file.contests.find((x) => x.title.endsWith('MEASURE DB'))
    expect(c?.passRate).toBe('Majority of votes cast')
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 12496 },
      { name: 'NO', votes: 2772 },
    ])
    expect(c?.countyOnly).toBe(false)
  })

  it('throws on a file without contests', () => {
    expect(() => readLa({}, RETRIEVED)).toThrow(/^la: /)
  })
})

describe('readCaSos', () => {
  const read = (name: string, path: string) =>
    readCaSos(JSON.parse(fixture(name)), path, RETRIEVED)

  it('reads a candidate file as one contest', () => {
    const file = read('ca-sos-us-rep-23.json', 'us-rep/district/23')
    expect(file.source).toBe('ca-sos')
    expect(file.url).toBe(CA_SOS_BASE + 'us-rep/district/23')
    expect(file.retrievedAt).toBe(RETRIEVED)
    expect(file.asOf).toBe('2026-11-04T16:08:00.000Z')
    expect(file.contests).toHaveLength(1)
    expect(file.contests[0].title).toBe('us-rep/district/23')
    expect(file.contests[0].choices).toEqual([
      { name: 'Tessa Lynn Hodge', votes: 63681 },
      { name: 'Jay Obernolte', votes: 67169 },
    ])
  })

  it('reads ballot measures keyed by number', () => {
    const file = read('ca-sos-ballot-measures.json', 'ballot-measures')
    const c = file.contests.find((x) => x.title === 'ballot-measures#01')
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 4506588 },
      { name: 'NO', votes: 3084042 },
    ])
    expect(file.contests).toHaveLength(2)
  })

  it('reads Supreme Court retention keyed by justice', () => {
    const file = read('ca-sos-supreme-court.json', 'supreme-court')
    const c = file.contests.find(
      (x) => x.title === 'supreme-court#Kelli M. Evans',
    )
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 4380187 },
      { name: 'NO', votes: 1752274 },
    ])
  })

  it('reads one contest per appellate justice', () => {
    const file = read(
      'ca-sos-courts-of-appeal-2.json',
      'courts-of-appeal/district/2',
    )
    expect(file.contests.map((c) => c.title)).toEqual([
      'courts-of-appeal/district/2#Michelle C. Kim',
      'courts-of-appeal/district/2#Gregory J. Weingart',
    ])
    expect(file.contests[0].choices[0]).toEqual({
      name: 'YES',
      votes: 1384767,
    })
  })

  it('converts Pacific a.m. and p.m. times, including 12 o’clock', () => {
    const at = (time: string) =>
      readCaSos(
        {
          ...JSON.parse(fixture('ca-sos-us-rep-23.json')),
          ReportingTime: time,
        },
        'us-rep/district/23',
        RETRIEVED,
      ).asOf
    expect(at('November 4, 2026, 4:30 p.m.')).toBe('2026-11-05T00:30:00.000Z')
    expect(at('November 4, 2026, 12:05 a.m.')).toBe('2026-11-04T08:05:00.000Z')
    expect(at('November 4, 2026, 12:05 p.m.')).toBe('2026-11-04T20:05:00.000Z')
    expect(at('November 4, 2026, 3 p.m.')).toBe('2026-11-04T23:00:00.000Z')
  })

  it('throws on an unparseable time, a missing array and bad votes', () => {
    const base = JSON.parse(fixture('ca-sos-us-rep-23.json'))
    const go = (json: unknown) => () =>
      readCaSos(json, 'us-rep/district/23', RETRIEVED)
    expect(go({ ...base, ReportingTime: 'yesterday' })).toThrow(/^ca-sos: /)
    expect(go({ ...base, candidates: undefined })).toThrow(/^ca-sos: /)
    expect(go({ ...base, candidates: [] })).toThrow(/^ca-sos: /)
    expect(go({ ...base, candidates: [{ Name: 'A', Votes: 'n/a' }] })).toThrow(
      /^ca-sos: /,
    )
    expect(() =>
      readCaSos(
        { ReportingTime: base.ReportingTime, 'supreme-court': 5 },
        'supreme-court',
        RETRIEVED,
      ),
    ).toThrow(/^ca-sos: /)
  })
})

describe('caSosPaths', () => {
  it('returns distinct sorted API paths for ca-sos entries only', () => {
    const match = {
      contests: [
        {
          official: [
            { source: 'la', title: 'x#1' },
            { source: 'ca-sos', title: 'us-rep/district/23' },
            { source: 'ca-sos', title: 'supreme-court#Kelli M. Evans' },
          ],
        },
        {
          official: [
            { source: 'ca-sos', title: 'supreme-court#Joshua Groban' },
            { source: 'ca-sos', title: 'us-rep/district/23' },
            { source: 'ca-sos', title: 'courts-of-appeal/district/2#A' },
          ],
        },
      ],
    }
    expect(caSosPaths(match)).toEqual([
      'courts-of-appeal/district/2',
      'supreme-court',
      'us-rep/district/23',
    ])
  })
})
