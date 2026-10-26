// Campaign money for every candidate profile, from official filings:
// the FEC for U.S. Senate and House, the Illinois State Board of Elections for
// everything else. Reads the contest files from `npm run data:build`, finds
// each person's campaign committee and writes data/build/profiles/money.json.
// People it can't match with confidence are listed under `unmatched` with the
// reason, never guessed. Downloads are cached in data/raw/money/ for a day.
// Each summary breaks the money raised down by kind of source (gifts, PACs,
// transfers, loans, the candidate); no donor is ever named.
// Run: node scripts/profiles/money.ts [--region=<id>] [--refresh]

import { join } from 'node:path'
import type { Contest } from '../../src/shared/ballot.ts'
import { CURRENT_ELECTION } from '../../src/shared/cook.ts'
import { chicagoDate } from '../../src/shared/dates.ts'
import {
  profileKey,
  type MoneySectionData,
  type MoneySummary,
} from '../../src/shared/profile.ts'
import { BUILD, RAW, readJson, writeJson } from '../lib/data.ts'
import {
  downloadFec,
  fecSummary,
  loadFec,
  matchFecCandidates,
  principalCommittee,
} from '../lib/profiles/fec.ts'
import {
  a1sAfter,
  committeesByName,
  committeeUrl,
  committeesFor,
  downloadIsbe,
  isbeSummary,
  isJudgesRetentionCommittee,
  largeSince,
  latestQuarterly,
  loadIsbeIndex,
  loadReceipts,
  loadReports,
  loadTotals,
  matchIsbeCandidates,
  otherCommitteesFor,
  quarterliesOf,
  shownQuarterly,
  type IsbeCommittee,
  type IsbeReport,
} from '../lib/profiles/isbe.ts'
import { parseBallotName, type ParsedName } from '../lib/profiles/names.ts'
import { seatFor, type Seat } from '../lib/profiles/seats.ts'
import { COOK } from '../../src/shared/regions.ts'
import { MONEY, readSubjects } from '../lib/profiles/content.ts'
import { collectMoney, type MoneyPerson } from '../lib/profiles/money-ca.ts'
import { MONEY_MODULES } from '../lib/profiles/money-sources.ts'
import { REGION } from '../lib/profiles/region.ts'

const MAX_AGE_HOURS = process.argv.includes('--refresh') ? 0 : 24
const FEC_DIR = join(RAW, 'money', 'fec')
const ISBE_DIR = join(RAW, 'money', 'isbe')
const YEAR = Number(CURRENT_ELECTION.date.slice(0, 4))
// A Chicago date, so a report filed today counts on a Chicago evening.
const today = chicagoDate()

interface Person {
  key: string
  name: string
  ballot: ParsedName
  seat: Seat | null
  offices: Set<string>
}

export interface MoneyEntry {
  summaries: MoneySummary[]
  matchedCommittee?: string
  /** The joint committee a judge up for retention campaigns through, when they have none of their own. */
  sharedCommittee?: MoneySectionData['sharedCommittee']
  /** No active committee of their own on file (see MoneySectionData). */
  noCommittee?: MoneySectionData['noCommittee']
  note?: string
}

export interface MoneyFile {
  generatedAt: string
  byKey: Record<string, MoneyEntry>
  unmatched: { key: string; name: string; office: string; reason: string }[]
}

// Other regions: their own source modules (money-sources.ts), on the
// people in their subjects file.
if (REGION.id !== COOK.id) {
  const modules = MONEY_MODULES[REGION.id]
  if (!modules)
    throw new Error(
      `No money sources for ${REGION.id}; add them to scripts/lib/profiles/money-sources.ts`,
    )
  const { subjects } = await readSubjects()
  const people: MoneyPerson[] = subjects.map((s) => ({
    key: s.key,
    name: s.name,
    ballot: parseBallotName(s.name),
    office: s.office,
    officeType: s.officeType,
    districtId: s.districtId,
    contestIds: s.contestIds,
  }))
  const file = await collectMoney(people, modules(), {
    maxAgeHours: MAX_AGE_HOURS,
    today,
    year: Number(REGION.election.date.slice(0, 4)),
  })
  await writeJson(MONEY, file)
  const withReport = Object.values(file.byKey).filter((e) => e.summaries.length)
  console.log(
    `${REGION.id}: ${people.length} people; ${withReport.length} with a report, ${Object.keys(file.byKey).length - withReport.length} matched without one, ${file.unmatched.length} unmatched`,
  )
  console.log('  by source:', file.bySource)
  const reasons = new Map<string, number>()
  for (const u of file.unmatched)
    reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1)
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`  unmatched ${n} × ${r}`)
  process.exit(0)
}

