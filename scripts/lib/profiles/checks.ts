// Automated checks every generated profile must pass before it's published
// Pure functions: citations, allowed sources, neutral tone (VoteStack's
// writing rules), length per tier and privacy patterns. Link and support checks that
// need the network live elsewhere.

import {
  OVERVIEW_PARAGRAPH_LIMITS,
  OVERVIEW_WORD_LIMITS,
  type CandidateProfile,
} from '../../../src/shared/profile.ts'
import { IS_COOK } from './region.ts'

export type CheckRule =
  | 'citation'
  | 'source'
  | 'tone'
  | 'length'
  | 'privacy'
  | 'judicial'
  | 'link'
  | 'coverage'
  | 'date'
  | 'support'

export interface Issue {
  rule: CheckRule
  /** Errors block publishing; warnings are reviewed by hand. */
  severity: 'error' | 'warning'
  message: string
  /** Where it was found, e.g. "overview[1]" or "sources[3]". */
  at?: string
}

const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  't.co',
  'tiktok.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'threads.net',
  'threads.com',
  'bsky.app',
  'reddit.com',
  'nextdoor.com',
  'snapchat.com',
  'pinterest.com',
  'mastodon.social',
  'truthsocial.com',
]

function host(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function isSocialMedia(url: string): boolean {
  const h = host(url)
  return !!h && SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`))
}

/** Every item cites at least one source, and every cited number exists. */
export function checkCitations(p: CandidateProfile): Issue[] {
  const issues: Issue[] = []
  const ids = new Set(p.sources.map((s) => s.id))
  if (ids.size !== p.sources.length) {
    issues.push({
      rule: 'citation',
      severity: 'error',
      message: 'Source numbers repeat',
    })
  }
  const items: [string, number[]][] = [
    ...p.overview.items.map((o, i): [string, number[]] => [
      `overview[${i}]`,
      o.cites,
    ]),
    ...p.endorsements.items.map((e, i): [string, number[]] => [
      `endorsements[${i}]`,
      e.cites,
    ]),
  ]
  const used = new Set<number>()
  for (const [at, cites] of items) {
    if (!cites?.length) {
      issues.push({
        rule: 'citation',
        severity: 'error',
        message: 'No source',
        at,
      })
    }
    for (const id of cites ?? []) {
      used.add(id)
      if (!ids.has(id)) {
        issues.push({
          rule: 'citation',
          severity: 'error',
          message: `Cites source ${id}, which isn't listed`,
          at,
        })
      }
    }
  }
  p.sources.forEach((s, i) => {
    if (!used.has(s.id)) {
      issues.push({
        rule: 'citation',
        severity: 'warning',
        message: `Source ${s.id} is never cited`,
        at: `sources[${i}]`,
      })
    }
  })
  return issues
}

/** Source URLs are valid http(s) links and never social media. */
export function checkSources(p: CandidateProfile): Issue[] {
  const issues: Issue[] = []
  p.sources.forEach((s, i) => {
    const at = `sources[${i}]`
    const h = host(s.url)
    if (!h || !/^https?:\/\//i.test(s.url)) {
      issues.push({
        rule: 'source',
        severity: 'error',
        message: `Not a web link: ${s.url}`,
        at,
      })
    } else if (isSocialMedia(s.url)) {
      issues.push({
        rule: 'source',
        severity: 'error',
        message: `Social media: ${h}`,
        at,
      })
    } else if (h.endsWith('vertexaisearch.cloud.google.com')) {
      issues.push({
        rule: 'source',
        severity: 'error',
        message: 'Search redirect link instead of the page itself',
        at,
      })
    }
  })
  return issues
}

/** Words that read as AI writing, banned in all VoteStack copy. */
const BANNED_WORDS = [
  'unlock',
  'unlocks',
  'unlocking',
  'empower',
  'empowers',
  'empowering',
  'seamless',
  'seamlessly',
  'transform',
  'transforms',
  'transformed',
  'transforming',
  'transformative',
  'supercharge',
  'elevate',
  'elevates',
  'elevating',
  'delve',
  'delves',
  'tapestry',
  'landscape',
  'pivotal',
  'crucial',
  'foster',
  'fosters',
  'fostering',
  'robust',
  'journey',
]

