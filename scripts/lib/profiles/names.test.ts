import { describe, expect, it } from 'vitest'
import {
  fullNameMatches,
  givenNamesAgree,
  namesMatch,
  oneEditApart,
  parseBallotName,
  splitCommaName,
} from './names.ts'

const matches = (ballot: string, official: string) => {
  const { last, first } = splitCommaName(official)
  return namesMatch(parseBallotName(ballot), last, first)
}

describe('parseBallotName', () => {
  it('keeps quoted nicknames as given names and drops suffixes', () => {
    expect(parseBallotName('Elizabeth "Liz" Doody Gorman')).toEqual({
      words: ['elizabeth', 'doody', 'gorman'],
      given: ['elizabeth', 'liz'],
    })
    expect(parseBallotName('Michael Scott, Jr.').words).toEqual([
      'michael',
      'scott',
    ])
  })

  it('uses the first person of a joint ticket', () => {
    expect(parseBallotName('JB Pritzker & Christian Mitchell').words).toEqual([
      'jb',
      'pritzker',
    ])
  })
})

describe('givenNamesAgree', () => {
  it('accepts prefixes of three letters or more and known nicknames', () => {
    expect(givenNamesAgree('pat', 'patrick')).toBe(true)
    expect(givenNamesAgree('bill', 'william')).toBe(true)
    expect(givenNamesAgree('ed', 'edward')).toBe(true)
    expect(givenNamesAgree('al', 'alan')).toBe(false)
    expect(givenNamesAgree('john', 'joan')).toBe(false)
  })
})

describe('oneEditApart', () => {
  it('allows one changed, added or removed letter', () => {
    expect(oneEditApart('villivalam', 'villivalim')).toBe(true)
    expect(oneEditApart('gabel', 'gable')).toBe(false)
    expect(oneEditApart('morita', 'moritas')).toBe(true)
  })
})

describe('namesMatch', () => {
  it('matches FEC-style names with titles, initials and nicknames', () => {
    expect(matches('Bill Foster', 'FOSTER, G. WILLIAM (BILL)')).toBe(true)
    expect(matches('Brad Schneider', 'SCHNEIDER, BRADLEY S.')).toBe(true)
    expect(matches('La Shawn K. Ford', 'FORD, LA SHAWN K')).toBe(true)
    expect(
      matches('Whitfield Harrington Jr', 'HARRINGTON, WHITFIELD MR JR'),
    ).toBe(true)
  })

  it('matches multi-word and accented last names', () => {
    expect(
      namesMatch(
        parseBallotName('Eira Lizeth Corral Sepúlveda'),
        'Sepulveda',
        'Eira L Corral',
      ),
    ).toBe(true)
    expect(
      namesMatch(
        parseBallotName('Juan Ponce de Leon'),
        'Ponce de Leon',
        'Juan',
      ),
    ).toBe(true)
  })

  it('matches a ballot nickname with the filed first name', () => {
    expect(
      namesMatch(parseBallotName('Deborah "Debby" Pope'), 'Pope', 'Debby'),
    ).toBe(true)
    expect(namesMatch(parseBallotName('Pat Hynes'), 'Hynes', 'Patrick J')).toBe(
      true,
    )
  })

  it('allows a typo in the filed last name only when asked', () => {
    const ram = parseBallotName('Ram Villivalam')
    expect(namesMatch(ram, 'Villivalim', 'Ram')).toBe(false)
    expect(namesMatch(ram, 'Villivalim', 'Ram', { typoInLastName: true })).toBe(
      true,
    )
  })

  it('rejects a different person with the same last name', () => {
    expect(matches('Ann M. Williams', 'WILLIAMS, JAWAHARIAL')).toBe(false)
    expect(matches('Jennifer Davis', 'DAVIS, LISA')).toBe(false)
    // Last name must match in full, not just its final word.
    expect(
      namesMatch(parseBallotName('Maria Leon'), 'Ponce de Leon', 'Maria'),
    ).toBe(false)
  })
})

describe('fullNameMatches (rosters in First Middle Last order)', () => {
  it('matches the same person across spellings', () => {
    expect(fullNameMatches('Aaron M. Ortiz', 'Aarón M. Ortíz')).toBe(true)
    expect(fullNameMatches('Edgar Gonzalez, Jr.', 'Edgar González, Jr.')).toBe(
      true,
    )
    expect(fullNameMatches('Curtis J. Tarver II', 'Curtis J. Tarver, II')).toBe(
      true,
    )
    expect(
      fullNameMatches('Kimberly Neely DuBuclet', 'Kimberly Du Buclet'),
    ).toBe(true)
    expect(
      fullNameMatches('Suzanne "Suzy" Glowiak Hilton', 'Suzy Glowiak Hilton'),
    ).toBe(true)
    expect(
      fullNameMatches('Angie Guerrero-Cuellar', 'Angelica Guerrero-Cuellar'),
    ).toBe(true)
    expect(
      fullNameMatches('Jawaharial "Omar" Williams', 'Jawaharial Williams'),
    ).toBe(true)
    expect(
      fullNameMatches('JB Pritzker & Christian Mitchell', 'JB Pritzker'),
    ).toBe(true)
  })

  it('does not match different people', () => {
    expect(fullNameMatches('Ann M. Williams', 'Jawaharial Williams')).toBe(
      false,
    )
    expect(fullNameMatches('Paul Kendrick', 'Margaret Croke')).toBe(false)
    expect(fullNameMatches('Lisa J. Davis', 'William "Will" Davis')).toBe(false)
  })
})