// 1. Everyone on the ballot, once per person.
const people = new Map<string, Person>()
for (const file of ['cook-clerk', 'chicago-boe']) {
  const { contests } = await readJson<{ contests: Contest[] }>(
    join(BUILD, 'contests', `${file}.json`),
  )
  for (const contest of contests) {
    const names =
      contest.kind === 'candidate'
        ? contest.candidates.map((c) => c.name)
        : contest.kind === 'retention'
          ? [contest.judge]
          : []
    for (const name of names) {
      const key = profileKey(name)
      const person = people.get(key) ?? {
        key,
        name,
        ballot: parseBallotName(name),
        seat: seatFor(contest),
        offices: new Set<string>(),
      }
      person.offices.add(contest.title)
      people.set(key, person)
    }
  }
}
console.log(`${people.size} people on the ballot`)

const byKey: Record<string, MoneyEntry> = {}
const unmatched: MoneyFile['unmatched'] = []
const office = (p: Person) => [...p.offices][0]
const miss = (p: Person, reason: string) =>
  unmatched.push({ key: p.key, name: p.name, office: office(p), reason })

// 2. Federal races: FEC bulk files.
await downloadFec(FEC_DIR, MAX_AGE_HOURS)
const fec = await loadFec(FEC_DIR)
for (const p of people.values()) {
  if (p.seat?.level !== 'federal') continue
  const matches = matchFecCandidates(p.ballot, p.seat, fec.candidates)
  if (matches.length === 0) {
    miss(p, 'No FEC candidate with this name for this seat')
    continue
  }
  // A person sometimes has several candidate IDs (one per filing); only the
  // one with a funded committee counts.
  const funded = matches.flatMap((m) => {
    const summary = fecSummary(m, fec)
    return summary ? [{ m, summary }] : []
  })
  if (funded.length > 1) {
    miss(
      p,
      `Several FEC candidates with reports match: ${funded.map((f) => f.m.id).join(', ')}`,
    )
    continue
  }
  if (funded.length === 0) {
    byKey[p.key] = {
      summaries: [],
      noCommittee: { filedWith: 'Federal Election Commission' },
      note: `No campaign committee reports with the FEC for ${YEAR} (candidate ${matches.map((m) => m.id).join(', ')}).`,
    }
    continue
  }
  const { m, summary } = funded[0]
  byKey[p.key] = {
    summaries: [summary],
    matchedCommittee: principalCommittee(m.id, fec.committees)?.id,
  }
}

// 3. State and local races: ISBE data files.
await downloadIsbe(ISBE_DIR, MAX_AGE_HOURS)
const index = await loadIsbeIndex(ISBE_DIR)
const committeesByKey = new Map<string, IsbeCommittee[]>()
const byNameOnly = new Set<string>()
for (const p of people.values()) {
  if (!p.seat) {
    miss(p, 'Office not mapped to a filing office')
    continue
  }
  if (p.seat.level === 'federal') continue
  const matches = matchIsbeCandidates(p.ballot, p.seat, index.candidates, YEAR)
  let committees = committeesFor(matches, index)
  if (committees.length === 0) {
    const fallback = committeesByName(p.ballot, index)
    if (fallback.length === 1) {
      committees = fallback
      byNameOnly.add(p.key)
    } else if (fallback.length > 1) {
      miss(
        p,
        `No record for this office; several committees match by name: ${fallback.map((c) => c.id).join(', ')}`,
      )
      continue
    }
  }
  if (matches.length === 0 && committees.length === 0) {
    miss(
      p,
      p.seat.level === 'judge' && p.seat.retention
        ? 'No ISBE candidate record (judges up for retention rarely have a committee)'
        : 'No ISBE candidate record with this name for this office',
    )
    continue
  }
  if (committees.length === 0) {
    const shared = otherCommitteesFor(matches, index)
    const joint =
      p.seat.level === 'judge' &&
      p.seat.retention &&
      shared.length > 0 &&
      shared.every(isJudgesRetentionCommittee)
    byKey[p.key] = {
      summaries: [],
      ...(joint
        ? {
            sharedCommittee: {
              name: shared[0].name,
              url: committeeUrl(shared[0].id),
            },
          }
        : { noCommittee: { filedWith: 'Illinois State Board of Elections' } }),
      note:
        shared.length > 0
          ? `No campaign committee of their own on file; linked only to ${shared.map((c) => c.name).join(', ')}, which also supports other candidates.`
          : 'On file with ISBE as a candidate but no active campaign committee.',
    }
    continue
  }
  committeesByKey.set(p.key, committees)
}

const allCommittees = new Set(
  [...committeesByKey.values()].flat().map((c) => c.id),
)
const reports = await loadReports(ISBE_DIR, allCommittees)

// The committee to show: the candidate committee with the latest quarterly.
const chosen = new Map<
  string,
  { committee: IsbeCommittee; quarterly?: IsbeReport; others: number }
>()
for (const [key, committees] of committeesByKey) {
  const withReport = committees
    .map((committee) => ({
      committee,
      quarterly: latestQuarterly(reports, committee.id, today),
    }))
    .sort(
      (a, b) =>
        Number(b.committee.type === 'Candidate') -
          Number(a.committee.type === 'Candidate') ||
        (b.quarterly?.end ?? '').localeCompare(a.quarterly?.end ?? ''),
    )
  chosen.set(key, { ...withReport[0], others: committees.length - 1 })
}

