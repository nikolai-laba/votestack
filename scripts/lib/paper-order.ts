// Paper ballot order: the order races, questions and judges appear on
// the printed ballot, so a voter can follow along in the booth.
//
// Suburban Cook: read from the Clerk's specimen ballot for every ballot style.
// pdftotext's plain readings interleave the ballot's three columns (see
// ballot-text.ts), so positions come from the PDF's word coordinates instead
// (`pdftotext -bbox-layout`): words are read page by page, column by column,
// top to bottom, which is how the paper reads. Each contest's position is
// where its first candidate, judge or question starts in that reading. The
// orders of all styles are then merged into one rank per contest.
//
// Chicago: the Board of Election Commissioners publishes no specimen ballot
// per precinct, so the order is its official candidate list's order, checked
// against the office order Illinois law sets (the same sequence the Clerk's
// specimen ballots print). NOT YET VERIFIED against a printed Chicago ballot.

import type { Contest } from '../../src/shared/ballot.ts'
import {
  appears,
  findMarker,
  MATCH,
  normalize,
  type BallotText,
  type QuestionMatcher,
} from './ballot-text.ts'

/** A word on a specimen ballot page, from `pdftotext -bbox-layout`. */
export interface PdfWord {
  page: number
  /** Left edge and top, in points from the page's top left. */
  x: number
  y: number
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** The words of `pdftotext -bbox-layout` output, with their page and position. */
export function parseBbox(html: string): PdfWord[] {
  const words: PdfWord[] = []
  html
    .split(/<page\b/)
    .slice(1)
    .forEach((page, i) => {
      for (const m of page.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g,
      )) {
        words.push({
          page: i,
          x: Number(m[1]),
          y: Number(m[2]),
          text: m[3].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]),
        })
      }
    })
  return words
}

/**
 * Left edges of the three columns on the Clerk's 2026 ballot cards (612 pt
 * wide, columns 175 pt apart), in points. A word belongs to the last column
 * that starts at or before it (with some slack for indented lines' neighbours).
 * If the Clerk changes the layout, the checks in build-paper-order.ts fail.
 */
export const COLUMN_STARTS = [49, 224, 399]
const SLACK = 12
/** Words this close in height are on the same line. */
const LINE_TOLERANCE = 3

export function columnOf(x: number): number {
  let column = 0
  COLUMN_STARTS.forEach((start, i) => {
    if (x + SLACK >= start) column = i
  })
  return column
}

/**
 * The ballot's words in paper reading order: page by page, each column top
 * to bottom, each line left to right. Normalized as in ballot-text.ts.
 */
export function readingOrder(words: PdfWord[]): string[] {
  const sorted = [...words].sort(
    (a, b) =>
      a.page - b.page ||
      columnOf(a.x) - columnOf(b.x) ||
      a.y - b.y ||
      a.x - b.x,
  )
  // Group into lines (same page, column and height), then order each by x.
  const lines: PdfWord[][] = []
  for (const w of sorted) {
    const line = lines.at(-1)
    const first = line?.[0]
    if (
      first &&
      first.page === w.page &&
      columnOf(first.x) === columnOf(w.x) &&
      w.y - first.y <= LINE_TOLERANCE
    )
      line.push(w)
    else lines.push([w])
  }
  // Line breaks let normalize() undo end-of-line hyphenation.
  const text = lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text)
        .join(' '),
    )
    .join('\n')
  return normalize(text).split(' ').filter(Boolean)
}

/** One ballot style's text: the reading for positions, the usual readings for presence. */
export interface StyleText {
  /** Words in paper reading order (`readingOrder`). */
  words: string[]
  /** pdftotext's default and -layout readings, as build-clerk-precincts.ts uses. */
  ballot: BallotText
}

/** Where a marker starts: as one phrase first, then allowing a few words between. */
function locate(words: string[], marker: string, from = 0): number {
  const exact = findMarker(words, marker, 1, from)
  return exact !== -1 ? exact : findMarker(words, marker, 6, from)
}

/** Words of a question's opening used to find where it starts. */
const QUESTION_OPENING = 20

