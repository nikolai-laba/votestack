import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './version.ts'

describe('APP_VERSION', () => {
  // Releases bump package.json and tag v<version>, so the footer follows them.
  it('is the release version in package.json', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(APP_VERSION).toBe(version)
  })
})
