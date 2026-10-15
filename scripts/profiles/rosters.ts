// Downloads the official member rosters of the U.S. House and Senate (the
// region's state) and of the California Assembly and Senate, and writes
// content/profiles/{region}/rosters.json (committed). profiles:generate
// reads it to give each endorsing legislator their party, from one source
// for everyone. California only for now.
//
// Run:  node scripts/profiles/rosters.ts --region ca-la

import { parseArgs } from 'node:util'
import { ROSTERS, today, writeFormattedJson } from '../lib/profiles/content.ts'
import { REGION, REGION_OPTION } from '../lib/profiles/region.ts'
import {
  parseAssembly,
  parseHouse,
  parseStateSenate,
  parseUsSenate,
  type Body,
  type Rosters,
} from '../lib/profiles/rosters.ts'

parseArgs({ options: { ...REGION_OPTION } })
if (REGION.state !== 'CA')
  throw new Error(`Rosters are only set up for California, not ${REGION.state}`)

const USER_AGENT = 'VoteStack data import (votestack.org)'
const SOURCES: Record<Body, string> = {
  us_house: 'https://clerk.house.gov/xml/lists/MemberData.xml',
  us_senate:
    'https://www.senate.gov/general/contact_information/senators_cfm.xml',
  state_assembly: 'https://www.assembly.ca.gov/assemblymembers',
  state_senate: 'https://www.senate.ca.gov/senators',
}

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

const members = [
  ...parseHouse(await text(SOURCES.us_house), REGION.state),
  ...parseUsSenate(await text(SOURCES.us_senate), REGION.state),
  ...parseAssembly(await text(SOURCES.state_assembly)),
  ...parseStateSenate(await text(SOURCES.state_senate)),
]
// A roster that stops parsing would quietly fill nothing; these are the
// seat counts less a few vacancies.
const minimum: Record<Body, number> = {
  us_house: 45,
  us_senate: 2,
  state_assembly: 70,
  state_senate: 35,
}
for (const [body, n] of Object.entries(minimum) as [Body, number][]) {
  const count = members.filter((m) => m.body === body).length
  if (count < n)
    throw new Error(`Only ${count} members read for ${body}; check its parser`)
}
const rosters: Rosters = { fetchedAt: today(), sources: SOURCES, members }
await writeFormattedJson(ROSTERS, rosters)
console.log(
  `${members.length} members: ${Object.keys(minimum)
    .map((b) => `${b} ${members.filter((m) => m.body === b).length}`)
    .join(', ')} → ${ROSTERS}`,
)
