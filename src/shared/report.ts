// Error reports on candidate profiles. The form (src/pages/ReportPage)
// and the Worker (worker/report.ts) validate with the same rules, and the
// database (supabase/migrations/*_profile_reports.sql) checks them again.

export const REPORT_SECTIONS = [
  'overview',
  'money',
  'endorsements',
  'sources',
  'other',
] as const

export type ReportSection = (typeof REPORT_SECTIONS)[number]

export const REPORT_MESSAGE_MAX = 2000
export const REPORT_URL_MAX = 500
/** Turnstile tokens are at most 2048 characters. */
export const TURNSTILE_TOKEN_MAX = 2048

export interface ProfileReport {
  key: string
  section: ReportSection
  message: string
  /** Required: we correct profiles only from a cited source. */
  sourceUrl: string
}

export type ReportField = 'section' | 'message' | 'sourceUrl'

export const REPORT_ERRORS = {
  section: 'Choose which part of the profile is wrong.',
  messageEmpty: 'Tell us what is wrong.',
  messageLong: `Use ${REPORT_MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.`,
  sourceUrlEmpty: 'Add a link to a page that shows the correct information.',
  sourceUrl: 'Enter a full web address that starts with https://',
} as const

/** Characters as people (and Postgres char_length) count them, not UTF-16 units. */
export const charCount = (text: string) => [...text].length

export const isReportSection = (value: unknown): value is ReportSection =>
  typeof value === 'string' &&
  (REPORT_SECTIONS as readonly string[]).includes(value)

export function validateSection(value: unknown): string | undefined {
  return isReportSection(value) ? undefined : REPORT_ERRORS.section
}

export function validateMessage(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return REPORT_ERRORS.messageEmpty
  if (charCount(text) > REPORT_MESSAGE_MAX) return REPORT_ERRORS.messageLong
  return undefined
}

/** Required: an http(s) address of 500 characters or fewer. */
export function validateSourceUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return REPORT_ERRORS.sourceUrlEmpty
  if (typeof value !== 'string') return REPORT_ERRORS.sourceUrl
  const text = value.trim()
  if (!text) return REPORT_ERRORS.sourceUrlEmpty
  const url = parseSourceUrl(text)
  return url ? undefined : REPORT_ERRORS.sourceUrl
}

/** The link as it is stored (normalized by URL), or null if it isn't a valid one. */
export function parseSourceUrl(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.')) return null
  if (url.username || url.password) return null
  return charCount(url.href) <= REPORT_URL_MAX ? url.href : null
}
