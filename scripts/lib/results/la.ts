import { zonedToIso } from './time.ts'
import { OFFICIAL_URLS } from './types.ts'
import type { OfficialContest, OfficialFile } from './types.ts'

const fail = (what: string) => new Error(`la: ${what}`)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads the LA County Registrar's results JSON. */
export function readLa(json: unknown, retrievedAt: string): OfficialFile {
  if (!isRecord(json)) throw fail('not a JSON object')
  const stamp =
    typeof json.Timestamp === 'string'
      ? json.Timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/)
      : null
  if (!stamp) throw fail('no Timestamp found')
  const asOf = zonedToIso(
    {
      year: Number(stamp[1]),
      month: Number(stamp[2]),
      day: Number(stamp[3]),
      hour: Number(stamp[4]),
      minute: Number(stamp[5]),
      second: Number(stamp[6]),
    },
    'America/Los_Angeles',
  )

  const groups = isRecord(json.Election) ? json.Election.ContestGroups : null
  if (!Array.isArray(groups)) throw fail('no ContestGroups found')
  const contests: OfficialContest[] = []
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.Contests)) {
      throw fail('a contest group has no Contests')
    }
    for (const c of group.Contests) {
      if (
        !isRecord(c) ||
        typeof c.Title !== 'string' ||
        !Array.isArray(c.Candidates)
      ) {
        throw fail('a contest has no Title or Candidates')
      }
      const choices = c.Candidates.map((cand: unknown) => {
        if (
          !isRecord(cand) ||
          typeof cand.Name !== 'string' ||
          typeof cand.Votes !== 'number' ||
          !Number.isInteger(cand.Votes) ||
          cand.Votes < 0
        ) {
          throw fail(`bad candidate in "${c.Title}"`)
        }
        return { name: cand.Name, votes: cand.Votes }
      })
      const contest: OfficialContest = {
        title: c.Title,
        choices,
        countyOnly:
          typeof c.AdditionalText === 'string' &&
          c.AdditionalText.includes('Los Angeles County Results Only'),
      }
      const voteFor = Number(c.VoteFor)
      if (c.VoteFor !== '' && Number.isInteger(voteFor) && voteFor > 0) {
        contest.voteFor = voteFor
      }
      if (typeof c.MeasurePassRate === 'string' && c.MeasurePassRate !== '') {
        contest.passRate = c.MeasurePassRate
      }
      contests.push(contest)
    }
  }
  if (contests.length === 0) throw fail('no contests found')
  return { source: 'la', url: OFFICIAL_URLS.la, retrievedAt, asOf, contests }
}