/**
 * Where each contest on this ballot style starts, as an index into
 * `text.words`. Races and questions are on the style by the same tests as
 * in build-clerk-precincts.ts (more than half of a race's candidates
 * printed, a question's distinctive words present); a judge when the name is
 * on the retention card. Contests
 * that are on the style but couldn't be located are listed in `unplaced`;
 * races without candidates can't be found and are left out.
 */
export function contestPositions(
  contests: Contest[],
  text: StyleText,
  matcher: QuestionMatcher,
): { positions: Map<string, number>; unplaced: string[] } {
  const positions = new Map<string, number>()
  const unplaced: string[] = []
  const { words, ballot } = text
  // The retention card starts with this line; judges are found after it,
  // since a judge can also be a candidate on the first card (Judith C. Rice).
  const retentionCard = Math.max(
    0,
    findMarker(words, 'candidates seeking retention in office', 1),
  )

  for (const contest of contests) {
    let at = -1
    if (contest.kind === 'candidate') {
      const names = contest.candidates
        .map((c) => normalize(c.name))
        .filter(Boolean)
      const printed = names.filter((n) => appears(ballot.words, n))
      if (!names.length || printed.length <= names.length / 2) continue
      const found = printed.map((n) => locate(words, n)).filter((i) => i !== -1)
      at = found.length ? Math.min(...found) : -1
    } else if (contest.kind === 'retention') {
      // The plain readings can split a judge's name with the card's
      // instructions ("John Michael … Allegretti"), so this reads the
      // retention card in paper order only.
      at = locate(words, normalize(contest.judge), retentionCard)
      if (at === -1) continue
    } else {
      if (matcher.score(contest.question, ballot) < MATCH) continue
      const opening = normalize(contest.question)
        .split(' ')
        .slice(0, QUESTION_OPENING)
        .join(' ')
      at = findMarker(words, opening, 3)
      if (at === -1) {
        // The printed wording differs from the Clerk's list: use where its
        // own word pairs first appear instead.
        const found = matcher
          .distinctivePairs(contest.question)
          .map((p) => findMarker(words, p, 1))
          .filter((i) => i !== -1)
        at = found.length ? Math.min(...found) : -1
      }
    }
    if (at === -1) unplaced.push(contest.id)
    else positions.set(contest.id, at)
  }
  return { positions, unplaced }
}

/** Contest IDs in the order their positions put them. */
export function styleOrder(positions: Map<string, number>): string[] {
  return [...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id)
}

const KIND_ON_CLERK_CARDS: Record<Contest['kind'], number> = {
  candidate: 0,
  measure: 1,
  retention: 2,
}

/**
 * The Cook County Clerk's own numbering, as a fallback order: races by race
 * number and then by the candidate numbers printed beside the names,
 * referenda by the Clerk's ballot sort order, then the retention card, each
 * in the Clerk's list order. The parts are in the order every 2026 suburban
 * specimen ballot prints them (races, public questions, then the separate
 * retention card).
 */
export function clerkOrder(contests: Contest[]): Contest[] {
  const listed = new Map(contests.map((c, i) => [c.id, i]))
  const firstNumber = (c: Contest) =>
    c.kind === 'candidate'
      ? Math.min(...c.candidates.map((x) => x.ballotOrder ?? Infinity))
      : 0
  return [...contests].sort(
    (a, b) =>
      KIND_ON_CLERK_CARDS[a.kind] - KIND_ON_CLERK_CARDS[b.kind] ||
      (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0) ||
      firstNumber(a) - firstNumber(b) ||
      listed.get(a.id)! - listed.get(b.id)!,
  )
}

/**
 * Merges the orders seen on each ballot style into one order of all `ids`.
 * Each style says which of its contests comes before which; `ids` (in a
 * fallback order) breaks ties and places contests no style located.
 * `conflicts` lists contests whose styles disagree about their order: then
 * one rank per contest isn't enough and the order must be kept per style.
 */
