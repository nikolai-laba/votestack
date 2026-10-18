// Reads e-filed California Form 460 and Form 497 PDFs (pdftotext -layout)
// into the shapes in form460.ts. Scanned (image-only) PDFs are read with OCR,
// and only their Summary Page totals are taken, under stricter checks (see
// parseForm460Ocr); a scan that fails them reads as unreadable, never as zeros.
//
// The forms are the FPPC's, so every e-filing system prints the same line
// numbers and labels; only spacing and line breaks differ. The reader goes by
// labels and line numbers, then checks the form's own arithmetic (line 5 =
// lines 1 + 2 + 4, Schedule A's itemized + unitemized = its total, the items
// add up to the itemized total). When a check fails the parts it guards are
// left out rather than guessed. Contributors' names are read only to spot
// the candidate's own gifts and loans; nothing about a donor is returned.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IsoDate } from '../../../src/shared/ballot.ts'
import { RAW } from '../data.ts'
import type { ContributorCode, Form460, LateContribution } from './form460.ts'
import { namesMatch, parseBallotName, splitCommaName } from './names.ts'

export type PdfRead<T> =
  /** `scanned`: read with OCR from a scanned copy, so only its totals. */
  | { ok: true; value: T; scanned?: true }
  | {
      ok: false
      reason: 'scanned' | 'not-460' | 'not-497' | 'unreadable'
      detail?: string
    }

export interface Form497Read {
  committee: string
  committeeId?: string
  contributions: LateContribution[]
}

/** The candidate whose own gifts and loans are picked out, by name. */
export interface CandidateName {
  first: string
  last: string
}

/** The filer as the caller knows it, used for scanned copies in place of the name and ID OCR reads. */
export interface CommitteeHint {
  name?: string
  id?: string
}

/**
 * A Form 460's cover and summary page, plus its Schedule A and C items by
 * code. A scanned copy gives only its Summary Page totals.
 */
export async function readForm460Pdf(
  path: string,
  candidate?: { first: string; last: string },
  committee?: CommitteeHint,
): Promise<PdfRead<Form460>> {
  const read = await textOf(path)
  if (read === null) return { ok: false, reason: 'unreadable', detail: path }
  if (!read.ocr) {
    // A text layer that doesn't parse (a scan with poor OCR text baked in,
    // or a redacted copy) can still have an agreed read of its page images.
    const parsed = parseForm460Text(read.text, candidate)
    if (parsed.ok) return parsed
    return (await scanReadOf(path, committee)) ?? parsed
  }
  const parsed = parseForm460Ocr(read.text, committee)
  if (parsed.ok) {
    parsed.value.fromScan = 'ocr'
    return parsed
  }
  return (await scanReadOf(path, committee)) ?? parsed
}

/**
 * Agreed AI reads of scanned filings, one file per PDF (by its SHA-256):
 * the period and Summary Page lines 1, 2, 4, 5 and 16 that two separate
 * reads of the page images gave identically, with line 5 equal to lines 1,
 * 2 and 4. Written by the scan-reading step, not committed.
 */
const SCAN_READS = join(RAW, 'money', 'scan-reads')

export interface ScanRead {
  from: IsoDate
  through: IsoDate
  line1: number
  line2: number
  line4: number
  line5: number
  line16: number
  committee?: string | null
  committeeId?: string | null
}

async function scanReadOf(
  path: string,
  committee?: CommitteeHint,
): Promise<PdfRead<Form460> | null> {
  const sha = createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
  const file = join(SCAN_READS, `${sha}.json`)
  if (!existsSync(file)) return null
  const value = form460OfScanRead(
    JSON.parse(await readFile(file, 'utf8')) as ScanRead,
    committee,
  )
  return value && { ok: true, value }
}

/** An agreed read as a Form 460; null without a committee name. */
export function form460OfScanRead(
  r: ScanRead,
  committee?: CommitteeHint,
): Form460 | null {
  const name = committee?.name ?? r.committee
  if (!name) return null
  const id = committee?.id ?? r.committeeId ?? undefined
  return {
    committee: name,
    ...(id && { committeeId: id }),
    from: r.from,
    through: r.through,
    summary: {
      monetary: r.line1,
      loans: r.line2,
      nonmonetary: r.line4,
      total: r.line5,
      cashOnHand: r.line16,
    },
    fromScan: 'ai',
  }
}

/** A Form 497's contributions received (part 1). */
export async function readForm497Pdf(
  path: string,
  candidate?: { first: string; last: string },
  committee?: CommitteeHint,
): Promise<
  PdfRead<{
    committee: string
    committeeId?: string
    contributions: LateContribution[]
  }>
> {
  const read = await textOf(path)
  if (read === null) return { ok: false, reason: 'unreadable', detail: path }
  return read.ocr
    ? parseForm497Ocr(read.text, committee)
    : parseForm497Text(read.text, candidate)
}

/**
 * The PDF's text layer, or for a scanned PDF the text tesseract reads from
 * its page images (cached next to the PDF), flagged as OCR so the scan
 * parsers read it. When OCR fails the empty text layer reads as scanned.
 */
async function textOf(
  path: string,
): Promise<{ text: string; ocr: boolean } | null> {
  const text = await pdfText(path)
  if (text === null) return null
  if (!looksScanned(pagesOf(text))) return { text, ocr: false }
  const cached = `${path}.ocr-layout.txt`
  if (existsSync(cached))
    return { text: await readFile(cached, 'utf8'), ocr: true }
  const ocr = await ocrText(path)
  if (ocr === null) return { text, ocr: false }
  await writeFile(cached, ocr)
  return { text: ocr, ocr: true }
}

const run = (cmd: string, args: string[]) =>
  new Promise<string | null>((resolve) =>
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout),
    ),
  )

/**
 * Text from each page image (300 dpi), laid out from the words' positions
 * (see layoutOf), pages separated by form feeds; null if a tool fails.
 */
