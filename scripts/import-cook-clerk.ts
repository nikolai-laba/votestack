// Imports contests, candidates, retention judges and referenda for the
// Nov 3, 2026 general election from the Cook County Clerk (suburban Cook).
// Writes data/build/contests/cook-clerk.json and reports anything it can't
// place in a district, so gaps are visible instead of silently dropped.
// Run: node scripts/import-cook-clerk.ts

import { join } from 'node:path'
import type { Contest, OcdId, SourceRef } from '../src/shared/ballot.ts'
import * as ocd from '../src/shared/ocd.ts'
import { readableCase } from '../src/shared/text.ts'
import { BUILD, getJson, RAW, writeJson } from './lib/data.ts'
import { ELECTION_CODE, ELECTION_ID } from './lib/election.ts'
import { loadBoundary } from './lib/layers.ts'

const API = 'https://www.cookcountyclerkil.gov/api/Candidate'

interface ClerkRace {
  Name: string
  Office: string
  Vote: number
  RaceNumber: string
  Vacancy: string
  Retention: boolean
  item: { Name: string; Pty: string; Num: string }[]
}

interface ClerkReferendum {
  TaxCode: string
  SortOrder_Ballot: number
  LongTitle: string
  ReferendumText: string
}

const candidatesUrl = `${API}/GetAllCandidates?language=en&electionCode=${ELECTION_CODE}&partyCode=`

// The Clerk's API gives party codes; use the names as printed on the ballot,
// matching the Chicago Board's list. Unknown codes are kept as they are.
const PARTIES: Record<string, string> = {
  DEM: 'Democratic',
  REP: 'Republican',
  LIB: 'Libertarian',
  IND: 'Independent',
  ACP: 'American Center Party',
  WCP: 'Working Class Party',
}
const referendaUrl = `${API}/GetAllReferenda?electionCode=${ELECTION_CODE}&language=en`
const races = (await getJson<{ Candidates: ClerkRace[] }>(candidatesUrl))
  .Candidates
const referenda = (
  await getJson<{ BallotReferendums: ClerkReferendum[] }>(referendaUrl)
).BallotReferendums
await writeJson(join(RAW, 'cook-clerk', 'candidates.json'), races)
await writeJson(join(RAW, 'cook-clerk', 'referenda.json'), referenda)

const retrievedAt = new Date().toISOString()
const today = retrievedAt.slice(0, 10)
const source = (url: string): SourceRef => ({
  name: 'Cook County Clerk',
  url,
  retrievedAt,
  official: true,
})

// Sanitary districts by name → tax code, from County GIS (the Clerk's race
// names match the GIS names apart from case).
const sanitaryCodes = new Map(
  (await loadBoundary('tax-sanitary')).features.map((f) => [
    String(f.properties.MAX_AGENCY_DESC).trim().toUpperCase(),
    ocd.taxCode(Number(f.properties.AGENCY)),
  ]),
)

const ordinal = (text: string) =>
  Number(text.match(/(\d+)(?:st|nd|rd|th)/)?.[1])

/** The district whose voters see a race, from the Clerk's race name. */
function districtFor(race: ClerkRace): OcdId | null {
  const name = race.Name.trim()
  if (name === 'U.S.' || name === 'State of Illinois') return ocd.ILLINOIS
  if (/Congressional District/.test(name))
    return ocd.congressionalDistrict(ordinal(name))
  if (/Senate District/.test(name))
    return ocd.stateSenateDistrict(ordinal(name))
  if (/Representative District/.test(name))
    return ocd.stateHouseDistrict(ordinal(name))
  if (name === 'Metropolitan Water Reclamation District') return ocd.MWRD
  if (name === 'Cook County' || name === 'Cook County Judicial Circuit')
    return ocd.COOK_COUNTY
  if (/County Board District/.test(name))
    return ocd.countyBoardDistrict(ordinal(name))
  if (/^Board of Review/.test(name))
    return ocd.boardOfReviewDistrict(ordinal(name))
  if (/Appellate Court, 1st District/.test(name))
    return ocd.appellateDistrict(1)
  if (/Cook County Subcircuit/.test(name))
    return ocd.judicialSubcircuit(ordinal(name))
  const roe = name.match(/^(\w+) County Regional Office of Education$/)
  if (roe) return ocd.regionalOfficeOfEducation(roe[1])
  const sanitary = sanitaryCodes.get(name.toUpperCase())
  if (sanitary) return ocd.cookTaxDistrict(sanitary)
  return null
}

/**
 * The district voting on a referendum. Tax codes name the taxing district:
 * 02 = township, 03 = municipality (both matched by name), and school, park,
 * library and fire districts by code (County GIS uses the same numbers).
 */
