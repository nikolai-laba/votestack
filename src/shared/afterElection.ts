// The site-wide switch for the time after an election. While it's on, pages
// say voting has ended and link to the official results. Turning it off
// restores the site as it was before the election.

/** Whether voting in the November 3, 2026 election has ended. */
export const AFTER_ELECTION: boolean = false

/**
 * Where the notice's words are served from. The build writes this file only
 * while AFTER_ELECTION is on, and robots.txt keeps crawlers out of /notice/,
 * so the words are in neither the app's code nor the prerendered pages.
 */
export const NOTICE_WORDS_PATH = '/notice/after-election.json'

/** The words of the thank-you notice shown after an election. */
export interface NoticeWords {
  version: 1
  heading: string
  intro: string
  signup: { heading: string; body: string }
  support: {
    heading: string
    body: string
    payLabel: string
    /** A Stripe Payment Link; the only kind of address accepted. */
    payUrl: string
    fine: string
    linkLabel: string
  }
  /** The one-line form the notice shrinks to once it is closed. */
  line: { text: string; open: string; openSignedUp: string }
}

const PAY_URL_PREFIX = 'https://buy.stripe.com/'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every named field of `value`, if each is a non-empty string. */
function stringFields<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, string> | null {
  if (!isRecord(value)) return null
  const fields = {} as Record<K, string>
  for (const key of keys) {
    const field = value[key]
    if (typeof field !== 'string' || field === '') return null
    fields[key] = field
  }
  return fields
}

/**
 * Reads the words file. Null unless every field is present as a non-empty
 * string, the version is one this code knows and the pay link goes to
 * Stripe over https, so a damaged or altered file shows no notice at all.
 */
export function parseNoticeWords(raw: unknown): NoticeWords | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  const top = stringFields(raw, ['heading', 'intro'])
  const signup = stringFields(raw.signup, ['heading', 'body'])
  const support = stringFields(raw.support, [
    'heading',
    'body',
    'payLabel',
    'payUrl',
    'fine',
    'linkLabel',
  ])
  const line = stringFields(raw.line, ['text', 'open', 'openSignedUp'])
  if (!top || !signup || !support || !line) return null
  if (!support.payUrl.startsWith(PAY_URL_PREFIX)) return null
  return { version: 1, ...top, signup, support, line }
}
