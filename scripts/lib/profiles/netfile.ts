// NetFile's public campaign portal (netfile.com/public/{agency}/campaign),
// where Los Angeles County's Registrar-Recorder/County Clerk and a number of
// cities publish their candidates' campaign statements. Everything here is
// what the portal itself loads with no sign-in or challenge: the election's
// seats with each candidate's committee (as the filing officer linked them),
// each committee's list of filings, and each filing's PDF. The bulk exports
// behind the portal's bot check are never requested; a challenged request
// stops the run as a NetFileWall.
//
// Downloads are cached under data/raw/money/netfile/ (filing PDFs never
// change, so they're kept; lists are refreshed after maxAgeHours) and made
// one at a time with a pause between them.

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RAW } from '../data.ts'
import { namesMatch, splitCommaName, type ParsedName } from './names.ts'

export const NETFILE_DIR = join(RAW, 'money', 'netfile')
const API = 'https://netfile.com/api/public/sites/api/'
const USER_AGENT = 'VoteStack data import (votestack.org)'
const PAUSE_MS = 400

/** A filing officer on NetFile: its agency code and the office's name as voters know it. */
export interface Agency {
  aid: string
  filedWith: string
}

const LA_COUNTY: Agency = {
  aid: 'LACO',
  filedWith: 'Los Angeles County Registrar-Recorder/County Clerk',
}

/**
 * Cities whose clerks publish candidates' statements on NetFile, by the
 * place slug in our district IDs. Agency codes are from NetFile's public
 * agency list (netfile.com/api/public/sites/api/agencies), each checked to
 * have a November 3, 2026 election on NetFile. (Pomona's lists no seats, so
 * its candidates are found by their committees' names.)
 */
export const CITY_AGENCIES: Record<string, Agency> = {
  culver_city: { aid: 'CUL', filedWith: 'City of Culver City' },
  diamond_bar: { aid: 'CDB', filedWith: 'City of Diamond Bar' },
  duarte: { aid: 'COD', filedWith: 'City of Duarte' },
  el_segundo: { aid: 'SEG', filedWith: 'City of El Segundo' },
  glendora: { aid: 'COG', filedWith: 'City of Glendora' },
  hermosa_beach: { aid: 'COHB', filedWith: 'City of Hermosa Beach' },
  malibu: { aid: 'MBU', filedWith: 'City of Malibu' },
  manhattan_beach: { aid: 'CMB', filedWith: 'City of Manhattan Beach' },
  monrovia: { aid: 'MON', filedWith: 'City of Monrovia' },
  montebello: { aid: 'BELLO', filedWith: 'City of Montebello' },
  norwalk: { aid: 'NWK', filedWith: 'City of Norwalk' },
  palmdale: { aid: 'CPD', filedWith: 'City of Palmdale' },
  pomona: { aid: 'PMNA', filedWith: 'City of Pomona' },
  san_gabriel: { aid: 'CSG', filedWith: 'City of San Gabriel' },
  santa_fe_springs: { aid: 'SFS', filedWith: 'City of Santa Fe Springs' },
  santa_monica: { aid: 'CSM', filedWith: 'City of Santa Monica' },
  south_gate: { aid: 'SGC', filedWith: 'City of South Gate' },
  south_pasadena: { aid: 'SPAS', filedWith: 'City of South Pasadena' },
  west_hollywood: { aid: 'WEHO', filedWith: 'City of West Hollywood' },
}

/**
 * Districts whose candidates file somewhere other than LA County: Santa
 * Monica's charter puts Santa Monica College and Santa Monica-Malibu USD
 * with its City Clerk, and districts spanning counties file in the county
 * with most of their voters.
 */
const DISTRICT_AGENCIES: [RegExp, Agency][] = [
  [/community_college_district:santa_monica\b/, CITY_AGENCIES.santa_monica],
  [/school_district:santa_monica_malibu_unified\b/, CITY_AGENCIES.santa_monica],
  [
    /school_district:fullerton_joint_union_high\b/,
    { aid: 'COC', filedWith: 'Orange County Registrar of Voters' },
  ],
  [
    /special_district:wrightwood_community_services_district\b/,
    { aid: 'SBD', filedWith: 'San Bernardino County Registrar of Voters' },
  ],
]

const LOCAL_DISTRICT_TYPES = new Set([
  'school_board',
  'community_college',
  'special_district',
])