const totals = await loadTotals(
  ISBE_DIR,
  new Set(
    [...chosen.values()].flatMap((c) =>
      quarterliesOf(reports, c.committee.id, today).map((r) => r.id),
    ),
  ),
)
// The latest quarterly with totals; a newer one still being keyed in waits.
const shown = new Map(
  [...chosen].map(([key, c]) => [
    key,
    shownQuarterly(reports, c.committee.id, today, (id) => totals.has(id)),
  ]),
)
const quarterlyIds = new Set(
  [...shown.values()].flatMap((s) => (s.quarterly ? [s.quarterly.id] : [])),
)
const a1Ids = new Set<string>()
// Each report's candidate, to find money they gave or lent their own committee.
const candidateOf = new Map<string, ParsedName>()
for (const [key, c] of chosen) {
  const quarterly = shown.get(key)!.quarterly
  if (!quarterly) continue
  const ballot = people.get(key)!.ballot
  candidateOf.set(quarterly.id, ballot)
  for (const r of a1sAfter(reports, c.committee.id, quarterly.end)) {
    a1Ids.add(r.id)
    candidateOf.set(r.id, ballot)
  }
}
console.log(`Reading receipts for ${quarterlyIds.size + a1Ids.size} reports…`)
const receipts = await loadReceipts(
  ISBE_DIR,
  new Set([...quarterlyIds, ...a1Ids]),
  candidateOf,
)

for (const [key, { committee, others }] of chosen) {
  const { quarterly, pending } = shown.get(key)!
  const notes: string[] = []
  if (byNameOnly.has(key))
    notes.push(
      "Matched by name and committee name: ISBE's candidate record for this committee lists a different office.",
    )
  if (others > 0)
    notes.push(
      `${others} other active committee${others > 1 ? 's' : ''} linked to this candidate; showing ${committee.name}.`,
    )
  const t = quarterly && totals.get(quarterly.id)
  const entry: MoneyEntry =
    quarterly && t
      ? {
          summaries: [
            isbeSummary(
              committee,
              quarterly,
              t,
              receipts.fromCandidate?.get(quarterly.id),
            ),
          ],
          matchedCommittee: committee.id,
        }
      : { summaries: [], matchedCommittee: committee.id }
  if (pending)
    notes.unshift(
      `${committee.name} filed a quarterly report for ${pending.start} to ${pending.end} on ${pending.filed}, but ISBE's data files don't have its figures yet${quarterly ? '; showing the one before it' : ''}.`,
    )
  else if (!quarterly || !t)
    notes.unshift(`${committee.name} has not filed a quarterly report yet.`)
  // Large contributions reported since the quarter ended. Without a
  // quarterly there's no summary to add them to.
  if (quarterly && t) {
    const large = largeSince(
      quarterly.end,
      a1sAfter(reports, committee.id, quarterly.end),
      receipts,
    )
    if (large) entry.summaries[0].largeSince = large
  }
  if (notes.length > 0) entry.note = notes.join(' ')
  byKey[key] = entry
}

const out: MoneyFile = {
  generatedAt: new Date().toISOString(),
  byKey,
  unmatched: unmatched.sort((a, b) => a.key.localeCompare(b.key)),
}
await writeJson(join(BUILD, 'profiles', 'money.json'), out)

const withMoney = Object.values(byKey).filter((e) => e.summaries.length > 0)
const periods = new Map<string, number>()
for (const e of withMoney)
  for (const s of e.summaries)
    periods.set(
      `${s.source} ${s.period}`,
      (periods.get(`${s.source} ${s.period}`) ?? 0) + 1,
    )
console.log(
  `${Object.keys(byKey).length} matched (${withMoney.length} with a report), ${unmatched.length} unmatched of ${people.size}`,
)
for (const [period, n] of [...periods].sort((a, b) => b[1] - a[1]).slice(0, 8))
  console.log(`  ${n} × ${period}`)
// The candidate's own money, largest first, for review.
const own = Object.entries(byKey)
  .map(([key, e]) => {
    const s = e.summaries[0]
    return {
      key,
      amount: (s?.fromCandidate ?? 0) + (s?.largeSince?.fromCandidate ?? 0),
    }
  })
  .filter((o) => o.amount > 0)
  .sort((a, b) => b.amount - a.amount)
console.log(`${own.length} with money from the candidate:`)
for (const o of own.slice(0, 10))
  console.log(`  ${o.key}: $${Math.round(o.amount).toLocaleString('en-US')}`)
// Reports whose parts don't add up to their total get no breakdown.
const noBreakdown = Object.entries(byKey).filter(([, e]) =>
  e.summaries.some((s) => !s.breakdown),
)
console.log(
  `${noBreakdown.length} without a breakdown (parts don't add up)${noBreakdown.length ? ':' : ''}`,
)
for (const [key] of noBreakdown) console.log(`  ${key}`)
