// Downloads the LA County Registrar's Interactive Sample Ballot data for an
// election into data/raw/la/isb/{election}/: the street segments (address
// ranges with their precinct and ballot style), each ballot style's list of
// contests in ballot order, and each contest with its candidates.
//
// These are the files isb.lavote.gov loads in the browser. We fetch each once,
// one at a time with a pause between requests, and keep them on disk so a
// rerun only fetches what's missing. Street segment files are named by the
// first three letters of the street name; the names come from the County's
// address points (run fetch-la-address-points.ts first).
// Run: node scripts/la/fetch-la-isb.ts [election id, default 4348]

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RAW } from '../lib/data.ts'
import { csvRows } from './csv.ts'

const ELECTION = process.argv[2] ?? '4348'
const BASE = `https://isb.lavote.gov/parsed/${ELECTION}`
const DIR = join(RAW, 'la', 'isb', ELECTION)
const PAUSE_MS = 250

interface Segment {
  PrecinctID: string
  partyBallotMap: Record<string, string>
}
interface Ballot {
  contests: { contest_id: string }[]
}

/** The file at `path` under the election, from disk or the site. Null if the site has none. */
async function get<T>(path: string): Promise<T | null> {
  const file = join(DIR, path)
  const missing = `${file}.missing`
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as T
  if (existsSync(missing)) return null
  await new Promise((r) => setTimeout(r, PAUSE_MS))
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'User-Agent': 'VoteStack data import (votestack.org)' },
  })
  await mkdir(join(file, '..'), { recursive: true })
  const text = await res.text()
  // Missing files come back as a 404 with the site's HTML page. (Files that
  // exist are served as application/octet-stream, so the type can't tell.)
  if (res.status === 404 || text.trimStart().startsWith('<')) {
    await writeFile(missing, '')
    return null
  }
  if (!res.ok) throw new Error(`${res.status} for ${path}`)
  await writeFile(file, text)
  return JSON.parse(text) as T
}

// Street name prefixes from the County's address points.
const prefixes = new Set<string>()
for await (const row of csvRows(join(RAW, 'la', 'cams.csv'))) {
  for (const name of [
    row.StreetName,
    [row.PreType, row.StreetName].filter(Boolean).join(' '),
  ]) {
    const prefix = name?.trim().toUpperCase().slice(0, 3)
    if (prefix && /^[A-Z0-9]/.test(prefix)) prefixes.add(prefix)
  }
}

const styles = new Set<string>()
let found = 0
let done = 0
for (const prefix of [...prefixes].sort()) {
  const segments = await get<Segment[]>(
    `street-segments/${encodeURIComponent(prefix)}.json`,
  )
  if (segments) found++
  for (const s of segments ?? [])
    for (const style of Object.values(s.partyBallotMap ?? {})) styles.add(style)
  if (++done % 100 === 0)
    console.log(`street segments: ${done}/${prefixes.size} prefixes`)
}
console.log(
  `${found} of ${prefixes.size} street name prefixes have segments; ${styles.size} ballot styles`,
)

const contests = new Set<string>()
for (const style of [...styles].sort()) {
  const ballot = await get<Ballot>(`ballots/${style}.json`)
  for (const c of ballot?.contests ?? []) contests.add(c.contest_id)
}
console.log(`${contests.size} contests`)
for (const id of [...contests].sort()) await get(`contests/${id}.json`)
await get('election.json')
console.log(`Saved in ${DIR}`)
