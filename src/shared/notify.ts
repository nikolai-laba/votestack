// "Tell me when VoteStack reaches my area" sign-ups. The form
// (src/pages/NotifyPage) and the Worker (worker/notify.ts) validate with the
// same rules, and the database (supabase/migrations/*_expansion_signups.sql)
// checks them again. A sign-up is an email address and a ZIP code, nothing
// else.

/** The longest address the email standards allow. */
export const EMAIL_MAX = 254

export type SignupField = 'email' | 'zip'

export interface ExpansionSignup {
  email: string
  zip: string
}

export const SIGNUP_ERRORS = {
  emailEmpty: 'Enter your email address.',
  email: 'Enter an email address like name@example.com.',
  zip: 'Enter a 5-digit ZIP code.',
} as const

// One @, something before it, and a domain with a dot after it. Deliberately
// loose: the only real test of an address is a message reaching it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ZIP = /^(\d{5})(?:-\d{4})?$/

/** The address as it is stored: trimmed and in lowercase. */
export const normalizeEmail = (value: string) => value.trim().toLowerCase()

/** The 5-digit ZIP code as it is stored, or null if it isn't one. */
export function normalizeZip(value: string): string | null {
  return ZIP.exec(value.trim())?.[1] ?? null
}

export function validateEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim())
    return SIGNUP_ERRORS.emailEmpty
  const email = normalizeEmail(value)
  return email.length <= EMAIL_MAX && EMAIL.test(email)
    ? undefined
    : SIGNUP_ERRORS.email
}

/** Accepts 60301 and 60301-1234; only the first 5 digits are kept. */
export function validateZip(value: unknown): string | undefined {
  return typeof value === 'string' && normalizeZip(value)
    ? undefined
    : SIGNUP_ERRORS.zip
}
