// Readable titles and text from the Registrar's Interactive Sample Ballot,
// which prints names and headings in capitals.

import { readableCase } from '../../src/shared/text.ts'

/**
 * A title in readable case. readableCase leaves a lone capitalized word
 * ("SHERIFF", "GOVERNOR") as it is, so a title with no lower case at all is
 * capitalized word by word. A measure's letters stay as the Registrar prints
 * them ("MEASURE A", "MEASURE AT", "MEASURE RC").
 */
export function titleCase(text: string): string {
  const letters = /\bMEASURE\s+(\S+)/i.exec(text)?.[1]
  const readable = readableCase(text)
  const cased = /[a-z]/.test(readable)
    ? readable
    : readable
        .toLowerCase()
        .replace(/(^|[\s(-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
        .replace(/\b(Of|The|And|For)\b/g, (w) => w.toLowerCase())
  return letters === undefined
    ? cased
    : cased.replace(/\b(Measure\s+)\S+/i, (_, word) => word + letters)
}

/** Small words the Secretary of State keeps in lower case inside a title. */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
])

/**
 * A statewide measure's title in the Secretary of State's style:
 * "AUTHORIZES BONDS FOR HOUSING AFFORDABILITY PROGRAMS." → "Authorizes
 * Bonds for Housing Affordability Programs". Every word is capitalized
 * (each part of a hyphenated word too) except small words after a word;
 * after a number the Secretary of State capitalizes them ("90% Of
 * Revenue"). Possessives keep a lower-case s ("STATE'S" → "State's").
 */
function stateTitleCase(text: string): string {
  let previous = ''
  return text
    .split(/(\s+)/)
    .map((word) => {
      if (!word.trim()) return word
      const lower = word.toLowerCase()
      const small =
        previous !== '' &&
        /\p{L}/u.test(previous) &&
        !/[.:]$/.test(previous) &&
        SMALL_WORDS.has(lower)
      previous = word
      if (small) return lower
      return lower.replace(
        /(^|-)(\p{L})/gu,
        (_, sep, ch) => sep + ch.toUpperCase(),
      )
    })
    .join('')
}

/**
 * A statewide measure's number and title from its Sample Ballot entry: the
 * name is "STATE MEASURE 1" and the description starts with the title in
 * bold, followed by the kind of measure ("AUTHORIZES BONDS FOR HOUSING
 * AFFORDABILITY PROGRAMS. LEGISLATIVE STATUTE."). Undefined for county and
 * local measures, or when the description has no bold title.
 */
export function stateMeasure(
  name: string,
  description: string,
): { number: string; title: string } | undefined {
  const number = /^\s*STATE MEASURE\s+(\d+)\s*$/i.exec(name)?.[1]
  const bold = /^\s*<b>([^<]+)<\/b>/i.exec(description)?.[1]
  if (!number || !bold) return undefined
  const heading = bold
    .replace(/\s+/g, ' ')
    .trim()
    // The kind of measure, which the title leaves out.
    .replace(/\s*\b(LEGISLATIVE|INITIATIVE|REFERENDUM)\b[A-Z ,]*\.?$/, '')
    .replace(/\.$/, '')
  return { number, title: stateTitleCase(heading) }
}

/** "Proposition 1: Authorizes Bonds for Housing Affordability Programs" */
export const propositionTitle = (m: { number: string; title: string }) =>
  `Proposition ${m.number}: ${m.title}`

/**
 * A measure's official text without markup, with a line break before the
 * bold "Fiscal Impact:", "Supporters:" and "Opponents:" labels so each part
 * starts its own line.
 */
export function measureText(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(
      /\s*(<b>\s*(?:Fiscal Impact|Supporters|Opponents):?\s*<\/b>)/gi,
      '\n$1',
    )
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** The Secretary of State's Official Voter Information Guide page for a proposition. */
export const voterGuideUrl = (number: string) =>
  `https://voterguide.sos.ca.gov/propositions/${number}/`
