// Bar association evaluations of the judges on the ballot. Parsers for
// the four published lists, name matching against the ballot, and the
// endorsement entries each judge's profile gets. Pure functions; downloads and
// files are in scripts/profiles/judges.ts.
//
// Ratings are kept word for word. Where a publisher prints a code ("Q", "HR"),
// it's expanded with that publisher's own key, never ours.

import type {
  BarContext,
  BarTally,
  Endorsement,
  ProfileSource,
} from '../../../src/shared/profile.ts'
import { givenNamesAgree } from './names.ts'

export type { BarContext }

export interface BarRating {
  /** The name as the publisher printed it. */
  name: string
  context: BarContext
  /** Rating word for word, codes expanded with the publisher's key. */
  rating: string
}

/** One organization's ratings from one publication. */
export interface BarList {
  organization: string
  source: Omit<ProfileSource, 'id' | 'viewedAt'>
  ratings: BarRating[]
}

/**
 * What a judge gets when a list has nothing for them, or the Alliance table's
 * cell for that association is blank ("All reporting bars say yes"). Our
 * wording, not a rating: the README says so.
 */
export const NO_RATING = 'No rating published'

/** The Alliance's footnote mark ("¹"), expanded with its key. Not a rating. */
export const NOT_EVALUATED = 'Not Evaluated Through No Fault of the Candidate'

// ---------------------------------------------------------------------------
// Alliance of Bar Associations for Judicial Screening (voteforjudges.org)

/** The Alliance's members, in the order of its table's columns. */
export const ALLIANCE_MEMBERS = [
  'Arab American Bar Association',
  'Asian American Bar Association of the Greater Chicago Area',
  "Black Men Lawyers' Association",
  "Black Women Lawyers' Association of Greater Chicago",
  'Chicago Council of Lawyers',
  'Cook County Bar Association',
  'Decalogue Society of Lawyers',
  'Hellenic Bar Association of Illinois',
  'Hispanic Lawyers Association of Illinois',
  'Illinois State Bar Association',
  "Chicago's LGBTQ+ Bar Association",
  'Puerto Rican Bar Association',
  "Women's Bar Association of Illinois",
] as const

/** The third letter of each column's vertical abbreviation (AABAR, AABA, BMLA, ...). */
const ALLIANCE_HEADER = 'B B L L L B L A A B G B A'

/** The Alliance's ratings key. */
const ALLIANCE_KEY: Record<string, string> = {
  HQ: 'Highly Qualified',
  WQ: 'Well Qualified',
  Q: 'Qualified',
  NQ: 'Not Qualified',
  HR: 'Highly Recommended',
  R: 'Recommended',
  NR: 'Not Recommended',
  '¹': NOT_EVALUATED,
  Yes: 'Yes',
  No: 'No',
}

const ALLIANCE_TOKEN = /^(HQ|WQ|Q|NQ|HR|R|NR|¹|Yes|No)$/

export const ALLIANCE = 'Alliance of Bar Associations for Judicial Screening'

/**
 * The groups a judge's profile shows on their own line, in this order, with
 * their ratings word for word. The Council and the ISBA are Alliance members
 * too; the Alliance's line sums up its other members (allianceTally).
 */
export const SHOWN_ON_OWN_LINE = [
  'Chicago Bar Association',
  'Chicago Council of Lawyers',
  'Illinois State Bar Association',
] as const

/** Alliance members summed up in the Alliance's line (11). */
export const ALLIANCE_OTHERS: readonly string[] = ALLIANCE_MEMBERS.filter(
  (m) => !(SHOWN_ON_OWN_LINE as readonly string[]).includes(m),
)

/** Order for ratings given by equally many members: the Alliance's key. */
const RATING_ORDER = Object.values(ALLIANCE_KEY)

/**
 * How the Alliance members in `ALLIANCE_OTHERS` rated one judge, from their
 * ratings word for word (one per member, NO_RATING for a blank cell).
 */
