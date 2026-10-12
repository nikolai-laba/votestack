// Imports contests, candidates, retention judges and referenda for the
// Nov 3, 2026 general election from the Chicago Board of Election
// Commissioners' candidate list (a PDF in ballot order). Needs `pdftotext`
// (poppler: `brew install poppler`). Writes data/build/contests/chicago-boe.json
// and reports anything it can't place in a district.
// Run: node scripts/import-chicago-boe.ts

import { execFileSync } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Candidate,
  Contest,
  OcdId,
  SourceRef,
} from '../src/shared/ballot.ts'
import * as ocd from '../src/shared/ocd.ts'
import { readableCase } from '../src/shared/text.ts'
import { referendumAreaDistrict } from './chicago-referendum-areas.ts'
import { BUILD, RAW, writeJson } from './lib/data.ts'
import { ELECTION_ID } from './lib/election.ts'

// Linked from https://www.chicagoelections.gov/getting-ballot/candidates.
// The file name changes when the Board updates the list; check that page.
const PDF_URL =
  'https://cboeprod.blob.core.usgovcloudapi.net/prod/2026-09/Candidate%20List_20260911-1.pdf'

const res = await fetch(PDF_URL)
if (!res.ok) throw new Error(`${res.status} for ${PDF_URL}`)
const dir = join(RAW, 'chicago')
await mkdir(dir, { recursive: true })
await writeFile(
  join(dir, 'candidates.pdf'),
  Buffer.from(await res.arrayBuffer()),
)
execFileSync('pdftotext', [
  '-layout',
  join(dir, 'candidates.pdf'),
  join(dir, 'candidates.txt'),
])
const text = execFileSync('cat', [join(dir, 'candidates.txt')], {
  encoding: 'utf8',
})

const retrievedAt = new Date().toISOString()
const today = retrievedAt.slice(0, 10)
const source: SourceRef = {
  name: 'Chicago Board of Election Commissioners',
  url: PDF_URL,
  retrievedAt,
  official: true,
}

const ordinal = (s: string) => Number(s.match(/(\d+)(?:st|nd|rd|th)/)?.[1])
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const VOTE_FOR: Record<string, number> = { One: 1, Two: 2, Three: 3, Four: 4 }

/** The district whose voters see a race, from its heading in the PDF. */
function districtFor(heading: string): OcdId | null {
  if (
    /^(United States Senator|Governor|Attorney General|Secretary of State|Comptroller|Treasurer)/.test(
      heading,
    )
  ) {
    return ocd.ILLINOIS
  }
  if (/^U\.S\. Representative/.test(heading))
    return ocd.congressionalDistrict(ordinal(heading))
  if (/^State Senator/.test(heading))
    return ocd.stateSenateDistrict(ordinal(heading))
  if (/^State Representative/.test(heading))
    return ocd.stateHouseDistrict(ordinal(heading))
  if (/^Metropolitan Water Reclamation District/.test(heading)) return ocd.MWRD
  if (
    /^(President of County Board|County (Clerk|Sheriff|Treasurer|Assessor))/.test(
      heading,
    )
  )
    return ocd.COOK_COUNTY
  if (/^County Commissioner/.test(heading))
    return ocd.countyBoardDistrict(ordinal(heading))
  if (/^Board of Review/.test(heading))
    return ocd.boardOfReviewDistrict(ordinal(heading))
  if (/^Judge(,| of the) Appellate Court/.test(heading))
    return ocd.appellateDistrict(1)
  if (/^Judge(,| of the) Circuit Court/.test(heading)) return ocd.COOK_COUNTY
  if (/Subcircuit/.test(heading))
    return ocd.judicialSubcircuit(ordinal(heading))
  if (/^President of the Chicago Board of Education/.test(heading))
    return ocd.CHICAGO
  const sub = heading.match(/Board of Education, Subdistrict (\d+[AB])/)
  if (sub) return ocd.chicagoSchoolBoardDistrict(sub[1])
  return null
}

/** The district for a referendum's "To the Voters of …:" line. */
function referendumDistrict(scope: string): OcdId | null {
  if (/^Cook County$/.test(scope)) return ocd.COOK_COUNTY
  // CPS District 299 has the same boundary as the city.
  if (
    /^(the )?City of Chicago$|^Chicago Public Schools District 299$/.test(scope)
  )
    return ocd.CHICAGO
  const precinct = scope.match(/^the (\d+)\w\w Precinct of the (\d+)\w\w Ward$/)
  if (precinct)
    return ocd.chicagoPrecinct(Number(precinct[2]), Number(precinct[1]))
  const ward = scope.match(/^the (\d+)\w\w Ward$/)
  if (ward) return ocd.chicagoWard(Number(ward[1]))
  // Proposed Expanded Mental Health Services Program areas: the Board
  // publishes no precinct list, so they're mapped by community area.
  return referendumAreaDistrict(scope)
}

// Drop page furniture and blank lines.
const lines = text
  .split('\n')
  .map((l) => l.replace(/\s+$/, ''))
  .filter(
    (l) =>
      l.trim() &&
      !/^\s*Page \d+ of \d+$/.test(l) &&
      !/^\s*Ballot No\.\s+Candidate\s+Status$/.test(l),
  )

const retentionStart = lines.findIndex((l) =>
  /General Election Judicial Retention/.test(l),
)
const referendaStart = lines.findIndex((l) =>
  /^\s*Referenda and Local Options$/.test(l),
)
const headerEnd = lines.findIndex((l) =>
  /Candidate Filings in Ballot Order/.test(l),
)

