import { OFFICIAL_URLS, parseVotes } from './types.ts'
import type { OfficialContest, OfficialFile } from './types.ts'

const fail = (what: string) => new Error(`chicago: ${what}`)

const NL = 0x0a
const CR = 0x0d
const TWO = 0x32 // '2': the record type of a candidate line

/**
 * Reads Chicago's SummaryExport.txt (type-2 lines are candidates). The file is
 * fixed-width by BYTES, so fields are cut from the bytes, then decoded: a
 * multi-byte letter must not shift the fields after it. Bytes 1 to 5 are the
 * contest's number: two contests with the same title stop the read, since
 * merging them would add up two races' votes.
 */
export function readChicago(
  bytes: Uint8Array,
  lastModified: string,
  retrievedAt: string,
): OfficialFile {
  const asOfDate = new Date(lastModified)
  if (Number.isNaN(asOfDate.getTime())) {
    throw fail(`Last-Modified is not a date: "${lastModified}"`)
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const field = (line: Uint8Array, start: number, end: number) => {
    try {
      return decoder.decode(line.subarray(start, end)).trim()
    } catch {
      throw fail('a candidate line is not valid UTF-8')
    }
  }
  const byTitle = new Map<string, OfficialContest>()
  const numberOf = new Map<string, string>()
  let start = 0
  while (start < bytes.length) {
    let end = bytes.indexOf(NL, start)
    if (end === -1) end = bytes.length
    let lineEnd = end
    if (lineEnd > start && bytes[lineEnd - 1] === CR) lineEnd -= 1
    const line = bytes.subarray(start, lineEnd)
    start = end + 1
    if (line[0] !== TWO) continue
    if (line.length < 157) throw fail('a candidate line is too short')
    const title = field(line, 37, 107)
    const name = field(line, 107, 157)
    if (!title || !name) throw fail('a candidate line has no title or name')
    const votes = parseVotes('chicago', field(line, 16, 23))
    const number = field(line, 1, 6)
    const seen = numberOf.get(title)
    if (seen !== undefined && seen !== number) {
      throw fail(`contests ${seen} and ${number} are both titled "${title}"`)
    }
    numberOf.set(title, number)
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