async function ocrText(path: string): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), 'form460-ocr-'))
  try {
    if (
      (await run('pdftoppm', ['-r', '300', '-png', path, join(dir, 'p')])) ===
      null
    )
      return null
    const images = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
    const pages: string[] = []
    for (const image of images) {
      // Sparse-text segmentation reads the amounts written on a form's
      // underlines far better than treating the page as one block; the
      // rows and columns are rebuilt from the word boxes.
      const tsv = await run('tesseract', [
        join(dir, image),
        '-',
        '--psm',
        '11',
        'tsv',
      ])
      if (tsv === null) return null
      pages.push(layoutOf(tsv))
    }
    return pages.join('\f')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Pixels per character column when laying out OCR words (300 dpi). */
const PX_PER_COLUMN = 10

/**
 * Tesseract's word boxes (TSV) as layout text, like pdftotext -layout: words
 * whose boxes overlap vertically share a line, and each starts at the column
 * its left edge maps to, so one column of the form lines up down the page.
 */
export function layoutOf(tsv: string): string {
  const words: { x: number; top: number; bottom: number; text: string }[] = []
  for (const row of tsv.split('\n').slice(1)) {
    const f = row.split('\t')
    const text = f[11]?.trim()
    if (f[0] !== '5' || !text) continue
    const [x, top, , h] = f.slice(6, 10).map(Number)
    words.push({ x, top, bottom: top + h, text })
  }
  words.sort((a, b) => a.top + a.bottom - (b.top + b.bottom))
  const lines: { top: number; bottom: number; words: typeof words }[] = []
  for (const w of words) {
    const h = w.bottom - w.top
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, w.bottom) - Math.max(l.top, w.top)
      return overlap >= 0.5 * Math.min(h, l.bottom - l.top)
    })
    if (line) {
      line.words.push(w)
      line.top = Math.min(line.top, w.top)
      line.bottom = Math.max(line.bottom, w.bottom)
    } else lines.push({ top: w.top, bottom: w.bottom, words: [w] })
  }
  lines.sort((a, b) => a.top - b.top)
  return lines
    .map((l) => {
      let out = ''
      for (const w of l.words.sort((a, b) => a.x - b.x)) {
        const col = Math.round(w.x / PX_PER_COLUMN)
        out += (out ? ' ' : '').padEnd(Math.max(1, col - out.length)) + w.text
      }
      return out
    })
    .join('\n')
}

/** The PDF's text, page by page (form feeds between pages), or null if pdftotext fails. */
function pdfText(path: string): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(
      'pdftotext',
      ['-layout', '-enc', 'UTF-8', path, '-'],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    ),
  )
}

// ---------------------------------------------------------------- helpers

const CODES: readonly ContributorCode[] = ['IND', 'COM', 'OTH', 'PTY', 'SCC']

/** Dollar amounts with cents ("1,234.56", "-50.00", "(50.00)"), in order. */
const AMOUNT =
  /(?<![\d.,/A-Za-z])(\(?)\$?(-?)\$?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(\)?)(?![\d%])(?!\s*%)/g

export function amountsIn(line: string): number[] {
  const out: number[] = []
  for (const m of line.matchAll(AMOUNT)) {
    const n = Number(`${m[3].replace(/,/g, '')}.${m[4]}`)
    out.push(m[2] === '-' || (m[1] === '(' && m[5] === ')') ? -n : n)
  }
  return out
}

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/
const isoOf = (m: RegExpMatchArray): IsoDate => `${m[3]}-${m[1]}-${m[2]}`
const near = (a: number, b: number, within = 0.01) =>
  Math.abs(a - b) <= within + 1e-9
const round2 = (n: number) => Math.round(n * 100) / 100

/** Average printable characters per page below this means no text layer. */
const SCANNED_CHARS_PER_PAGE = 40

function pagesOf(text: string): string[] {
  const pages = text.split('\f')
  if (pages.length > 1 && pages.at(-1)!.trim() === '') pages.pop()
  return pages
}

function looksScanned(pages: string[]): boolean {
  const chars = pages.join('').replace(/\s/g, '').length
  return chars < SCANNED_CHARS_PER_PAGE * Math.max(1, pages.length)
}

/** Which part of the form a page is ("cover", "summary", "A", "B1", "C", ...). */
export function pageKind(page: string): string | undefined {
  const head = page.split('\n').slice(0, 16).join('\n')
  const top = page.split('\n').slice(0, 6).join('\n')
  const kinds: [RegExp, string][] = [
    [/COVER PAGE/, 'cover'],
    [/ADDITIONAL COMMENTS/, 'comments'],
    [/SUMMARY PAGE/, 'summary'],
    [/SCHEDULE\s+B\s*[-–]\s*PART\s*2/, 'B2'],
    [/SCHEDULE\s+([A-I])\b/, ''],
  ]
  for (const [re, kind] of kinds) {
    const m = head.match(re)
    if (m) return kind || (m[1] === 'B' ? 'B1' : m[1])
  }
  // Mixed-case titles, as some filing programs print them. A schedule's
  // title can sit under the form's title, so it's looked for first.
  const s = top.match(/^\s*Schedule\s+([A-I])\b(?!\s+Summary)/im)
  if (!s && /^\s*(Recipient Committee\s+)?Campaign Statement\s*$/m.test(head))
    return /Part 2/i.test(head) ? 'cover2' : 'cover'
  if (/^\s*Summary Page\b/im.test(head)) return 'summary'
  if (/^\s*Additional Comments\b/im.test(head)) return 'comments'
  if (s) {
    const letter = s[1].toUpperCase()
    if (letter === 'B') return /Part\s*2/i.test(head) ? 'B2' : 'B1'
    return letter
  }
  return undefined
}

/** The text before the first run of 3+ spaces: the left-hand column of a layout line. */
const leftCell = (line: string) => line.trim().split(/\s{3,}/)[0] ?? ''

