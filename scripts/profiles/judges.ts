// Bar association evaluations for every judge on the Cook County ballot
// contested judicial races and retention votes. Downloads the 2026
// general election lists published by the Chicago Bar Association, the
// Alliance of Bar Associations for Judicial Screening (voteforjudges.org), the
// Chicago Council of Lawyers and the Illinois State Bar Association, matches
// names with the ballot and writes content/profiles/judges/bar-ratings.json.
// Names it can't match are printed, never guessed. Needs `pdftotext`
// (poppler) and the contest files from `npm run data:build`.
// Run: node scripts/profiles/judges.ts [--refresh]

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { format } from 'prettier'
import type { Contest } from '../../src/shared/ballot.ts'
import { chicagoDate } from '../../src/shared/dates.ts'
import { profileKey } from '../../src/shared/profile.ts'
import { BUILD, RAW, ROOT, readJson } from '../lib/data.ts'
import { cachedDownload } from '../lib/profiles/download.ts'
import {
  ALLIANCE_MEMBERS,
  buildEntries,
  contextLabel,
  matchJudge,
  NO_RATING,
  parseAlliance,
  parseCba,
  parseCcl,
  parseIsba,
  type BarContext,
  type BarList,
  type BarRating,
  type JudgeBarRatings,
} from '../lib/profiles/bar.ts'

const MAX_AGE_HOURS = process.argv.includes('--refresh') ? 0 : 24
const DIR = join(RAW, 'judges')
const OUT = join(ROOT, 'content', 'profiles', 'judges', 'bar-ratings.json')
const today = chicagoDate()

const ALLIANCE_URL =
  'https://www.voteforjudges.org/wp-content/uploads/2026/09/2026-Alliance-General-Ballot-Ratings-09252026.pdf'
const CBA_URL = 'https://www.chicagobar.org/CBA/JEC/Judicial_Voters_Guide.aspx'
const CCL_URL =
  'https://www.voteforjudges.org/wp-content/uploads/2026/09/CCL-Judicial-Evaluation-Report-for-Nov-3-2026-General-Election_Ballot-Order.pdf'
const ISBA_URL = 'https://www.isba.org/judicial-elections/counties/cook'

/**
 * Misspellings in the published lists, checked by hand against the ballot,
 * the court assignment and the other lists. Published name → ballot key.
 */
const ALIASES: Record<string, string> = {
  'Maire Aileen Dempsey': 'marie-aileen-dempsey',
  'Rachel Marello': 'rachel-marrello',
  'Erin Haggerty Antoniett': 'erin-haggerty-antonietti',
  'Erin Haggerty Antoinetti': 'erin-haggerty-antonietti',
}

interface Judge {
  name: string
  contexts: Set<BarContext>
  /** A label per vote (contextLabel), from the contest's office. */
  votes: Partial<Record<BarContext, string>>
}

/** Every judge on either list of contests, with how they appear. */
async function ballotJudges(): Promise<Map<string, Judge>> {
  const judges = new Map<string, Judge>()
  const add = (name: string, context: BarContext, office: string) => {
    const key = profileKey(name)
    const judge = judges.get(key) ?? { name, contexts: new Set(), votes: {} }
    judge.contexts.add(context)
    judge.votes[context] ??= contextLabel(context, office)
    judges.set(key, judge)
  }
  for (const file of ['cook-clerk', 'chicago-boe']) {
    const { contests } = await readJson<{ contests: Contest[] }>(
      join(BUILD, 'contests', `${file}.json`),
    )
    for (const c of contests) {
      if (c.kind === 'retention')
        add(c.judge, 'retention', `${c.office} ${c.title}`)
      else if (
        c.kind === 'candidate' &&
        /Judge|Justice|Court|Subcircuit/.test(c.office)
      )
        for (const p of c.candidates)
          add(p.name, 'election', `${c.office} ${c.title}`)
    }
  }
  return judges
}

