// Parsers for published general-election endorsement lists (slates).
// Each turns one list's text into entries with the office as printed and a
// structured hint (office type, district, vacancy) that matching checks
// against subjects.json. Pure functions: scripts/profiles/slates.ts does the
// downloading and runs `pdftotext -bbox` on PDFs.

import type { OfficeType } from './subjects.ts'

/** The kind of office an entry is for, as the lists group them. */
export type SlateSection =
  | 'us_senate'
  | 'governor'
  | 'lt_governor'
  | 'attorney_general'
  | 'secretary_of_state'
  | 'state_treasurer'
  | 'comptroller'
  | 'us_house'
  | 'state_senate'
  | 'state_house'
  | 'county_president'
  | 'county_clerk'
  | 'county_sheriff'
  | 'county_treasurer'
  | 'county_assessor'
  | 'board_of_review'
  | 'county_board'
  | 'mwrd'
  | 'mwrd6'
  | 'mwrd2'
  | 'appellate'
  | 'circuit_countywide'
  | 'subcircuit'
  | 'school_board'
  | 'retention'
  /** An office not on Cook County ballots (another county, a referendum). */
  | 'other'

/** What a subject's office must look like for an entry to be about them. */
export interface OfficeHint {
  types: OfficeType[]
  /** Substrings of the subject's office, ignoring case. */
  includes?: string[]
  excludes?: string[]
  /** The first number in the subject's office (district or subcircuit). */
  district?: number
  /** The vacancy's surname, which the subject's office must name. */
  vacancy?: string
}

export interface ParsedEntry {
  name: string
  /** The office or district as the list prints it. */
  office: string
  /** Null when the office can't be on a Cook County ballot. */
  hint: OfficeHint | null
}

interface Detail {
  district?: number
  vacancy?: string
  /** Chicago school board subdistrict, e.g. "1A". */
  school?: string
  president?: boolean
}

const ordinal = (s: string): number | undefined => {
  const m = s.replace(/(\d)\s+(?=\d)/g, '$1').match(/(\d+)/)
  return m ? Number(m[1]) : undefined
}

/** "Curry, Jr." → "curry"; "Martin C. Kelley" → "kelley". */
export function vacancySurname(text: string): string {
  const words = text
    .replace(/\b(jr|sr|iii|ii)\b\.?/gi, '')
    .replace(/['’]/g, '')
    .replace(/[.,]/g, ' ')
    .trim()
    .split(/\s+/)
  return (words.at(-1) ?? '').toLowerCase()
}

/** The hint for a section and the details printed with an entry. */
export function hintFor(
  section: SlateSection,
  d: Detail = {},
): OfficeHint | null {
  const v = d.vacancy ? { vacancy: vacancySurname(d.vacancy) } : {}
  const n = d.district === undefined ? {} : { district: d.district }
  switch (section) {
    case 'us_senate':
      return { types: ['us_senate'] }
    case 'governor':
    case 'lt_governor':
      return { types: ['statewide'], includes: ['Governor'] }
    case 'attorney_general':
      return { types: ['statewide'], includes: ['Attorney General'] }
    case 'secretary_of_state':
      return { types: ['statewide'], includes: ['Secretary of State'] }
    case 'state_treasurer':
      return { types: ['statewide'], includes: ['Illinois Treasurer'] }
    case 'comptroller':
      return { types: ['statewide'], includes: ['Comptroller'] }
    case 'us_house':
      return { types: ['us_house'], ...n }
    case 'state_senate':
      return { types: ['state_legislature'], includes: ['State Senator'], ...n }
    case 'state_house':
      return {
        types: ['state_legislature'],
        includes: ['State Representative'],
        ...n,
      }
    case 'county_president':
      return { types: ['county_executive'], includes: ['Board President'] }
    case 'county_clerk':
      return { types: ['county_executive'], includes: ['Cook County Clerk'] }
    case 'county_sheriff':
      return { types: ['county_executive'], includes: ['Sheriff'] }
    case 'county_treasurer':
      return {
        types: ['county_executive'],
        includes: ['Cook County Treasurer'],
      }
    case 'county_assessor':
      return { types: ['county_executive'], includes: ['Assessor'] }
    case 'board_of_review':
      return { types: ['board_of_review'], ...n }
    case 'county_board':
      return { types: ['county_board'], ...n }
    case 'mwrd':
      return { types: ['water_reclamation'] }
    case 'mwrd6':
      return { types: ['water_reclamation'], excludes: ['unexpired'] }
    case 'mwrd2':
      return { types: ['water_reclamation'], includes: ['unexpired'] }
    case 'appellate':
      return {
        types: ['judicial_candidate'],
        includes: ['Appellate'],
        ...n,
        ...v,
      }
    case 'circuit_countywide':
      return {
        types: ['judicial_candidate'],
        includes: ['Circuit Court Judge, Cook County'],
        ...v,
      }
    case 'subcircuit':
      return {
        types: ['judicial_candidate'],
        includes: ['Subcircuit'],
        ...n,
        ...v,
      }
    case 'school_board':
      if (d.president)
        return {
          types: ['school_board'],
          includes: ['Board of Education President'],
        }
      return d.school
        ? { types: ['school_board'], includes: [`Subdistrict ${d.school}`] }
        : null
    case 'retention':
      return { types: ['retention'] }
    case 'other':
      return null
  }
}

// ---- PDF text with positions (pdftotext -bbox) ----

export interface PdfWord {
  /** From 1. */
  page: number
  x: number
  xMax: number
  y: number
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : Number(code.slice(1)),
      )
    return ENTITIES[code.toLowerCase()] ?? all
  })
}

