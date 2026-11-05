// The kept inputs of the results build, in content/results-inputs/{area}/:
// how official contests match ours (match.json), AP's calls (ap-calls.json),
// AP's district-wide counts from two separate reads (ap-counts-a.json,
// ap-counts-b.json) and the offices' certifications (certifications.json).
// Each parser checks a parsed JSON file and returns it typed, or throws an
// Error naming the file and the first bad field.

import type { IsoDate } from '../../../src/shared/ballot.ts'
import type { OfficialSource } from './types.ts'

export interface MatchEntry {
  contestIds: string[]
  kind: 'candidate' | 'retention' | 'measure'
  scope: 'within' | 'beyond'
  /** Official contests that feed this race; Cook countywide races list both chicago and cook. */
  official: { source: OfficialSource; title: string }[]
  /** Official name → our name ("YES" → "Yes"). Write-ins have no entry. */
  names: Record<string, string>
  /** Our names in ballot order (Yes, No for judges and measures). */
  ballotOrder: string[]
  voteFor?: number
  threshold?: number
  certifyBy: IsoDate
  /** AP's public page, when AP covers the race. */
  apUrl?: string
  /** Why no official count exists, when none does. */
  noOfficialCount?: string
}

export interface MatchFile {
  version: 1
  electionId: string
  area: 'cook' | 'ca-la'
  contests: MatchEntry[]
}

export interface ApCall {
  contestIds: string[]
  winners: string[]
  at: string
  url: string
  status: 'called' | 'too_close' | 'withdrawn'
}

export interface ApCallsFile {
  version: 1
  checkedAt: string
  calls: ApCall[]
}

export interface ApCount {
  contestIds: string[]
  url: string
  asOf: string
  /** AP's estimate of the share of votes counted, 0 to 1. */
  counted: number
  /** Our names. */
  choices: { name: string; votes: number }[]
}

export interface ApCountsFile {
  version: 1
  reader: 'a' | 'b'
  checkedAt: string
  counts: ApCount[]
}

export interface Certification {
  source: OfficialSource | 'il-sbe' | 'ca-sos'
  on: IsoDate
  url: string
  confirmedWinners: true
}

export interface CertificationsFile {
  version: 1
  certifications: Certification[]
}

/** The same race whatever order its contest IDs are listed in. */
export const raceKey = (contestIds: readonly string[]): string =>
  [...contestIds].sort().join(' ')

type Fail = (path: string, why: string) => never

const failer =
  (file: string): Fail =>
  (path, why) => {
    throw new Error(`${file}: ${path} ${why}`)
  }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function object(fail: Fail, v: unknown, path: string) {
  if (!isObject(v)) fail(path, 'must be an object')
  return v
}

function list(fail: Fail, v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be an array')
  return v
}

function str(fail: Fail, v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    fail(path, 'must be a non-empty string')
  }
  return v
}

function strings(fail: Fail, v: unknown, path: string): string[] {
  const items = list(fail, v, path)
  items.forEach((s, i) => str(fail, s, `${path}[${i}]`))
  return items as string[]
}

/** Non-empty, with no repeats. */
function ids(fail: Fail, v: unknown, path: string): string[] {
  const items = strings(fail, v, path)
  if (items.length === 0) fail(path, 'must not be empty')
  items.forEach((s, i) => {
    if (items.indexOf(s) !== i) fail(path, `repeats "${s}"`)
  })
  return items
}

/** A real calendar date: "2026-13-24" fails, and so does "2026-02-30", which Date would roll over. */
function isoDate(fail: Fail, v: unknown, path: string): string {
  const s = str(fail, v, path)
  const time = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? Date.parse(`${s}T00:00:00Z`)
    : Number.NaN
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== s) {
    fail(path, 'must be a date like 2026-11-24')
  }
  return s
}