/** True when a contributor or lender name is the candidate's (strictly: full last name, same given name). */
export function isCandidateName(
  name: string,
  candidate: CandidateName | undefined,
): boolean {
  if (!candidate) return false
  let n = name.replace(/\(ID#.*$/i, '').trim()
  if (!n || /\b(inc|llc|committee|for|pac|union|corp|association)\b/i.test(n))
    return false
  if (n.includes(',')) {
    const { last, first } = splitCommaName(n)
    n = `${first} ${last}`
  }
  return namesMatch(parseBallotName(n), candidate.last, candidate.first, {
    strictGiven: true,
  })
}

// ---------------------------------------------------------------- Form 460

/** The amount on a summary-page line: on the label's own line, or on the line next to it when the layout split them. */
function summaryLine(lines: string[], n: number): number | undefined {
  const label = new RegExp(`^\\s*${n}\\.\\s+[A-Za-z]`)
  const i = lines.findIndex((l) => label.test(l))
  if (i < 0) return undefined
  const own = amountsIn(lines[i].replace(label, ' '))
  if (own.length) return own[0]
  // The amount printed just above or below, on a line with no label of its own.
  for (const j of [i - 1, i + 1]) {
    const l = lines[j]
    if (l === undefined || /^\s*\d+\.\s/.test(l)) continue
    const a = amountsIn(l)
    if (a.length) return a[0]
  }
  return undefined
}

/** The filer's name and FPPC ID from the "NAME OF FILER ... I.D. NUMBER" heading. */
function filerOf(lines: string[]): { name?: string; id?: string } {
  const i = lines.findIndex((l) => /^\s*NAME OF FILER\b/.test(l))
  if (i < 0) {
    // "Name of filer: ..." on one line, as some programs print it.
    const inline = lines
      .map((l) => l.match(/Name of filer:\s*(\S.*?)(\s{3,}|$)/i))
      .find((m) => m)
    return inline ? { name: inline[1] } : {}
  }
  for (const l of lines.slice(i + 1, i + 5)) {
    if (!l.trim() || /I\.D\. NUMBER|NAME OF FILER/i.test(l)) continue
    const cells = l.trim().split(/\s{3,}/)
    const id = cells.length > 1 ? cells.at(-1)!.match(/^#?(\d{5,9})$/) : null
    return { name: cells[0], ...(id && { id: id[1] }) }
  }
  return {}
}

function periodOf(
  lines: string[],
): { from: IsoDate; through: IsoDate } | undefined {
  let from: IsoDate | undefined
  let through: IsoDate | undefined
  for (const l of lines) {
    const f = l.match(/\bfrom\s+(\d{2}\/\d{2}\/\d{4})/i)
    if (f && !from) from = isoOf(f[1].match(DATE)!)
    // The City of Los Angeles's e-filings print "to" where the form says "through".
    const t = l.match(/\b(?:through|to)\s+(\d{2}\/\d{2}\/\d{4})/i)
    if (t && !through) through = isoOf(t[1].match(DATE)!)
  }
  if (from && through) return { from, through }
  // Scanned and some other filings split the period over several lines and
  // spell the month out ("from July / 1, 2026 / through / September 19, 2026").
  const flat = lines.join(' ').replace(/\s+/g, ' ')
  const m = flat.match(
    new RegExp(
      `\\bfrom:? (${LONG_DATE.source}) through:? (${LONG_DATE.source})`,
      'i',
    ),
  )
  const a = m && dateIn(m[1])
  const b = m && dateIn(m[2])
  return a && b ? { from: a, through: b } : undefined
}

/** A date as "07/01/2026", "7/1/2026" or "July 1, 2026". */
const LONG_DATE =
  /\d{1,2}\/\d{1,2}\/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.? \d{1,2},? \d{4}/
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

function dateIn(text: string): IsoDate | undefined {
  const pad = (n: string | number) => String(n).padStart(2, '0')
  const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slash) return `${slash[3]}-${pad(slash[1])}-${pad(slash[2])}`
  const long = text.match(/([A-Za-z]+)\.? (\d{1,2}),? (\d{4})/)
  const month = long && MONTHS.indexOf(long[1].slice(0, 3).toLowerCase())
  return long && month !== null && month >= 0
    ? `${long[3]}-${pad(month + 1)}-${pad(long[2])}`
    : undefined
}

interface Item {
  name: string
  amount: number
  code?: ContributorCode
}

/**
 * Items on Schedule A or C pages: each starts with a line beginning with the
 * date received, whose first amount is the amount this period; its code is
 * the one marked with an X (or the only code printed) before the next item.
 */
function itemsOn(pages: string[]): Item[] {
  const items: Item[] = []
  for (const page of pages) {
    const lines = page.split('\n')
    let cur: { name: string; amount: number; block: string[] } | null = null
    const close = () => {
      if (cur) items.push({ ...cur, code: codeOf(cur.block) })
      cur = null
    }
    for (const line of lines) {
      const start = line.match(/^\s*(\d{2}\/\d{2}\/(?:\d{4}|\d{2}))\s+(.*)$/)
      if (start) {
        const amounts = amountsIn(start[2])
        if (amounts.length) {
          close()
          cur = { name: leftCell(start[2]), amount: amounts[0], block: [line] }
          continue
        }
      }
      if (/SUBTOTAL|Schedule [AC] Summary|Contributor Codes/i.test(line)) {
        close()
        continue
      }
      if (cur) cur.block.push(line)
    }
    close()
  }
  return items
}

function codeOf(block: string[]): ContributorCode | undefined {
  const text = block.join('\n')
  const marked = [
    ...text.matchAll(/(?:^|\s)[Xx✓✔☒■]\s*(IND|COM|OTH|PTY|SCC)\b/g),
  ].map((m) => m[1] as ContributorCode)
  if (new Set(marked).size === 1) return marked[0]
  if (marked.length) return undefined
  // No check marks: some programs print only the chosen code.
  const printed = [...text.matchAll(/\b(IND|COM|OTH|PTY|SCC)\b/g)].map(
    (m) => m[1] as ContributorCode,
  )
  if (printed.length)
    return new Set(printed).size === 1 ? printed[0] : undefined
  // Some programs (the City of Los Angeles's e-filing) spell the code out
  // on the item's first line.
  return CODE_WORDS.find(([words]) => words.test(block[0]))?.[1]
}

/** Spelled-out contributor codes, most specific first ("Other: Non-Individual" before "Individual"). */
const CODE_WORDS: [RegExp, ContributorCode][] = [
  [/\bSmall Contributor\b/, 'SCC'],
  [/\bPolitical Party\b/, 'PTY'],
  // The code column can wrap ("Other: Non-" / "Individual"), so these match
  // the first line's part.
  [/\bOther: Non-/, 'OTH'],
  [/\bIndividual\b/, 'IND'],
  [/\bCommittee\b/, 'COM'],
]

/** A schedule summary's lines 1–3 (itemized, unitemized, total), checked against each other. */
function scheduleSummary(
  pages: string[],
  letter: 'A' | 'C',
): { itemized: number; unitemized: number; total: number } | undefined {
  for (const page of pages) {
    const lines = page.split('\n')
    const i = lines.findIndex((l) =>
      new RegExp(`Schedule ${letter} Summary`, 'i').test(l),
    )
    if (i < 0) continue
    const amounts: number[] = []
    for (const l of lines.slice(i + 1)) {
      if (/FPPC Form 460|^\s*Schedule [B-I]\b/i.test(l)) break
      amounts.push(...amountsIn(l))
    }
    const [itemized, unitemized, total] = amounts
    if (amounts.length >= 3 && near(round2(itemized + unitemized), total, 0.01))
      return { itemized, unitemized, total }
    return undefined
  }
  return undefined
}

/**
 * Schedule B part 1 loans. Each loan is a block from the lender's line
 * (ending "CALENDAR YEAR" in the printed layout) to its "DATE DUE" line; its
 * lower row, after the "FORGIVEN" label, holds columns (a) beginning
 * balance, (b) amount received this period, (c) forgiven and (e) interest,
 * in that order. The caller checks the loans add up to Schedule B line 1.
 */
function loansOn(pages: string[]): { name: string; received: number }[] {
  const loans: { name: string; received: number }[] = []
  for (const page of pages) {
    const lines = page.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/CALENDAR YEAR\s*$/.test(lines[i])) continue
      const name = leftCell(lines[i])
      if (!name || /^(PAID|FORGIVEN|RATE|CALENDAR YEAR)$/.test(name)) continue
      const end = lines.findIndex((l, j) => j > i && /DATE DUE/.test(l))
      if (end < 0) continue
      const block = lines.slice(i + 1, end)
      const lower = block.findIndex((l) => /FORGIVEN/.test(l))
      if (lower < 0) continue
      // Per-election amounts ("G2026 2,000.00") print in the same rows.
      const amounts = block
        .slice(lower + 1)
        .map((l) => l.replace(/\b[PGRS]\d{4}\s+\$?\s*[\d,]+\.\d\d/g, ' '))
        .flatMap(amountsIn)
      if (amounts.length >= 2) loans.push({ name, received: amounts[1] })
      i = end
    }
  }
  return loans
}

