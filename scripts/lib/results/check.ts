// The checks every results update passes before it ships. Pure: no file
// access and no clock (`now` is an input). Each failure names the race's first
// contest ID, so the message points at the race to look at.

import type { ResultsFile } from '../../../src/shared/raceResults.ts'
import { raceKey } from './inputs.ts'
import type { ApCount, ApCountsFile, MatchEntry, MatchFile } from './inputs.ts'
import type { OfficialFile } from './types.ts'

export interface CheckContext {
  match: MatchFile
  /** The committed version before this update; absent on the first run. */
  previous?: ResultsFile
  /** AP's two separate reads; empty when the area takes no AP counts. */
  apCounts: ApCountsFile[]
  now: string
  /** The downloaded official files, when checking that every contest is used. */
  official?: OfficialFile[]
}

const DAY = 24 * 60 * 60 * 1000
const STALE_AFTER = 3 * DAY
const WRITE_IN = /write-?in/i

const time = (iso: string) => Date.parse(iso)

/** The choices with fewer than `seats` choices strictly ahead of this one lead. */
function leads(
  name: string,
  choices: { name: string; votes: number }[],
  seats: number,
): boolean {
  const own = choices.find((c) => c.name === name)
  if (!own) return false
  return choices.filter((c) => c.votes > own.votes).length < seats
}

function sameCount(a: ApCount, b: ApCount): boolean {
  return (
    time(a.asOf) === time(b.asOf) &&
    a.counted === b.counted &&
    a.choices.length === b.choices.length &&
    a.choices.every((c) =>
      b.choices.some((d) => d.name === c.name && d.votes === c.votes),
    )
  )
}

