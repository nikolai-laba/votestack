import { zonedToIso } from './time.ts'
import { parseVotes } from './types.ts'
import type { OfficialContest, OfficialFile } from './types.ts'

export const CA_SOS_BASE = 'https://api.sos.ca.gov/returns/'

const fail = (what: string) => new Error(`ca-sos: ${what}`)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** "November 4, 2026, 8:08 a.m." (Pacific, no zone) to a UTC ISO string. */
function parseReportingTime(raw: unknown): string {
  const m =
    typeof raw === 'string'
      ? raw
          .trim()
          .match(
            /^([A-Za-z]+) (\d{1,2}), (\d{4}), (\d{1,2})(?::(\d{2}))? ([ap])\.?m\.?$/i,
          )
      : null
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  const hour12 = m ? Number(m[4]) : 0
  if (!m || month < 0 || hour12 < 1 || hour12 > 12) {
    throw fail(`unreadable ReportingTime: ${JSON.stringify(raw)}`)
  }
  const hour = (hour12 % 12) + (m[6].toLowerCase() === 'p' ? 12 : 0)
  return zonedToIso(
    {
      year: Number(m[3]),
      month: month + 1,
      day: Number(m[2]),
      hour,
      minute: Number(m[5] ?? 0),
      second: 0,
    },
    'America/Los_Angeles',
  )
}

const votes = (raw: unknown): number => {
  if (typeof raw !== 'string') throw fail('votes field is not a string')
  return parseVotes('ca-sos', raw)
}

/** Reads one California Secretary of State API file (`path` is relative to CA_SOS_BASE). */
export function readCaSos(
  json: unknown,
  path: string,
  retrievedAt: string,
): OfficialFile {
  if (!isRecord(json)) throw fail('not a JSON object')
  const asOf = parseReportingTime(json.ReportingTime)
  const contests: OfficialContest[] = []

  if ('candidates' in json) {
    if (!Array.isArray(json.candidates)) throw fail('candidates is not a list')
    const choices = json.candidates.map((c: unknown) => {
      if (!isRecord(c) || typeof c.Name !== 'string' || !c.Name) {
        throw fail('a candidate has no Name')
      }
      return { name: c.Name, votes: votes(c.Votes) }
    })
    if (choices.length === 0) throw fail('no candidates')
    contests.push({ title: path, choices })
  } else {
    const key = path.split('/')[0]
    const list = json[key]
    if (!Array.isArray(list)) throw fail(`no "${key}" list or candidates found`)
    for (const e of list) {
      const id = isRecord(e)
        ? key === 'ballot-measures'
          ? e.Number
          : e.Name
        : undefined
      if (!isRecord(e) || typeof id !== 'string' || !id) {
        throw fail(
          `an entry in "${key}" has no ${key === 'ballot-measures' ? 'Number' : 'Name'}`,
        )
      }
      contests.push({
        title: `${path}#${id}`,
        choices: [
          { name: 'YES', votes: votes(e.yesVotes) },
          { name: 'NO', votes: votes(e.noVotes) },
        ],
      })
    }
    if (contests.length === 0) throw fail(`"${key}" is empty`)
  }

  return {
    source: 'ca-sos',
    url: CA_SOS_BASE + path,
    retrievedAt,
    asOf,
    contests,
  }
}

/** The distinct API paths to fetch for a match file's ca-sos entries. */
export function caSosPaths(match: {
  contests: { official: { source: string; title: string }[] }[]
}): string[] {
  const paths = new Set<string>()
  for (const c of match.contests) {
    for (const o of c.official) {
      if (o.source === 'ca-sos') paths.add(o.title.split('#')[0])
    }
  }
  return [...paths].sort()
}