/** Words and their positions from `pdftotext -bbox` output. */
export function parseBbox(html: string): PdfWord[] {
  const words: PdfWord[] = []
  const pages = html.split(/<page\b/).slice(1)
  pages.forEach((page, i) => {
    for (const m of page.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g,
    ))
      words.push({
        page: i + 1,
        x: Number(m[1]),
        y: Number(m[2]),
        xMax: Number(m[3]),
        text: decodeEntities(m[4]),
      })
  })
  return words
}

/**
 * One page's lines, column by column (left to right, top to bottom).
 * `edges` are the columns' left x positions. Each line is split into fields
 * wherever words are more than `gap` points apart. Words above `top` or
 * below `bottom` (titles, page numbers) are left out.
 */
export function columnLines(
  words: PdfWord[],
  page: number,
  edges: number[],
  { gap = 8, top = 0, bottom = Infinity } = {},
): string[][] {
  const out: string[][] = []
  edges.forEach((left, c) => {
    const right = edges[c + 1] ?? Infinity
    const col = words
      .filter(
        (w) =>
          w.page === page &&
          w.x >= left &&
          w.x < right &&
          w.y >= top &&
          w.y <= bottom,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x)
    const lines: PdfWord[][] = []
    for (const w of col) {
      const line = lines.at(-1)
      // Superscripts ("1st") sit about a point lower than their line.
      if (line && Math.abs(w.y - line[0].y) <= 2.5) line.push(w)
      else lines.push([w])
    }
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      const fields: string[] = []
      let prev: PdfWord | undefined
      for (const w of line) {
        const text = w.text.replace(/\t/g, '').trim()
        if (!text) continue
        if (!prev || w.x - prev.xMax > gap) fields.push(text)
        else fields[fields.length - 1] += ` ${text}`
        prev = w
      }
      if (fields.length) out.push(fields.map(tidy))
    }
  })
  return out
}

