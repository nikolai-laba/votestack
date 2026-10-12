// Text clean-up for headings and names that official sources print in all
// caps.

/**
 * Words kept in capitals: acronyms and Roman numerals seen on Illinois
 * ballots, and acronyms in the committee and donor names of campaign
 * filings (ISBE, FEC).
 */
const ACRONYMS = new Set([
  'CPS',
  'MWRD',
  'US',
  'USA',
  'ILCS',
  'IL',
  'CCSD',
  'CUSD',
  'SD',
  'HSD',
  'PTAB',
  'ROE',
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
  // Campaign committees and donors.
  'PAC',
  'LLC',
  'LLP',
  'NFP',
  'AFL',
  'CIO',
  'AFSCME',
  'SEIU',
  'HCII',
  'IBEW',
  'CTU',
  'UFCW',
  'COPE',
  'CME',
  'BMO',
  'AAR',
  'ACEC',
  'BOMA',
  'DLGA',
  'IFSA',
  'IHA',
  'IMHA',
  'INCS',
  'IPACE',
  'ISDF',
  'RAI',
])

/** Short words that stay lowercase inside a heading, except at the start. */
const MINOR = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

/** True for a word with at least two letters and no lowercase ones ("LAND", "OWNERS'", "U.S."). */
const isShouted = (word: string) =>
  /[A-Z].*[A-Z]/.test(word) && !/[a-z]/.test(word)

/** One all-caps word or hyphen-free part of one, in title case. */
function softenPart(part: string, first: boolean): string {
  const letters = part.replace(/[^A-Za-z]/g, '')
  if (ACRONYMS.has(letters)) return part
  // Ordinals and numbers: "1ST" → "1st".
  if (/^\d/.test(part)) return part.toLowerCase()
  const lower = part.toLowerCase()
  if (!first && MINOR.has(lower)) return lower
  // A name run into "PAC": "AMERIPAC" → "AmeriPAC".
  const pac = /^([a-z]{2,})pac(\W*)$/.exec(lower)
  if (pac) return `${softenPart(pac[1].toUpperCase(), true)}PAC${pac[2]}`
  return (
    lower
      .replace(
        /(^|[/(“"'])([a-z])/g,
        (_, before, letter) => `${before}${letter.toUpperCase()}`,
      )
      // "MCLEAN" → "McLean".
      .replace(
        /^([(“"]?)Mc([a-z])(?=[a-z]{2})/,
        (_, before, letter) => `${before}Mc${letter.toUpperCase()}`,
      )
      // An apostrophe ending a word is a contraction or possessive, not a
      // name like O'Malley: "AMERICA'S" → "America's", "INT'L" → "Int'l".
      .replace(
        /(['’])([A-Z])([a-z]?\W*)$/,
        (_, mark, letter, rest) => `${mark}${letter.toLowerCase()}${rest}`,
      )
  )
}

function soften(word: string, first: boolean): string {
  if (ACRONYMS.has(word.replace(/[^A-Za-z]/g, ''))) return word
  // Each hyphenated part on its own: "SELF-FUNDING" → "Self-Funding",
  // "AFL-CIO" stays, "DENT-IL-PAC" → "Dent-IL-PAC".
  return word
    .split('-')
    .map((part, k) => softenPart(part, first && k === 0))
    .join('-')
}

/**
 * Turns all-caps words in a heading, office name, or a committee or donor
 * name into title case (the site never shows all caps), keeping acronyms
 * such as CPS, MWRD, U.S., ILCS, PAC and LLC, numbers and ordinals, and
 * words already in mixed case ("JULIANA FOR ILLINOIS" → "Juliana for
 * Illinois", "CME GROUP INC. PAC" → "CME Group Inc. PAC").
 * Only text with two or more all-caps words in a row (numbers in between
 * don't count) is changed, so a lone acronym ("CPS District 299") is left
 * alone. Never use it on official ballot text (a referendum's question);
 * only on titles and names.
 */
export function readableCase(text: string): string {
  const parts = text.split(/(\s+)/)
  // Words with letters, in order; numbers and spaces don't break a run.
  const lettered = parts.filter((part) => /[A-Za-z]/.test(part))
  const hasRun = lettered.some(
    (part, k) => isShouted(part) && isShouted(lettered[k + 1] ?? ''),
  )
  if (!hasRun) return text
  let atStart = true
  return parts
    .map((part) => {
      if (!part.trim()) return part
      const first = atStart
      atStart = /[:(]$/.test(part)
      // The article "A" has one letter, so isShouted misses it.
      if (part === 'A') return first ? part : 'a'
      return isShouted(part) ? soften(part, first) : part
    })
    .join('')
}

/**
 * A committee's or donor's name from campaign filings, readable: names
 * filed in all caps go through readableCase ("JULIANA FOR ILLINOIS" →
 * "Juliana for Illinois"), extra spaces are dropped, and a name filed in
 * mixed case is kept as filed, since its capitals ("Illinois CRNA PAC")
 * are meant.
 */
export function readableName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return /[a-z]/.test(clean) ? clean : readableCase(clean)
}
