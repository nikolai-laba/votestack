// Turns the official counts, AP's calls and counts, and the certifications
// into one area's results file (content/results/). Pure: the CLI
// (scripts/results-build.ts) reads the files and passes the time in.
//
// Per race, in order:
// - Counts. A race marked noOfficialCount has none. An Illinois race that
//   crosses county lines takes AP's district-wide count, only when reads a
//   and b agree exactly; otherwise it has none. Any other race adds its
//   official contests per our name (Chicago plus the Clerk for countywide
//   races), or takes only the Secretary of State's when it lists one.
//   Fails closed: every name in a used count must be matched (or be a
//   write-in row, which is left out), and every ballot-order name must be in
//   it, or the build throws.
// - Status. No count: no_count. Certified by every office whose count it
//   uses (the Secretary of State for an LA race across the county line):
//   certified, winners from the count (never anyone with 0 votes). Illinois
//   races across county lines are never certified here (no reader yet for the
//   State Board's canvass). Else AP's call: called with AP's winners (checked
//   against the race), or too_close; withdrawn or no call: counting.

import type { IsoDate } from '../../../src/shared/ballot.ts'
import { passes } from '../../../src/shared/raceResults.ts'
import type {
  RaceResult,
  ResultChoice,
  ResultSource,
  ResultsFile,
} from '../../../src/shared/raceResults.ts'
import { resultsOffices } from '../../../src/shared/results.ts'
import { raceKey } from './inputs.ts'
import type {
  ApCall,
  ApCallsFile,
  ApCount,
  ApCountsFile,
  Certification,
  CertificationsFile,
  MatchEntry,
  MatchFile,
} from './inputs.ts'
import type { OfficialContest, OfficialFile, OfficialSource } from './types.ts'

export interface BuildInputs {
  match: MatchFile
  official: OfficialFile[]
  apCalls: ApCallsFile
  apCounts: [ApCountsFile, ApCountsFile] | []
  certifications: CertificationsFile
  previous?: ResultsFile
  now: string
}

const [CHICAGO, COOK, LA] = resultsOffices([
  'chicago',
  'suburban-cook',
  'los-angeles-county',
])

const OFFICES: Record<OfficialSource, { name: string; url: string }> = {
  chicago: CHICAGO,
  cook: COOK,
  la: LA,
  'ca-sos': {
    name: 'California Secretary of State',
    url: 'https://electionresults.sos.ca.gov/',
  },
}

/** The order sources are listed in. */
const SOURCE_ORDER: OfficialSource[] = ['chicago', 'cook', 'la', 'ca-sos']

const iso = (time: string) => new Date(time).toISOString()

/** Rows dropped without a match ("Write-in", "Write-In: Lee Chen", "Write-ins"). */
const WRITE_IN = /write-?in/i

/** Where an area's kept input lives, for error messages. */
const inputFile = (area: MatchFile['area'], name: string) =>
  `content/results-inputs/${area}/${name}.json`

const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a)

interface Count {
  choices: ResultChoice[]
  sources: ResultSource[]
  /** The offices whose counts these are; none for AP's. */
  offices: OfficialSource[]
}

interface Used {
  source: OfficialSource
  file: OfficialFile
  contest: OfficialContest
}

/** The one downloaded contest with this source and title. */
function findContest(
  id: string,
  official: OfficialFile[],
  source: OfficialSource,
  title: string,
): Used {
  const hits = official
    .filter((f) => f.source === source)
    .flatMap((file) =>
      file.contests
        .filter((c) => c.title === title)
        .map((contest) => ({ source, file, contest })),
    )
  if (hits.length === 0) {
    throw new Error(
      `${id}: no ${source} contest titled "${title}" in the downloads`,
    )
  }
  if (hits.length > 1) {
    throw new Error(
      `${id}: ${hits.length} ${source} contests are titled "${title}"`,
    )
  }
  return hits[0]
}

/**
 * Adds the used contests per our name. Fails closed: every official name must
 * be matched in `names` or be a write-in, and every ballot-order name must be
 * in every contest, so a renamed or missed candidate stops the build instead
 * of losing votes.
 */