const contests: Contest[] = []
const unmapped: string[] = []
const skippedCandidates: string[] = []
let order = 0

/** A contest without the fields `add` fills in, for each contest kind. */
type ContestDraft = Contest extends infer C
  ? C extends Contest
    ? Omit<
        C,
        | 'electionId'
        | 'authorityId'
        | 'sources'
        | 'lastVerified'
        | 'ballotOrder'
      >
    : never
  : never

function add(contest: ContestDraft, heading: string) {
  order += 1
  if (!contest.districtId) {
    unmapped.push(heading)
    return
  }
  contests.push({
    ...contest,
    electionId: ELECTION_ID,
    authorityId: ocd.CHICAGO,
    ballotOrder: order,
    sources: [source],
    lastVerified: today,
  } as Contest)
}

// Candidate races: an unindented heading, "Vote for N", then "(n) Name (Party)  Status" lines.
let race: { heading: string; voteFor: number; candidates: Candidate[] } | null =
  null
const flushRace = () => {
  if (!race) return
  const { heading, voteFor, candidates } = race
  // IDs and district matching use the raw heading; what voters read is never in all caps.
  const title = readableCase(heading)
  const vacancy = title.match(/\((.+)\)$/)?.[1]
  add(
    {
      id: `chicago-boe:${slug(heading)}`,
      kind: 'candidate',
      districtId: districtFor(heading) as OcdId,
      title,
      office: title.replace(/\s*\(.+\)$/, ''),
      voteFor,
      vacancy,
      candidates,
    },
    heading,
  )
  race = null
}
for (const line of lines.slice(headerEnd + 1, retentionStart)) {
  const candidate = line.match(
    /^\s*\((\d+)\)\s+(.+?)\s+\(([^)]+)\)\s{2,}(\S.*)$/,
  )
  if (candidate && race) {
    const [, number, name, party, status] = candidate
    if (status.trim() === 'Candidate')
      race.candidates.push({ name, party, ballotOrder: Number(number) })
    else skippedCandidates.push(`${name} (${status.trim()}) in ${race.heading}`)
    continue
  }
  const voteFor = line.match(/^\s*Vote for (?:not more than )?(\w+)/)
  if (voteFor && race) {
    race.voteFor = VOTE_FOR[voteFor[1]] ?? 1
    continue
  }
  if (/^\s*Write-in\b/.test(line)) continue
  if (/^\S/.test(line)) {
    flushRace()
    race = { heading: line.trim(), voteFor: 1, candidates: [] }
  }
}
flushRace()

// Retention: "Judge, … Court (Retention)", then the judge's name, then Yes/No lines.
for (let i = retentionStart + 1; i < referendaStart; i++) {
  const heading = lines[i].trim()
  if (!/\(Retention\)$/.test(heading)) continue
  const judge = lines[i + 1].trim()
  const office = heading.replace(/\s*\(Retention\)$/, '')
  add(
    {
      id: `chicago-boe:retention:${slug(judge)}`,
      kind: 'retention',
      districtId: districtFor(office) as OcdId,
      title: `Retention: ${readableCase(office)}`,
      office: readableCase(office),
      judge,
    },
    `${heading} ${judge}`,
  )
}

// Referenda: "To the Voters of <scope>:" (may wrap onto a second line), then
// for each question a title, the quoted question, and Yes/No lines.
let scope = ''
let block: string[] = []
for (let i = referendaStart + 1; i < lines.length; i++) {
  const line = lines[i].trim()
  const scopeStart = line.match(/^To the Voters of (.+)$/)
  if (scopeStart) {
    let full = scopeStart[1]
    while (!full.endsWith(':') && i + 1 < lines.length)
      full += ` ${lines[++i].trim()}`
    scope = full.replace(/:$/, '').replace(/\s+/g, ' ')
    block = []
    continue
  }
  if (line === 'Yes') {
    const quoteAt = block.findIndex((l) => /^["“]/.test(l))
    const title = (
      quoteAt > 0 ? block.slice(0, quoteAt) : block.slice(0, 1)
    ).join(' ')
    const question = (quoteAt >= 0 ? block.slice(quoteAt) : block.slice(1))
      .join(' ')
      .replace(/^["“]|["”]$/g, '')
    add(
      {
        id: `chicago-boe:ref:${slug(scope)}:${slug(title)}`,
        kind: 'measure',
        districtId: referendumDistrict(scope) as OcdId,
        title: readableCase(title),
        // The official ballot text, word for word.
        question,
      },
      `referendum "${title}" (${scope})`,
    )
    block = []
    continue
  }
  if (line === 'No') continue
  block.push(line)
}

await writeJson(join(BUILD, 'contests', 'chicago-boe.json'), {
  retrievedAt,
  contests,
  unmapped,
})
const count = (kind: Contest['kind']) =>
  contests.filter((c) => c.kind === kind).length
console.log(
  `${contests.length} contests: ${count('candidate')} races, ${count('retention')} retention, ${count('measure')} referenda`,
)
console.log(`${skippedCandidates.length} candidates not listed as "Candidate":`)
for (const line of skippedCandidates) console.log(`  ${line}`)
console.log(`${unmapped.length} not yet placed in a district:`)
for (const line of unmapped) console.log(`  ${line}`)
