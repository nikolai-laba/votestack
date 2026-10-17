import { describe, expect, it } from 'vitest'
import { REGIONS } from '../../../src/shared/regions.ts'
import { MANIFESTS } from './manifest.ts'

describe('region manifests', () => {
  it('has an entry for every region and none for a region that doesn’t exist', () => {
    expect(Object.keys(MANIFESTS).sort()).toEqual(
      REGIONS.map((r) => r.id).sort(),
    )
  })

  it('gives every region its own files', () => {
    const paths = Object.values(MANIFESTS).flatMap((m) => [
      m.raceList.path,
      m.incumbents.labels.path,
      m.profiles.dir.path,
      m.profiles.published.path,
      m.profiles.money.path,
    ])
    expect(new Set(paths).size).toBe(paths.length)
  })
})
