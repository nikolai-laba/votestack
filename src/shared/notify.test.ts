import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizeZip,
  SIGNUP_ERRORS,
  SIGNUP_SOURCES,
  signupSource,
  validateEmail,
  validateZip,
} from './notify.ts'

describe('sign-up validation', () => {
  it('accepts ordinary addresses, in any case and with spaces around', () => {
    for (const email of ['pat@example.com', ' Pat.Lee+votes@Mail.Example.org '])
      expect(validateEmail(email)).toBeUndefined()
    expect(normalizeEmail(' Pat@Example.COM ')).toBe('pat@example.com')
  })

  it('rejects empty, malformed and over-long addresses', () => {
    expect(validateEmail('')).toBe(SIGNUP_ERRORS.emailEmpty)
    expect(validateEmail('   ')).toBe(SIGNUP_ERRORS.emailEmpty)
    expect(validateEmail(undefined)).toBe(SIGNUP_ERRORS.emailEmpty)
    for (const email of [
      'pat',
      'pat@example',
      '@example.com',
      'pat@@example.com',
      'pat lee@example.com',
      `${'a'.repeat(250)}@x.org`,
    ])
      expect(validateEmail(email)).toBe(SIGNUP_ERRORS.email)
  })

  it('keeps the 5-digit ZIP code, from ZIP+4 too', () => {
    expect(normalizeZip('60301')).toBe('60301')
    expect(normalizeZip(' 60301-1234 ')).toBe('60301')
    expect(validateZip('02134')).toBeUndefined()
    for (const zip of ['6030', '603011', '60301-12', 'ABCDE', '', 60301])
      expect(validateZip(zip)).toBe(SIGNUP_ERRORS.zip)
    expect(normalizeZip('6030')).toBeNull()
  })
})

describe('sign-up sources', () => {
  it('accepts each place a sign-up form appears, and nothing else', () => {
    for (const s of SIGNUP_SOURCES) expect(signupSource(s)).toBe(s)
    for (const v of ['', 'Profile', 'footer', 42, null, undefined])
      expect(signupSource(v)).toBeNull()
  })
})