/** The NetFile agency a person files with, or null when it isn't on NetFile. */
export function agencyFor(p: {
  officeType: string
  districtId: string
}): Agency | null {
  if (p.officeType === 'county_executive') return LA_COUNTY
  if (LOCAL_DISTRICT_TYPES.has(p.officeType)) {
    for (const [re, agency] of DISTRICT_AGENCIES)
      if (re.test(p.districtId)) return agency
    return LA_COUNTY
  }
  if (p.officeType === 'city_council' || p.officeType === 'city_executive') {
    const place = p.districtId.match(/\/place:([a-z0-9_]+)/)?.[1]
    return (place && CITY_AGENCIES[place]) || null
  }
  return null
}

export const agencyPage = (aid: string) =>
  `https://netfile.com/public/${aid}/campaign`

/** The portal's page listing one committee's filings. */
export const filerPage = (aid: string, filerId: string, name: string) =>
  `https://netfile.com/public/${aid}/campaign/filingsByFiler/${filerId}-${encodeURIComponent(name)}`

// ---------------------------------------------------------------- the API

export interface NfElection {
  id: string
  caption: string | null
  electionDate: string
}
export interface NfCandidate {
  id: string
  fullName: string
  committeeId: string | null
}
export interface NfSeat {
  id: string
  caption: string
  candidates: NfCandidate[]
}
export interface NfFiling {
  id: string
  formName: string
  filerName: string
  filingDate: string
  periodStart: string | null
  periodEnd: string | null
  canDownload?: boolean
}

/** A request the portal answered with a bot check, login or block: a wall we don't get past. */
export class NetFileWall extends Error {}

let lastRequest = 0

async function politeFetch(url: string): Promise<Response> {
  const wait = lastRequest + PAUSE_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  const challenged =
    res.headers.get('cf-mitigated') === 'challenge' ||
    res.status === 401 ||
    res.status === 403 ||
    res.status === 429 ||
    res.status === 503
  if (challenged)
    throw new NetFileWall(`${res.status} ${res.statusText} for ${url}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res
}

async function fresh(path: string, maxAgeHours: number): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return !!s && Date.now() - s.mtimeMs < maxAgeHours * 3_600_000
}

async function save(path: string, data: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.partial`, data)
  await rename(`${path}.partial`, path)
}

