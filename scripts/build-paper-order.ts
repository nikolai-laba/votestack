// Paper ballot order for every contest, written to
// data/build/paper-order.json; load-supabase.ts stores it on each contest as
// `paperOrder`. See scripts/lib/paper-order.ts for how it's derived.
//
// Suburban Cook: reads each ballot style's specimen ballot (the PDF cached by
// fetch-clerk-ballots.ts in data/raw/sample-ballots/, with `pdftotext
// -bbox-layout`) and its text (data/raw/clerk-ballots/), records where each
// contest starts, and merges the styles' orders into one rank per contest.
// It reports styles whose order disagrees with the merged one (then a single
// rank isn't enough) and with the Clerk's own numbering.
// Chicago: the Board's list order checked against Illinois law's office
// order; not yet verified against a printed Chicago ballot.
// Needs `pdftotext` (poppler). Run after build-clerk-precincts.ts:
// node scripts/build-paper-order.ts

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest } from '../src/shared/ballot.ts'
import { ballotText, QuestionMatcher } from './lib/ballot-text.ts'
import { BUILD, RAW, readJson, writeJson } from './lib/data.ts'
import {
  agrees,
  chicagoOrder,
  clerkOrder,
  contestPositions,
  mergeOrders,
  parseBbox,
  ranksOf,
  readingOrder,
  styleOrder,
} from './lib/paper-order.ts'

const contestsOf = async (file: string) =>
  (await readJson<{ contests: Contest[] }>(join(BUILD, 'contests', file)))
    .contests

// Suburban Cook.
const suburban = await contestsOf('cook-clerk.json')
const matcher = new QuestionMatcher(
  suburban.flatMap((c) => (c.kind === 'measure' ? [c.question] : [])),
)
const textDir = join(RAW, 'clerk-ballots')
const pdfDir = join(RAW, 'sample-ballots')
const pdfFor = new Map<string, string>()
for (const file of (await readdir(pdfDir)).sort()) {
  const style = file.match(/^1_\d+_(.+)_AB_SP\.pdf$/)?.[1]
  if (style && !pdfFor.has(style)) pdfFor.set(style, join(pdfDir, file))
}

const styles: Record<string, string[]> = {}
const unplaced: string[] = []
const missing: string[] = []
for (const file of (await readdir(textDir)).sort()) {
  const style = file.match(/^(.+)\.txt$/)?.[1]
  if (!style || style.endsWith('.layout')) continue
  const pdf = pdfFor.get(style)
  const layout = join(textDir, `${style}.layout.txt`)
  if (!pdf || !existsSync(layout)) {
    missing.push(style)
    continue
  }
  const html = execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const text = {
    words: readingOrder(parseBbox(html)),
    ballot: ballotText([
      await readFile(join(textDir, file), 'utf8'),
      await readFile(layout, 'utf8'),
    ]),
  }
  const found = contestPositions(suburban, text, matcher)
  styles[style] = styleOrder(found.positions)
  for (const id of found.unplaced) unplaced.push(`${style}: ${id}`)
}

const fallback = clerkOrder(suburban).map((c) => c.id)
const merged = mergeOrders(Object.values(styles), fallback)
const disagree = Object.entries(styles).filter(
  ([, order]) => !agrees(order, merged.order),
)
const differFromClerk = Object.entries(styles).filter(
  ([, order]) => !agrees(order, fallback),
)
const located = new Set(Object.values(styles).flat())
const neverLocated = suburban.filter((c) => !located.has(c.id))

// Chicago.
const chicago = chicagoOrder(await contestsOf('chicago-boe.json'))

await writeJson(join(BUILD, 'paper-order.json'), {
  generatedAt: new Date().toISOString(),
  ranks: {
    ...ranksOf(merged.order),
    ...ranksOf(chicago.order.map((c) => c.id)),
  },
  // Each suburban style's contests in the order its specimen ballot prints them.
  styles,
  checks: {
    styles: Object.keys(styles).length,
    missing,
    conflicts: merged.conflicts,
    disagree: disagree.map(([style]) => style),
    differFromClerk: differFromClerk.map(([style]) => style),
    unplaced,
    neverLocated: neverLocated.map((c) => c.id),
    chicagoUnmatched: chicago.unmatched,
  },
})

const titleOf = new Map(suburban.map((c) => [c.id, c.title]))
console.log(
  `Suburban: ${Object.keys(styles).length} ballot styles read, ${located.size}/${suburban.length} contests located on at least one`,
)
if (missing.length)
  console.log(`  No specimen ballot PDF or text for: ${missing.join(', ')}`)
console.log(
  `  Styles whose order disagrees with the merged order: ${disagree.length}`,
)
for (const [style] of disagree.slice(0, 10)) console.log(`    ${style}`)
console.log(
  `  Contests in a cycle (one rank per contest isn't enough): ${merged.conflicts.length}`,
)
for (const id of merged.conflicts) console.log(`    ${titleOf.get(id)}`)
console.log(
  `  Styles that differ from the Clerk's own numbering: ${differFromClerk.length}`,
)
for (const [style] of differFromClerk.slice(0, 10)) console.log(`    ${style}`)
console.log(`  On a style but not located: ${unplaced.length}`)
for (const line of unplaced.slice(0, 20)) console.log(`    ${line}`)
console.log(
  `  Never located (placed by the Clerk's numbering): ${neverLocated.length}`,
)
for (const c of neverLocated) console.log(`    ${c.title}`)
console.log(
  `Chicago: ${chicago.order.length} contests in the Board's list order (unverified)`,
)
if (chicago.unmatched.length)
  console.log(
    `  Offices not in Illinois law's order (kept after the race before them): ${chicago.unmatched.join('; ')}`,
  )