function referendumDistrict(ref: ClerkReferendum): OcdId | null {
  if (ref.TaxCode === '03-CCTY-000') return ocd.COOK_COUNTY
  const body = ref.LongTitle.split(',')[0].trim()
  if (ref.TaxCode.startsWith('03-')) return ocd.municipality(body)
  if (ref.TaxCode.startsWith('02-'))
    return ocd.cookTownship(body.replace(/ Township$/i, ''))
  if (/^0[4-7]-\d{4}-\d{3}$/.test(ref.TaxCode))
    return ocd.cookTaxDistrict(ref.TaxCode)
  return null
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
/**
 * The Clerk's API wraps names that contain a comma or quotes in single quotes
 * and doubles the inner ones: 'Robert ''Bob'' Rita' is Robert "Bob" Rita.
 */
const cleanName = (name: string) => {
  const trimmed = name.trim()
  const quoted = trimmed.match(/^'(.*)'$/)
  return quoted ? quoted[1].replace(/''/g, '"') : trimmed
}
/** The Clerk's stand-in name for a race with no candidates. */
const isPlaceholder = (name: string) =>
  cleanName(name).toLowerCase() === 'no candidate'
const cleanVacancy = (v: string) =>
  v
    .replace(/^'|'$/g, '')
    .replace(/^\(|\)$/g, '')
    .trim()

const contests: Contest[] = []
const unmapped: string[] = []

for (const race of races) {
  const districtId = districtFor(race)
  // Some race names are in all caps (sanitary districts); IDs still come from the raw text.
  const office = readableCase(race.Office.trim())
  const name = readableCase(race.Name.trim())
  const title = `${office}, ${name}`
  if (!districtId) {
    unmapped.push(`${race.RaceNumber} ${title}`)
    continue
  }
  const base = {
    electionId: ELECTION_ID,
    districtId,
    authorityId: ocd.COOK_COUNTY,
    ballotOrder: Number(race.RaceNumber),
    sources: [source(candidatesUrl)],
    lastVerified: today,
  }
  if (race.Retention) {
    // The Clerk lists all retention judges of a court as one race; voters see one yes/no question per judge.
    for (const judge of race.item) {
      contests.push({
        ...base,
        id: `cook-clerk:${race.RaceNumber}:${slug(judge.Name)}`,
        kind: 'retention',
        title: `Retention: ${title}`,
        office: title,
        judge: cleanName(judge.Name),
      })
    }
    continue
  }
  const rawVacancy = cleanVacancy(race.Vacancy)
  const vacancy = readableCase(rawVacancy)
  contests.push({
    ...base,
    // RaceNumber isn't unique (e.g. two 19th Subcircuit vacancies share one), so include the vacancy.
    id: `cook-clerk:${race.RaceNumber}${rawVacancy ? `:${slug(rawVacancy)}` : ''}`,
    kind: 'candidate',
    title: vacancy ? `${title} (${vacancy})` : title,
    office,
    voteFor: race.Vote,
    vacancy: vacancy || undefined,
    // "No Candidate" is the Clerk's placeholder for a race nobody filed
    // for; the ballot then says no candidates filed instead of a name.
    candidates: race.item
      .filter((c) => !isPlaceholder(c.Name))
      .map((c) => ({
        name: cleanName(c.Name),
        party: PARTIES[c.Pty] ?? (c.Pty || undefined),
        ballotOrder: Number(c.Num) || undefined,
      })),
  })
}

for (const ref of referenda) {
  const districtId = referendumDistrict(ref)
  if (!districtId) {
    unmapped.push(`referendum ${ref.TaxCode} ${ref.LongTitle}`)
    continue
  }
  contests.push({
    id: `cook-clerk:ref:${ref.TaxCode}:${slug(ref.LongTitle)}`,
    electionId: ELECTION_ID,
    districtId,
    authorityId: ocd.COOK_COUNTY,
    kind: 'measure',
    title: readableCase(ref.LongTitle),
    // The official ballot text, word for word.
    question: ref.ReferendumText,
    ballotOrder: ref.SortOrder_Ballot,
    sources: [source(referendaUrl)],
    lastVerified: today,
  })
}

await writeJson(join(BUILD, 'contests', 'cook-clerk.json'), {
  retrievedAt,
  contests,
  unmapped,
})
console.log(
  `${contests.length} contests from ${races.length} races and ${referenda.length} referenda`,
)
console.log(`${unmapped.length} not yet placed in a district:`)
for (const line of unmapped) console.log(`  ${line}`)