/** A JSON endpoint, cached at `cache`. */
async function getJson<T>(
  endpoint: string,
  cache: string,
  maxAgeHours: number,
): Promise<T> {
  const path = join(NETFILE_DIR, cache)
  if (!(await fresh(path, maxAgeHours))) {
    const res = await politeFetch(API + endpoint)
    const text = await res.text()
    if (!/^\s*[[{]/.test(text))
      throw new NetFileWall(`Not JSON from ${API + endpoint}`)
    await save(path, text)
  }
  return JSON.parse(await readFile(path, 'utf8')) as T
}

/** The agency's election on `date` (YYYY-MM-DD), if it has one. */
export async function electionOn(
  aid: string,
  date: string,
  maxAgeHours: number,
): Promise<NfElection | undefined> {
  const { elections } = await getJson<{ elections: NfElection[] }>(
    `elections?aid=${aid}`,
    `${aid}/elections.json`,
    maxAgeHours,
  )
  return elections.find((e) => e.electionDate.startsWith(date))
}

/** Every seat in an election, with its candidates and their committees. */
export async function seatsOf(
  aid: string,
  electionId: string,
  maxAgeHours: number,
): Promise<NfSeat[]> {
  const details = await getJson<{
    electionSeats: { id: string; caption: string }[]
  }>(
    `elections/details?aid=${aid}&id=${electionId}`,
    `${aid}/election-${electionId}.json`,
    maxAgeHours,
  )
  const seats: NfSeat[] = []
  for (const s of details.electionSeats) {
    try {
      seats.push(
        await getJson<NfSeat>(
          `elections/seat?aid=${aid}&id=${s.id}`,
          `${aid}/seats/${s.id}.json`,
          maxAgeHours,
        ),
      )
    } catch (e) {
      // The portal answers 500 for some seats with no candidates.
      if (e instanceof NetFileWall || !/^500 /.test((e as Error).message))
        throw e
      console.warn(`NetFile ${aid}: no candidate list for seat ${s.caption}`)
      seats.push({ id: s.id, caption: s.caption, candidates: [] })
    }
  }
  return seats
}

/** All of a committee's filings. */
export async function filingsOf(
  aid: string,
  filerId: string,
  maxAgeHours: number,
): Promise<NfFiling[]> {
  const { filings } = await getJson<{ filings: NfFiling[] }>(
    `filings/byFiler?agencyCode=${aid}&filerId=${filerId}`,
    `${aid}/filers/${filerId}.json`,
    maxAgeHours,
  )
  return filings
}

/** Every campaign filing an agency received in a date range, for finding committees no seat lists. */
export async function filingsBetween(
  aid: string,
  start: string,
  end: string,
  maxAgeHours: number,
): Promise<NfFiling[]> {
  const out: NfFiling[] = []
  const pageSize = 500
  for (let page = 1; page < 100; page++) {
    const { filings, totalCount } = await getJson<{
      filings: NfFiling[]
      totalCount: number
    }>(
      `filings/byDate?agencyCode=${aid}&startDate=${start}&endDate=${end}&isOnlyCampaign=true&page=${page}&pageSize=${pageSize}`,
      `${aid}/byDate-${start}-${end}-${page}.json`,
      maxAgeHours,
    )
    out.push(...filings)
    if (filings.length < pageSize || out.length >= totalCount) break
  }
  return out
}

/** The committee (filer) ID behind one filing. */
export async function filerIdOf(
  aid: string,
  filingId: string,
): Promise<string | undefined> {
  const r = await getJson<{ filerId?: string }>(
    `Filings/byId/${filingId}?agencyCode=${aid}`,
    `${aid}/filing/${filingId}.json`,
    Infinity,
  )
  return r.filerId
}

/**
 * A filing's PDF on disk (downloaded once; filings never change), or null
 * when NetFile has no copy (paper filings it lists but doesn't hold).
 */
export async function filingPdf(
  aid: string,
  filing: Pick<NfFiling, 'id' | 'canDownload'>,
): Promise<string | null> {
  const filingId = filing.id
  if (filing.canDownload === false) return null
  const path = join(NETFILE_DIR, aid, 'pdf', `${filingId}.pdf`)
  if (await fresh(path, Infinity)) return path
  let res: Response
  try {
    res = await politeFetch(
      `${API}CampaignDocuments/download/${filingId}?aid=${aid}&name=x&date=x&form=x`,
    )
  } catch (e) {
    if (e instanceof NetFileWall || !/^5\d\d /.test((e as Error).message))
      throw e
    console.warn(`NetFile ${aid}: no PDF for filing ${filingId}`)
    return null
  }
  const type = res.headers.get('content-type') ?? ''
  const body = new Uint8Array(await res.arrayBuffer())
  if (
    !type.includes('pdf') &&
    !/^%PDF/.test(new TextDecoder().decode(body.slice(0, 5)))
  )
    throw new NetFileWall(
      `Filing ${filingId} (${aid}) didn't come back as a PDF`,
    )
  await save(path, body)
  return path
}

// ---------------------------------------------------------------- matching

/** "Calderon, Sergio" → last and first. */
export function candidateName(fullName: string): {
  first: string
  last: string
} {
  const { last, first } = splitCommaName(fullName)
  return { last: last.trim(), first: first.trim() }
}

const words = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Whether a seat's caption names the same office as ours (same words, ignoring punctuation and notes in brackets). */
export function sameOffice(caption: string, office: string): boolean {
  // Our office titles drop letters like "ñ" ("La Ca Ada"), so compare
  // without them and without spaces too.
  const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '')
  return (
    words(caption).join(' ') === words(office).join(' ') ||
    words(ascii(caption)).join('') === words(ascii(office)).join('')
  )
}

export interface SeatMatch {
  seat: NfSeat
  candidate: NfCandidate
}

/**
 * The seat candidates who are this person: the name must match (full last
 * name, agreeing given name), and when several do, only those on a seat
 * whose caption is this office count; a caption written differently must
 * still name the same body.
 */
export function matchSeatCandidates(
  person: { ballot: ParsedName; office: string },
  seats: NfSeat[],
): SeatMatch[] {
  const byName: SeatMatch[] = []
  for (const seat of seats)
    for (const candidate of seat.candidates) {
      const { last, first } = candidateName(candidate.fullName)
      if (namesMatch(person.ballot, last, first))
        byName.push({ seat, candidate })
    }
  const onSeat = byName.filter((m) => sameOffice(m.seat.caption, person.office))
  if (onSeat.length) return onSeat
  // Captions written differently: the seat must at least name the same body.
  const body = bodyWords(person.office)
  return byName.filter((m) =>
    bodyWords(m.seat.caption).some((w) => body.includes(w)),
  )
}

/** The words of an office title that name the body ("west", "basin", "water"). */
const bodyWords = (office: string) =>
  words(office).filter((w) => !GENERIC_OFFICE_WORDS.has(w) && !/^\d+$/.test(w))

/** Words naming a kind of office rather than a particular body. */
const OFFICE_KIND_WORDS = new Set(
  'school schools unified union high elementary joint city water municipal college library services community council irrigation agency county valley'.split(
    ' ',
  ),
)

/** Words that may come before a last name in a committee's name ("Elect Doe"). */
const NAME_LEADS = new Set(['elect', 'reelect', 're', 'of', 'to', 'committee'])

/**
 * Whether the last name at `at` stands alone or follows the person's own
 * names ("Doe for ...", "Jane Q. Doe for ...", "Elect Doe"), not someone
 * else's ("John Doe for ...", a relative).
 */
function ownNameAt(w: string[], at: number, ballot: ParsedName): boolean {
  if (at < 0) return false
  let i = at - 1
  // Skip a middle initial after a given name.
  if (w[i]?.length === 1 && i > 0 && ballot.words.includes(w[i - 1])) i--
  return (
    i < 0 ||
    NAME_LEADS.has(w[i]) ||
    ballot.words.includes(w[i]) ||
    ballot.given.includes(w[i])
  )
}

/** Words in office titles that say nothing about which body it is. */
const GENERIC_OFFICE_WORDS = new Set(
  'a an and area at board county director directors district division for governing large member members no of seat short term the to trustee trustees unexpired ending'.split(
    ' ',
  ),
)

/**
 * Filers named after this person in the election year, for seats the
 * filing officer left without candidates. `committees` are committee names
 * holding the year, the person's last name and either their given name and
 * the kind of office ("Jane Doe for Water Board 2026") or the body's own
 * name ("Doe for West Basin Water District 2026"), so a committee for some
 * other office ("Jane Doe for Supervisor 2026") or person ("John Doe for
 * Water Board 2026") doesn't count. `self` are filers under
 * the candidate's own name ("Doe, Jane"), who file Form 470s and 501s.
 */
export function filersNamedFor(
  person: { ballot: ParsedName; office: string },
  year: number,
  filings: NfFiling[],
): { committees: string[]; self: string[] } {
  const { ballot } = person
  const last = ballot.words.at(-1)
  const committees = new Set<string>()
  const self = new Set<string>()
  if (!last) return { committees: [], self: [] }
  const officeWords = bodyWords(person.office)
  const distinctive = officeWords.filter((x) => !OFFICE_KIND_WORDS.has(x))
  for (const f of filings) {
    const name = f.filerName
    const w = words(name)
    if (!w.includes(last)) continue
    if (/^[^,]+,[^,]+$/.test(name) && !/\d/.test(name)) {
      const { last: l, first } = candidateName(name)
      if (namesMatch(ballot, l, first)) self.add(name)
      continue
    }
    if (!w.includes(String(year))) continue
    const at = w.indexOf(last)
    if (!ownNameAt(w, at, ballot)) continue
    // With the given name, the kind of office will do ("Jane Doe for Water
    // Board"); without it, the body's own name must be there ("Doe for
    // West Basin"), since "Doe for School Board" could be any Doe.
    const given = w
      .slice(Math.max(0, at - 2), at)
      .some((x) => ballot.given.includes(x))
    const names = given ? officeWords : distinctive
    if (w.some((x) => names.includes(x))) committees.add(name)
  }
  return { committees: [...committees], self: [...self] }
}

// ---------------------------------------------------------------- filings

const is460 = (f: NfFiling) => /\b460\b/.test(f.formName)
const is497 = (f: NfFiling) =>
  /\b497\b/.test(f.formName) && !/LCR/.test(f.formName)
const isAmendment = (f: NfFiling) => /amend/i.test(f.formName)
const day = (iso: string | null) => (iso ?? '').slice(0, 10)

/**
 * A committee's latest Form 460 (the latest period, then the latest filed,
 * so an amendment replaces its original) and the Form 497s filed after
 * that period ended. Amended 497s are left out: they repeat the original's
 * contributions, and counting both would double them.
 */
export function latestFilings(filings: NfFiling[]): {
  f460?: NfFiling
  f497: NfFiling[]
  f470: NfFiling[]
} {
  const f460 = filings
    .filter((f) => is460(f) && f.periodEnd)
    .sort(
      (a, b) =>
        day(b.periodEnd).localeCompare(day(a.periodEnd)) ||
        b.filingDate.localeCompare(a.filingDate),
    )[0]
  const after = f460 ? day(f460.periodEnd) : ''
  const f497 = filings.filter(
    (f) => is497(f) && !isAmendment(f) && day(f.filingDate) > after,
  )
  const f470 = filings.filter((f) => /\b470\b/.test(f.formName))
  return { f460, f497, f470 }
}

export { day as isoDay }