async function pdfText(url: string, name: string): Promise<string> {
  const pdf = join(DIR, `${name}.pdf`)
  await cachedDownload(url, pdf, MAX_AGE_HOURS)
  return execFileSync('pdftotext', ['-layout', pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function page(url: string, name: string): Promise<string> {
  const path = join(DIR, `${name}.html`)
  await cachedDownload(url, path, MAX_AGE_HOURS)
  return readFile(path, 'utf8')
}

const alliance = parseAlliance(await pdfText(ALLIANCE_URL, 'alliance'))
const cba = parseCba(await page(CBA_URL, 'cba'))
const ccl = parseCcl(await pdfText(CCL_URL, 'ccl'))
const isba = parseIsba(await page(ISBA_URL, 'isba'))

const allianceSource = {
  title:
    'Alliance of Bar Associations for Judicial Screening, 2026 General Election ratings',
  publisher: 'Alliance of Bar Associations for Judicial Screening',
  url: ALLIANCE_URL,
  kind: 'bar' as const,
}

// The Chicago Bar Association first, then the Alliance's members in the
// Alliance's order. The Council and the ISBA publish their own reports with
// the same ratings in words, so their own reports stand in for their columns.
const lists: BarList[] = [
  {
    organization: 'Chicago Bar Association',
    source: {
      title:
        "Vote Smart: CBA Judicial Voter's Guide, General Election, November 3, 2026",
      publisher: 'Chicago Bar Association',
      url: CBA_URL,
      kind: 'bar',
    },
    ratings: cba,
  },
  ...ALLIANCE_MEMBERS.map((organization, i): BarList => {
    if (organization === 'Chicago Council of Lawyers')
      return {
        organization,
        source: {
          title:
            'Evaluation Report: Judges on the Ballot in the November 3, 2026 General Election',
          publisher: 'Chicago Council of Lawyers',
          url: CCL_URL,
          kind: 'bar',
        },
        ratings: ccl,
      }
    if (organization === 'Illinois State Bar Association')
      return {
        organization,
        source: {
          title: '2026 General Election, Cook County Judicial Evaluations',
          publisher: 'Illinois State Bar Association',
          url: ISBA_URL,
          kind: 'bar',
        },
        ratings: isba,
      }
    return { organization, source: allianceSource, ratings: alliance[i] }
  }),
]

const judges = await ballotJudges()
const ballotNames = new Map([...judges].map(([k, j]) => [k, j.name]))
const matched = new Map<string, { list: number; rating: BarRating }[]>()
const unmatched: string[] = []
const wrongContext: string[] = []

lists.forEach((list, i) => {
  for (const rating of list.ratings) {
    const key = matchJudge(rating.name, ballotNames, ALIASES)
    if (!key) {
      unmatched.push(`${list.organization}: ${rating.name} (${rating.context})`)
      continue
    }
    if (!judges.get(key)!.contexts.has(rating.context))
      wrongContext.push(
        `${list.organization}: ${rating.name} (${rating.context})`,
      )
    const entries = matched.get(key) ?? []
    if (
      entries.some((e) => e.list === i && e.rating.context === rating.context)
    )
      throw new Error(`${list.organization} rates ${rating.name} twice`)
    entries.push({ list: i, rating })
    matched.set(key, entries)
  }
})

// Cross-check: the Alliance's Council and ISBA columns against their own
// reports, for contested races (retention columns say Yes/No instead).
const crossChecks: string[] = []
for (const [org, own] of [
  ['Chicago Council of Lawyers', ccl],
  ['Illinois State Bar Association', isba],
] as const) {
  const column = alliance[ALLIANCE_MEMBERS.indexOf(org)]
  for (const r of own.filter((x) => x.context === 'election')) {
    const key = matchJudge(r.name, ballotNames, ALIASES)
    const other = column.find(
      (c) =>
        c.context === 'election' &&
        matchJudge(c.name, ballotNames, ALIASES) === key,
    )
    if (other && other.rating !== r.rating)
      crossChecks.push(
        `${org}, ${r.name}: report "${r.rating}", Alliance table "${other.rating}"`,
      )
  }
}

const out: Record<string, JudgeBarRatings> = {}
for (const key of [...judges.keys()].sort())
  out[key] = buildEntries(lists, matched, key, today, judges.get(key)!.votes)

await mkdir(join(ROOT, 'content', 'profiles', 'judges'), { recursive: true })
// Formatted like the rest of the repo, so a rerun passes `prettier --check`.
await writeFile(OUT, await format(JSON.stringify(out), { parser: 'json' }))

console.log(`${judges.size} judges on the ballot; wrote ${OUT}`)
console.log('\nRated (not "No rating published"), by organization:')
for (const list of lists) {
  const rated = Object.values(out).filter((j) =>
    j.endorsements.some(
      (e) => e.organization === list.organization && e.rating !== NO_RATING,
    ),
  ).length
  console.log(`  ${list.organization}: ${rated} of ${judges.size}`)
}
const report = (title: string, lines: string[]) => {
  console.log(`\n${title}: ${lines.length}`)
  for (const l of lines) console.log(`  ${l}`)
}
report('Unmatched published names', unmatched)
report('Rated for a race the judge is not in', wrongContext)
report('Alliance table differs from the own report', crossChecks)
report(
  'Judges with no rating from any list',
  [...judges].filter(([k]) => !matched.has(k)).map(([, j]) => j.name),
)