/** Loaded descriptors that hint at a preference. */
const LOADED_WORDS = [
  'controversial',
  'radical',
  'extreme',
  'extremist',
  'staunch',
  'beloved',
  'embattled',
  'tireless',
  'tirelessly',
  'firebrand',
  'divisive',
  'disgraced',
  'champion',
  'champions',
  'championed',
  'passionate',
  'fierce',
  'fiercely',
  'visionary',
  'trailblazer',
  'trailblazing',
  'stalwart',
  'progressive champion',
  'far-left',
  'far-right',
  'hardline',
  'notorious',
  'scandal-plagued',
  'outspoken',
]

const SUPERLATIVES = [
  'best',
  'worst',
  'greatest',
  'finest',
  'strongest',
  'weakest',
  'foremost',
  'unparalleled',
  'unmatched',
  'unrivaled',
  'renowned',
  'acclaimed',
  'most respected',
  'most effective',
  'most experienced',
  'most qualified',
  'most powerful',
  'most influential',
  'most popular',
  'most successful',
]

const wordList = (words: string[]) =>
  new RegExp(
    `\\b(${words.map((w) => w.replace(/-/g, '\\-')).join('|')})\\b`,
    'gi',
  )

const TONE_PATTERNS: { re: RegExp; message: string }[] = [
  { re: wordList(BANNED_WORDS), message: 'Banned word' },
  { re: wordList(LOADED_WORDS), message: 'Loaded word' },
  { re: wordList(SUPERLATIVES), message: 'Superlative' },
  { re: /[—–]/g, message: 'Em or en dash' },
  {
    re: /\bnot (just|only|merely)\b[^.]*\bbut\b/gi,
    message: '"Not just X, but Y" framing',
  },
  {
    re: /\b(it|this|that)['’]?s not\b[^.]*,\s*(it|this|that)['’]?s\b/gi,
    message: '"It\'s not X, it\'s Y" framing',
  },
  { re: /\s·\s/g, message: 'Middle-dot list' },
  { re: /\p{Extended_Pictographic}/gu, message: 'Emoji' },
  { re: /!/g, message: 'Exclamation mark' },
  // Citations belong in "cites"; some models also paste links into the text.
  { re: /https?:\/\/\S+|\]\([^)]*\)/g, message: 'Link in text' },
]

/** Word-list rules, where a capitalized word may be part of a name. */
const WORD_RULES = new Set(['Banned word', 'Loaded word', 'Superlative'])

/**
 * A capitalized word in the middle of a sentence is a proper noun, such as
 * "Journey for Justice Alliance" or "Champion Mobility Fund", not a tone hit.
 */
function isProperNoun(text: string, index: number, word: string): boolean {
  if (word[0] === word[0].toLowerCase()) return false
  const before = text.slice(0, index).trimEnd()
  return before.length > 0 && !/[.!?:"“(]$/.test(before)
}

/** Tone lint for one piece of text; returns each hit. */
export function lintTone(text: string): { message: string; match: string }[] {
  const hits: { message: string; match: string }[] = []
  for (const { re, message } of TONE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (WORD_RULES.has(message) && isProperNoun(text, m.index, m[0])) continue
      // "foster care", "foster youth": the child-welfare term, not the verb.
      if (
        /^foster$/i.test(m[0]) &&
        /^\s+(care|youth|children|child|kids|parents?|families|family|homes?)\b/i.test(
          text.slice((m.index ?? 0) + m[0].length),
        )
      )
        continue
      hits.push({ message, match: m[0] })
    }
  }
  return hits
}

/**
 * Blanks the capitalized words of the person's own name, so a name like
 * "Bill Foster" doesn't read as the banned word "foster".
 */
