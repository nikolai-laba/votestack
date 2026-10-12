// Matches names as printed on the ballot ("Elizabeth "Liz" Doody Gorman",
// "Bill Foster") with names in official filings ("Gorman", "Elizabeth Doody";
// "FOSTER, G. WILLIAM (BILL)"). Used by the campaign money import, where a
// wrong match would show someone else's money, so it errs on the side of no
// match: the last name must match exactly and a given name must agree.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'md', 'hon', 'ret', 'ltc'])

/**
 * Given names that are the same person but neither is a prefix of the other.
 * (Prefixes such as Pat/Patrick or Jeff/Jeffrey match without this list.)
 */
const NICKNAMES: string[][] = [
  ['william', 'bill', 'will', 'billy'],
  ['robert', 'bob', 'bobby', 'rob'],
  ['richard', 'rick', 'dick', 'rich'],
  ['james', 'jim', 'jimmy'],
  ['michael', 'mike'],
  ['elizabeth', 'liz', 'lisa', 'beth', 'betsy'],
  ['edward', 'ed', 'ted', 'eddie'],
  ['theodore', 'ted'],
  ['anthony', 'tony'],
  ['christopher', 'chris'],
  ['christian', 'chris'],
  ['deborah', 'debby', 'debbie', 'deb'],
  ['patricia', 'trish', 'patty', 'pat'],
  ['suzanne', 'suzy', 'sue'],
  ['martha', 'marti'],
  ['katherine', 'kate', 'kathy', 'katie'],
  ['margaret', 'maggie', 'peggy'],
  ['john', 'jack'],
  ['thomas', 'tom'],
  ['joseph', 'joe'],
  ['daniel', 'dan', 'danny'],
  ['benjamin', 'ben'],
  ['samuel', 'sam'],
  ['peter', 'pete'],
  ['nicholas', 'nick'],
  ['charles', 'chuck', 'charlie'],
  ['alexander', 'alex'],
  ['angelica', 'angie'],
]

const nicknamePairs = new Set(
  NICKNAMES.flatMap((group) =>
    group.flatMap((a) => group.map((b) => `${a}|${b}`)),
  ),
)

export interface ParsedName {
  /** Every word, lowercase and without accents, suffixes or titles. */
  words: string[]
  /** Given names to compare: the first word and any quoted or bracketed nickname. */
  given: string[]
}

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Quoted or bracketed parts: `"Liz"`, `(BILL)`. */
function nicknamesIn(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(/["“”]([^"“”]+)["“”]|\(([^)]+)\)/g))
    out.push(...words(m[1] ?? m[2]))
  return out
}

function words(s: string): string[] {
  return fold(s)
    .replace(/[’'.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SUFFIXES.has(w) && !TITLES.has(w))
}

const withoutNicknames = (s: string) =>
  s.replace(/["“”][^"“”]*["“”]|\([^)]*\)/g, ' ')

/**
 * A ballot name. For a joint ticket ("JB Pritzker & Christian Mitchell") this
 * is the first person, whose committee runs the ticket's campaign.
 */
export function parseBallotName(name: string): ParsedName {
  const first = name.split(/\s+&\s+|\s+and\s+/)[0]
  const w = words(withoutNicknames(first))
  return { words: w, given: [...w.slice(0, 1), ...nicknamesIn(first)] }
}

/** Given names in a filing's first-name field, plus nicknames in either field. */
function officialGivenNames(last: string, first: string): string[] {
  const w = words(withoutNicknames(first))
  // "G. William" goes by the middle name, so an initial lets the next word count.
  const given = w[0]?.length === 1 ? w.slice(0, 2) : w.slice(0, 1)
  return [...given, ...nicknamesIn(first), ...nicknamesIn(last)]
}

/** "SCHNEIDER, BRADLEY S." → last "SCHNEIDER", first "BRADLEY S." */
export function splitCommaName(name: string): { last: string; first: string } {
  const i = name.indexOf(',')
  if (i < 0) return { last: name, first: '' }
  return { last: name.slice(0, i), first: name.slice(i + 1) }
}

/**
 * Same given name: equal, a known nickname, or (unless `strict`) a prefix of
 * 3+ letters. `strict` drops the prefix rule, which would match relatives
 * ("Chris" and "Christine").
 */
export function givenNamesAgree(a: string, b: string, strict = false): boolean {
  if (a === b) return true
  if (nicknamePairs.has(`${a}|${b}`)) return true
  if (strict) return false
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short)
}

/**
 * True when the ballot name ends with the filing's last name (all its words,
 * so "Ponce de Leon" and "Doody Gorman" work) and a given name agrees.
 */
export function namesMatch(
  ballot: ParsedName,
  officialLast: string,
  officialFirst: string,
  options: { typoInLastName?: boolean; strictGiven?: boolean } = {},
): boolean {
  const last = words(withoutNicknames(officialLast))
  if (last.length === 0 || last.length >= ballot.words.length) return false
  const tail = ballot.words.slice(-last.length).join(' ')
  const filed = last.join(' ')
  const sameLast =
    tail === filed ||
    (options.typoInLastName === true &&
      filed.length >= 6 &&
      oneEditApart(tail, filed))
  if (!sameLast) return false
  const official = officialGivenNames(officialLast, officialFirst)
  return ballot.given.some((b) =>
    official.some((o) => givenNamesAgree(b, o, options.strictGiven)),
  )
}

/** True when b is a with one letter changed, added or removed ("Villivalim" for "Villivalam"). */
export function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1)
}

/**
 * True when a ballot name and an official's full name in "First Middle Last"
 * order are the same person, by the rules of namesMatch. For rosters such as
 * the General Assembly's member lists ("Edgar González, Jr.", "Emanuel
 * "Chris" Welch"). The last name is the official's last word, or their last
 * two words run together, so "Kimberly Du Buclet" matches "Kimberly Neely
 * DuBuclet".
 */
export function fullNameMatches(ballotName: string, official: string): boolean {
  const ballot = parseBallotName(ballotName)
  const plain = words(withoutNicknames(official))
  if (plain.length < 2) return false
  const nicknames = nicknamesIn(official)
    .map((n) => `(${n})`)
    .join(' ')
  const tries: [string, string[]][] = [[plain.at(-1) ?? '', plain.slice(0, -1)]]
  if (plain.length >= 3)
    tries.push([plain.slice(-2).join(''), plain.slice(0, -2)])
  return tries.some(([last, given]) =>
    namesMatch(ballot, last, `${given.join(' ')} ${nicknames}`),
  )
}
