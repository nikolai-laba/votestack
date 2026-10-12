import { describe, expect, it } from 'vitest'
import type { Endorsement } from '../../../src/shared/profile.ts'
import {
  confirmation,
  dropSharedEndorsers,
  endorserKey,
  sameEndorser,
} from './endorsers.ts'
import { fixtureProfile } from './test-fixtures.ts'

describe('endorserKey', () => {
  it('folds case, punctuation and known spellings', () => {
    expect(sameEndorser('CFL', 'Chicago Federation of Labor')).toBe(true)
    expect(
      sameEndorser(
        'International Union of Operating Engineers (IUOE) Local 150',
        'IUOE Local 150',
      ),
    ).toBe(true)
    expect(sameEndorser('Operating Engineer Local 150', 'IUOE Local 150')).toBe(
      true,
    )
    expect(sameEndorser('IL AFL CIO', 'Illinois AFL-CIO')).toBe(true)
    expect(sameEndorser('Illinois State AFL-CIO', 'Illinois AFL-CIO')).toBe(
      true,
    )
    expect(sameEndorser('The Sierra Club', 'sierra club')).toBe(true)
    expect(endorserKey('Planned Parenthood & Friends')).toBe(
      'planned parenthood and friends',
    )
  })

  it('keeps different locals apart', () => {
    expect(sameEndorser('IUOE Local 399', 'IUOE Local 150')).toBe(false)
    expect(
      sameEndorser(
        'International Union of Operating Engineers Locals 150 and 399',
        'IUOE Local 150',
      ),
    ).toBe(false)
  })
})

describe('dropSharedEndorsers', () => {
  const person = (key: string, items: Omit<Endorsement, 'cites'>[]) =>
    fixtureProfile({
      key,
      endorsements: {
        asOf: '2026-10-01',
        items: items.map((e) => ({ ...e, cites: [2] })),
      },
    })
  const union = { organization: 'CFL', kind: 'union' as const }
  const club = { organization: 'Sierra Club', kind: 'organization' as const }

  it('drops an endorser credited to both nominees from both', () => {
    const { changed, removed } = dropSharedEndorsers(
      'race',
      [
        person('a', [union, club]),
        person('b', [
          { ...union, organization: 'Chicago Federation of Labor' },
        ]),
      ],
      1,
      new Set(),
    )
    expect(removed.map((r) => r.key)).toEqual(['a', 'b'])
    expect(removed[0].sharedWith).toEqual(['a', 'b'])
    expect(changed.map((p) => p.endorsements.items.length)).toEqual([1, 0])
  })

  it('keeps it for the person a slate confirms', () => {
    const { changed, removed } = dropSharedEndorsers(
      'race',
      [person('a', [union]), person('b', [union])],
      1,
      new Set([confirmation('a', 'Chicago Federation of Labor')]),
    )
    expect(removed.map((r) => r.key)).toEqual(['b'])
    expect(changed.map((p) => p.key)).toEqual(['b'])
  })

  it('allows as many as the race has seats', () => {
    const race = [person('a', [union]), person('b', [union]), person('c', [])]
    expect(dropSharedEndorsers('mwrd', race, 3, new Set()).removed).toEqual([])
    expect(
      dropSharedEndorsers(
        'mwrd',
        [...race, person('d', [union]), person('e', [union])],
        3,
        new Set(),
      ).removed,
    ).toHaveLength(4)
  })

  it('never counts bar evaluations', () => {
    const bar = {
      organization: 'Chicago Bar Association',
      kind: 'bar_evaluation' as const,
      rating: 'Qualified',
    }
    const { removed } = dropSharedEndorsers(
      'judges',
      [person('a', [bar]), person('b', [bar])],
      1,
      new Set(),
    )
    expect(removed).toEqual([])
  })
})