function loansReceivedTotal(pages: string[]): number | undefined {
  for (const page of pages) {
    const lines = page.split('\n')
    const i = lines.findIndex((l) => /Schedule B Summary/i.test(l))
    if (i < 0) continue
    for (const l of lines.slice(i + 1, i + 6)) {
      if (/^\s*1\.\s/.test(l)) return amountsIn(l)[0]
    }
  }
  return undefined
}

/** A Form 460's text (pdftotext -layout) as a Form460. */
export function parseForm460Text(
  text: string,
  candidate?: CandidateName,
): PdfRead<Form460> {
  const pages = pagesOf(text)
  if (looksScanned(pages)) return { ok: false, reason: 'scanned' }
  if (!/\b460\b/.test(text) || !/Summary Page/i.test(text))
    return { ok: false, reason: 'not-460' }
  const kinds = pages.map(pageKind)
  const of = (k: string) => pages.filter((_, i) => kinds[i] === k)
  const summaryPage = of('summary')[0]
  if (!summaryPage)
    return { ok: false, reason: 'unreadable', detail: 'no Summary Page' }
  const lines = summaryPage.split('\n')
  const filer = filerOf(lines)
  const period = periodOf(lines) ?? periodOf(text.split('\n'))
  if (!period)
    return { ok: false, reason: 'unreadable', detail: 'no period dates' }
  const [monetary, loans, nonmonetary, total, cash] = [1, 2, 4, 5, 16].map(
    (n) => summaryLine(lines, n),
  )
  if (
    monetary === undefined ||
    loans === undefined ||
    nonmonetary === undefined ||
    total === undefined
  )
    return {
      ok: false,
      reason: 'unreadable',
      detail: 'Summary Page lines 1, 2, 4 or 5 not found',
    }
  if (!near(round2(monetary + loans + nonmonetary), total, 1))
    return {
      ok: false,
      reason: 'unreadable',
      detail: `line 5 (${total}) isn't lines 1 + 2 + 4 (${monetary} + ${loans} + ${nonmonetary})`,
    }

  const cover = of('cover')[0] ?? pages[0]
  const filedOn = cover.match(/E-?Filed\s+(\d{2}\/\d{2}\/\d{4})/i)
  const committee =
    filer.name ??
    leftCell(
      cover.split('\n')[
        cover.split('\n').findIndex((l) => /COMMITTEE NAME/i.test(l)) + 1
      ] ?? '',
    )
  const report: Form460 = {
    committee,
    ...(filer.id && { committeeId: filer.id }),
    from: period.from,
    through: period.through,
    ...(filedOn && { filedOn: isoOf(filedOn[1].match(DATE)!) }),
    summary: {
      monetary,
      loans,
      nonmonetary,
      total,
      ...(cash !== undefined && { cashOnHand: cash }),
    },
  }

  // Items by code, kept only when every part checks out.
  const schedA = of('A')
  const schedC = of('C')
  const a =
    monetary === 0 && schedA.length === 0
      ? { itemized: 0, unitemized: 0, total: 0 }
      : scheduleSummary(schedA, 'A')
  const c =
    nonmonetary === 0 && schedC.length === 0
      ? { itemized: 0, unitemized: 0, total: 0 }
      : scheduleSummary(schedC, 'C')
  const itemsA = itemsOn(schedA)
  const itemsC = itemsOn(schedC)
  const items = [...itemsA, ...itemsC]
  const sum = (xs: Item[]) => round2(xs.reduce((n, x) => n + x.amount, 0))
  const loanItems = loansOn(of('B1'))
  const loansIn = loansReceivedTotal(of('B1'))
  const loansOk =
    loans === 0 ||
    (loansIn !== undefined &&
      near(sum(loanItems.map((l) => ({ ...l, amount: l.received }))), loansIn))
  if (
    a &&
    c &&
    near(a.total, monetary, 1) &&
    near(c.total, nonmonetary, 1) &&
    near(sum(itemsA), a.itemized, 1) &&
    near(sum(itemsC), c.itemized, 1) &&
    items.every((x) => x.code) &&
    loansOk
  ) {
    const byCode: Partial<Record<ContributorCode, number>> = {}
    for (const code of CODES) {
      const n = sum(items.filter((x) => x.code === code))
      if (n) byCode[code] = n
    }
    report.byCode = byCode
    // Unitemized gifts under $100, money and in-kind alike.
    report.unitemized = round2(a.unitemized + c.unitemized)
    const own = sum(
      items.filter(
        (x) => x.code === 'IND' && isCandidateName(x.name, candidate),
      ),
    )
    if (own > 0) report.fromCandidate = own
    // Line 2 is loans received less loans repaid, so the candidate's loans
    // count only up to it (a loan made and repaid this period adds nothing).
    const ownLoans = round2(
      Math.min(
        loans,
        loanItems
          .filter((l) => isCandidateName(l.name, candidate))
          .reduce((n, l) => n + l.received, 0),
      ),
    )
    if (ownLoans > 0) report.loansFromCandidate = ownLoans
  }
  return { ok: true, value: report }
}

