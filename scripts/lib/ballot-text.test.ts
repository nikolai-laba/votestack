import { describe, expect, it } from 'vitest'
import {
  appears,
  findMarker,
  ballotText,
  MATCH,
  normalize,
  QuestionMatcher,
  UNSURE,
} from './ballot-text.ts'

const SD128 =
  'Shall the limiting rate under the Property Tax Extension Limitation Law for Palos Heights School District Number 128, Cook County, Illinois, be increased by an additional amount equal to 0.590000% above the limiting rate for levy year 2024? (1) The approximate amount of taxes extendable at the most recently extended limiting rate is $10,018,587.'
const HOMETOWN =
  'Shall the limiting rate under the Property Tax Extension Limitation Law for the Hometown Fire Protection District, Cook County, Illinois, be increased by an additional amount equal to 0.25% above the limiting rate for levy year 2025? (1) The approximate amount of taxes extendable at the most recently extended limiting rate is $1,204,331.'
const ALSIP =
  'Shall the Village of Alsip modify its current term limits so that no person shall be eligible to seek election to, or hold the office of Village President (Mayor), Village Clerk, or Village Trustee if that person has already served four consecutive four-year terms in that specific office?'
const CRESTWOOD =
  'Shall the Village of Crestwood modify its current term limits so that no person shall be eligible to seek election to, or hold the office of Village President, Village Clerk, or Village Trustee if that person has already served four consecutive four-year terms?'

// pdftotext's default mode on a two-column ballot: the two questions' lines
// mostly alternate, one column's line breaks hyphenate words, and a Spanish block
// sits between the halves of a question.
const INTERLEAVED = `"Shall the limiting rate under the Property Tax
"Shall the Village of Alsip modify its current
Extension Limitation Law for Palos Heights
School District Number 128, Cook County,
term limits so that no person shall be eligible to
seek election to, or hold the office of Village
Illinois, be increased by an additional amount
President (Mayor), Village Clerk, or Village
“¿Debe el pueblo de Alsip modificar sus límites
de mandato actuales para que ninguna persona
pueda postularse a la elección para presidente?”
equal to 0.590000% above the limiting rate for
Trustee if that person has already served four
levy year 2024? (1) The approximate amount of
consecutive four-year terms in that specific of-
taxes extendable at the most recently extended
fice?"
limiting rate is $10,018,587.
Yes / Sí
No / No`

// pdftotext -layout on the same ballot: columns side by side, sometimes with
// a single space between them.
const LAYOUT = `"Shall the limiting rate under the Property Tax   "Shall the Village of Alsip modify its current
Extension Limitation Law for Palos Heights        term limits so that no person shall be eligible to
School District Number 128, Cook County, seek election to, or hold the office of Village
Illinois, be increased by an additional amount    President (Mayor), Village Clerk, or Village
equal to 0.590000% above the limiting rate for    Trustee if that person has already served four
levy year 2024? (1) The approximate amount of     consecutive four-year terms in that specific of-
taxes extendable at the most recently extended    fice?"
limiting rate is $10,018,587.`

describe('normalize', () => {
  it('keeps amounts and rates whole', () => {
    expect(normalize('$10,018,587 and 0.590000%')).toBe('10018587 and 0590000')
  })
  it('undoes hyphenation at line breaks but keeps hyphenated names apart', () => {
    expect(normalize('specific of-\nfice')).toBe('specific office')
    expect(normalize('María Smith-\nJones')).toBe('maria smith jones')
  })
})

describe('appears', () => {
  const words = normalize(
    'Caroline Kate Retention in Office Moreland Yes No',
  ).split(' ')
  it('finds a name broken by other text within the gap', () => {
    expect(appears(words, 'caroline kate moreland', 6)).toBe(true)
    expect(appears(words, 'caroline kate moreland', 2)).toBe(false)
  })

  it('says where the marker starts, from a given word on', () => {
    const twice = [...words, ...words]
    expect(findMarker(twice, 'kate retention', 1)).toBe(1)
    expect(findMarker(twice, 'kate retention', 1, 2)).toBe(9)
    expect(findMarker(twice, 'kate yes', 1)).toBe(-1)
  })
})

describe('QuestionMatcher', () => {
  const matcher = new QuestionMatcher([SD128, HOMETOWN, ALSIP, CRESTWOOD])

  it('finds questions whose columns are interleaved', () => {
    const ballot = ballotText([INTERLEAVED])
    expect(matcher.score(SD128, ballot)).toBeGreaterThanOrEqual(MATCH)
    expect(matcher.score(ALSIP, ballot)).toBeGreaterThanOrEqual(MATCH)
  })

  it('finds questions in side-by-side columns', () => {
    const ballot = ballotText([LAYOUT])
    expect(matcher.score(SD128, ballot)).toBeGreaterThanOrEqual(MATCH)
    expect(matcher.score(ALSIP, ballot)).toBeGreaterThanOrEqual(MATCH)
  })

  it('combines readings: a pair broken in one may be whole in the other', () => {
    // "Palos Heights School" is broken by the next column in -layout only.
    const layout = matcher.score(SD128, ballotText([LAYOUT]))
    expect(layout).toBeLessThan(1)
    expect(matcher.score(SD128, ballotText([LAYOUT, INTERLEAVED]))).toBe(1)
  })

  it("doesn't match a question that only shares boilerplate", () => {
    const ballot = ballotText([INTERLEAVED, LAYOUT])
    // Same PTELL wording as SD 128, different district and amounts.
    expect(matcher.score(HOMETOWN, ballot)).toBeLessThanOrEqual(UNSURE)
    // Same term-limits wording as Alsip, different village.
    expect(matcher.score(CRESTWOOD, ballot)).toBeLessThanOrEqual(UNSURE)
  })

  it('rejects unknown questions', () => {
    expect(() => matcher.score('Shall we?', ballotText(['']))).toThrow()
  })
})