export function withoutName(text: string, name: string): string {
  const words = name.match(/\p{Lu}[\p{L}'’-]+/gu) ?? []
  return words.reduce(
    (t, w) =>
      t.replace(
        // Name words hold only letters, apostrophes and hyphens: no escaping.
        new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'gu'),
        ' ',
      ),
    text,
  )
}

export function checkTone(p: CandidateProfile): Issue[] {
  return p.overview.items.flatMap((o, i) =>
    lintTone(withoutName(o.text, p.name)).map((h): Issue => ({
      rule: 'tone',
      severity: 'error',
      message: `${h.message}: "${h.match}"`,
      at: `overview[${i}]`,
    })),
  )
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/**
 * How far over the word limit an overview may run before it blocks: none
 * for Cook County; 15% elsewhere, where a slightly long overview is only a
 * warning (maintainer decision, October 2026).
 */
export const WORD_MARGIN = IS_COOK ? 0 : 0.15

/** Words and paragraphs within the tier's limits (src/shared/profile.ts). */
export function checkLength(
  p: CandidateProfile,
  margin = WORD_MARGIN,
): Issue[] {
  const issues: Issue[] = []
  const words = p.overview.items.reduce((n, o) => n + countWords(o.text), 0)
  const paragraphs = p.overview.items.length
  const maxWords = OVERVIEW_WORD_LIMITS[p.tier]
  const maxParagraphs = OVERVIEW_PARAGRAPH_LIMITS[p.tier]
  if (words > maxWords) {
    issues.push({
      rule: 'length',
      severity: words > maxWords * (1 + margin) ? 'error' : 'warning',
      message: `${words} words; the ${p.tier} tier allows ${maxWords}`,
    })
  }
  if (paragraphs > maxParagraphs) {
    issues.push({
      rule: 'length',
      severity: 'error',
      message: `${paragraphs} paragraphs; the ${p.tier} tier allows ${maxParagraphs}`,
    })
  }
  if (p.overview.items.some((o) => o.text.split(/\n\s*\n/).length > 1)) {
    issues.push({
      rule: 'length',
      severity: 'warning',
      message: 'A paragraph item holds more than one paragraph',
    })
  }
  return issues
}

const MONTHS =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?'

const PRIVACY_PATTERNS: { re: RegExp; message: string }[] = [
  {
    // A year ("2022 Supreme Court") isn't a house number.
    re: /\b(?!(?:19|20)\d{2}\b)\d{1,6}\s+(?:[NSEW]\.?\s+|North\s+|South\s+|East\s+|West\s+)?(?:[A-Z][\w.'-]*\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Pkwy|Parkway|Ter|Terrace|Cir|Circle|Hwy|Highway)\b\.?/g,
    message: 'Street address',
  },
  {
    re: /(?:\+1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    message: 'Phone number',
  },
  { re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, message: 'Email address' },
  {
    re: new RegExp(
      `\\bborn\\b[^.]{0,30}?\\b(${MONTHS}\\s+\\d{1,2}|\\d{4}|\\d{1,2}/\\d{1,2})`,
      'gi',
    ),
    message: 'Birth date',
  },
  // "Birthday" alone is too broad ("screenings in a resident's birthday month").
  {
    re: /\b(date of birth|DOB)\b|\b(his|her|their) birthday\b/gi,
    message: 'Birth date',
  },
  {
    re: /\b(?:age|aged)\s+\d{1,3}\b|\b\d{1,3}[- ]years?[- ]old\b/gi,
    message: 'Age',
  },
  {
    re: /\b(his|her) (wife|husband|spouse|partner|son|sons|daughter|daughters|children|kids|child)\b|\b(married|mother of|father of)\b/gi,
    message: 'Family',
  },
]

export function lintPrivacy(
  text: string,
): { message: string; match: string }[] {
  const hits: { message: string; match: string }[] = []
  for (const { re, message } of PRIVACY_PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ message, match: m[0] })
  }
  return hits
}

export function checkPrivacy(p: CandidateProfile): Issue[] {
  const texts: [string, string][] = [
    ...p.overview.items.map((o, i): [string, string] => [
      `overview[${i}]`,
      o.text,
    ]),
    ...p.endorsements.items.map((e, i): [string, string] => [
      `endorsements[${i}]`,
      e.organization,
    ]),
  ]
  return texts.flatMap(([at, text]) =>
    lintPrivacy(text).map((h): Issue => ({
      rule: 'privacy',
      severity: 'error',
      message: `${h.message}: "${h.match}"`,
      at,
    })),
  )
}

/** Judges can't announce views, so their profiles hold no positions. */
const POSITION_WORDS =
  /\b(supports|opposes|has proposed|proposes|promises|pledges|plans to|wants to|would (?:vote|rule|end|ban|cut|raise)|is against|favors)\b/gi

export function checkJudicial(p: CandidateProfile): Issue[] {
  if (p.kind === 'candidate') return []
  return p.overview.items.flatMap((o, i) =>
    [...o.text.matchAll(POSITION_WORDS)].map((m): Issue => ({
      rule: 'judicial',
      severity: 'warning',
      message: `Position language in a judge's profile: "${m[0]}"`,
      at: `overview[${i}]`,
    })),
  )
}

export interface CheckResult {
  pass: boolean
  issues: Issue[]
}

/** Runs every check; a profile passes when no check finds an error. */
export function runChecks(p: CandidateProfile): CheckResult {
  const issues = [
    ...checkCitations(p),
    ...checkSources(p),
    ...checkTone(p),
    ...checkLength(p),
    ...checkPrivacy(p),
    ...checkJudicial(p),
  ]
  return { pass: !issues.some((i) => i.severity === 'error'), issues }
}