// ---------------------------------------------------------------- Form 497

/**
 * The FPPC ID printed under the "I.D. NUMBER" label: the 6–8 digit number in
 * the next few lines that starts nearest the label's column (the report
 * number and phone number sit in other columns).
 */
function idUnderLabel(lines: string[]): string | undefined {
  const i = lines.findIndex((l) => /I\.D\. NUMBER/i.test(l))
  if (i < 0) return undefined
  const col = lines[i].search(/I\.D\. NUMBER/i)
  let best: { id: string; off: number } | undefined
  for (const l of lines.slice(i + 1, i + 4))
    for (const m of l.matchAll(/(?<![\d/:()-])(\d{6,8})(?![\d/:)-])/g)) {
      const off = Math.abs(m.index - col)
      if (off <= 20 && (!best || off < best.off)) best = { id: m[1], off }
    }
  return best?.id
}

/** A Form 497's text as its part 1 contributions received. */
export function parseForm497Text(
  text: string,
  candidate?: CandidateName,
): PdfRead<Form497Read> {
  const pages = pagesOf(text)
  if (looksScanned(pages)) return { ok: false, reason: 'scanned' }
  if (!/\b497\b/.test(text) || !/Contribution\(?s?\)? Received/i.test(text))
    return { ok: false, reason: 'not-497' }
  const lines = text.split('\n')
  const filer = (() => {
    const i = lines.findIndex((l) => /NAME OF FILER/i.test(l))
    return i < 0
      ? ''
      : (lines
          .slice(i + 1, i + 4)
          .map(leftCell)
          .find((s) => s) ?? '')
  })()
  const committeeId = idUnderLabel(lines)

  const contributions: LateContribution[] = []
  let inPart1 = false
  let cur: {
    date: IsoDate
    amount?: number
    name: string
    block: string[]
  } | null = null
  const close = () => {
    if (cur && cur.amount !== undefined) {
      const code = codeOf(cur.block)
      if (code)
        contributions.push({
          date: cur.date,
          amount: cur.amount,
          code,
          ...(code === 'IND' &&
            isCandidateName(cur.name, candidate) && { fromCandidate: true }),
        })
      else
        throw new Error(
          `Form 497 item on ${cur.date} for ${cur.amount} has no contributor code`,
        )
    }
    cur = null
  }
  try {
    for (const line of lines) {
      if (/^\s*1\.\s*Contribution\(?s?\)? Received/i.test(line)) {
        inPart1 = true
        continue
      }
      if (/^\s*2\.\s*Contribution\(?s?\)? Made/i.test(line)) {
        close()
        inPart1 = false
        continue
      }
      if (!inPart1) continue
      if (/Contributor Codes|FPPC Form 497/i.test(line)) {
        close()
        continue
      }
      const start = line.match(/^\s*(\d{2}\/\d{2}\/(?:\d{4}|\d{2}))\s+(.*)$/)
      if (start) {
        close()
        const a = amountsIn(start[2])
        cur = {
          date: isoOf(start[1].match(DATE)!),
          name: leftCell(start[2]),
          block: [line],
          ...(a.length && { amount: a.at(-1) }),
        }
        continue
      }
      if (cur) {
        cur.block.push(line)
        if (cur.amount === undefined && cur.block.length <= 3) {
          const a = amountsIn(line)
          if (a.length) cur.amount = a.at(-1)
        }
      }
    }
    close()
  } catch (e) {
    return { ok: false, reason: 'unreadable', detail: (e as Error).message }
  }
  return {
    ok: true,
    value: {
      committee: filer,
      ...(committeeId && { committeeId }),
      contributions,
    },
  }
}

// ---------------------------------------------------------------- scanned copies

// OCR of a paper filing misreads line numbers ("8." for "5."), dollar signs
// and digits. So a scan gives only its Summary Page totals, each found by
// its words and read from under the "Column A" heading, and only when the
// form's own arithmetic confirms every one of them to the cent. Amounts
// must show their cents or a thousands comma: a dropped decimal point would
// otherwise read as whole dollars, 100 times too much, and still add up.

