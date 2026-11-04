import { OFFICIAL_URLS, parseVotes } from './types.ts'
import type { OfficialContest, OfficialFile } from './types.ts'

const fail = (what: string) => new Error(`chicago: ${what}`)

/** Reads Chicago's fixed-width SummaryExport.txt (type-2 lines are candidates). */
export function readChicago(
  text: string,
  lastModified: string,
  retrievedAt: string,
): OfficialFile {
  const asOfDate = new Date(lastModified)
  if (Number.isNaN(asOfDate.getTime())) {
    throw fail(`Last-Modified is not a date: "${lastModified}"`)
  }
  const byTitle = new Map<string, OfficialContest>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('2')) continue
    if (line.length < 137) throw fail('a candidate line is too short')
    const title = line.slice(37, 87).trim()
    const name = line.slice(87, 137).trim()
    if (!title || !name) throw fail('a candidate line has no title or name')
    const votes = parseVotes('chicago', line.slice(16, 23))
    let contest = byTitle.get(title)
    if (!contest) {
      contest = { title, choices: [] }
      byTitle.set(title, contest)
    }
    contest.choices.push({ name, votes })
  }
  if (byTitle.size === 0) throw fail('no contests found')
  return {
    source: 'chicago',
    url: OFFICIAL_URLS.chicago,
    retrievedAt,
    asOf: asOfDate.toISOString(),
    contests: [...byTitle.values()],
  }
}