export function allianceTally(ratings: string[]): BarTally {
  const counts = new Map<string, number>()
  let notEvaluated = 0
  for (const rating of ratings) {
    if (rating === NO_RATING) continue
    if (rating === NOT_EVALUATED) notEvaluated++
    else counts.set(rating, (counts.get(rating) ?? 0) + 1)
  }
  const rank = (r: string) =>
    RATING_ORDER.includes(r) ? RATING_ORDER.indexOf(r) : RATING_ORDER.length
  return {
    members: ratings.length,
    ratings: [...counts]
      .map(([rating, count]) => ({ rating, count }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          rank(a.rating) - rank(b.rating) ||
          a.rating.localeCompare(b.rating),
      ),
    notEvaluated,
  }
}

/**
 * The heading for one set of a judge's ratings, when the judge is rated for
 * two votes. `office` is the contest's office as the Clerk prints it.
 */
export function contextLabel(context: BarContext, office: string): string {
  const appellate = /appellate/i.test(office)
  const supreme = /supreme/i.test(office)
  if (context === 'election')
    return `For the ${supreme ? 'Supreme Court' : appellate ? 'Appellate Court' : 'Circuit Court'} election`
  return `For retention as ${supreme ? 'a Supreme Court justice' : appellate ? 'an appellate judge' : 'a circuit judge'}`
}

/**
 * The Alliance's table, from `pdftotext -layout`: one row per judge, one
 * column per member. Cells are placed by their position under the header,
 * because retention rows leave a member's cell blank when it didn't report.
 * Returns one rating list per member (blank cells are left out).
 */
export function parseAlliance(text: string): BarRating[][] {
  const out: BarRating[][] = ALLIANCE_MEMBERS.map(() => [])
  let columns: number[] | null = null
  let context: BarContext = 'election'
  for (const line of text.replace(/\f/g, '').split('\n')) {
    if (/be retained in office/i.test(line)) context = 'retention'
    const header = headerColumns(line)
    if (header) {
      columns = header
      continue
    }
    // Judges' rows start at the margin; titles and vacancy lines are indented.
    const m = line.match(/^(\S.*?)\s{2,}(\S.*)$/)
    if (!m || !columns) continue
    const cells = [...line.matchAll(/\S+/g)].filter(
      (t) => t.index >= m[1].length && ALLIANCE_TOKEN.test(t[0]),
    )
    if (cells.length === 0) continue
    const name = m[1].trim()
    const seen = new Set<number>()
    for (const cell of cells) {
      const center = cell.index + cell[0].length / 2
      const col = nearest(columns, center)
      if (seen.has(col)) throw new Error(`Two ratings in one column: ${line}`)
      seen.add(col)
      out[col].push({ name, context, rating: ALLIANCE_KEY[cell[0]] })
    }
    if (context === 'election' && cells.length !== columns.length)
      throw new Error(`Expected ${columns.length} ratings: ${line}`)
  }
  return out
}

/** Centers of the 13 columns, when the line is the header's third row. */
function headerColumns(line: string): number[] | null {
  const tokens = [...line.matchAll(/\S+/g)]
  if (tokens.length < 13) return null
  const last = tokens.slice(-13)
  if (last.map((t) => t[0]).join(' ') !== ALLIANCE_HEADER) return null
  return last.map((t) => t.index + 0.5)
}

function nearest(columns: number[], x: number): number {
  let best = 0
  for (let i = 1; i < columns.length; i++)
    if (Math.abs(columns[i] - x) < Math.abs(columns[best] - x)) best = i
  return best
}

// ---------------------------------------------------------------------------
// Chicago Bar Association (chicagobar.org, Judicial Voter's Guide)

const CBA_KEY: Record<string, string> = {
  HQ: 'Highly Qualified',
  Q: 'Qualified',
  NR: 'Not Recommended',
}

/** "#102 | Judith C. Rice (D) | Q" rows; the retention list follows the word RETENTION. */
export function parseCba(html: string): BarRating[] {
  const text = htmlText(html)
  const split = text.search(/seeking\s+RETENTION/)
  const ratings: BarRating[] = []
  for (const m of text.matchAll(
    /#?(\d{3})\s*\|\s*([^|]+?)\s*\|\s*(HQ|Q|NR)\b/g,
  )) {
    ratings.push({
      name: m[2].replace(/\s*\([A-Z]{1,3}\)$/, ''),
      context: split >= 0 && m.index > split ? 'retention' : 'election',
      rating: CBA_KEY[m[3]],
    })
  }
  return ratings
}

// ---------------------------------------------------------------------------
// Chicago Council of Lawyers (evaluation report PDF on voteforjudges.org)

const CCL_RATING =
  'Highly Qualified|Well Qualified|Not Qualified|Qualified|Not Recommended'

/**
 * Headings such as "Radiance Ward (1st Subcircuit) – Well Qualified", from
 * `pdftotext -layout`. Retention judges follow "on the Ballot for Retention".
 */
export function parseCcl(text: string): BarRating[] {
  const ratings: BarRating[] = []
  let context: BarContext = 'election'
  const heading = new RegExp(`^(\\S.*?)\\s*[–—-]\\s*(${CCL_RATING})\\s*$`)
  // A form feed starts each page.
  for (const line of text.replace(/\f/g, '').split('\n')) {
    if (/on the Ballot for Retention/i.test(line)) context = 'retention'
    const m = line.match(heading)
    if (!m) continue
    const name = m[1].replace(/\s*\(\d+\w*\s+Subcircuit\)$/i, '').trim()
    ratings.push({ name, context, rating: m[2] })
  }
  return ratings
}

// ---------------------------------------------------------------------------
// Illinois State Bar Association (isba.org, Cook County judicial evaluations)

/** `<summary>Name<span class="judicial-rating"> – Rating</span>`; retention after `<h2>Retention</h2>`. */
export function parseIsba(html: string): BarRating[] {
  const split = html.search(/<h2[^>]*>\s*Retention\s*<\/h2>/i)
  const ratings: BarRating[] = []
  for (const m of html.matchAll(
    /<summary[^>]*>([\s\S]*?)<span class="judicial-rating">([\s\S]*?)<\/span>/g,
  )) {
    ratings.push({
      name: htmlText(m[1]),
      context: split >= 0 && m.index > split ? 'retention' : 'election',
      rating: htmlText(m[2])
        .replace(/^[–—-]\s*/, '')
        .trim(),
    })
  }
  return ratings
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  quot: '"',
  apos: "'",
}

/** Text of an HTML fragment, tags removed and whitespace collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(
      /&([a-z]+);/gi,
      (all, e: string) => ENTITIES[e.toLowerCase()] ?? all,
    )
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Matching published names with the ballot

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

/** Words of a name without nicknames, suffixes or punctuation: "D’ Anthony" → "danthony". */
export function nameWords(name: string): string[] {
  return fold(name)
    .replace(/["“”(][^"“”)]*["“”)]|''[^']*''/g, ' ')
    .replace(/(\w)['’]\s*(\w)/g, '$1$2')
    .replace(/\s*-\s*/g, '-')
    .split(/[^a-z0-9-]+/)
    .flatMap((w) => w.split('-'))
    .filter((w) => w && !SUFFIXES.has(w))
}

/**
 * Same person, by the rules a reader would use: the same last name, first
 * names that agree (Sam/Samuel, Chris/Christopher) and middle names that
 * don't conflict ("Regina A." and "Regina Ann", "Kristal" and "Kristal R.").
 */
export function sameJudge(published: string, ballot: string): boolean {
  const a = nameWords(published)
  const b = nameWords(ballot)
  if (a.length < 2 || b.length < 2) return false
  if (a.at(-1) !== b.at(-1)) return false
  if (!givenNamesAgree(a[0], b[0])) return false
  const middleA = a.slice(1, -1)
  const middleB = b.slice(1, -1)
  const n = Math.min(middleA.length, middleB.length)
  for (let i = 0; i < n; i++) {
    const [x, y] = [middleA[i], middleB[i]]
    if (!(x.startsWith(y) || y.startsWith(x))) return false
  }
  return true
}

/**
 * The ballot key for a published name: an exact or rule match that is the
 * only candidate, or a reviewed alias. Anything else is unmatched.
 */
export function matchJudge(
  published: string,
  ballot: Map<string, string>,
  aliases: Record<string, string>,
): string | undefined {
  const alias = aliases[published]
  if (alias) return ballot.has(alias) ? alias : undefined
  const hits = [...ballot].filter(([, name]) => sameJudge(published, name))
  return hits.length === 1 ? hits[0][0] : undefined
}

// ---------------------------------------------------------------------------
// Profile entries

export interface JudgeBarRatings {
  endorsements: Endorsement[]
  sources: ProfileSource[]
}

/**
 * One entry per organization for every judge, in the same order for all.
 * Lists that never mention a judge still give an entry (NO_RATING), so no
 * judge looks better covered than another. `votes` holds a label (see
 * contextLabel) for each vote the judge is on the ballot for. A judge in a
 * race and up for retention gets one set of entries per vote, the race
 * first, each with its label.
 */
export function buildEntries(
  lists: BarList[],
  matched: Map<string, { list: number; rating: BarRating }[]>,
  key: string,
  viewedAt: string,
  votes: Partial<Record<BarContext, string>>,
): JudgeBarRatings {
  const sources: ProfileSource[] = []
  const sourceIds = new Map<string, number>()
  const cite = (list: BarList) => {
    let id = sourceIds.get(list.source.url)
    if (id === undefined) {
      id = sources.length + 1
      sourceIds.set(list.source.url, id)
      sources.push({ id, ...list.source, viewedAt })
    }
    return id
  }
  lists.forEach(cite)
  const mine = matched.get(key) ?? []
  const contexts = (['election', 'retention'] as const).filter(
    (c) => votes[c] !== undefined,
  )
  if (contexts.length === 0)
    throw new Error(`${key}: on the ballot for no vote`)
  const endorsements: Endorsement[] = []
  for (const context of contexts) {
    const label = contexts.length > 1 ? votes[context] : undefined
    lists.forEach((list, i) => {
      const r = mine.find((m) => m.list === i && m.rating.context === context)
      endorsements.push({
        organization: list.organization,
        kind: 'bar_evaluation',
        rating: r?.rating.rating ?? NO_RATING,
        context,
        ...(label ? { contextLabel: label } : {}),
        cites: [cite(list)],
      })
    })
  }
  return { endorsements, sources }
}