export function mergeOrders(
  orders: string[][],
  ids: string[],
): { order: string[]; conflicts: string[] } {
  const rank = new Map(ids.map((id, i) => [id, i]))
  const after = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]))
  const before = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const order of orders) {
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1], order[i]]
      if (!after.has(a) || !after.has(b) || after.get(a)!.has(b)) continue
      after.get(a)!.add(b)
      before.set(b, before.get(b)! + 1)
    }
  }
  const order: string[] = []
  const conflicts: string[] = []
  const left = new Set(ids)
  while (left.size) {
    const free = [...left].filter((id) => before.get(id) === 0)
    const pool = free.length ? free : [...left]
    const next = pool.reduce((a, b) => (rank.get(a)! <= rank.get(b)! ? a : b))
    // No contest is free: the styles' orders form a cycle through this one.
    if (!free.length) conflicts.push(next)
    order.push(next)
    left.delete(next)
    for (const b of after.get(next)!) before.set(b, before.get(b)! - 1)
  }
  return { order, conflicts }
}

/** True if `order` lists its contests in the same relative order as `reference`. */
export function agrees(order: string[], reference: string[]): boolean {
  const at = new Map(reference.map((id, i) => [id, i]))
  const known = order.filter((id) => at.has(id))
  return known.every((id, i) => i === 0 || at.get(known[i - 1])! < at.get(id)!)
}

/**
 * The order of offices Illinois law sets for a general election ballot, as
 * the Clerk's specimen ballots print it: statewide offices, then Congress,
 * the General Assembly, the Water Reclamation District, county offices,
 * the Board of Review and judges. Matched against the Chicago Board's titles.
 */
export const OFFICE_ORDER: RegExp[] = [
  /^United States Senator/,
  /^Governor/,
  /^Attorney General/,
  /^Secretary of State/,
  /^Comptroller/,
  /^Treasurer/,
  /^U\.S\. Representative/,
  /^State Senator/,
  /^State Representative/,
  /^Metropolitan Water Reclamation District/,
  /^President of County Board/,
  /^County Clerk/,
  /^County Sheriff/,
  /^County Treasurer/,
  /^County Assessor/,
  /^County Commissioner/,
  /^Board of Review/,
  /^Judge(,| of the) Appellate Court/,
  /^Judge(,| of the) Circuit Court/,
  /^Judge, \d+\w\w Subcircuit/,
  /Board of Education/,
]

const KIND_ON_CHICAGO_LIST: Record<Contest['kind'], number> = {
  candidate: 0,
  retention: 1,
  measure: 2,
}

/**
 * Chicago's paper order (unverified): candidate races in the office order of
 * Illinois law, then judges up for retention, then referenda, each in the
 * order of the Board's official list (`ballotOrder`). A race whose office
 * isn't in OFFICE_ORDER stays right after the race listed before it.
 * `unmatched` lists those titles so the import can report them.
 */
export function chicagoOrder(contests: Contest[]): {
  order: Contest[]
  unmatched: string[]
} {
  const listed = [...contests].sort(
    (a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0),
  )
  const office = new Map<string, number>()
  const unmatched: string[] = []
  let previous = -1
  for (const c of listed) {
    if (c.kind !== 'candidate') continue
    const i = OFFICE_ORDER.findIndex((re) => re.test(c.title))
    if (i === -1) unmatched.push(c.title)
    else previous = i
    office.set(c.id, i === -1 ? previous : i)
  }
  const position = new Map(listed.map((c, i) => [c.id, i]))
  const order = [...listed].sort(
    (a, b) =>
      KIND_ON_CHICAGO_LIST[a.kind] - KIND_ON_CHICAGO_LIST[b.kind] ||
      (office.get(a.id) ?? 0) - (office.get(b.id) ?? 0) ||
      position.get(a.id)! - position.get(b.id)!,
  )
  return { order, unmatched }
}

/** contest ID → 1-based paper position. */
export type PaperRanks = Record<string, number>

export function ranksOf(ids: string[]): PaperRanks {
  return Object.fromEntries(ids.map((id, i) => [id, i + 1]))
}

/** Contests with their paper position (`paperOrder`) where one is known. */
export function withPaperOrder(
  contests: Contest[],
  ranks: PaperRanks,
): Contest[] {
  return contests.map((c) =>
    ranks[c.id] === undefined ? c : { ...c, paperOrder: ranks[c.id] },
  )
}
