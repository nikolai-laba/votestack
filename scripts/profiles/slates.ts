// Downloads published general-election endorsement lists (slates) and
// writes content/profiles/slates/{slug}.json (committed), with each entry
// matched to a person on the ballot by name and office. generate
// merges matched entries into profiles. Needs `pdftotext` (poppler) and
// data/build/profiles/subjects.json.
//
// Entries that fit no one, or more than one person, are printed for review
// and never merged.
//
// Run:  node scripts/profiles/slates.ts [--only slug,slug]

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  PIPELINE_BUILD,
  SLATES_DIR,
  readSubjects,
  today,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import {
  parseAflCio,
  parseCfl,
  parseLocal150,
  parsePersonalPac,
  type ParsedEntry,
} from '../lib/profiles/slate-parsers.ts'
import { matchSlate, type Slate } from '../lib/profiles/slates.ts'

const { values } = parseArgs({ options: { only: { type: 'string' } } })

const USER_AGENT = 'VoteStack data import (votestack.org)'
const WORK = join(PIPELINE_BUILD, 'slates')

interface Source extends Omit<Slate, 'entries' | 'fetchedAt'> {
  /** Downloads the list and returns its entries; may set documentUrl. */
  read(): Promise<{ entries: ParsedEntry[]; documentUrl?: string }>
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** A PDF's words with positions (pdftotext -bbox). */
async function pdfBbox(url: string, slug: string): Promise<string> {
  const pdf = join(WORK, `${slug}.pdf`)
  await mkdir(WORK, { recursive: true })
  const bytes = await download(url)
  if (bytes.subarray(0, 4).toString() !== '%PDF')
    throw new Error(`${url} isn't a PDF`)
  await writeFile(pdf, bytes)
  return execFileSync('pdftotext', ['-bbox', pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

const SOURCES: Source[] = [
  {
    slug: 'chicago-federation-of-labor',
    endorser: 'Chicago Federation of Labor',
    kind: 'union',
    title: 'November 3, 2026 General Election Endorsed Candidates',
    publisher: 'Chicago Federation of Labor',
    url: 'https://chicagolabor.org/wp-content/uploads/CFL-2026-General-Election-Endorsements.pdf',
    note: 'Most State House names are drawn as outlines without text; they were read off the PDF by hand (CFL_STATE_HOUSE_TRANSCRIBED in scripts/lib/profiles/slate-parsers.ts), and the parser stops if the districts change. "Neutral" races are left out.',
    async read() {
      return { entries: parseCfl(await pdfBbox(this.url, this.slug)) }
    },
  },
  {
    slug: 'personal-pac',
    endorser: 'Personal PAC',
    kind: 'organization',
    title: 'Personal PAC 2026 General Election Endorsements',
    publisher: 'Personal PAC',
    url: 'https://personalpac.org/elections/',
    note: 'Lists more than one candidate in some Chicago school board subdistricts; each listed candidate is endorsed.',
    async read() {
      const html = (await download(this.url)).toString('utf8')
      return { entries: parsePersonalPac(html) }
    },
  },
  {
    slug: 'iuoe-local-150',
    endorser: 'International Union of Operating Engineers Local 150',
    kind: 'union',
    title:
      'IUOE Local 150 Illinois Endorsements, General Election, November 3, 2026 (Cook County)',
    publisher: 'IUOE Local 150',
    url: 'https://local150.org/wp-content/uploads/2026/08/2026-IL-GE_D1_Cook-County_83126.pdf',
    async read() {
      return { entries: parseLocal150(await pdfBbox(this.url, this.slug)) }
    },
  },
  {
    slug: 'illinois-afl-cio',
    endorser: 'Illinois AFL-CIO',
    kind: 'union',
    title: 'Illinois AFL-CIO Announces Endorsements for 2026 General Election',
    publisher: 'Illinois AFL-CIO',
    url: 'https://www.ilaflcio.org/release-general-endorsements-072026/',
    note: 'The release embeds the list as a PDF on Google Drive (documentUrl); profiles cite the release. Statewide list: offices outside Cook County are marked "outside".',
    async read() {
      const page = (await download(this.url)).toString('utf8')
      const id = page.match(/drive\.google\.com\/file\/d\/([\w-]+)/)?.[1]
      if (!id) throw new Error(`No Google Drive file on ${this.url}`)
      const documentUrl = `https://drive.google.com/file/d/${id}/view`
      const bbox = await pdfBbox(
        `https://drive.google.com/uc?export=download&id=${id}`,
        this.slug,
      )
      return { entries: parseAflCio(bbox), documentUrl }
    },
  },
]

const { subjects } = await readSubjects()
const only = values.only?.split(',')
const fetchedAt = today()
let problems = 0

for (const source of SOURCES) {
  if (only && !only.includes(source.slug)) continue
  const { read, ...meta } = source
  const { entries: parsed, documentUrl } = await read.call(source)
  const entries = matchSlate(parsed, subjects)
  const slate: Slate = {
    ...meta,
    ...(documentUrl ? { documentUrl } : {}),
    fetchedAt,
    entries,
  }
  await writeFormattedJson(join(SLATES_DIR, `${source.slug}.json`), slate)

  const count = (status?: string) =>
    entries.filter((e) =>
      status ? e.status === status : e.matchedKey !== null,
    ).length
  console.log(
    `${source.slug}: ${entries.length} entries, ${count()} matched, ${count('outside')} outside Cook County ballots, ${count('unmatched')} unmatched, ${count('ambiguous')} ambiguous`,
  )
  for (const e of entries.filter(
    (x) => x.status === 'unmatched' || x.status === 'ambiguous',
  )) {
    problems++
    console.log(`  ${e.status}: ${e.name} (${e.office}). ${e.note ?? ''}`)
  }
}
if (problems)
  console.log(
    `${problems} entries to review: fix the parser, or confirm the person and add a rule, then run again.`,
  )