/** An ISO 8601 time with its zone ("Z" or "-06:00"), so it reads the same everywhere. */
function timestamp(fail: Fail, v: unknown, path: string): string {
  const s = str(fail, v, path)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      s,
    ) ||
    Number.isNaN(Date.parse(s))
  ) {
    fail(
      path,
      'must be an ISO 8601 time with a zone, like 2026-11-04T03:21:00-06:00',
    )
  }
  return s
}

/** The sites a kept link may point to: AP's, and the election offices' own. */
const LINK_HOSTS = [
  { host: 'apnews.com', subdomains: false },
  { host: 'chicagoelections.gov', subdomains: true },
  { host: 'cookcountyclerkil.gov', subdomains: true },
  { host: 'lavote.gov', subdomains: true },
  { host: 'sos.ca.gov', subdomains: true },
  { host: 'elections.il.gov', subdomains: false },
]

/** A link voters follow from a result: AP's page or an election office's. */
function link(fail: Fail, v: unknown, path: string): string {
  const s = str(fail, v, path)
  let host = ''
  try {
    host = new URL(s).hostname
  } catch {
    // Not a URL: no host, so it fails below.
  }
  if (
    !LINK_HOSTS.some(
      (h) => host === h.host || (h.subdomains && host.endsWith(`.${h.host}`)),
    )
  ) {
    fail(
      path,
      `must link to AP or an election office (apnews.com, chicagoelections.gov, cookcountyclerkil.gov, lavote.gov, sos.ca.gov or elections.il.gov), not "${s}"`,
    )
  }
  return s
}

function votes(fail: Fail, v: unknown, path: string): number {
  if (!Number.isInteger(v) || (v as number) < 0) {
    fail(path, 'must be a non-negative integer')
  }
  return v as number
}

function oneOf<T extends string>(
  fail: Fail,
  v: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (!allowed.includes(v as T)) {
    fail(path, `must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`)
  }
  return v as T
}

/** Fails on a race (by its contest IDs) already seen in the same file. */
function noRepeatedRaces(
  fail: Fail,
  items: unknown[],
  path: (i: number) => string,
) {
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const key = raceKey((item as { contestIds: string[] }).contestIds)
    const first = seen.get(key)
    if (first !== undefined) {
      fail(`${path(i)}.contestIds`, `repeats the race in ${path(first)}`)
    }
    seen.set(key, i)
  })
}

const KINDS = ['candidate', 'retention', 'measure'] as const
const SCOPES = ['within', 'beyond'] as const
const AREA_SOURCES: Record<MatchFile['area'], readonly OfficialSource[]> = {
  cook: ['chicago', 'cook'],
  'ca-la': ['la', 'ca-sos'],
}

/** The yes shares a ballot question or judge can need. */
const THRESHOLDS = [0.5, 0.55, 0.6, 2 / 3]

