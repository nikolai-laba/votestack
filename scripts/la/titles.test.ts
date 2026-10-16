// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  measureText,
  propositionTitle,
  stateMeasure,
  titleCase,
  voterGuideUrl,
} from './titles.ts'

describe('titleCase', () => {
  it('keeps a measure’s letters as the Registrar prints them', () => {
    expect(titleCase('COUNTY MEASURE A')).toBe('County Measure A')
    expect(
      titleCase('CITY OF INGLEWOOD GENERAL MUNICIPAL ELECTION - MEASURE AT'),
    ).toBe('City of Inglewood General Municipal Election - Measure AT')
    expect(
      titleCase('CITY OF ROSEMEAD SPECIAL MUNICIPAL ELECTION - MEASURE RC'),
    ).toBe('City of Rosemead Special Municipal Election - Measure RC')
    expect(titleCase('COUNTY MEASURE E')).toBe('County Measure E')
  })

  it('still reads offices', () => {
    expect(titleCase('SHERIFF')).toBe('Sheriff')
  })
})

// The Secretary of State's titles for the November 3, 2026 propositions
// (sos.ca.gov, qualified ballot measures), and the Registrar's bold headings.
const PROPOSITIONS: [string, string, string][] = [
  [
    '1',
    'AUTHORIZES BONDS FOR HOUSING AFFORDABILITY PROGRAMS. LEGISLATIVE STATUTE.',
    'Authorizes Bonds for Housing Affordability Programs',
  ],
  [
    '2',
    "INCREASES STATE'S RAINY DAY FUND. LEGISLATIVE CONSTITUTIONAL AMENDMENT.",
    "Increases State's Rainy Day Fund",
  ],
  [
    '3',
    'PROVIDES PERMANENT FUNDING FOR SCHOOLS AND HEALTH CARE BY EXTENDING EXISTING TAX ON HIGH INCOMES. INITIATIVE CONSTITUTIONAL AMENDMENT.',
    'Provides Permanent Funding for Schools and Health Care by Extending Existing Tax on High Incomes',
  ],
  [
    '4',
    'REPEALS PROHIBITION AGAINST PUBLIC FUNDING OF ELECTION CAMPAIGNS. LEGISLATIVE STATUTE.',
    'Repeals Prohibition Against Public Funding of Election Campaigns',
  ],
  [
    '5',
    'CHANGES RECALL ELECTION PROCESS FOR STATEWIDE OFFICERS. LEGISLATIVE CONSTITUTIONAL AMENDMENT.',
    'Changes Recall Election Process for Statewide Officers',
  ],
  [
    '37',
    'CREATES LOAN PROGRAM FOR MIDDLE-INCOME BUYERS OF QUALIFIED NEW HOMES. INITIATIVE STATUTE.',
    'Creates Loan Program for Middle-Income Buyers of Qualified New Homes',
  ],
  [
    '38',
    'AUTHORIZES BONDS FOR IMMUNOLOGY MEDICAL RESEARCH. INITIATIVE STATUTE.',
    'Authorizes Bonds for Immunology Medical Research',
  ],
  [
    '39',
    'PROHIBITS CITIZENS FROM VOTING UNLESS THEY PRESENT GOVERNMENT-ISSUED IDENTIFICATION. INITIATIVE CONSTITUTIONAL AMENDMENT.',
    'Prohibits Citizens from Voting Unless They Present Government-Issued Identification',
  ],
  [
    '40',
    'IMPOSES ONE-TIME TAX ON CERTAIN TAXPAYERS. INITIATIVE CONSTITUTIONAL AMENDMENT AND STATUTE.',
    'Imposes One-Time Tax on Certain Taxpayers',
  ],
  [
    '41',
    'PROHIBITS NEW STATE TAXES THAT EXCLUDE REVENUES FROM STATE SPENDING LIMIT. REQUIRES AUDITS FOR NEW STATE SPECIAL TAXES. INITIATIVE CONSTITUTIONAL AMENDMENT.',
    'Prohibits New State Taxes That Exclude Revenues from State Spending Limit. Requires Audits for New State Special Taxes',
  ],
  [
    '42',
    'PROHIBITS NEW STATE PERSONAL PROPERTY TAXES AND CERTAIN RETROACTIVE STATE TAXES. INITIATIVE CONSTITUTIONAL AMENDMENT.',
    'Prohibits New State Personal Property Taxes and Certain Retroactive State Taxes',
  ],
  [
    '43',
    "LIMITS VOTERS' ABILITY TO RAISE REVENUES FOR LOCAL GOVERNMENT SERVICES. LEGISLATIVE CONSTITUTIONAL AMENDMENT.",
    "Limits Voters' Ability to Raise Revenues for Local Government Services",
  ],
  [
    '44',
    'REQUIRES COMMUNITY HEALTH CLINICS SPEND 90% OF REVENUE ON PROGRAM SERVICES. INITIATIVE STATUTE.',
    'Requires Community Health Clinics Spend 90% Of Revenue on Program Services',
  ],
  [
    '45',
    'MODIFIES ENVIRONMENTAL REVIEW FOR CERTAIN PROJECTS. INITIATIVE STATUTE.',
    'Modifies Environmental Review for Certain Projects',
  ],
]

describe('stateMeasure', () => {
  it.each(PROPOSITIONS)(
    'titles Proposition %s as the Secretary of State does',
    (number, heading, title) => {
      const m = stateMeasure(
        `STATE MEASURE ${number}`,
        `<b>${heading}</b> Authorizes things. <b>Fiscal Impact:</b> Costs.`,
      )
      expect(m).toEqual({ number, title })
      expect(propositionTitle(m!)).toBe(`Proposition ${number}: ${title}`)
    },
  )

  it('leaves county and local measures alone', () => {
    expect(
      stateMeasure('COUNTY MEASURE A', '<b>LOS ANGELES COUNTY CHARTER</b>'),
    ).toBeUndefined()
  })

  it('links the voter guide page', () => {
    expect(voterGuideUrl('37')).toBe(
      'https://voterguide.sos.ca.gov/propositions/37/',
    )
  })
})

describe('measureText', () => {
  it('starts the fiscal impact, supporters and opponents on new lines', () => {
    expect(
      measureText(
        '<b>AUTHORIZES BONDS. LEGISLATIVE STATUTE.</b> Authorizes   bonds. <b>Fiscal Impact:</b> Costs money. <b>Supporters:</b> A; B <b>Opponents:</b> None submitted.',
      ),
    ).toBe(
      'AUTHORIZES BONDS. LEGISLATIVE STATUTE. Authorizes bonds.\nFiscal Impact: Costs money.\nSupporters: A; B\nOpponents: None submitted.',
    )
  })

  it('keeps other bold text in line', () => {
    expect(
      measureText('Shall <b>Measure YV.</b> pass? <b>Opponents</b> X'),
    ).toBe('Shall Measure YV. pass?\nOpponents X')
  })
})

it('reads every proposition in the built data, when it is there', async () => {
  const file = 'data/build/la/contests.json'
  let built: { contests: { id: string; title: string }[] }
  try {
    built = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return
  }
  const titles = new Set(built.contests.map((c) => c.title))
  for (const [number, , title] of PROPOSITIONS)
    if (built.contests.some((c) => c.title.startsWith('Proposition ')))
      expect(titles).toContain(`Proposition ${number}: ${title}`)
})
