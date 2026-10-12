import { describe, expect, it } from 'vitest'
import { readableCase, readableName } from './text.ts'

describe('readableCase', () => {
  it('turns an all-caps heading into title case', () => {
    expect(
      readableCase('ADVISORY QUESTION REGARDING CHICAGO LAND OWNERS'),
    ).toBe('Advisory Question Regarding Chicago Land Owners')
  })

  it('changes only the all-caps part of a mixed heading', () => {
    expect(
      readableCase('Trustee, SOUTH PALOS TOWNSHIP SANITARY DISTRICT'),
    ).toBe('Trustee, South Palos Township Sanitary District')
  })

  it('keeps minor words lowercase except at the start', () => {
    expect(
      readableCase('THE ELECTION OF A BOARD FOR THE CITY OF CHICAGO'),
    ).toBe('The Election of a Board for the City of Chicago')
    expect(readableCase('Trustee: OF THE PARK DISTRICT')).toBe(
      'Trustee: Of the Park District',
    )
  })

  it('keeps acronyms, numbers and ordinals readable', () => {
    expect(readableCase('CPS DISTRICT 299 AND MWRD UNDER 10 ILCS 5/28-6')).toBe(
      'CPS District 299 and MWRD Under 10 ILCS 5/28-6',
    )
    expect(
      readableCase('U.S. REPRESENTATIVE, 7TH CONGRESSIONAL DISTRICT'),
    ).toBe('U.S. Representative, 7th Congressional District')
  })

  it('capitalizes each part of hyphenated words and keeps punctuation', () => {
    expect(readableCase('NON-BINDING QUESTION (OWNERS’ TAX)')).toBe(
      'Non-Binding Question (Owners’ Tax)',
    )
  })

  it('leaves mixed-case text and lone acronyms alone', () => {
    expect(readableCase('Board of Education, Subdistrict 4A')).toBe(
      'Board of Education, Subdistrict 4A',
    )
    expect(readableCase('Chicago Public Schools (CPS) District 299')).toBe(
      'Chicago Public Schools (CPS) District 299',
    )
    expect(readableCase('Commissioner, MWRD')).toBe('Commissioner, MWRD')
  })
})

describe('readableCase on campaign committee and donor names', () => {
  // Real names from FEC and ISBE filings (data/build/profiles/money.json).
  it.each([
    ['JULIANA FOR ILLINOIS', 'Juliana for Illinois'],
    ['DON TRACY FOR ILLINOIS, NFP', 'Don Tracy for Illinois, NFP'],
    ['FRIENDS OF WHITFIELD HARRINGTON', 'Friends of Whitfield Harrington'],
    ['CME GROUP INC. PAC', 'CME Group Inc. PAC'],
    [
      'ALPHA KAPPA ALPHA SORORITY PAC, INC.',
      'Alpha Kappa Alpha Sorority PAC, Inc.',
    ],
    ['ALLH LLC', 'Allh LLC'],
    ["AMERICA'S CREDIT UNIONS PAC", "America's Credit Unions PAC"],
    [
      "INT'L UNION OF BRICKLAYERS AND ALLIED CRAFTWORKERS",
      "Int'l Union of Bricklayers and Allied Craftworkers",
    ],
    [
      'AMERICAN FEDERATION OF TEACHERS, AFL-CIO COMMITTEE ON POLITICAL EDUCATION',
      'American Federation of Teachers, AFL-CIO Committee on Political Education',
    ],
    ['AFSCME IL COUNCIL, #31 PAC', 'AFSCME IL Council, #31 PAC'],
    [
      'AMERIPAC: THE FUND FOR A GREATER AMERICA',
      'AmeriPAC: The Fund for a Greater America',
    ],
    ['FAMILY-PAC FEDERAL', 'Family-PAC Federal'],
    ['UNITED WITH DELIA FOR CONGRESS', 'United with Delia for Congress'],
    ['LA SHAWN K FORD FOR CONGRESS', 'La Shawn K Ford for Congress'],
    [
      'INTERNATIONAL UNION OF OPERATING ENGINEERS LOCAL 150 POLITICAL ACTION COMMITTEE',
      'International Union of Operating Engineers Local 150 Political Action Committee',
    ],
  ])('%s', (filed, readable) => {
    expect(readableCase(filed)).toBe(readable)
  })

  it('handles suffixes, ordinals and Mc names', () => {
    expect(readableCase('FRIENDS OF JOHN DOE JR.')).toBe(
      'Friends of John Doe Jr.',
    )
    expect(readableCase('CITIZENS FOR JOHN DOE III')).toBe(
      'Citizens for John Doe III',
    )
    expect(readableCase('19TH WARD REGULAR DEMOCRATIC ORGANIZATION')).toBe(
      '19th Ward Regular Democratic Organization',
    )
    expect(readableCase('FRIENDS OF SUSAN MCLEAN')).toBe(
      'Friends of Susan McLean',
    )
    expect(readableCase("FRIENDS OF PAT O'MALLEY")).toBe(
      "Friends of Pat O'Malley",
    )
  })
})

describe('readableName', () => {
  it('fixes names filed in all caps and drops extra spaces', () => {
    expect(readableName('JULIANA FOR ILLINOIS')).toBe('Juliana for Illinois')
    expect(readableName('ACTION  PAC')).toBe('Action PAC')
  })

  it('keeps names filed in mixed case as filed', () => {
    expect(readableName('Illinois CRNA PAC')).toBe('Illinois CRNA PAC')
    expect(readableName('SEIU Healthcare IL IN PAC')).toBe(
      'SEIU Healthcare IL IN PAC',
    )
  })

  it('leaves a lone acronym alone', () => {
    expect(readableName('IPACE')).toBe('IPACE')
  })
})
