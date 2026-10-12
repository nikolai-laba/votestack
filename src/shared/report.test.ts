import { describe, expect, it } from 'vitest'
import {
  parseSourceUrl,
  REPORT_ERRORS,
  REPORT_URL_MAX,
  validateSourceUrl,
} from './report.ts'

describe('validateSourceUrl', () => {
  it('requires a link', () => {
    for (const value of [undefined, null, '', '   '])
      expect(validateSourceUrl(value)).toBe(REPORT_ERRORS.sourceUrlEmpty)
  })

  it('accepts http and https addresses', () => {
    expect(validateSourceUrl('https://elections.il.gov/x')).toBeUndefined()
    expect(
      validateSourceUrl(' http://www.cookcountyclerkil.gov '),
    ).toBeUndefined()
  })

  it('rejects anything that is not a full http(s) address', () => {
    for (const value of [
      'elections.il.gov',
      'javascript:alert(1)',
      'ftp://elections.il.gov/x',
      'https://localhost/x',
      'https://user:pass@elections.il.gov/x',
      `https://elections.il.gov/${'a'.repeat(REPORT_URL_MAX)}`,
      42,
    ])
      expect(validateSourceUrl(value)).toBe(REPORT_ERRORS.sourceUrl)
  })
})

describe('parseSourceUrl', () => {
  it('returns the normalized link', () => {
    expect(parseSourceUrl(' https://Elections.IL.gov/x ')).toBe(
      'https://elections.il.gov/x',
    )
    expect(parseSourceUrl('not a link')).toBeNull()
  })
})
