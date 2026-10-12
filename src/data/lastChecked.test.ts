// Keeps the About page's "last checked" date in step with the published
// profiles: after a profile refresh, set LAST_CHECKED to the date this test
// names.
// @vitest-environment node
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { longDate } from '../format.ts'
import { LAST_CHECKED } from './lastChecked.ts'

const dir = new URL('../../content/profiles/2026-11-03/', import.meta.url)

describe('LAST_CHECKED', () => {
  it('is the day the newest profile was generated', () => {
    const generated = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map(
        (f) =>
          (
            JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as {
              meta?: { generatedAt?: string }
            }
          ).meta?.generatedAt,
      )
      .filter((d): d is string => Boolean(d))
      .sort()
    expect(generated.length).toBeGreaterThan(0)
    // longDate shows a timestamp as its day in Chicago.
    expect(longDate(LAST_CHECKED)).toBe(longDate(generated.at(-1)!))
  })
})