/** Checks one match entry; returns it with a two-thirds threshold made exact. */
function parseEntry(
  fail: Fail,
  raw: unknown,
  path: string,
  area: MatchFile['area'],
): MatchEntry {
  const e = object(fail, raw, path)
  const id = ids(fail, e.contestIds, `${path}.contestIds`)[0]
  const kind = oneOf(fail, e.kind, `${path}.kind`, KINDS)
  const scope = oneOf(fail, e.scope, `${path}.scope`, SCOPES)

  const official = list(fail, e.official, `${path}.official`)
  const seen = new Set<string>()
  official.forEach((o, i) => {
    const p = `${path}.official[${i}]`
    const item = object(fail, o, p)
    oneOf(fail, item.source, `${p}.source`, AREA_SOURCES[area])
    const title = str(fail, item.title, `${p}.title`)
    const key = `${item.source} ${title}`
    if (seen.has(key)) fail(p, `repeats ${item.source} "${title}"`)
    seen.add(key)
  })

  // Only a candidate race with a stated reason for no count may have no
  // choices at all ("No candidates filed.").
  const nobody =
    kind === 'candidate' &&
    e.noOfficialCount !== undefined &&
    Array.isArray(e.ballotOrder) &&
    e.ballotOrder.length === 0
  const order = nobody ? [] : ids(fail, e.ballotOrder, `${path}.ballotOrder`)
  if (
    kind !== 'candidate' &&
    (order.length !== 2 || order[0] !== 'Yes' || order[1] !== 'No')
  ) {
    fail(`${path}.ballotOrder`, 'must be ["Yes", "No"] for judges and measures')
  }
  const names = object(fail, e.names, `${path}.names`)
  for (const [from, to] of Object.entries(names)) {
    const p = `${path}.names[${JSON.stringify(from)}]`
    if (!order.includes(str(fail, to, p))) {
      fail(p, `maps to "${String(to)}", which is not in ballotOrder`)
    }
  }

  if (kind === 'candidate' || e.voteFor !== undefined) {
    if (!Number.isInteger(e.voteFor) || (e.voteFor as number) < 1) {
      fail(`${path}.voteFor`, 'must be a whole number of seats, 1 or more')
    }
  }
  let threshold = e.threshold
  if (kind !== 'candidate' || e.threshold !== undefined) {
    const t = e.threshold
    if (typeof t !== 'number' || !(t > 0 && t <= 1)) {
      fail(
        `${path}.threshold`,
        'must be the yes share needed, above 0 and at most 1',
      )
    }
    // Two-thirds has no exact decimal, so a file may round it (0.666667);
    // the rules need it exact, or exactly two-thirds yes would fall short.
    const exact = Math.abs(t - 2 / 3) < 1e-4 ? 2 / 3 : t
    if (!THRESHOLDS.includes(exact)) {
      fail(
        `${path}.threshold`,
        `of ${id} is ${t}; it must be 0.5, 0.55, 0.6 or two-thirds`,
      )
    }
    threshold = exact
  }
  const entry = (threshold === e.threshold
    ? e
    : { ...e, threshold }) as unknown as MatchEntry
  isoDate(fail, e.certifyBy, `${path}.certifyBy`)
  if (e.apUrl !== undefined) link(fail, e.apUrl, `${path}.apUrl`)

  if (e.noOfficialCount !== undefined) {
    str(fail, e.noOfficialCount, `${path}.noOfficialCount`)
    return entry
  }
  // Without a reason for having none, a race the offices count whole needs
  // their count, and an LA race across the county line needs the state's.
  if (scope === 'within' && official.length === 0) {
    fail(`${path}.official`, 'is empty; set noOfficialCount with the reason')
  }
  if (
    area === 'ca-la' &&
    scope === 'beyond' &&
    !official.some((o) => (o as { source: string }).source === 'ca-sos')
  ) {
    fail(
      `${path}.official`,
      'must include a ca-sos contest for a race that crosses the county line, or set noOfficialCount',
    )
  }
  return entry
}

/** Checks a parsed match.json; returns it with two-thirds thresholds made exact. */
export function parseMatchFile(raw: unknown): MatchFile {
  const fail = failer('Match file')
  const file = object(fail, raw, 'file')
  if (file.version !== 1) fail('version', 'must be 1')
  str(fail, file.electionId, 'electionId')
  const area = oneOf(fail, file.area, 'area', ['cook', 'ca-la'] as const)
  const contests = list(fail, file.contests, 'contests')
  const owner = new Map<string, number>()
  const entries = contests.map((c, i) => {
    const entry = parseEntry(fail, c, `contests[${i}]`, area)
    for (const id of entry.contestIds) {
      const first = owner.get(id)
      if (first !== undefined) {
        fail(
          `contests[${i}].contestIds`,
          `has "${id}", already in contests[${first}]`,
        )
      }
      owner.set(id, i)
    }
    return entry
  })
  return { ...file, contests: entries } as unknown as MatchFile
}

const CALL_STATUSES = ['called', 'too_close', 'withdrawn'] as const