/** One OCR token as an amount: "20,000.00", "2678.79", "440,00", "(50.00)"; or 0 for "0", "O", "Oo", "-0-". */
function ocrValue(token: string): number | undefined {
  const t = token.replace(/^[|$§¢:;'‘’"]+|[|:;'‘’"]+$/g, '')
  if (/^-?[0Oo]{1,3}-?$|^[0Oo][.,-]?[0Oo]{2}$/.test(t)) return 0
  const m = t.match(/^(\(?)(-?)(\d{1,3}(?:,\d{3})+|\d+)[.,-](\d{2})(\)?)$/)
  if (!m) {
    // Whole dollars, as the form allows, but only with a thousands comma
    // ("6,477"): a bare "77900" may be 779.00 with its point lost.
    const whole = t.match(/^\d{1,3}(?:,\d{3})+$/)
    return whole ? Number(t.replace(/,/g, '')) : undefined
  }
  const n = Number(`${m[3].replace(/,/g, '')}.${m[4]}`)
  return m[2] === '-' || (m[1] === '(' && m[5] === ')') ? -n : n
}

/** Where the Summary Page's two amount columns are: the character columns of its "Column A" and "Column B" headings. */
interface Columns {
  a: number
  b: number
  /** Half the distance between them. */
  half: number
}

function columnsOf(lines: string[]): Columns | undefined {
  for (const l of lines) {
    const at = [...l.matchAll(/\bColu\w*/gi)].map((m) => m.index + 4)
    if (at.length === 2 && at[1] - at[0] >= 10)
      return { a: at[0], b: at[1], half: (at[1] - at[0]) / 2 }
  }
  return undefined
}

/**
 * The column A amount on a line, after its label: the one amount whose
 * centre is nearer column A than column B (and no further left of it).
 * "blank" when there is none there, undefined when there are several.
 */
function columnA(
  line: string,
  label: RegExp,
  cols: Columns,
): number | 'blank' | undefined {
  const m = line.match(label)
  if (!m || m.index === undefined) return undefined
  const start = m.index + m[0].length
  const rest = line
    .slice(start)
    // Underlines before an amount aren't a minus sign.
    .replace(/[_—–][_—–-]*/g, (u) => ' '.repeat(u.length))
    // "24,000 | 00": cents written in a box of their own.
    .replace(
      /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)\.?( {1,12})(\d{2})(?![\d,.])/g,
      (all, a: string, _: string, c: string) => `${a}.${c}`.padEnd(all.length),
    )
    // "24, 000.00" and "3 350.00": a thousands comma split off or read as a space.
    .replace(
      /(?<![\d,.])([1-9]\d{0,2})(?:, | )(\d{3}[.,-]\d{2})(?![\d,])/g,
      (_, a: string, b: string) => `${a},${b}`.padEnd(a.length + b.length + 2),
    )
  const found: number[] = []
  for (const t of rest.matchAll(/\S+/g)) {
    const centre = start + t.index + t[0].length / 2
    if (Math.abs(centre - cols.a) >= cols.half) continue
    const v = ocrValue(t[0])
    if (v !== undefined) found.push(v)
    // Anything legible right after an amount ("48,204 0S") may be part of
    // it: its cents, misread.
    else if (found.length && /[A-Za-z0-9]/.test(t[0])) return undefined
  }
  return found.length === 0
    ? 'blank'
    : found.length === 1
      ? found[0]
      : undefined
}

/** The index of the one line matching `label` (and not `not`) between `from` and `to`; undefined when none or several. */
function onlyLine(
  lines: string[],
  label: RegExp,
  not?: RegExp,
  from = 0,
  to = lines.length,
): number | undefined {
  const hits: number[] = []
  for (let i = from; i < to; i++)
    if (label.test(lines[i]) && !not?.test(lines[i])) hits.push(i)
  return hits.length === 1 ? hits[0] : undefined
}

const OCR_DATE = /\d{1,2}\/\d{1,2}\/\d{2,4}/

/** "MM/DD/YYYY" as an ISO date when it's a real calendar date. */
function cleanDate(text: string): IsoDate | undefined {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return undefined
  const iso: IsoDate = `${m[3]}-${m[1]}-${m[2]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso)
    ? iso
    : undefined
}

/** "July 1, 2026" or "Sept. 30, 2026", read only when the month and day are real. */
const LONG_WORDS = /\b[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}\b/

function cleanLongDate(text: string): IsoDate | undefined {
  const m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (!m) return undefined
  const word = m[1].toLowerCase()
  const month = MONTHS.indexOf(word.slice(0, 3))
  if (month < 0) return undefined
  const full = new Date(Date.UTC(2000, month, 1))
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
    .toLowerCase()
  if (!full.startsWith(word) && word !== 'sept') return undefined
  const pad = (n: string | number) => String(n).padStart(2, '0')
  return cleanDate(`${pad(month + 1)}/${pad(m[2])}/${m[3]}`)
}

type DateRead = IsoDate | 'bad'

/** A page's "from" and "through" dates: the date after each word on its line; "bad" when that date isn't clean or two differ. */
function ocrPeriod(lines: string[]): { from?: DateRead; through?: DateRead } {
  const out: { from?: DateRead; through?: DateRead } = {}
  for (const word of ['from', 'through'] as const) {
    const reads = new Set<DateRead>()
    for (const l of lines) {
      const m = l.match(new RegExp(`\\b${word}\\b(.*)$`, 'i'))
      if (!m) continue
      const d = m[1].match(OCR_DATE)
      const long = m[1].match(LONG_WORDS)
      if (d) reads.add(cleanDate(d[0]) ?? 'bad')
      else if (long) reads.add(cleanLongDate(long[0]) ?? 'bad')
    }
    if (reads.size === 1) out[word] = [...reads][0]
    else if (reads.size > 1) out[word] = 'bad'
  }
  return out
}

const reject = (detail: string): PdfRead<never> => ({
  ok: false,
  reason: 'unreadable',
  detail: `scanned copy: ${detail}`,
})

/** The filer's name and ID under "NAME OF FILER", when the OCR reads them cleanly. */
function ocrFiler(lines: string[]): { name?: string; id?: string } {
  const i = lines.findIndex((l) => /NAME\s+OF\s+FILER/i.test(l))
  if (i < 0) return {}
  const next = lines
    .slice(i + 1, i + 4)
    .map((l) => l.replace(/^[\s|:;.,'‘’"©]+/, '').trimEnd())
    .find((l) => l && !/\bNUMBER\b/i.test(l))
  if (!next) return {}
  // The ID (or "Pending") sits far to the right of the name.
  const cells = next.split(/\s{3,}/)
  const last = cells.length > 1 ? cells.at(-1)! : ''
  const id = last.match(/^#?(\d{6,9})$/)
  if (id || /^Pending$/i.test(last)) cells.pop()
  const name = cells.join(' ').replace(/\s+/g, ' ')
  const clean =
    /^[A-Za-z][A-Za-z0-9 .,'&()/-]{3,79}$/.test(name) &&
    (name.match(/[A-Za-z]{2,}/g) ?? []).length >= 2
  return { ...(clean && { name }), ...(id && { id: id[1] }) }
}

/**
 * A scanned Form 460's OCR text (see layoutOf) as its Summary Page totals.
 * Lines 1, 2, 4, 5 and 16 are found by their words and read from column A;
 * a blank line 1, 2 or 4 counts as 0. The report is accepted only when line
 * 5 = 1 + 2 + 4, line 3 (when read) = 1 + 2, line 13 (when read) = line 3,
 * line 16 = 12 + 13 + 14 - 15 (when those are read), and the cover and
 * Summary Page agree on a period ending in 2025 or 2026. No breakdown and no
 * candidate money are read from a scan.
 */
export function parseForm460Ocr(
  text: string,
  hint?: CommitteeHint,
): PdfRead<Form460> {
  const pages = pagesOf(text)
  const summaryIdx = pages.findIndex(
    (p) => /Summary\s+Page/i.test(p) && /ENDING\s*[CG]ASH/i.test(p),
  )
  if (summaryIdx < 0) {
    if (!/\b460\b/.test(text) && /\b497\b/.test(text))
      return { ok: false, reason: 'not-460' }
    return reject('no Summary Page found')
  }
  const lines = pages[summaryIdx].split('\n')

  // Lines by their words, each found once.
  const L1 = /(?<![A-Za-z-])Monetary\b/i
  const L2 = /\bLoans\b/i
  const L3 = /SUBTOTAL\s*CASH\s*CONTRIB\S*/i
  const L4 = /Non[\s-]*monetary\b/i
  const L5 = /TOTAL\s*CONTRIBUTIONS\s*REC\S*/i
  const L16 = /ENDING\s*[CG]ASH\s*BAL\S*/i
  const l5 = onlyLine(lines, L5)
  const l1 = onlyLine(lines, L1, /Non[\s-]*monetary/i)
  if (l1 === undefined || l5 === undefined || l1 > l5)
    return reject('Summary Page lines 1 or 5 not found')
  const l2 = onlyLine(lines, L2, /\bMad[ea]?\b/i, l1 + 1, l5)
  const l3 = onlyLine(lines, L3, undefined, l1, l5)
  const l4 = onlyLine(lines, L4, /Adjust/i, (l3 ?? l2 ?? l1) + 1, l5)
  const l16 = onlyLine(lines, L16)
  if (l2 === undefined || l4 === undefined || l16 === undefined)
    return reject('Summary Page lines 2, 4 or 16 not found')
  const cols = columnsOf(lines.slice(0, l1))
  if (!cols) return reject('Column A and B headings not found')

  // Typed or written amounts can sit just above or below their label's row.
  // Each block (lines 1-5, lines 12-16) is read at one offset: the row of
  // line 5 (or 16) itself, else the amount-only row above it, else below.
  const amountRow = (i: number) => {
    const l = lines[i]
    const labelArea = l?.slice(0, Math.max(0, Math.floor(cols.a - cols.half)))
    return l === undefined || /[A-Za-z0-9]/.test(labelArea!)
      ? 'blank'
      : columnA(l, /^/, cols)
  }
  const offsetOf = (i: number, label: RegExp) =>
    typeof columnA(lines[i], label, cols) === 'number'
      ? 0
      : typeof amountRow(i - 1) === 'number'
        ? -1
        : typeof amountRow(i + 1) === 'number'
          ? 1
          : 0
  const at = (i: number, label: RegExp, offset: number) =>
    offset === 0 ? columnA(lines[i], label, cols) : amountRow(i + offset)
  const top = offsetOf(l5, L5)
  const bottom = offsetOf(l16, L16)
  const [r1, r2, r4, r5] = [
    [l1, L1],
    [l2, L2],
    [l4, L4],
    [l5, L5],
  ].map(([i, re]) => at(i as number, re as RegExp, top))
  const r16 = at(l16, L16, bottom)
  if ([r1, r2, r4].includes(undefined))
    return reject('more than one amount in column A on line 1, 2 or 4')
  // A blank line 1, 2 or 4 is 0; line 5's arithmetic must confirm it.
  const [monetary, loans, nonmonetary] = [r1, r2, r4].map((r) =>
    r === 'blank' ? 0 : (r as number),
  )
  if (typeof r5 !== 'number')
    return reject('no single amount read on Summary Page line 5')
  if (typeof r16 !== 'number')
    return reject('no single ending cash balance read (Summary Page line 16)')
  const total = r5
  const cash = r16
  if (!near(round2(monetary + loans + nonmonetary), total))
    return reject(
      `line 5 (${total}) isn't lines 1 + 2 + 4 (${monetary} + ${loans} + ${nonmonetary})`,
    )
  const cashIn = round2(monetary + loans)
  const r3 = l3 === undefined ? 'blank' : at(l3, L3, top)
  if (typeof r3 === 'number' && !near(r3, cashIn))
    return reject(`line 3 (${r3}) isn't lines 1 + 2 (${cashIn})`)

  // Lines 12-16, the current cash statement, have column A only.
  const cashLine = (label: RegExp, not?: RegExp) => {
    const i = onlyLine(lines, label, not, l5 + 1, l16)
    const r = i === undefined ? undefined : at(i, label, bottom)
    return typeof r === 'number' ? r : undefined
  }
  const begin = cashLine(/Beginning\s+Cash\s*\S*/i)
  const receipts = cashLine(/Cash\s+Rec\w*/i)
  const misc = cashLine(/Increases\s+to\s+Cash\S*/i) ?? 0
  const paid = cashLine(/Cash\s+Pay\w*/i, /SUBTOTAL/i)
  if (receipts !== undefined && !near(receipts, cashIn))
    return reject(`line 13 (${receipts}) isn't line 3 (${cashIn})`)
  if (begin !== undefined && receipts !== undefined && paid !== undefined) {
    if (!near(round2(begin + receipts + misc - paid), cash))
      return reject(`line 16 (${cash}) isn't lines 12 + 13 + 14 - 15`)
  } else {
    // Unchecked, line 16 must at least be printed cleanly: "2,713.88", or
    // "2,713  88" with the cents in a box of their own.
    const printed = cash
      .toLocaleString('en-US', { minimumFractionDigits: 2 })
      .replace(/\./, '(?:\\.| {1,12})')
    const row = lines[l16 + bottom]
    if (!new RegExp(`(?<![\\d,.])${printed}(?![\\d,.])`).test(row))
      return reject(
        `line 16 (${cash}) neither checks against lines 12-15 nor reads cleanly`,
      )
  }

  // The period, from the cover and the Summary Page.
  const coverIdx = pages.findIndex((p) => /Cover\s+Page/i.test(p))
  const headOf = (i: number, end: RegExp) => {
    if (i < 0) return []
    const ls = pages[i].split('\n')
    const stop = ls.findIndex((l) => end.test(l))
    return stop < 0 ? ls.slice(0, 20) : ls.slice(0, stop)
  }
  const cover = ocrPeriod(headOf(coverIdx, /Type\s+of\s+Recipient/i))
  const summary = ocrPeriod(headOf(summaryIdx, /NAME\s+OF\s+FILER/i))
  // One page reads both dates cleanly and the other reads the same or none.
  const clean = (p: typeof cover) =>
    p.from && p.from !== 'bad' && p.through && p.through !== 'bad'
  const agrees = (a: typeof cover, b: typeof cover) =>
    clean(a) &&
    (!b.from || b.from === a.from) &&
    (!b.through || b.through === a.through)
  const read = agrees(cover, summary)
    ? cover
    : agrees(summary, cover)
      ? summary
      : undefined
  const from = read?.from as IsoDate | undefined
  const through = read?.through as IsoDate | undefined
  if (!from || !through)
    return reject(
      `period dates not read cleanly (cover ${cover.from ?? '-'} to ${cover.through ?? '-'}, Summary Page ${summary.from ?? '-'} to ${summary.through ?? '-'})`,
    )
  if (from >= through || !/^202[56]-/.test(through))
    return reject(`implausible period ${from} to ${through}`)

  // The caller's committee (from the filing officer's own listing) wins
  // over a name or ID read from the scan; a scanned ID counts only when the
  // cover page shows the same digits.
  const filer = ocrFiler(lines)
  const coverText = coverIdx < 0 ? '' : pages[coverIdx]
  const committee = hint?.name ?? filer.name
  if (!committee) return reject('filer name not readable')
  const committeeId =
    hint?.id ??
    (filer.id && coverText.includes(filer.id) ? filer.id : undefined)
  return {
    ok: true,
    scanned: true,
    value: {
      committee,
      ...(committeeId && { committeeId }),
      from,
      through,
      summary: { monetary, loans, nonmonetary, total, cashOnHand: cash },
    },
  }
}

