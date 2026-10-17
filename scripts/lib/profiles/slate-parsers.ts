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
  /**
   * The city, school district or water district the office belongs to,
   * which must begin the subject's office (after any "City of"), ignoring
   * case, accents and punctuation.
   */
  place?: string
}

export interface ParsedEntry {
  name: string
  /** The office or district as the list prints it. */
  office: string
  /** Null when the office can't be on the region's ballots or isn't recognized. */
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
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ndash: '–',
  mdash: '—',
}

/** Combining marks for accented letters: "&eacute;" → "é", "&Ntilde;" → "Ñ". */
const ACCENTS: Record<string, string> = {
  acute: '\u0301',
  grave: '\u0300',
  circ: '\u0302',
  tilde: '\u0303',
  uml: '\u0308',
  cedil: '\u0327',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#')
      return String.fromCodePoint(
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : Number(code.slice(1)),
      )
    const accent = code.match(/^([a-z])(acute|grave|circ|tilde|uml|cedil)$/i)
    if (accent)
      return (accent[1] + ACCENTS[accent[2].toLowerCase()]).normalize('NFC')
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

// ---- Los Angeles County lists ----
//
// The LA lists print offices in many styles ("CA 26", "California's 26th
// Congressional District", "Alhambra City Council, CD 5", "Los Angeles CCD,
// Seat 2"). laHint reads any of them, place first, into a hint: the office
// type, the place (city, school or water district) and the district or seat.
// Matching then needs the name as well, so a loose label never matches on
// its own.

/** Place names the lists shorten or misspell, as the ballot names them. */
const LA_PLACE_ALIASES: Record<string, string> = {
  'antelope valley union high': 'Antelope Valley Joint Union High',
  'college of the canyons': 'Santa Clarita',
  hart: 'William S. Hart',
  'sagus union': 'Saugus Union',
  'san gabriel valley': 'San Gabriel',
  southgate: 'South Gate',
}

const placeAlias = (place: string) =>
  LA_PLACE_ALIASES[place.toLowerCase()] ?? place

/** Words that describe a city office rather than name the city. */
const CITY_ROLE =
  /\b(city council ?members?|city council|council ?members?|councilmember|member of the|mayor of|mayor|city clerk|city treasurer|treasurer|city attorney|rent control board|rent stabilization board|members?|city of|at large|\(vote for \d+\)|(district|cd) ?\d+|\d+(st|nd|rd|th)? district)\b/gi

/** "Culver City Council, At Large" → "Culver"; "Arcadia, District 2, City Council Member" → "Arcadia". */
function cityPlace(text: string): string | undefined {
  for (const segment of text.split(',')) {
    const place = segment
      .replace(CITY_ROLE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*\bcity$/i, '')
    if (place) return placeAlias(place)
  }
  return undefined
}

const TRAILING_SCHOOL_WORDS =
  /\s+(school|schools|district|board|unified|usd|ccd|college|community|trustees?|of|governing|members?|education|elementary|city)$/i
const TRAILING_SPECIAL_WORDS =
  /\s+(district|agency|board|directors?|of|members?)$/i

/** The first segment with generic trailing words removed: "East Whittier City School Board" → "East Whittier". */
function trimmedPlace(text: string, trailing: RegExp): string | undefined {
  let place = text.split(',')[0].replace(/\s+/g, ' ').trim()
  for (let prev = ''; prev !== place;) {
    prev = place
    place = place.replace(trailing, '').trim()
  }
  return place ? placeAlias(place) : undefined
}

const STATEWIDE: [RegExp, string][] = [
  [/\bgovernor\b/, 'Governor'],
  [/attorney general/, 'Attorney General'],
  [/secretary of state/, 'Secretary of State'],
  [/controller/, 'Controller'],
  [/treasurer/, 'Treasurer'],
  [/insurance/, 'Insurance Commissioner'],
  [/superintendent/, 'Superintendent of Public Instruction'],
]

/** The hint for an LA-area office label, or null when it isn't one LA ballots could have. */
export function laHint(label: string): OfficeHint | null {
  const text = label
    .replace(/\bLACCD\b/g, 'Los Angeles CCD')
    .replace(/\bLA\b/g, 'Los Angeles')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
  const lower = text.toLowerCase()
  const n =
    text.match(
      /\b(?:district|seat|area|div(?:ision)?\.?|cd|ca|sd|ad|boed?|office|no\.?)\s*0*(\d+)\b/i,
    ) ?? text.match(/\b0*(\d+)(?:st|nd|rd|th)\b/i)
  const district = n ? { district: Number(n[1]) } : {}
  const letter = text.match(/\barea ([a-z])\b/i)
  const area = letter ? { includes: [`Area ${letter[1].toUpperCase()}`] } : {}
  const city = (role?: string): OfficeHint | null => {
    const place = cityPlace(text)
    if (!place) return null
    return /council/i.test(lower)
      ? { types: ['city_council'], place, ...district }
      : { types: ['city_executive'], includes: [role ?? ''], place }
  }

  if (/superior court/.test(lower))
    return {
      types: ['judicial_candidate'],
      includes: ['Superior Court'],
      ...district,
    }
  if (/council/.test(lower)) return city()
  if (/\bmayor\b/.test(lower)) return city('Mayor')
  if (/city clerk/.test(lower)) return city('Clerk')
  if (/city attorney/.test(lower)) return city('Attorney')
  if (/rent (control|stabilization)/.test(lower)) return city('Rent Control')
  if (/treasurer/.test(lower) && /\bcity\b/.test(lower))
    return city('Treasurer')
  if (/college|\bccd\b/.test(lower)) {
    const place = trimmedPlace(text, TRAILING_SCHOOL_WORDS)
    return place ? { types: ['community_college'], place, ...district } : null
  }
  if (/school|unified|\busd\b/.test(lower)) {
    const place = trimmedPlace(text, TRAILING_SCHOOL_WORDS)
    return place
      ? { types: ['school_board'], place, ...district, ...area }
      : null
  }
  if (/water|library|irrigation|replenishment|community services/.test(lower)) {
    const place = trimmedPlace(text, TRAILING_SPECIAL_WORDS)
    return place ? { types: ['special_district'], place, ...district } : null
  }
  if (/sheriff/.test(lower))
    return { types: ['county_executive'], includes: ['Sheriff'] }
  if (/supervisor/.test(lower)) return { types: ['county_board'], ...district }
  if (/equalization|\bboed?\b/.test(lower))
    return { types: ['board_of_equalization'], ...district }
  const statewide = STATEWIDE.find(([re]) => re.test(lower))
  if (statewide) return { types: ['statewide'], includes: [statewide[1]] }
  if (
    /congress|(u\.?s\.?|united states) (house|representative)|^c[ad] ?\d+$/.test(
      lower,
    )
  )
    return { types: ['us_house'], ...district }
  if (/senat|^sd ?\d+$/.test(lower))
    return {
      types: ['state_legislature'],
      includes: ['State Senator'],
      ...district,
    }
  if (/assembly|^ad ?\d+$/.test(lower))
    return { types: ['state_legislature'], includes: ['Assembly'], ...district }
  return null
}

/** Words that mark a line as an office, never a person. */
const LA_OFFICE_WORDS =
  /\b(council|district|unified|ccd|mayor|court|board|clerk|treasurer|attorney|sheriff|seat|area|division|at large|governor|senate|assembly|congress)\b/i

const LA_NONE = /^no (consensus|endorsement|recommendation)$/i

/** A name as printed, without incumbent or party marks and titles. */
export function laName(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\((i|D|R)\)/g, ' ')
    .replace(/^\s*Dr\.?\s+/i, '')
    .replace(/\*+/g, ' ')
    .replace(/[​ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Alicia Mignano, Laurie Lieberman" → two names; "Marcus Evans, Jr." stays one. */
const splitNames = (s: string) => {
  const parts = s.split(/\s*,\s*/)
  return parts.length > 1 && parts.every((p) => p.split(' ').length >= 2)
    ? parts
    : [s]
}

/**
 * Names and offices lists print wrong, checked against the ballot (same
 * race, one candidate it can be): "name|office" as printed → the ballot's
 * name and office. The entry keeps the printed office.
 */
const LA_FIXES: Record<string, [string, string]> = {
  // Santa Clarita Valley Water Agency has Division 1 and 3 races only;
  // Division 3 elects two (Plambeck, Gutzeit, Petersen running).
  'Maria Gutzeit|Santa Clarita Valley Water Agency, Board of Directors, Division 4 Director':
    ['Maria Gutzeit', 'Santa Clarita Valley Water Agency, Division 3'],
  'Kenneth Petersen|Santa Clarita Valley Water Agency, Division 2': [
    'Kenneth Petersen',
    'Santa Clarita Valley Water Agency, Division 3',
  ],
  'Fre’Drisha Dixon|Inglewood, Citywide offices, Mayor': [
    "Fre'Drisha Dixion",
    'Inglewood, Citywide offices, Mayor',
  ],
  // The guide's write-up calls her Nicole "Nikki" Perez.
  'Nicole Jane Perez|Burbank, City Council': [
    'Nikki Perez',
    'Burbank, City Council',
  ],
  'Nick Shultz|State Assembly District 44': [
    'Nick Schultz',
    'State Assembly District 44',
  ],
  'Juan Carillo|AD 39': ['Juan Carrillo', 'AD 39'],
  // Misspellings in the LA Fed, Working Families and state party lists.
  'Cynthina Romo|Cudahy City Council': ['Cynthia Romo', 'Cudahy City Council'],
  'Vergion Jesse Smith|Palmdale City Council, District 5': [
    'V. Jesse Smith',
    'Palmdale City Council, District 5',
  ],
  'Gustavo Camaco|Pico Rivera City Council': [
    'Gustavo V. Camacho',
    'Pico Rivera City Council',
  ],
  'Lisa Nasua|Pomona Unified School District, Area 1': [
    'Lisa C. Nashua',
    'Pomona Unified School District, Area 1',
  ],
  'Jonathon Cottrel|West Hollywood City Council': [
    'Jonathan Cottrell',
    'West Hollywood City Council',
  ],
  'Helen Kreiger|West Hollywood City Council': [
    'Helen Krieger',
    'West Hollywood City Council',
  ],
  'David Liu|AD 49': ['Long David Liu', 'AD 49'],
  'Bob Achuleta|SD 30': ['Bob Archuleta', 'SD 30'],
  'Fre’Drisha “Sha” Dixon|Inglewood, Mayor': [
    "Fre'Drisha Dixion",
    'Inglewood, Mayor',
  ],
  'Jared Gonzalez|Beverly Hills Unified School District Board of Education': [
    'Jared Gonzales',
    'Beverly Hills Unified School District',
  ],
  'Randall Wilson|Los Angeles Community College, LACCD Trustee Seat 6': [
    'Randall Winston',
    'Los Angeles Community College District, Seat 6',
  ],
  'Frederick Sykes|West Covina, City Council, District 5': [
    'Fredrick Sykes',
    'West Covina, City Council, District 5',
  ],
  'Chris Turnkey|Saugus Union School District, Board of Education, Trustee Area 5':
    ['Christopher Trunkey', 'Saugus Union School District, Trustee Area 5'],
}

const laEntry = (printed: string, office: string): ParsedEntry => {
  const name = laName(printed)
  const [fixed, hintOffice] = LA_FIXES[`${name}|${office}`] ?? [name, office]
  return { name: fixed, office, hint: laHint(hintOffice) }
}

const textOf = (html: string) => laName(html.replace(/<br\s*\/?>/gi, ' '))

/** Stops when a page doesn't say it's for the November 3, 2026 general election. */
function requireGeneral(text: string, list: string) {
  if (!/November 3,? 2026|11\/3\/2026/i.test(text))
    throw new Error(
      `${list}: the page doesn't name the November 3, 2026 election; check it's still the general-election list`,
    )
}

/**
 * The Los Angeles County Democratic Party's endorsed-candidates page (HTML):
 * cards for federal, state, county and Los Angeles city races, then a list
 * of local races (office, then one name per line, blank line between).
 */
export function parseLacdp(html: string): ParsedEntry[] {
  requireGeneral(html, 'LACDP')
  const entries: ParsedEntry[] = []
  for (const m of html.matchAll(
    /<h3[^>]*content-block-headline[^>]*>([\s\S]*?)<\/h3>\s*<h4[^>]*content-block-subheadline[^>]*>([\s\S]*?)<\/h4>/g,
  ))
    entries.push(laEntry(textOf(m[1]), textOf(m[2])))
  const start = html.search(/GENERAL ELECTION ENDORSEMENTS/)
  const end = html.search(/STATEWIDE PROPOSITIONS/)
  if (start < 0 || end < start)
    throw new Error('LACDP: no local endorsement list on the page')
  let office: string | undefined
  for (const m of html
    .slice(start, end)
    .matchAll(/<(h3|p)\b[^>]*>([\s\S]*?)<\/\1>|<hr\b[^>]*>/g)) {
    const text = m[2] === undefined ? '' : textOf(m[2])
    if (m[1] !== 'p' || !text) {
      office = undefined
      continue
    }
    if (/endorsements/i.test(text) || LA_NONE.test(text)) continue
    if (!office || LA_OFFICE_WORDS.test(text)) {
      office = text
      continue
    }
    for (const name of splitNames(text)) entries.push(laEntry(name, office))
  }
  return entries
}

/** One candidate in the LAGOP lookup's data. */
interface LagopRecord {
  name: string
  office: string
  jurisdiction: string
  source: string
}

/** A JavaScript string literal's text ("\xe9", "é", "\"" and so on). */
const jsString = (literal: string) =>
  literal
    .slice(1, -1)
    .replace(/\\x([0-9a-f]{2})/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\(.)/g, '$1')

/** The candidate records in the LAGOP endorsement lookup's script bundle. */
export function lagopRecords(js: string): LagopRecord[] {
  const str = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`
  const re = new RegExp(
    `\\{id:"[^"]*",name:${str},office:${str},jurisdiction:${str}[^{}]*?endorsementSource:${str}`,
    'g',
  )
  return [...js.matchAll(re)].map((m) => ({
    name: jsString(m[1]),
    office: jsString(m[2]),
    jurisdiction: jsString(m[3]),
    source: jsString(m[4]),
  }))
}

/** The LAGOP lookup's own picks: its endorsements and its recommendations. */
const LAGOP_PICKS = new Set(['LAGOP', 'Recommended'])

/**
 * The Republican Party of Los Angeles County's endorsement lookup. Records
 * it marks as its own endorsement ("LAGOP") or recommendation
 * ("Recommended") are entries. The tool also shows the state party's picks,
 * another group's or person's picks (Reform California, "Recommended (Steve
 * Cooley)"), "Either is acceptable" and candidates it opposes; those are
 * left out.
 */
export function parseLagop(js: string): ParsedEntry[] {
  const records = lagopRecords(js)
  if (!records.some((r) => r.source === 'LAGOP'))
    throw new Error('LAGOP: no endorsed candidates in the lookup data')
  return records
    .filter((r) => LAGOP_PICKS.has(r.source))
    .map((r) => laEntry(r.name, `${r.jurisdiction}, ${r.office}`))
}

/**
 * The California Democratic Party's one-page PDF (pdftotext -bbox output):
 * statewide offices as "Office: Name | ..." lines on top, then columns of
 * "AD 42 - Name", "SD 20 - Name" and "CA 26 - Name" rows. A name too long
 * for its column wraps onto the next line.
 */
export function parseCadem(html: string): ParsedEntry[] {
  const words = parseBbox(html)
  const marks = words.filter((w) => /^(AD|SD|CA)$/.test(w.text))
  if (!marks.length) throw new Error('CADEM: no district rows in the PDF')
  const edges = [
    ...new Set(marks.map((w) => Math.round(w.x / 10) * 10 - 5)),
  ].sort((a, b) => a - b)
  const top = Math.min(...marks.map((w) => w.y)) - 15
  const bottom = Math.min(
    ...words.filter((w) => /^Proposition$/.test(w.text)).map((w) => w.y),
    Infinity,
  )
  const header = words.filter((w) => w.y < top)
  const entries: ParsedEntry[] = []
  const lines = new Map<number, string[]>()
  for (const w of header.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const key = [...lines.keys()].find((y) => Math.abs(y - w.y) <= 2.5) ?? w.y
    lines.set(key, [...(lines.get(key) ?? []), w.text])
  }
  for (const line of lines.values())
    for (const part of line.join(' ').split(/\s*[|​]\s*/)) {
      const m = part.match(/^(.+?):\s*(.+)$/)
      if (m && !LA_NONE.test(m[2].trim())) entries.push(laEntry(m[2], m[1]))
    }
  let last: ParsedEntry | undefined
  for (const fields of columnLines(words, 1, edges, {
    gap: 1000,
    top,
    bottom: bottom - 1,
  })) {
    const line = laName(fields.join(' '))
    const row = line.match(/^(AD|SD|CA) 0*(\d+) [–-] (.+)$/)
    if (row) {
      last = LA_NONE.test(row[3])
        ? undefined
        : laEntry(row[3], `${row[1]} ${row[2]}`)
      if (last) entries.push(last)
    } else if (/^(State Assembly|State Senate|U\.S\. Congress)$/.test(line)) {
      last = undefined
    } else if (last && line) {
      last.name = `${last.name} ${line}`
    }
  }
  return entries
}

/** The California Republican Party's endorsements page (HTML): "Office: Name" headings. */
export function parseCagop(html: string): ParsedEntry[] {
  const start = html.search(/2026 CRP ENDORSEMENTS/)
  if (start < 0) throw new Error('CAGOP: no 2026 endorsements on the page')
  const entries: ParsedEntry[] = []
  for (const m of html
    .slice(start)
    .matchAll(/<h3[^>]*elementor-heading-title[^>]*>([\s\S]*?)<\/h3>/g)) {
    const row = textOf(m[1]).match(/^([^:]+):\s*(.+)$/)
    if (!row || /^prop/i.test(row[1]) || LA_NONE.test(row[2])) continue
    entries.push(laEntry(row[2], row[1]))
  }
  return entries
}

/**
 * The Registrar's party endorsements for voter-nominated offices (lavote.gov
 * "Additional Election Information", HTML), filed by each qualified party
 * under Elections Code 13302(b): per office, a table per party with each
 * endorsed candidate (and district). Returns one party's entries. The page's
 * later list of candidates who accepted voluntary spending limits is not an
 * endorsement list and is left out.
 */
export function parseLavoteParties(html: string, party: string): ParsedEntry[] {
  requireGeneral(html, 'Registrar party endorsements')
  const start = html.search(/Party Endorsements for Voter-Nominated Offices/)
  const end = html.search(/Pursuant to Elections Code 13302/)
  if (start < 0 || end < start)
    throw new Error('Registrar party endorsements: no endorsement section')
  const entries: ParsedEntry[] = []
  let office = ''
  for (const m of html
    .slice(start, end)
    .matchAll(/(<th\b[^>]*>\s*)?<h3>([\s\S]*?)<\/h3>/g)) {
    const heading = textOf(m[2])
    // A party's name heads its table; an office's name stands on its own.
    if (!m[1]) {
      office = heading
      continue
    }
    if (heading !== party) continue
    // The heading sits in its table's header, so the rows run to </table>.
    const table = html.slice(start + m.index).match(/^[\s\S]*?<\/table>/)
    for (const row of (table?.[0] ?? '').matchAll(
      /<tr>\s*<td>([\s\S]*?)<\/td>(?:\s*<td>([\s\S]*?)<\/td>)?/g,
    ))
      entries.push(
        laEntry(
          row[1],
          row[2] ? `${office} District ${textOf(row[2])}` : office,
        ),
      )
  }
  return entries
}

/** California Environmental Voters' 2026 endorsements page (HTML): a card per office. */
export function parseEnviroVoters(html: string): ParsedEntry[] {
  requireGeneral(html, 'EnviroVoters')
  const entries: ParsedEntry[] = []
  for (const card of html.matchAll(
    /<h3 class="ev-card-title"[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<\/li>/g,
  )) {
    const office = textOf(card[1])
    for (const m of card[2].matchAll(
      /<span class="ev-candidate-name">([\s\S]*?)<\/span>/g,
    ))
      entries.push(laEntry(textOf(m[1]), office))
  }
  return entries
}

/**
 * Planned Parenthood Advocacy Project Los Angeles County's voter guide
 * (HTML). Only the tables the Action Fund says it endorsed are entries; the
 * page also repeats other Planned Parenthood groups' picks.
 */
export function parsePpapLa(html: string): ParsedEntry[] {
  requireGeneral(html, 'PPAP LA')
  const entries: ParsedEntry[] = []
  for (const section of html.split(/<h2\b/).slice(1)) {
    const intro = section.split(/<table\b/)[0]
    if (
      !/endorsed by Planned Parenthood Advocacy Project Los Angeles County Action Fund/i.test(
        textOf(intro),
      )
    )
      continue
    const table = section.match(/<table\b[\s\S]*?<\/table>/)?.[0] ?? ''
    for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      if (/<strong>/i.test(row[1])) continue
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(
        (c) => textOf(c[1]),
      )
      if (cells.length === 2 && cells[1] && !LA_NONE.test(cells[1]))
        entries.push(laEntry(cells[1], cells[0]))
    }
  }
  return entries
}

/** One page image of the LA Fed's voter guide, read by hand. */
export interface TranscribedPage {
  /** The image's file name on thelafed.org, without the size suffix. */
  file: string
  sha256: string
  /** Each box: the office as printed (heading, then the line's district), and its names. */
  rows: [string, string[]][]
}

/**
 * The Los Angeles County Federation of Labor's November 2026 voter guide is
 * published only as page images, so it was read by hand. The script checks
 * the images are byte for byte the ones read here and stops otherwise.
 * Ballot measure pages (the last two) have no candidates.
 */
export const LAFED_TRANSCRIBED: TranscribedPage[] = [
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-1.jpg',
    sha256: '35781a13c35dfa69494ca778f1d6df54fde038a3c53b051f550b7d103dd5f0f6',
    rows: [
      ['Governor', ['Xavier Becerra']],
      ['Lt. Governor', ['Fiona Ma']],
      ['Secretary of State', ['Shirley Weber (i)']],
      ['Attorney General', ['Rob Bonta (i)']],
      ['CA State Controller', ['Malia Cohen (i)']],
      ['CA State Treasurer', ['Eleni Kounalakis']],
      ['CA State Insurance Commissioner', ['Jane Kim']],
      ['CA Superintendent of Public Instruction', ['Richard Barrera']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-2.jpg',
    sha256: '22bf7e219069c835c4038a8c348e0d8b93d8a0a32b5f334a0a18356fd8adf43b',
    rows: [
      ['CA Board of Equalization, District 3', ['Mike Gipson (D)']],
      ['U.S. Congress, CA 26', ['Jacqui Irwin']],
      ['U.S. Congress, CA 27', ['George Whitesides (i)']],
      ['U.S. Congress, CA 28', ['Judy Chu (i)']],
      ['U.S. Congress, CA 29', ['Luz Rivas (i)']],
      ['U.S. Congress, CA 30', ['Laura Friedman (i)']],
      ['U.S. Congress, CA 31', ['Gil Cisneros (i)']],
      ['U.S. Congress, CA 32', ['Brad Sherman (i)']],
      ['U.S. Congress, CA 34', ['Jimmy Gomez (i)']],
      ['U.S. Congress, CA 35', ['Norma Torres (i)']],
      ['U.S. Congress, CA 36', ['Ted Lieu (i)']],
      ['U.S. Congress, CA 37', ['Sydney Kamlager-Dove (i)']],
      ['U.S. Congress, CA 38', ['Hilda Solis']],
      ['U.S. Congress, CA 41', ['Linda Sanchez (i)']],
      ['U.S. Congress, CA 42', ['Robert Garcia (i)']],
      ['U.S. Congress, CA 43', ['Maxine Waters (i)']],
      ['U.S. Congress, CA 44', ['Nanette Barragan (i)']],
      ['State Senate, SD 20', ['Caroline Menjivar (i)']],
      ['State Senate, SD 24', ['John Erickson']],
      ['State Senate, SD 26', ['Sara Hernandez']],
      ['State Senate, SD 28', ['Lola Smallwood-Cuevas (i)']],
      ['State Senate, SD 30', ['Bob Archuleta (i)']],
      ['State Assembly, AD 39', ['Juan Carrillo (i)']],
      ['State Assembly, AD 40', ['Pilar Schiavo (i)']],
      ['State Assembly, AD 41', ['John Harabedian (i)']],
      ['State Assembly, AD 42', ['Deborah Klein Lopez']],
      ['State Assembly, AD 43', ['Celeste Rodriguez (i)']],
      ['State Assembly, AD 44', ['Nick Schultz (i)']],
      ['State Assembly, AD 46', ['Jesse Gabriel (i)']],
      ['State Assembly, AD 49', ['Mike Fong (i)']],
      ['State Assembly, AD 51', ['Rick Chavez Zbur (i)']],
      ['State Assembly, AD 52', ['Jessica Caloza (i)']],
      ['State Assembly, AD 54', ['Mark Gonzalez (i)']],
      ['State Assembly, AD 55', ['Isaac Bryan (i)']],
      ['State Assembly, AD 56', ['Lisa Calderon (i)']],
      ['State Assembly, AD 57', ['Sade Elhawary (i)']],
      ['State Assembly, AD 61', ['Tina McKinnor (i)']],
      ['State Assembly, AD 62', ['Jose Solache (i)']],
      ['State Assembly, AD 64', ['No Recommendation']],
      ['State Assembly, AD 65', ['Ayanna Davis']],
      ['State Assembly, AD 66', ['Paul Seo']],
      ['State Assembly, AD 67', ['Mark Pulido']],
      ['State Assembly, AD 69', ['Josh Lowenthal (i)']],
      ['Mayor of Los Angeles', ['Karen Bass (i)']],
      ['LA County Sheriff', ['Robert Luna (i)']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-3-1.jpg',
    sha256: '2c11487676735deb8a9d04ca0642b31db8cee16eaf07e942c83615f78f01b952',
    rows: [
      ['LA City Council, CD 3', ['Barri Worth Girvan']],
      ['LA City Attorney', ['Marissa Roy']],
      ['Alhambra City Council, CD 5', ['Adele Andrade Stadler (i)']],
      ['Alhambra Unified School District, Seat 4', ['Jennifer Tang']],
      ['Antelope Valley- East Kern Water District, Div 1', ['Drew Mercy (i)']],
      ['Artesia City Council', ['Melissa Ramoso (i)', 'Ali Sajjad Taj (i)']],
      ['Bellflower Unified School District, Area 1', ['Amie Stewart (i)']],
      [
        'Burbank City Council',
        ['Nikki Perez (i)', 'Nolan Southerland', 'Mike Van Gorder'],
      ],
      ['Burbank Unified School District, Area 3', ['Rosemary T. Morrison']],
      ['Carson City Council, CD 2', ['Jim Dear (i)']],
      [
        'Centinela Valley Union High School District, Area 5',
        ['Estefany Castaneda (i)'],
      ],
      ['College of the Canyons, Board Area 1', ['Reza Rassool']],
      ['Compton City Council, CD 2', ['Bennie Tinson']],
      ['Compton College Trustee, Area 4', ['Juanita Doplemore (i)']],
      ['Mayor of Compton', ['Emma Sharif (i)']],
      ['Cudahy City Council', ['Cynthina Romo', 'Cynthia Gonzalez (i)']],
      ['Culver City Council', ['Jeannine Wisnosky Stehlin']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-4.jpg',
    sha256: '52cb734845835a11711b300887a826f3cc00829917ab9560d5f23ec6b9a675a5',
    rows: [
      [
        'Culver City Unified School District',
        ['Brian Guerrero (i)', 'Stephanie Loredo (i)'],
      ],
      ['East Whittier City School Board, Seat 1', ['Lisa Dabbs (i)']],
      ['East Whittier City School Board, Seat 3', ['Michael Ramos']],
      ['El Monte City Clerk', ['Jerry Velasco']],
      ['El Monte Union High School District, Area 3', ['Kristy Rowe']],
      [
        'El Monte Union High School District, Area 4',
        ['Florencio Briones (i)'],
      ],
      ['El Monte Union High School District, Area 5', ['Raul Pardo']],
      ['Hacienda- La Puente Unified School District, Area 2', ['Johnny Yoder']],
      [
        'Hacienda- La Puente Unified School District, Area 4',
        ['Gino Kwok (i)'],
      ],
      [
        'Hacienda- La Puente Unified School District, Area 5',
        ['Alitzah Wiener'],
      ],
      ['Hart School District, Board Area 2', ['Julee Brooks']],
      ['Inglewood City Council, CD 2', ['Alex Padilla (i)']],
      ['Hawaiian Gardens City Council', ['Jesus Mendoza']],
      ['La Verne City Council, CD3', ['Mesahl “Kash” Kashifalghita (i)']],
      ['LA Community College District, Seat 2', ['Steve Veres (i)']],
      ['LA Community College District, Seat 4', ['Darryn Harris']],
      ['LA Community College District, Seat 6', ['Randall Winston']],
      ['Mayor of Lawndale', ['Robert Pullen-Miles (i)']],
      ['Little Lake City School District, Area 5', ['Dora Sandoval']],
      ['Long Beach City College Board of Trustees, Area 1', ['Uduak Ntuk (i)']],
      ['Long Beach City College Board of Trustees, Area 3', ['Sunny Zia (i)']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-5.jpg',
    sha256: '5a236d4df2be64eb4c739dad617d17903908c71221038d83b5eaa4b35ed2f299',
    rows: [
      ['Lynwood Unified School District', ['Mariela Renteria']],
      [
        'Lynwood City Council',
        ['Juan Munoz Guevara (i)', 'Mishaun Watkins', 'Emiliano Arellano'],
      ],
      ['Montebello City Council, District 1', ['Rafael Santoya']],
      ['Montebello City Council, District 3', ['Ana Torres']],
      ['Montebello City Council, District 4', ['Danielle Romero (i)']],
      ['Maywood City Council', ['Eddie de la Riva (i)', 'Mayra Aguiluz (i)']],
      ['Monterey Park City Council', ['Thomas Wong (i)', 'Vinh T. Ngo (i)']],
      ['City of Montebello Treasurer', ['David Matanga (i)']],
      [
        'Mt. San Antonio Community College District, Area 3',
        ['Laura Santos (i)'],
      ],
      ['Mountain View School District', ['Adam Carranza (i)', 'Cindy Wu (i)']],
      ['Palmdale City Council, District 4', ['Eric Ohlsen (i)']],
      ['Palmdale City Council, District 5', ['Vergion Jesse Smith']],
      ['Newhall School District, Board Area 1', ['Michelle Kampbell']],
      ['Paramount Unified School District, District 1', ['Sonia Olmos (i)']],
      ['Paramount Unified School District, District 5', ['Tricia Bass-Riedel']],
      ['Palmdale School Board, Area 1', ['Ralph Velador (i)']],
      ['Pico Rivera City Council', ['Johnny Garcia (i)', 'Gustavo Camaco (i)']],
      ['Pasadena City College, Seat 1', ['Francis Pollara']],
      ['Pasadena City College, Seat 3', ['Dr. Steve Gibson (i)']],
      ['Pasadena City College, Seat 7', ['Alton Wang (i)']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-6-1.jpg',
    sha256: 'b82f5b9f3c0b750d180d267c483b5416b867bb5afa95ff9b57df5e120470c763',
    rows: [
      ['Pomona City Council, District 2', ['Jacqueline Elizalde']],
      ['Pomona Unified School District, Area 1', ['Dr. Lisa Nasua (i)']],
      [
        'Rosemead City Council',
        ['Sandra Armenta (i)', 'Diana Lam', 'Steven Ly (i)'],
      ],
      [
        'Rio Hondo Community College Board of Trustees',
        ['Anais Medina Diaz (i)'],
      ],
      ['Santa Clarita City Council, District 2', ['Brett Haddoak']],
      ['Santa Clarita City Council, District 4', ['Valerie Bradford']],
      ['Santa Clarita City Council, District 5', ['Kelvin Driscoll']],
      ['San Gabriel City Council', ['Wendy Wang', 'Denise Menchaca (i)']],
      [
        'Santa Monica City Council',
        ['Brett Morrow', 'Caroline Torosis (i)', 'Danny Ivanov'],
      ],
      ['Santa Clarita Valley Water Board, Div. 3', ['Maria Gutzeit (i)']],
      [
        'Santa Monica College Board of Trustees',
        ['Oscar de la Torre', 'Tom Peters (i)'],
      ],
      [
        'Santa Monica-Malibu Unified School District Board',
        ['Alicia Mignano (i)', 'Laurie Lieberman (i)', 'Robbie Staenberg'],
      ],
      ['Sagus Union School District, Board Area 1', ['Larry Grable']],
      ['Sagus Union School District, Board Area 2', ['Alisa Gentry']],
      ['Sagus Union School District, Area 5', ['Chris Trunkey (i)']],
      [
        'South El Monte City Council',
        ['Rudy Bojorquez (i)', 'Manny Acosta (i)'],
      ],
      ['Southgate City Council', ['Joshua Barron (i)', 'Al Rios (i)']],
      [
        'Three Valleys Municipal Water District, Div 3',
        ['Monica Aleman Gibbs'],
      ],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-8.jpg',
    sha256: '527ed0beec4408fb1064fe095a388605d2100921b3c10f6fe0a0a39144fdcfa3',
    rows: [
      ['Water Replenishment District, Div 3', ['Al Austin']],
      ['West Basin Municipal Water District, Div 1', ['Tommy Faavae (i)']],
      [
        'Whittier Union High School District, District 5',
        ['Armando Urteaga (i)'],
      ],
      [
        'West Hollywood City Council',
        ['Chelsea Byers (i)', 'Jonathon Cottrel', 'Helen Krieger'],
      ],
      ['Whittier City School Board, District 5', ['Andrew Roble']],
      ['West Covina City Council, CD 4', ['Pauline Pezza']],
    ],
  },
  {
    file: 'LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-9.jpg',
    sha256: 'bbed364faa71f02efa26cfb82eb53870d916f13f8d80223b57710ae3866b23c3',
    rows: [],
  },
]

/**
 * The LA Fed guide's entries, after checking the page images found online
 * are exactly the transcribed ones (same files, same bytes).
 */
export function parseLaFed(
  found: { file: string; sha256: string }[],
  pages: TranscribedPage[] = LAFED_TRANSCRIBED,
): ParsedEntry[] {
  const want = pages.map((p) => `${p.file} ${p.sha256}`).sort()
  const got = found.map((p) => `${p.file} ${p.sha256}`).sort()
  if (want.join('\n') !== got.join('\n'))
    throw new Error(
      `LA Fed: the guide's page images changed (found ${found.map((p) => p.file).join(', ')}); read them again and update LAFED_TRANSCRIBED`,
    )
  return pages.flatMap((p) =>
    p.rows.flatMap(([office, names]) =>
      names
        .filter((n) => !LA_NONE.test(n))
        .map((name) => laEntry(name, office)),
    ),
  )
}

/** Stops when a list doesn't show the November 3, 2026 propositions (39 to 45 are only on that ballot). */
function requireNovemberProps(text: string, list: string) {
  if (!/Prop(osition)?\s*(–\s*)?45\b/i.test(text))
    throw new Error(
      `${list}: the page doesn't show the November 2026 propositions; check it's still the general-election list`,
    )
}

/** Lines of a PDF's words, page by page; each line's fields are split where words are more than `gap` points apart. */
function pdfLines(
  words: PdfWord[],
  edges: number[],
  opts: { gap: number; bottom?: number },
): string[][] {
  const pages = Math.max(0, ...words.map((w) => w.page))
  const out: string[][] = []
  for (let p = 1; p <= pages; p++)
    out.push(...columnLines(words, p, edges, opts))
  return out
}

/**
 * Words the California Republican Assembly's PDF prints with a ligature
 * (ti, tt, ffi) that has no text: the gap is marked "◊" and filled from here.
 */
const CRA_LIGATURES: Record<string, string> = {
  'O◊ce': 'Office',
  'A◊orney': 'Attorney',
  'Instruc◊on': 'Instruction',
  'Equaliza◊on': 'Equalization',
  'Representa◊ves': 'Representatives',
  'Con◊nued': 'Continued',
  'Elec◊on': 'Election',
  'Cris◊an': 'Cristian',
  'Ne◊er': 'Netter',
  'Mar◊nez': 'Martinez',
  'Le◊cia': 'Leticia',
  'Cas◊llo': 'Castillo',
  'Or◊z': 'Ortiz',
  'Gu◊errez': 'Gutierrez',
}

const CRA_SECTIONS: [RegExp, string | null][] = [
  [/^Statewide Office$/, ''],
  [/^Statewide Ballot Measures$/, null],
  [/^State Board of Equalization$/, 'Board of Equalization'],
  [/^U\.S\. House of Representatives$/, 'U.S. House'],
  [/^California State Senate( - Continued)?$/, 'State Senate'],
  [/^California State Assembly$/, 'State Assembly'],
]

/**
 * The California Republican Assembly's one-page general-election PDF
 * (pdftotext -bbox): two columns of section headings and "District 27 -
 * Name" rows ("Governor - Name" for statewide offices). Ligatures print as
 * gaps, filled from CRA_LIGATURES; the parser stops on one it doesn't know.
 * A ligature at the very end of a word leaves no gap and can't be seen.
 */
export function parseCra(html: string): ParsedEntry[] {
  const words = parseBbox(html)
  // Ligature glyphs are drawn off the page, at its bottom edge.
  const lines = pdfLines(words, [0, 300], { gap: 4.5, bottom: 780 }).map(
    (fields) =>
      fields.join('◊').replace(/[A-Za-z]+◊[A-Za-z]+/g, (word) => {
        const fixed = CRA_LIGATURES[word]
        if (!fixed)
          throw new Error(
            `CRA: "${word.replace(/◊/g, '_')}" has an unknown missing ligature; add it to CRA_LIGATURES`,
          )
        return fixed
      }),
  )
  // The title runs across both columns.
  const all = lines.join(' ')
  if (!/November 2026 General/.test(all) || !/Election Endorsements/.test(all))
    throw new Error(
      "CRA: the PDF doesn't say November 2026 General Election; check it's still the general-election list",
    )
  const entries: ParsedEntry[] = []
  let section: string | null = null
  for (const line of lines) {
    const heading = CRA_SECTIONS.find(([re]) => re.test(line))
    if (heading) {
      section = heading[1]
      continue
    }
    if (section === null) continue
    const row = line.match(/^(.+?) [-–] (.+)$/)
    if (!row || LA_NONE.test(row[2])) continue
    entries.push(laEntry(row[2], section ? `${section}, ${row[1]}` : row[1]))
  }
  return entries
}

/**
 * The California Republican Assembly's Los Angeles County page (HTML): a
 * card per local candidate (name, then office and seat). Cards under "City
 * Councils/Officers" name the city without the word "city" ("Hawthorne
 * Treasurer"), so their hint reads them as city offices.
 */
export function parseCraLa(html: string): ParsedEntry[] {
  if (!/November 2026 General Election/.test(html))
    throw new Error(
      "CRA: the Los Angeles County page doesn't say November 2026 General Election",
    )
  const entries: ParsedEntry[] = []
  let heading = ''
  for (const m of html.matchAll(
    /<h3[^>]*>([\s\S]*?)<\/h3>|<h2 class="et_pb_module_header"><span>([\s\S]*?)<\/span><\/h2>\s*<div class="et_pb_blurb_description"[^>]*>\s*<h4>([\s\S]*?)<\/h4>\s*(?:<p>([\s\S]*?)<\/p>)?/g,
  )) {
    if (m[1] !== undefined) {
      heading = textOf(m[1])
      continue
    }
    const detail = m[4] === undefined ? '' : textOf(m[4])
    const office =
      detail && !/^candidate$/i.test(detail)
        ? `${textOf(m[3])}, ${detail}`
        : textOf(m[3])
    const city = /city/i.test(heading) && !/\bcity\b/i.test(office)
    entries.push({
      name: laName(m[2]),
      office,
      hint: laHint(city ? `${office}, City` : office),
    })
  }
  return entries
}

/** Reform California's marks for a race with no pick, or a candidate it opposes. */
const REFORM_NO_PICK = /doomed|definitely not|\bretain\b/i

/**
 * Reform California's Los Angeles County voter guide (HTML): candidate
 * sections ("Statewide Candidate Races" to "Special Districts"), each a run
 * of paragraphs where a bold-only line names the office or place and the
 * lines under it read "District 23: Name" or just a name. The guide names
 * one pick per race; "You're Doomed" (no pick), "Definitely NOT", the
 * judicial retention calls and the ballot measures are left out.
 */
export function parseReformCa(html: string): ParsedEntry[] {
  requireNovemberProps(textOf(html), 'Reform California')
  const start = html.search(/>Statewide Candidate Races</)
  const end = html.search(/>Republican Central Committee</)
  if (start < 0 || end < start)
    throw new Error('Reform California: no candidate races on the page')
  const entries: ParsedEntry[] = []
  for (const section of html.slice(start, end).split(/<h2\b/)) {
    let group: string | undefined
    let retention = false
    for (const m of section.matchAll(/<(p|h4)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const body = m[2].replace(/\u200d/g, '')
      const bold = /^\s*<strong>([\s\S]*?)<\/strong>\s*$/.exec(body)
      if (m[1] === 'h4' || bold) {
        const heading = textOf(bold?.[1] ?? body).replace(/:$/, '')
        retention = /supreme court|court of appeal/i.test(heading)
        group = /^statewide offices$/i.test(heading) ? undefined : heading
        continue
      }
      if (retention) continue
      for (const line of body.split(/<br\s*\/?>/i)) {
        const text = textOf(line)
        if (!text || REFORM_NO_PICK.test(text)) continue
        const row = text.match(/^([^:]+):\s*(.+)$/)
        const name = (row ? row[2] : text).replace(
          /\s*[—–-]\s*Dual Endorsement$/i,
          '',
        )
        const office = [group, row?.[1]].filter(Boolean).join(', ')
        entries.push(laEntry(name, office))
      }
    }
  }
  return entries
}

/**
 * The California ProLife Council's 2026 voter guide (HTML): statewide and
 * congressional cards (office, then name) and, in the page's script, one
 * record per local candidate; only Los Angeles County records are read.
 */
export function parseCplc(html: string): ParsedEntry[] {
  requireNovemberProps(textOf(html), 'CPLC')
  const entries: ParsedEntry[] = []
  for (const section of html.split(/<section\b/).slice(1)) {
    const id = section.match(/^[^>]*id="([\w-]+)"/)?.[1]
    if (id !== 'statewide-section' && id !== 'congress-section') continue
    for (const m of section.matchAll(
      /<span class="[^"]*block mb-0\.5">([^<]+)<\/span>\s*<(h3|h4|div)\b[^>]*>\s*<span class="print-checkbox"><\/span>([^<]+?)\s*<\/\2>/g,
    )) {
      const office = decodeEntities(m[1]).trim()
      entries.push(
        laEntry(
          m[3],
          id === 'congress-section' ? `U.S. House, ${office}` : office,
        ),
      )
    }
  }
  for (const m of html.matchAll(
    /\{\s*county:\s*"Los Angeles",\s*type:\s*"candidate",\s*office:\s*"([^"]*)",\s*district:\s*"([^"]*)",\s*name:\s*"([^"]*)",\s*status:\s*"Recommended"/g,
  ))
    entries.push(laEntry(m[3], `${m[1]}, ${m[2]}`))
  return entries
}

/**
 * The California Federation of Teachers' general-election PDF (pdftotext
 * -bbox): statewide offices as a heading line then a name, and "AD 37 Name"
 * rows. A dual endorsement ends its first name with "|" and puts the second
 * on the next line.
 */
export function parseCft(html: string): ParsedEntry[] {
  const lines = pdfLines(parseBbox(html), [0, 200, 380], { gap: 12 }).map(
    (fields) => fields.join(' ').trim(),
  )
  if (
    !lines.some((l) => /^General Election 2026/.test(l)) ||
    !lines.some((l) => /November 3/.test(l))
  )
    throw new Error(
      "CFT: the PDF doesn't say General Election 2026, November 3; check it's still the general-election list",
    )
  const entries: ParsedEntry[] = []
  let statewide = false
  let office: string | undefined
  let more = false
  const add = (text: string) => {
    more = /\|\s*$/.test(text)
    entries.push(laEntry(text.replace(/[|+]/g, ' '), office as string))
    if (!more) office = undefined
  }
  for (const line of lines) {
    if (/^STATEWIDE OFFICES$/.test(line)) {
      statewide = true
      office = undefined
      continue
    }
    if (/^STATEWIDE BALLOT MEASURES$/.test(line)) {
      statewide = false
      office = undefined
      continue
    }
    const row = line.match(/^(AD|SD|CD) (\d+)\+?\s+(.+)$/)
    if (row) {
      office = `${row[1]} ${row[2]}`
      add(row[3])
    } else if (office && (more || statewide)) add(line)
    else if (statewide) office = line.replace(/\+$/, '')
  }
  return entries
}

/**
 * The California Teachers Association's "2026 Candidate Recommendations"
 * PDF (pdftotext -bbox): one table of office and candidate ("AD 02",
 * "Chris Rogers (D)"). "No Recommendation" is left out.
 */
export function parseCta(html: string): ParsedEntry[] {
  const lines = pdfLines(parseBbox(html), [0], { gap: 15 })
  if (!lines.some((l) => /2026 Candidate Recommendations/.test(l.join(' '))))
    throw new Error('CTA: no 2026 Candidate Recommendations in the PDF')
  return lines
    .filter((l) => l.length === 2 && l[0] !== 'District' && !LA_NONE.test(l[1]))
    .map(([office, name]) => laEntry(name, office))
}

/** The end of the bracketed value that starts at `start` in script text, skipping strings. */
function closingBracket(js: string, start: number): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < js.length; i++) {
    const c = js[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  throw new Error('Unbalanced brackets')
}

/** One candidate in the SEIU 721 slate's script data. */
const SEIU_RECORD =
  /\{category:"((?:[^"\\]|\\.)*)",office:"((?:[^"\\]|\\.)*)",candidate:"((?:[^"\\]|\\.)*)"(?:,jurisdiction:"((?:[^"\\]|\\.)*)")?/g

/**
 * SEIU 721's November 3, 2026 slate site (the script bundle): statewide
 * candidates, then lists by region; only the statewide and "la-county"
 * lists are read. Ballot measures are left out.
 */
export function parseSeiu721(js: string): ParsedEntry[] {
  if (!/November 3, 2026/.test(js))
    throw new Error('SEIU 721: the slate no longer names November 3, 2026')
  const lists: string[] = []
  for (const m of js.matchAll(/"la-county":\[/g)) {
    const start = m.index + m[0].length - 1
    lists.push(js.slice(start, closingBracket(js, start) + 1))
  }
  if (!lists.length) throw new Error('SEIU 721: no LA County list')
  const records = [
    ...[...js.matchAll(SEIU_RECORD)].filter((r) => r[1] === 'Statewide'),
    ...lists.flatMap((list) => [...list.matchAll(SEIU_RECORD)]),
  ]
  return records
    .filter((r) => r[1] !== 'Ballot Measure')
    .map((r) => {
      const [office, name, place] = [r[2], r[3], r[4]].map((s) =>
        s === undefined ? undefined : jsString(`"${s}"`),
      )
      return laEntry(name as string, place ? `${place}, ${office}` : office!)
    })
}

/** The LA Forward guide's ratings that are entries. */
const LA_FORWARD_PICKS = new Set(['Endorsed', 'Recommended'])

/**
 * LA Forward's November 2026 voter guide (laforwardguide.org): the home
 * page, then one page per area (statewide offices, legislature, county, a
 * city, a school or water district). Each page is headed by its area; a
 * section inside may name another district ("Claremont USD"). Groups
 * ("City Council", "Races") hold rows of "Office: Name" or a name, each
 * rated "Endorsed", "Recommended" or "No recommendation"; "Endorsed" and
 * "Recommended" candidates are entries. Ballot measures are left out.
 */
export function parseLaForward(home: string, pages: string[]): ParsedEntry[] {
  if (!/November 2026/.test(home) || !/NOV 3/.test(home))
    throw new Error("LA Forward: the guide doesn't name November 2026")
  const seen = new Set<string>()
  const entries: ParsedEntry[] = []
  for (const page of pages) {
    const main = page.slice(page.search(/<main\b/))
    const area = textOf(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')
    for (const section of main.split(/<section\b/).slice(1)) {
      const place =
        textOf(
          section.match(
            /<h2\b[^>]*RegionSection_heading[^>]*>([\s\S]*?)<\/h2>/,
          )?.[1] ?? '',
        ) || area
      for (const group of section
        .split(/<h[23]\b[^>]*RegionSection_groupLabel/)
        .slice(1)) {
        const label = textOf(
          group.match(/^[^>]*>([\s\S]*?)<\/h[23]>/)?.[1] ?? '',
        )
        if (/ballot measure/i.test(label)) continue
        for (const m of group.matchAll(
          /<span class="Accordion_label[^"]*">([\s\S]*?)<\/span><span class="RatingBadge[^"]*">(?:<svg[\s\S]*?<\/svg>)?([\s\S]*?)<\/span>/g,
        )) {
          if (!LA_FORWARD_PICKS.has(textOf(m[2]))) continue
          const row = textOf(m[1]).match(/^(?:([^:]+):\s*)?(.+)$/)
          if (!row) continue
          const office = (label === 'Races' ? [row[1]] : [place, label, row[1]])
            .filter(Boolean)
            .join(', ')
          // District pages repeat inside the city pages they cover.
          if (seen.has(`${row[2]}|${office}`)) continue
          seen.add(`${row[2]}|${office}`)
          entries.push(laEntry(row[2], office))
        }
      }
    }
  }
  if (!entries.length)
    throw new Error('LA Forward: no rated candidates on the pages')
  return entries
}

/** A school or college district named inside a DFI-LA row ("Mountain View School District"). */
const DFI_DISTRICT =
  /\b((?!Unified\b)[A-Z][\w-]*(?: [A-Z][\w-]*)*) (?:Unified School District|School District|Community College District)\b/

/**
 * Democrats for Israel – Los Angeles' endorsements page (HTML): under
 * "ENDORSEMENTS for November 2026 GENERAL ELECTION", ">> Heading" groups of
 * rows like "Luz Rivas CD-29 - Strong Support", "Karen Bass, Mayor of Los
 * Angeles - Support" or a name alone. "Strong Support" and "Support" are
 * entries; "Neutral" and "Oppose" are left out.
 */
export function parseDfiLa(html: string): ParsedEntry[] {
  const start = html.search(/ENDORSEMENTS for November 2026 GENERAL ELECTION/)
  const end = html.search(/For a few candidates who returned our questionnaire/)
  if (start < 0 || end < start)
    throw new Error(
      "DFI-LA: the page doesn't show the November 2026 general-election endorsements",
    )
  const lines = decodeEntities(
    html
      .slice(start, end)
      .replace(/<(?:br|\/p|p)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\bSMMUSD\b/g, 'Santa Monica-Malibu Unified School District')
    .split('\n')
    .map((l) => l.replace(/[*\s]+/g, ' ').trim())
  const entries: ParsedEntry[] = []
  let group = ''
  for (const line of lines) {
    const heading = line.match(/^>>\s*(.+)$/)
    if (heading) {
      group = heading[1]
      continue
    }
    const row = line.match(/^(.+?)\s*-\s*(Strong Support|Support)$/)
    if (!row) continue
    const body = row[1].replace(/\s*\(incumbent\)/g, '')
    const legislative = body.match(/^(.+?),?\s+((?:CD|AD|SD)-\d+)$/)
    const seat = body.match(/^(.+?)\s+-\s+(Seat \d+)$/)
    const titled = body.match(/^([^,]+),\s*(.+)$/)
    if (legislative)
      entries.push(laEntry(legislative[1], legislative[2].replace('-', ' ')))
    else if (seat) entries.push(laEntry(seat[1], `${group}, ${seat[2]}`))
    else if (titled) {
      const district = titled[2].match(DFI_DISTRICT)?.[0]
      const office = district
        ? `${district}, ${titled[2]}`
        : `${group}, ${titled[2]}`
      entries.push(laEntry(titled[1], office))
    } else entries.push(laEntry(body, group))
  }
  return entries
}

/** Job titles Knock LA prints before a name ("DPD Rhonda Haymon", "Mayor Caroline Torosis"). */
const KNOCK_TITLES = /^(?:DA?PD|Mayor)\s+/

/**
 * Knock LA's voter guide for the November 2026 general election (HTML):
 * headings by area (h2), then race headings "Office: Name" (h3 or h4);
 * under "Neighboring LA Cities" a city heading (h3) can instead have one
 * heading per recommended council candidate. A heading can name several
 * candidates ("A, B, and C", "A or B"); each is an entry. Ballot measures,
 * the state judicial retention section, "No Recommendation", "[COMING
 * SOON]" and "Not Name" (a candidate it opposes) are left out.
 */
export function parseKnockLa(html: string): ParsedEntry[] {
  const start = html.search(/November 2026 General Election Races/)
  const end = html.search(/jp-relatedposts/)
  if (start < 0 || end < start)
    throw new Error(
      'Knock LA: no November 2026 General Election races on the page',
    )
  const entries: ParsedEntry[] = []
  let area = ''
  let sub = ''
  for (const m of html
    .slice(start, end)
    .matchAll(/<h([234])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const text = textOf(m[2])
    if (m[1] === '2') {
      ;[area, sub] = [text, '']
      continue
    }
    const race = text.match(/^([^:]+):\s*(.*)$/)
    if (!race && m[1] === '3') {
      sub = text
      continue
    }
    if (area === 'Ballot Measures' || /^State Judicial\b/.test(sub)) continue
    const label = (race?.[1] ?? 'City Council').replace(
      /\s*\(\d+ Seats?\)/i,
      '',
    )
    const names = race ? race[2] : text
    if (!names || /^\[|^No Recommendation$/i.test(names)) continue
    const context =
      area === 'City of Los Angeles'
        ? 'Los Angeles'
        : area === 'US Congress'
          ? `U.S. ${sub}`
          : sub === 'Judge of the Superior Court'
            ? 'Superior Court'
            : area === 'Neighboring LA Cities' && !label.startsWith(sub)
              ? sub
              : ''
    const office = [context, label].filter(Boolean).join(', ')
    for (const name of names.split(/,\s*(?:and\s+)?|\s+(?:and|or)\s+/))
      if (!/^Not\s/.test(name))
        entries.push(laEntry(name.replace(KNOCK_TITLES, ''), office))
  }
  return entries
}

/**
 * DSA-LA's endorsed candidates for the 2026 general election (the "Shake
 * Up LA" site, HTML): a heading per candidate, then a line "for Office".
 */
export function parseDsaLa(html: string): ParsedEntry[] {
  if (!/endorse[^<]*2026 general election/i.test(textOf(html)))
    throw new Error(
      "DSA-LA: the page doesn't say it lists the 2026 general-election endorsements",
    )
  const page = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, '')
  const entries: ParsedEntry[] = []
  for (const m of page.matchAll(
    /<h2\b[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|$)/g,
  )) {
    const office = [...m[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
      .map((p) => textOf(p[1]))
      .find((t) => /^for\s/.test(t))
    if (office) entries.push(laEntry(m[1], office.replace(/^for\s+/, '')))
  }
  if (!entries.length) throw new Error('DSA-LA: no candidates on the page')
  return entries
}

/**
 * United Teachers Los Angeles' 2026 endorsements page (HTML): under
 * "ENDORSED CANDIDATES", a heading per candidate ("Name, Office"). Los
 * Angeles city offices are printed without the city, so their hint adds
 * it. Headings without a comma ("YES on Prop 3") are ballot measures.
 */
export function parseUtla(html: string): ParsedEntry[] {
  if (!/Disclaimer-General-2026/.test(html))
    throw new Error(
      "UTLA: the page no longer carries the 2026 general-election disclaimer; check it's still the general-election list",
    )
  const start = html.search(/ENDORSED CANDIDATES/)
  const end = html.search(/State Affiliates/)
  if (start < 0 || end < start)
    throw new Error('UTLA: no endorsed candidates on the page')
  const entries: ParsedEntry[] = []
  for (const m of html.slice(start, end).matchAll(/<h2>([\s\S]*?)<\/h2>/g)) {
    const row = textOf(m[1]).match(/^([^,]+),\s*(.+)$/)
    if (!row) continue
    const office = row[2]
    entries.push({
      name: laName(row[1]),
      office,
      hint: laHint(/^City\b/.test(office) ? `Los Angeles ${office}` : office),
    })
  }
  return entries
}

/** The California WFP list's regions whose races can be on Los Angeles County ballots. */
const WFP_REGIONS = ['Los Angeles', 'Statewide']

/**
 * The California Working Families Party's candidates (HTML table rows from
 * its California page and the rest of the list, which the page loads on
 * "View More"): name, office, region. Only the Los Angeles and statewide
 * regions are read; the others' offices are elsewhere, and their labels
 * have typos ("Distrcit 6") that would make a loose hint.
 */
export function parseWfpCa(pages: string[]): ParsedEntry[] {
  requireNovemberProps(textOf(pages[0] ?? ''), 'California WFP')
  const seen = new Set<string>()
  const entries: ParsedEntry[] = []
  for (const html of pages)
    for (const m of html.matchAll(
      /state-cands__name">([\s\S]*?)<\/td>\s*<td class="state-cands__info">([\s\S]*?)<\/td>\s*<td class="state-cands__rac">([\s\S]*?)<\/td>/g,
    )) {
      if (!WFP_REGIONS.includes(textOf(m[3]))) continue
      const name = textOf(m[1])
      const office = textOf(m[2])
      if (seen.has(`${name}|${office}`)) continue
      seen.add(`${name}|${office}`)
      entries.push(laEntry(name, office))
    }
  return entries
}