/** Checks a parsed ap-calls.json. */
export function parseApCalls(raw: unknown): ApCallsFile {
  const fail = failer('AP calls file')
  const file = object(fail, raw, 'file')
  if (file.version !== 1) fail('version', 'must be 1')
  timestamp(fail, file.checkedAt, 'checkedAt')
  const calls = list(fail, file.calls, 'calls')
  calls.forEach((c, i) => {
    const p = `calls[${i}]`
    const call = object(fail, c, p)
    ids(fail, call.contestIds, `${p}.contestIds`)
    const status = oneOf(fail, call.status, `${p}.status`, CALL_STATUSES)
    const winners = strings(fail, call.winners, `${p}.winners`)
    if (status === 'called' && winners.length === 0) {
      fail(`${p}.winners`, 'must name the winners of a called race')
    }
    if (status !== 'called' && winners.length > 0) {
      fail(`${p}.winners`, `must be empty for a ${status} call`)
    }
    winners.forEach((w, j) => {
      if (winners.indexOf(w) !== j) fail(`${p}.winners`, `repeats "${w}"`)
    })
    timestamp(fail, call.at, `${p}.at`)
    link(fail, call.url, `${p}.url`)
  })
  noRepeatedRaces(fail, calls, (i) => `calls[${i}]`)
  return raw as ApCallsFile
}

/** Checks a parsed ap-counts-a.json or ap-counts-b.json. */
export function parseApCounts(raw: unknown): ApCountsFile {
  const fail = failer('AP counts file')
  const file = object(fail, raw, 'file')
  if (file.version !== 1) fail('version', 'must be 1')
  oneOf(fail, file.reader, 'reader', ['a', 'b'] as const)
  timestamp(fail, file.checkedAt, 'checkedAt')
  const counts = list(fail, file.counts, 'counts')
  counts.forEach((c, i) => {
    const p = `counts[${i}]`
    const count = object(fail, c, p)
    ids(fail, count.contestIds, `${p}.contestIds`)
    str(fail, count.url, `${p}.url`)
    timestamp(fail, count.asOf, `${p}.asOf`)
    const counted = count.counted
    if (typeof counted !== 'number' || !(counted >= 0 && counted <= 1)) {
      fail(`${p}.counted`, 'must be a share from 0 to 1 (0.81 for 81%)')
    }
    const names = new Set<string>()
    list(fail, count.choices, `${p}.choices`).forEach((ch, j) => {
      const q = `${p}.choices[${j}]`
      const choice = object(fail, ch, q)
      const name = str(fail, choice.name, `${q}.name`)
      if (names.has(name)) fail(`${q}.name`, `repeats "${name}"`)
      names.add(name)
      votes(fail, choice.votes, `${q}.votes`)
    })
  })
  noRepeatedRaces(fail, counts, (i) => `counts[${i}]`)
  return raw as ApCountsFile
}

const CERT_SOURCES = ['chicago', 'cook', 'la', 'ca-sos', 'il-sbe'] as const

/** Checks a parsed certifications.json. */
export function parseCertifications(raw: unknown): CertificationsFile {
  const fail = failer('Certifications file')
  const file = object(fail, raw, 'file')
  if (file.version !== 1) fail('version', 'must be 1')
  const seen = new Map<string, number>()
  list(fail, file.certifications, 'certifications').forEach((c, i) => {
    const p = `certifications[${i}]`
    const cert = object(fail, c, p)
    const source = oneOf(fail, cert.source, `${p}.source`, CERT_SOURCES)
    const first = seen.get(source)
    if (first !== undefined) {
      fail(`${p}.source`, `repeats "${source}" from certifications[${first}]`)
    }
    seen.set(source, i)
    isoDate(fail, cert.on, `${p}.on`)
    link(fail, cert.url, `${p}.url`)
    if (cert.confirmedWinners !== true) {
      fail(
        `${p}.confirmedWinners`,
        'must be true: every winner confirmed against the certified document',
      )
    }
  })
  return raw as CertificationsFile
}