/**
 * A scanned Form 497's OCR text as its part 1 contributions, only when every
 * row in part 1 has a clean date, a clean amount and one contributor code
 * marked with an X; otherwise the whole report is unreadable.
 */
export function parseForm497Ocr(
  text: string,
  hint?: CommitteeHint,
): PdfRead<Form497Read> {
  if (!/\b497\b/.test(text) || !/Contribution/i.test(text))
    return { ok: false, reason: 'not-497' }
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^\W*1\W+Contribution\S*\s+Rec/i.test(l))
  if (start < 0) return reject('part 1 (contributions received) not found')
  const endAt = lines.findIndex(
    (l, i) => i > start && /^\W*2\W+Contribution\S*\s+Made/i.test(l),
  )
  const part = lines.slice(start + 1, endAt < 0 ? undefined : endAt)
  const rows: { block: string[] }[] = []
  for (const l of part) {
    if (/^\W*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l)) rows.push({ block: [l] })
    else if (rows.length) rows.at(-1)!.block.push(l)
  }
  if (rows.length === 0) return reject('no contributions read in part 1')
  const contributions: LateContribution[] = []
  for (const { block } of rows) {
    const first = block[0].replace(/^\W+/, '')
    const date = cleanDate(first.split(/\s+/)[0])
    const amounts = first
      .split(/\s+/)
      .slice(1)
      .map(ocrValue)
      .filter((v) => v !== undefined && v > 0)
    // Only a code marked with an X: OCR can drop the unmarked codes beside
    // it, so a lone printed code proves nothing.
    const marked = new Set(
      [
        ...block
          .join('\n')
          .matchAll(/(?:^|\s)[Xx✓✔]\s*(IND|COM|OTH|PTY|SCC)\b/g),
      ].map((m) => m[1] as ContributorCode),
    )
    const code = marked.size === 1 ? [...marked][0] : undefined
    if (!date || amounts.length === 0 || !code)
      return reject(
        `a part 1 row has no clean date, amount or code (${date ?? 'date?'})`,
      )
    contributions.push({ date, amount: amounts.at(-1)!, code })
  }
  const filer = ocrFiler(lines)
  return {
    ok: true,
    scanned: true,
    value: {
      committee: filer.name ?? hint?.name ?? '',
      ...((filer.id ?? hint?.id) && { committeeId: filer.id ?? hint?.id }),
      contributions,
    },
  }
}