function officialCount(
  area: MatchFile['area'],
  entry: MatchEntry,
  used: Used[],
): Count {
  const where = `${inputFile(area, 'match')}: ${entry.contestIds[0]}`
  const totals = new Map<string, number>()
  for (const { source, contest } of used) {
    const what = `${source} contest "${contest.title}"`
    const reached = new Set<string>()
    for (const c of contest.choices) {
      if (!Object.hasOwn(entry.names, c.name)) {
        if (WRITE_IN.test(c.name)) continue
        throw new Error(
          `${where}: ${what} has "${c.name}", which has no entry in names and isn't a write-in`,
        )
      }
      const ours = entry.names[c.name]
      if (!entry.ballotOrder.includes(ours)) {
        throw new Error(
          `${where}: ${what} has "${c.name}", which maps to "${ours}", not in ballotOrder`,
        )
      }
      reached.add(ours)
      totals.set(ours, (totals.get(ours) ?? 0) + c.votes)
    }
    for (const name of entry.ballotOrder) {
      if (!reached.has(name)) {
        throw new Error(`${where}: ${what} has no choice for "${name}"`)
      }
    }
  }
  const files = [...new Set(used.map((u) => u.file))].sort(
    (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
  )
  return {
    choices: entry.ballotOrder.map((name) => ({
      name,
      votes: totals.get(name) ?? 0,
    })),
    sources: files.map((f) => ({
      name: OFFICES[f.source].name,
      url: OFFICES[f.source].url,
      retrievedAt: f.retrievedAt,
      official: true,
      asOf: f.asOf,
    })),
    offices: [...new Set(used.map((u) => u.source))],
  }
}

function sameCount(a: ApCount, b: ApCount): boolean {
  if (Date.parse(a.asOf) !== Date.parse(b.asOf)) return false
  if (a.counted !== b.counted) return false
  if (a.choices.length !== b.choices.length) return false
  return a.choices.every((c) =>
    b.choices.some((d) => d.name === c.name && d.votes === c.votes),
  )
}

interface ApReads {
  a: ApCountsFile
  b: ApCountsFile
  byRace: { a: Map<string, ApCount>; b: Map<string, ApCount> }
}

function apReads(apCounts: BuildInputs['apCounts']): ApReads | undefined {
  if (apCounts.length === 0) return undefined
  const a = apCounts.find((r) => r.reader === 'a')
  const b = apCounts.find((r) => r.reader === 'b')
  if (!a || !b) {
    throw new Error(
      'AP counts: need one read from reader a and one from reader b',
    )
  }
  const index = (read: ApCountsFile) => {
    const map = new Map<string, ApCount>()
    for (const c of read.counts) {
      const key = raceKey(c.contestIds)
      if (map.has(key)) {
        throw new Error(
          `AP counts (reader ${read.reader}): ${c.contestIds.join(', ')} is counted twice`,
        )
      }
      map.set(key, c)
    }
    return map
  }
  return { a, b, byRace: { a: index(a), b: index(b) } }
}

function apCount(
  area: MatchFile['area'],
  entry: MatchEntry,
  reads: ApReads | undefined,
): Count | undefined {
  if (!entry.apUrl || !reads) return undefined
  const key = raceKey(entry.contestIds)
  const a = reads.byRace.a.get(key)
  const b = reads.byRace.b.get(key)
  if (!a || !b || !sameCount(a, b)) return undefined
  // AP's reads use our names. Fails closed like the official counts.
  const where = `${inputFile(area, 'match')}: ${entry.contestIds[0]}: AP count`
  for (const c of a.choices) {
    if (!entry.ballotOrder.includes(c.name) && !WRITE_IN.test(c.name)) {
      throw new Error(
        `${where} has "${c.name}", which is not in ballotOrder and isn't a write-in`,
      )
    }
  }
  for (const name of entry.ballotOrder) {
    if (!a.choices.some((c) => c.name === name)) {
      throw new Error(`${where} has no choice for "${name}"`)
    }
  }
  return {
    choices: entry.ballotOrder.map((name) => ({
      name,
      votes: a.choices.find((c) => c.name === name)?.votes ?? 0,
    })),
    sources: [
      {
        name: 'AP',
        url: entry.apUrl,
        retrievedAt: iso(later(reads.a.checkedAt, reads.b.checkedAt)),
        official: false,
        asOf: iso(a.asOf),
        counted: a.counted,
      },
    ],
    offices: [],
  }
}

/** Winners from a certified count: the top voteFor (all tied at the last seat), or Yes or No by the threshold. */
function countWinners(entry: MatchEntry, choices: ResultChoice[]): string[] {
  const id = entry.contestIds[0]
  if (entry.kind === 'candidate') {
    if (entry.voteFor === undefined) throw new Error(`${id}: no voteFor`)
    const sorted = [...choices].sort((x, y) => y.votes - x.votes)
    const last = sorted[Math.min(entry.voteFor, sorted.length) - 1]
    if (!last) return []
    // No one wins with 0 votes (as no one leads with 0, in resultView).
    return choices
      .filter((c) => c.votes > 0 && c.votes >= last.votes)
      .map((c) => c.name)
  }
  if (entry.threshold === undefined) throw new Error(`${id}: no threshold`)
  const total = choices.reduce((sum, c) => sum + c.votes, 0)
  const yes = choices.find((c) => c.name === 'Yes')?.votes ?? 0
  return passes(total === 0 ? 0 : yes / total, entry.threshold)
    ? ['Yes']
    : ['No']
}

/** AP's winners must fit the race: Yes or No for judges and measures; our names, once each, within the seats. */
function checkCall(area: MatchFile['area'], entry: MatchEntry, call: ApCall) {
  const { winners, status } = call
  const bad = (why: string) =>
    new Error(
      `${inputFile(area, 'ap-calls')}: ${entry.contestIds[0]}: AP's winners ${JSON.stringify(winners)} ${why}`,
    )
  if (status !== 'called') {
    if (winners.length > 0) {
      throw bad(`are listed, but a ${status} call has no winners`)
    }
    return
  }
  if (entry.kind !== 'candidate') {
    if (winners.length !== 1 || (winners[0] !== 'Yes' && winners[0] !== 'No')) {
      throw bad('must be ["Yes"] or ["No"]')
    }
    return
  }
  if (winners.length === 0) {
    throw bad('are empty, but a called race needs its winners')
  }
  winners.forEach((w, i) => {
    if (winners.indexOf(w) !== i) throw bad(`names "${w}" twice`)
    if (!entry.ballotOrder.includes(w)) {
      throw bad(`include "${w}", who is not in ballotOrder`)
    }
  })
  const seats = entry.voteFor
  if (seats === undefined) throw bad("need the race's voteFor")
  if (winners.length > seats) {
    throw bad(
      `are ${winners.length} winners for ${seats} seat${seats === 1 ? '' : 's'}`,
    )
  }
}

const sameWinners = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

const sameVotes = (a: ResultChoice[], b: ResultChoice[]) =>
  a.length === b.length &&
  a.every((c, i) => c.name === b[i].name && c.votes === b[i].votes)

export function buildResults(inputs: BuildInputs): ResultsFile {
  const { match, official, previous, now } = inputs
  if (previous && previous.electionId !== match.electionId) {
    throw new Error(
      `The previous results file is for ${previous.electionId}, not ${match.electionId}`,
    )
  }
  const illinois = match.area === 'cook'
  const entries = new Map(match.contests.map((e) => [raceKey(e.contestIds), e]))
  const takesApCounts = (e: MatchEntry) =>
    illinois && e.scope === 'beyond' && !!e.apUrl && !e.noOfficialCount

  const calls = new Map<string, ApCall>()
  for (const c of inputs.apCalls.calls) {
    const key = raceKey(c.contestIds)
    const entry = entries.get(key)
    if (!entry) {
      throw new Error(
        `AP calls: no race in the match file has contest IDs ${c.contestIds.join(', ')}`,
      )
    }
    if (calls.has(key)) {
      throw new Error(`AP calls: ${c.contestIds.join(', ')} is called twice`)
    }
    checkCall(match.area, entry, c)
    calls.set(key, c)
  }

  const reads = apReads(inputs.apCounts)
  for (const read of reads ? [reads.a, reads.b] : []) {
    for (const c of read.counts) {
      const entry = entries.get(raceKey(c.contestIds))
      if (!entry) {
        throw new Error(
          `AP counts (reader ${read.reader}): no race in the match file has contest IDs ${c.contestIds.join(', ')}`,
        )
      }
      if (!takesApCounts(entry)) {
        throw new Error(
          `AP counts (reader ${read.reader}): ${entry.contestIds[0]} doesn't take AP's count (only Illinois races beyond Cook with an apUrl do)`,
        )
      }
    }
  }

  const certs = new Map<Certification['source'], Certification>()
  for (const c of inputs.certifications.certifications) {
    if (certs.has(c.source)) {
      throw new Error(`Certifications: ${c.source} is listed twice`)
    }
    certs.set(c.source, c)
  }

  /** The latest of the certifications a race needs, when it has them all. */
  function certification(
    entry: MatchEntry,
    count: Count,
  ): { on: IsoDate; url: string } | undefined {
    if (illinois && entry.scope === 'beyond') return undefined
    const needed: Certification['source'][] =
      entry.scope === 'beyond' ? ['ca-sos'] : count.offices
    if (needed.length === 0) return undefined
    const found = needed.map((s) => certs.get(s))
    if (found.some((c) => !c)) return undefined
    const latest = (found as Certification[]).reduce((best, c) =>
      c.on > best.on ? c : best,
    )
    return { on: latest.on, url: latest.url }
  }

  const previousById = new Map(
    (previous?.results ?? []).map((r) => [r.contestIds[0], r]),
  )

  const results = match.contests.map((entry): RaceResult => {
    const id = entry.contestIds[0]
    // Every listed official contest must be in the downloads, used or not:
    // a missing one means the download or the match changed.
    const listed = entry.official.map((o) =>
      findContest(id, official, o.source, o.title),
    )
    if (entry.scope === 'within') {
      const partial = listed.find((u) => u.contest.countyOnly)
      if (partial) {
        throw new Error(
          `${id}: LA marks "${partial.contest.title}" "Los Angeles County Results Only", so the race can't be within the county`,
        )
      }
    }

    let count: Count | undefined
    if (entry.noOfficialCount) count = undefined
    else if (illinois && entry.scope === 'beyond') {
      count = apCount(match.area, entry, reads)
    } else {
      const sos = listed.filter((u) => u.source === 'ca-sos')
      count = officialCount(match.area, entry, sos.length > 0 ? sos : listed)
    }

    let status: RaceResult['status']
    let winners: string[] | undefined
    let call: RaceResult['call']
    let certified: RaceResult['certified']
    if (!count) status = 'no_count'
    else {
      certified = certification(entry, count)
      const apCall = calls.get(raceKey(entry.contestIds))
      if (certified) {
        status = 'certified'
        winners = countWinners(entry, count.choices)
      } else if (apCall?.status === 'called') {
        status = 'called'
        winners = [...apCall.winners]
        call = { by: 'AP', at: iso(apCall.at), url: apCall.url }
      } else if (apCall?.status === 'too_close') status = 'too_close'
      else status = 'counting'
    }
    const choices = count?.choices ?? []

    const before = previousById.get(id)
    const changedAt =
      before &&
      before.status === status &&
      sameWinners(before.winners, winners) &&
      sameVotes(before.choices, choices)
        ? before.changedAt
        : now

    return {
      contestIds: [...entry.contestIds],
      kind: entry.kind,
      status,
      ...(entry.voteFor !== undefined ? { voteFor: entry.voteFor } : {}),
      ...(entry.threshold !== undefined ? { threshold: entry.threshold } : {}),
      choices,
      ...(winners ? { winners } : {}),
      ...(call ? { call } : {}),
      ...(certified ? { certified } : {}),
      certifyBy: entry.certifyBy,
      scope: entry.scope,
      sources: count?.sources ?? [],
      changedAt,
    }
  })

  const first = (r: RaceResult) => r.contestIds[0]
  results.sort((a, b) =>
    first(a) < first(b) ? -1 : first(a) > first(b) ? 1 : 0,
  )
  return { version: 1, electionId: match.electionId, checkedAt: now, results }
}
