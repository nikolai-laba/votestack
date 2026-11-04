import { zonedToIso } from './time.ts'
import { OFFICIAL_URLS, parseVotes } from './types.ts'
import type { OfficialContest, OfficialFile } from './types.ts'

const fail = (what: string) => new Error(`cook: ${what}`)

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

const text = (html: string) => decode(html.replace(/<[^>]*>/g, ' '))

/** Reads the Cook County Clerk's election-night page. `class="winning"` is only the current leader, so it is ignored. */
export function readCook(html: string, retrievedAt: string): OfficialFile {
  const stamp = html.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  )
  if (!stamp) throw fail('no timestamp found')
  const hour12 = Number(stamp[4]) % 12
  const asOf = zonedToIso(
    {
      year: Number(stamp[3]),
      month: Number(stamp[1]),
      day: Number(stamp[2]),
      hour: hour12 + (stamp[6].toUpperCase() === 'PM' ? 12 : 0),
      minute: Number(stamp[5]),
      second: 0,
    },
    'America/Chicago',
  )

  const contests: OfficialContest[] = []
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const h5 = table.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)
    if (!h5) continue
    const header = text(h5[1]).match(/^(.*?)\s+-\s+Vote For\s+(\d+)$/)
    if (!header) throw fail(`unexpected contest header: "${text(h5[1])}"`)
    const choices: { name: string; votes: number }[] = []
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []
    for (const row of rows) {
      const name = row.match(
        /<td[^>]*class="(?:candidate|winning)"[^>]*>([\s\S]*?)<\/td>/,
      )
      if (!name) continue
      const cells = row.match(/<td[\s\S]*?<\/td>/g) ?? []
      const nameIdx = cells.findIndex((c) =>
        /class="(?:candidate|winning)"/.test(c),
      )
      const votesCell = cells[nameIdx + 1]
      if (!votesCell) throw fail(`no votes cell in "${header[1]}"`)
      choices.push({
        name: text(name[1]).replace(/\s*\([^()]*\)$/, ''),
        votes: parseVotes('cook', text(votesCell)),
      })
    }
    if (choices.length === 0) throw fail(`no candidates in "${header[1]}"`)
    contests.push({ title: header[1], choices, voteFor: Number(header[2]) })
  }
  if (contests.length === 0) throw fail('no contests found')
  return {
    source: 'cook',
    url: OFFICIAL_URLS.cook,
    retrievedAt,
    asOf,
    contests,
  }
}