export function checkResults(
  file: ResultsFile,
  ctx: CheckContext,
): { failures: string[]; warnings: string[] } {
  const failures: string[] = []
  const warnings: string[] = []

  const entries = new Map(
    ctx.match.contests.map((e) => [raceKey(e.contestIds), e]),
  )
  const results = new Map(file.results.map((r) => [raceKey(r.contestIds), r]))
  const previous = new Map(
    (ctx.previous?.results ?? []).map((r) => [raceKey(r.contestIds), r]),
  )

  const apByRace = new Map<string, { a?: ApCount; b?: ApCount }>()
  for (const read of ctx.apCounts) {
    for (const c of read.counts) {
      const key = raceKey(c.contestIds)
      const slot = apByRace.get(key) ?? {}
      slot[read.reader] = c
      apByRace.set(key, slot)
    }
  }

  const entryChecks = (entry: MatchEntry) => {
    const id = entry.contestIds[0]
    if (!results.has(raceKey(entry.contestIds))) {
      failures.push(
        `${id}: the match file has this race but there is no result`,
      )
    }
    if (
      entry.kind === 'candidate' &&
      !(Number.isInteger(entry.voteFor) && (entry.voteFor as number) >= 1)
    ) {
      failures.push(`${id}: the match entry has no voteFor of 1 or more`)
    }
    if (
      entry.kind !== 'candidate' &&
      !(
        typeof entry.threshold === 'number' &&
        entry.threshold > 0 &&
        entry.threshold <= 1
      )
    ) {
      failures.push(
        `${id}: the match entry for a ${entry.kind} has no threshold above 0 and at most 1`,
      )
    }
  }
  ctx.match.contests.forEach(entryChecks)

  for (const result of file.results) {
    const id = result.contestIds[0]
    const key = raceKey(result.contestIds)
    const entry = entries.get(key)
    const fail = (why: string) => failures.push(`${id}: ${why}`)
    if (!entry) {
      fail('the result has no match entry')
      continue
    }

    // The match entry is the authority: the result must say the same.
    for (const field of [
      'kind',
      'scope',
      'voteFor',
      'threshold',
      'certifyBy',
    ] as const) {
      if (result[field] !== entry[field]) {
        fail(
          `the result's ${field} (${JSON.stringify(result[field])}) differs from the match entry's (${JSON.stringify(entry[field])})`,
        )
      }
    }
    if (
      entry.kind !== 'candidate' &&
      result.status !== 'no_count' &&
      (result.choices.length !== 2 ||
        result.choices[0].name !== 'Yes' ||
        result.choices[1].name !== 'No')
    ) {
      fail(`the ${entry.kind} result's choices must be exactly Yes, then No`)
    }

    for (const c of result.choices) {
      if (!entry.ballotOrder.includes(c.name)) {
        fail(`the choice "${c.name}" is not in the ballot order`)
      }
    }

    const winners = result.winners ?? []
    if (
      (result.status === 'called' || result.status === 'certified') &&
      winners.length === 0
    ) {
      fail(`the ${result.status} result has no winners`)
    }
    const seats = entry.voteFor
    if (
      entry.kind === 'candidate' &&
      seats !== undefined &&
      winners.length > seats
    ) {
      fail(
        `${winners.length} winners for ${seats} seat${seats === 1 ? '' : 's'}`,
      )
    }
    for (const w of winners) {
      if (WRITE_IN.test(w)) fail(`the write-in "${w}" is recorded as a winner`)
      else if (
        result.status === 'certified' &&
        !result.choices.some((c) => c.name === w)
      ) {
        fail(`the certified winner "${w}" is not among the choices`)
      }
    }

    if (result.status === 'certified' && !result.certified) {
      fail('the result is certified but has no certification')
    }

    // A called winner must lead in the counts shown, and in AP's reads.
    if (
      entry.kind === 'candidate' &&
      result.call &&
      seats !== undefined &&
      seats >= 1
    ) {
      const ap = apByRace.get(key)
      for (const w of winners) {
        if (WRITE_IN.test(w)) continue
        if (!leads(w, result.choices, seats)) {
          fail(`AP's winner "${w}" is not leading in the counts`)
        }
        for (const read of [ap?.a, ap?.b]) {
          if (read && !leads(w, read.choices, seats)) {
            fail(`AP's winner "${w}" is not leading in AP's counts`)
            break
          }
        }
      }
    }

    const before = previous.get(key)
    if (before) {
      for (const old of before.choices) {
        const now = result.choices.find((c) => c.name === old.name)
        if (!now) {
          fail(`"${old.name}" was in the previous file but is missing now`)
        } else if (now.votes < old.votes) {
          fail(
            `"${old.name}" has ${now.votes} votes, fewer than the ${old.votes} in the previous file`,
          )
        }
      }
      for (const old of before.sources) {
        const now = result.sources.find((s) => s.name === old.name)
        if (!now) {
          fail(
            `the ${old.name} source was in the previous file but is missing now`,
          )
        } else if (time(now.asOf) < time(old.asOf)) {
          fail(
            `the ${old.name} source is as of ${now.asOf}, earlier than ${old.asOf} in the previous file`,
          )
        }
      }
    }

    if (result.status === 'counting' && result.sources.length > 0) {
      const newest = Math.max(...result.sources.map((s) => time(s.asOf)))
      if (time(ctx.now) - newest > STALE_AFTER) {
        warnings.push(
          `${id}: still counting, but its newest source is from ${new Date(newest).toISOString()}, more than 3 days ago`,
        )
      }
    }
  }

  // Pair each previous race with the new results that share any contest ID. A
  // race regrouped on purpose (merged or split) is warned about, not compared.
  for (const [key, before] of previous) {
    if (results.has(key)) continue
    const paired = file.results.filter((r) =>
      r.contestIds.some((id) => before.contestIds.includes(id)),
    )
    if (paired.length === 0) {
      failures.push(
        `${before.contestIds[0]}: the race was in the previous file but is missing now`,
      )
    } else {
      warnings.push(
        `${before.contestIds[0]}: regrouped: was [${before.contestIds.join(', ')}], now ${paired.map((r) => `[${r.contestIds.join(', ')}]`).join(' and ')}`,
      )
    }
  }

  // Every Cook race beyond the county that takes AP's count needs it in both reads.
  if (ctx.match.area === 'cook') {
    for (const entry of ctx.match.contests) {
      if (entry.scope !== 'beyond' || !entry.apUrl || entry.noOfficialCount) {
        continue
      }
      const slot = apByRace.get(raceKey(entry.contestIds))
      if (!slot?.a || !slot.b) {
        failures.push(
          `${entry.contestIds[0]}: AP's count is missing from reader ${!slot?.a ? 'a' : 'b'}${!slot?.a && !slot?.b ? ' and b' : ''}`,
        )
      }
    }
  }

  for (const { a, b } of apByRace.values()) {
    if (!a || !b || !sameCount(a, b)) {
      const ids = (a ?? b)!.contestIds
      failures.push(
        `${ids[0]}: AP reads a and b differ${!a || !b ? ' (only one reader has this race)' : ''}`,
      )
    }
  }

  // An official contest no match entry uses is a renamed or new contest that
  // would drop a race. California's state files carry whole lists, so only the
  // three office files are held to this.
  if (ctx.official) {
    const used = new Set(
      ctx.match.contests.flatMap((e) =>
        e.official.map((o) => `${o.source} ${o.title}`),
      ),
    )
    for (const f of ctx.official) {
      if (f.source === 'ca-sos') continue
      for (const c of f.contests) {
        if (!used.has(`${f.source} ${c.title}`)) {
          failures.push(
            `${f.source} has a contest "${c.title}" that no match entry uses`,
          )
        }
      }
    }
  }

  return { failures, warnings }
}