/** "1 st District" → "1st District"; "2 1 st" → "21st"; one space between words. */
const tidy = (s: string) =>
  s
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .replace(/(\d)\s+(st|nd|rd|th)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()

const cleanName = (s: string) =>
  s
    .replace(/\s*\((D|R|I|L|G)\)\s*\**\s*$/, '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

// ---- Chicago Federation of Labor ----

const CFL_HEADINGS: [RegExp, SlateSection | null][] = [
  [/^U\.S\. Senate$/, 'us_senate'],
  [/^Governor and Lieutenant Governor$/, 'governor'],
  [/^Attorney General$/, 'attorney_general'],
  [/^Secretary of State$/, 'secretary_of_state'],
  [/^Treasurer$/, 'state_treasurer'],
  [/^Comptroller$/, 'comptroller'],
  [/^U\.S\. House of Representatives$/, 'us_house'],
  [/^Illinois Senate$/, 'state_senate'],
  [/^Illinois House of Representatives$/, 'state_house'],
  [/^Cook County Board President$/, 'county_president'],
  [/^Cook County Clerk$/, 'county_clerk'],
  [/^Cook County Sheriff$/, 'county_sheriff'],
  [/^Cook County Treasurer$/, 'county_treasurer'],
  [/^Cook County Assessor$/, 'county_assessor'],
  [/^Cook County Board of Review$/, 'board_of_review'],
  [/^Cook County Board of Commissioners$/, 'county_board'],
  [/^Metropolitan Water Reclamation District$/, 'mwrd'],
  [/^Commissioner, 6-year term$/i, 'mwrd6'],
  [/^Commissioner, 2-year term$/i, 'mwrd2'],
  [/^Appellate Court$/, 'appellate'],
  [/^Cook County Circuit Court$/, 'circuit_countywide'],
  [/^Cook County Judicial Subcircuits$/, 'subcircuit'],
  [/^Chicago Board of Education$/, 'school_board'],
  [/RECOMMENDED FOR RETENTION$/i, 'retention'],
  [/^Vote\b/, 'other'],
  // Group titles that don't change the office.
  [/^(STATEWIDE EXECUTIVE OFFICES|JUDICIAL)$/, null],
]

const CFL_SKIP =
  /GENERAL ELECTION$|^ENDORSED CANDIDATES$|^\d+ of \d+$|^As of \d|^District #\d+ Bond Referendum$/

/**
 * The CFL list draws most State House names as outlines, with no text to
 * extract; only the district and party are text. These names were read off
 * the PDF ("As of 9/16/2026") on 2026-10-07. The parser checks the PDF's
 * State House districts against this table and stops when they differ, so
 * a changed list is read again by a person.
 */
export const CFL_STATE_HOUSE_TRANSCRIBED: Record<number, string> = {
  4: 'Lilian Jimenez',
  5: 'Kimberly Du Buclet',
  6: 'Sonya Harper',
  7: "Emanuel 'Chris' Welch",
  8: 'Shantel Franklin',
  9: 'Yolanda Morris',
  10: 'Jawaharial Williams',
  11: 'Ann Williams',
  12: 'Paul Kendrick',
  13: 'Demi Palecek',
  14: 'Kelly Cassidy',
  15: 'Mike Kelly',
  16: 'Kevin Olickal',
  17: 'Jennifer Gong-Gershowitz',
  18: 'Robyn Gabel',
  19: 'Lindsey LaPointe',
  20: 'Brad Stephens',
  21: 'Abdelnasser Rashid',
  22: 'Angelica Guerrero-Cuellar',
  23: 'Edgar González, Jr.',
  24: 'Theresa Mah',
  25: 'Curtis Tarver II',
  26: 'Kam Buckner',
  27: 'Justin Slaughter',
  28: 'Bob Rita',
  29: 'Thaddeus Jones',
  30: 'Will Davis',
  31: 'Michael Crawford',
  32: 'Lisa Davis',
  33: 'Marcus C. Evans, Jr.',
  34: 'Cleopatra Cowley',
  35: 'Mary Gill',
  36: 'Rick Ryan',
  37: 'Pat Sheehan',
  38: 'Debbie Meyers-Martin',
  39: 'Will Guzzardi',
  40: 'Miguel Alvelo-Rivera',
  43: 'Anna Moeller',
  44: 'Fred Crespo',
  45: 'Martha Deuter',
  48: 'Jennifer Sanalitro',
  49: 'Maura Hirschauer',
  51: 'Jenny Levin',
  52: 'Maria Peterson',
  53: 'Nicolle Grasse',
  54: 'Mary Beth Canty',
  55: 'Justin Cochran',
  56: 'Michelle Mussman',
  57: 'Tracy Katz Muhl',
  58: 'Bob Morgan',
  59: 'Daniel Didech',
  77: 'Norma Hernandez',
  78: 'Camille Lilly',
  80: 'Anthony DeLuca',
  82: 'Nicole La Ha',
}

const PARTY = /^(Democrat|Republican|D|R)$/

/** "Graciela Guzman 20th District" (set too close to split) → name, district. */
const splitTrailingDistrict = (fields: string[]) =>
  fields.flatMap((f) => {
    const m = f.match(
      /^(.*\D)\s*(\d+(?:st|nd|rd|th)? (?:District|Subcircuit))$/,
    )
    return m ? [m[1].trim(), m[2]] : [f]
  })
const DISTRICT_FIELD = /^\d+(st|nd|rd|th)? ?(District|Subcircuit)$/

/** The CFL's three-page PDF (pdftotext -bbox output). */
export function parseCfl(
  html: string,
  transcribed: Record<number, string> = CFL_STATE_HOUSE_TRANSCRIBED,
): ParsedEntry[] {
  const words = parseBbox(html)
  const pages = Math.max(0, ...words.map((w) => w.page))
  const entries: ParsedEntry[] = []
  const missingNames: number[] = []
  let section: SlateSection = 'other'
  for (let page = 1; page <= pages; page++) {
    const lines = columnLines(words, page, [0, 300], { top: 75, bottom: 770 })
    for (const fields of lines.map(splitTrailingDistrict)) {
      const line = fields.join(' ')
      if (CFL_SKIP.test(line)) continue
      if (fields.length === 1) {
        const heading = CFL_HEADINGS.find(([re]) => re.test(line))
        if (heading) {
          if (heading[1]) section = heading[1]
          continue
        }
      }
      if (section === 'other') continue
      const rest = fields.filter((f) => !PARTY.test(f))
      let name = rest[0]
      const details = DISTRICT_FIELD.test(name ?? '') ? rest : rest.slice(1)
      const d: Detail = {}
      for (const f of details) {
        if (DISTRICT_FIELD.test(f)) d.district = ordinal(f)
        const vacancy = f.match(/^(.+) Vacancy$/)
        if (vacancy) d.vacancy = vacancy[1]
        const school = f.match(/^School Board District (\w+)$/)
        if (school) d.school = school[1]
        if (/^Board President$/.test(f)) d.president = true
      }
      if (DISTRICT_FIELD.test(name ?? '')) {
        // A State House row whose name is drawn, not text.
        if (section !== 'state_house' || d.district === undefined)
          throw new Error(`CFL: no name on "${line}"`)
        missingNames.push(d.district)
        name = transcribed[d.district]
        if (!name)
          throw new Error(`CFL: no transcribed name for HD ${d.district}`)
      }
      if (!name || /^Neutral$/i.test(name)) continue
      entries.push({
        name: cleanName(name),
        office: [SECTION_LABELS[section], ...details].join(', '),
        hint: hintFor(section, d),
      })
    }
  }
  const expected = Object.keys(transcribed)
    .map(Number)
    .sort((a, b) => a - b)
  const found = [...missingNames].sort((a, b) => a - b)
  if (expected.join(',') !== found.join(','))
    throw new Error(
      `CFL: the State House districts without text (${found.join(', ')}) differ from the transcribed ones (${expected.join(', ')}); read the PDF again and update CFL_STATE_HOUSE_TRANSCRIBED`,
    )
  return entries
}

const SECTION_LABELS: Record<SlateSection, string> = {
  us_senate: 'U.S. Senate',
  governor: 'Governor',
  lt_governor: 'Lieutenant Governor',
  attorney_general: 'Attorney General',
  secretary_of_state: 'Secretary of State',
  state_treasurer: 'Treasurer',
  comptroller: 'Comptroller',
  us_house: 'U.S. House',
  state_senate: 'Illinois Senate',
  state_house: 'Illinois House',
  county_president: 'Cook County Board President',
  county_clerk: 'Cook County Clerk',
  county_sheriff: 'Cook County Sheriff',
  county_treasurer: 'Cook County Treasurer',
  county_assessor: 'Cook County Assessor',
  board_of_review: 'Board of Review',
  county_board: 'Cook County Board',
  mwrd: 'Water Reclamation District',
  mwrd6: 'Water Reclamation District, 6-year term',
  mwrd2: 'Water Reclamation District, 2-year term',
  appellate: 'Appellate Court',
  circuit_countywide: 'Circuit Court',
  subcircuit: 'Subcircuit',
  school_board: 'Chicago Board of Education',
  retention: 'Retention',
  other: 'Other',
}

// ---- IUOE Local 150 ----

const L150_HEADINGS: [
  RegExp,
  SlateSection | 'statewide' | 'cook' | 'judicial' | null,
][] = [
  [/^Statewide:$/, 'statewide'],
  [/^U\.S\. Senate$/, 'us_senate'],
  [/^U\.S\. House of Representatives$/, 'us_house'],
  [/^Illinois Senate$/, 'state_senate'],
  [/^Illinois House of Representatives$/, 'state_house'],
  [/^Cook County$/, 'cook'],
  [/^County Board of Review:$/, 'board_of_review'],
  [/^County Board$/, 'county_board'],
  [/^Metropolitan Water Reclamation$/, 'mwrd'],
  [/^Chicago School Board:$/, 'school_board'],
  [/^Judicial:$/, 'judicial'],
  [/^Subcircuits:$/, 'subcircuit'],
  [/^(Commissioners:|District Commissioners:)$/, null],
]

const L150_SKIP = /ENDORSEMENTS$|^GENERAL ELECTION DAY:/

const STATEWIDE_LABELS: [RegExp, SlateSection][] = [
  [/^Governor$/, 'governor'],
  [/^(Lieutenant|Lt\.) Governor$/, 'lt_governor'],
  [/^Attorney General$/, 'attorney_general'],
  [/^Secretary of State$/, 'secretary_of_state'],
  [/^Treasurer$/, 'state_treasurer'],
  [/^Comptroller$/, 'comptroller'],
  [/^(Cook )?County Board President$/, 'county_president'],
  [/^(Cook )?County Clerk$/, 'county_clerk'],
  [/^(Cook )?County Sheriff$/, 'county_sheriff'],
  [/^(Cook )?County Treasurer$/, 'county_treasurer'],
  [/^(Cook )?County Assessor$/, 'county_assessor'],
]

/** A label printed before a name ("District 4", "1st, Vac. of Balanoff") in context. */
function interpretLabel(
  label: string,
  section: string,
): { section: SlateSection; detail: Detail } {
  const district = label.match(/^District (\d+)$/)
  if (district) {
    const s = (
      section === 'cook' || section === 'statewide' || section === 'judicial'
        ? 'other'
        : section
    ) as SlateSection
    return { section: s, detail: { district: Number(district[1]) } }
  }
  const sub = label.match(/^(\d+)(st|nd|rd|th)?, Vac\. of (.+)$/)
  if (sub)
    return {
      section: 'subcircuit',
      detail: { district: Number(sub[1]), vacancy: sub[3] },
    }
  const appellate = label.match(/^Appellate Court, Vac\. of (.+)$/)
  if (appellate)
    return { section: 'appellate', detail: { vacancy: appellate[1] } }
  const circuit = label.match(/^Circuit Court, Vac\. of (.+)$/)
  if (circuit)
    return { section: 'circuit_countywide', detail: { vacancy: circuit[1] } }
  const school = label.match(/^(\d+[AB])$/)
  if (school && section === 'school_board')
    return { section: 'school_board', detail: { school: school[1] } }
  for (const [re, s] of STATEWIDE_LABELS)
    if (re.test(label)) return { section: s, detail: {} }
  return { section: 'other', detail: {} }
}

/** IUOE Local 150's one-page, five-column PDF (pdftotext -bbox output). */
export function parseLocal150(
  html: string,
  edges = [0, 160, 316, 472, 628],
): ParsedEntry[] {
  const words = parseBbox(html)
  const entries: ParsedEntry[] = []
  let section = 'other'
  let pending: string | undefined
  const add = (name: string, label: string | undefined) => {
    const { section: s, detail } = label
      ? interpretLabel(label, section)
      : { section: section as SlateSection, detail: {} }
    const known = s in SECTION_LABELS ? s : 'other'
    entries.push({
      name: cleanName(name),
      office: label ? `${sectionText(section)}${label}` : SECTION_LABELS[known],
      hint: hintFor(known, detail),
    })
  }
  for (const fields of columnLines(words, 1, edges, { gap: 1000, top: 50 })) {
    const line = fields.join(' ')
    if (L150_SKIP.test(line)) continue
    const heading = L150_HEADINGS.find(([re]) => re.test(line))
    if (heading) {
      if (heading[1]) section = heading[1]
      pending = undefined
      continue
    }
    const labelled = line.match(/^(.+?):\s*(.*)$/)
    if (labelled) {
      if (labelled[2]) add(labelled[2], labelled[1])
      else pending = labelled[1]
      continue
    }
    add(line, pending)
    pending = undefined
  }
  return entries
}

const sectionText = (section: string) => {
  const label = SECTION_LABELS[section as SlateSection]
  return label && section !== 'other' ? `${label}, ` : ''
}

// ---- Illinois AFL-CIO ----

const AFL_HEADINGS: [RegExp, SlateSection | 'judicial'][] = [
  [/^Governor$/, 'governor'],
  [/^Lt\. Governor$/, 'lt_governor'],
  [/^U\.S\. Senate$/, 'us_senate'],
  [/^Attorney General$/, 'attorney_general'],
  [/^Secretary of State$/, 'secretary_of_state'],
  [/^Treasurer$/, 'state_treasurer'],
  [/^Comptroller$/, 'comptroller'],
  [/^U\.S\. House$/, 'us_house'],
  [/^State Senate$/, 'state_senate'],
  [/^State House$/, 'state_house'],
  [/^Judicial$/, 'judicial'],
]

const AFL_SKIP =
  /General Election Endorsements$|^italics\b|^\* [–-]|^\((D|R|I)\)$/

/** The Illinois AFL-CIO's one-page, three-column PDF (pdftotext -bbox output). */
export function parseAflCio(
  html: string,
  edges = [0, 225, 405],
): ParsedEntry[] {
  const words = parseBbox(html)
  const entries: ParsedEntry[] = []
  let section: SlateSection | 'judicial' = 'other'
  for (const fields of columnLines(words, 1, edges, { gap: 1000, top: 55 })) {
    const line = fields.join(' ')
    if (AFL_SKIP.test(line)) continue
    const heading = AFL_HEADINGS.find(([re]) => re.test(line))
    if (heading) {
      section = heading[1]
      continue
    }
    const row = line.match(/^(\d+)(st|nd|rd|th) (App )?[–-] (.+)$/)
    if (row) {
      const appellate = !!row[3]
      const s: SlateSection =
        section === 'judicial' ? (appellate ? 'appellate' : 'other') : section
      entries.push({
        name: cleanName(row[4]),
        office: `${SECTION_LABELS[s]}, ${row[1]}${row[2]}${appellate ? ' District' : ''}`,
        hint: hintFor(s, { district: Number(row[1]) }),
      })
      continue
    }
    if (section === 'judicial') continue
    entries.push({
      name: cleanName(line),
      office: SECTION_LABELS[section],
      hint: hintFor(section),
    })
  }
  return entries
}

// ---- Personal PAC ----

const PPAC_OFFICES: [
  RegExp,
  (m: RegExpMatchArray) => [SlateSection, Detail],
][] = [
  [/^Governor$/, () => ['governor', {}]],
  [/^Lt\. Governor$/, () => ['lt_governor', {}]],
  [/^Attorney General$/, () => ['attorney_general', {}]],
  [/^Secretary of State$/, () => ['secretary_of_state', {}]],
  [/^Comptroller$/, () => ['comptroller', {}]],
  [/^Treasurer$/, () => ['state_treasurer', {}]],
  [/^U\.S\. Senate$/, () => ['us_senate', {}]],
  [/^SD-0*(\d+)$/, (m) => ['state_senate', { district: Number(m[1]) }]],
  [/^HD-0*(\d+)$/, (m) => ['state_house', { district: Number(m[1]) }]],
  [/^Cook County Board President$/, () => ['county_president', {}]],
  [
    /^Cook County Board, 0*(\d+)\w* District$/,
    (m) => ['county_board', { district: Number(m[1]) }],
  ],
  [
    /^Metropolitan Water Reclamation District Commissioner 2-Year Term$/i,
    () => ['mwrd2', {}],
  ],
  [
    /^Metropolitan Water Reclamation District Commissioner 6-Year Term$/i,
    () => ['mwrd6', {}],
  ],
  [
    /^Cook Circuit - (\d+)\w* Subcircuit - (.+) Vacancy$/,
    (m) => ['subcircuit', { district: Number(m[1]), vacancy: m[2] }],
  ],
  [
    /^Cook Circuit - (.+) Vacancy$/,
    (m) => ['circuit_countywide', { vacancy: m[1] }],
  ],
  [
    /^Chicago School Board President$/,
    () => ['school_board', { president: true }],
  ],
  [
    /^Chicago School Board, District (\w+)$/,
    (m) => ['school_board', { school: m[1] }],
  ],
]

/** Personal PAC's elections page (HTML): offices and names in a grid. */
export function parsePersonalPac(html: string): ParsedEntry[] {
  const start = html.search(/General Election Endorsements/i)
  const body = start >= 0 ? html.slice(start) : html
  const entries: ParsedEntry[] = []
  let office: string | undefined
  for (const m of body.matchAll(
    /<div class="endorsement-(office|name)">([\s\S]*?)<\/div>/g,
  )) {
    const text = decodeEntities(m[2])
    if (m[1] === 'office') {
      office = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      continue
    }
    if (!office) continue
    const rule = PPAC_OFFICES.find(([re]) => re.test(office as string))
    const [section, detail] = rule
      ? rule[1](office.match(rule[0]) as RegExpMatchArray)
      : (['other', {}] as [SlateSection, Detail])
    for (const name of text.split(/<br\s*\/?>/i)) {
      const clean = name
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (clean)
        entries.push({ name: clean, office, hint: hintFor(section, detail) })
    }
  }
  return entries
}
