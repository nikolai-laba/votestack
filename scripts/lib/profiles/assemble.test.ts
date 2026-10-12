import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  paragraphOf,
  type BarContext,
  type Endorsement,
} from '../../../src/shared/profile.ts'
import {
  applyOverride,
  compactSources,
  mergeBarRatings,
  mergeIncumbent,
  mergeMoney,
  needsResearch,
  planFor,
  versioned,
  type BarRatings,
  type Override,
  type SourceInput,
} from './assemble.ts'
import {
  ALLIANCE,
  ALLIANCE_MEMBERS,
  ALLIANCE_OTHERS,
  NO_RATING,
  SHOWN_ON_OWN_LINE,
} from './bar.ts'
import { BAR_RATINGS } from './content.ts'
import { PROMPT_VERSION } from './prompt.ts'
import { fixtureProfile, fixtureSubject } from './test-fixtures.ts'

const tribune: SourceInput = {
  title: 'Water district race',
  publisher: 'Chicago Tribune',
  url: 'https://www.chicagotribune.com/2026/09/01/water-district/',
  viewedAt: '2026-10-02',
  kind: 'news',
}

describe('applyOverride', () => {
  const override: Override = {
    reason: 'Wrong committee name',
    overview: [
      {
        action: 'replace',
        match: 'chairs its budget committee',
        text: 'Jane Doe was elected to the board in 2020.',
        sources: [tribune],
      },
      {
        action: 'add',
        text: 'She worked as a civil engineer.',
        sources: [tribune],
      },
    ],
    endorsements: [
      { action: 'remove', organization: 'sierra club' },
      {
        action: 'add',
        endorsement: {
          organization: 'Chicago Federation of Labor',
          kind: 'union',
        },
        sources: [tribune],
      },
    ],
  }

  it('replaces, adds and removes with their own sources', () => {
    const { profile, stale } = applyOverride(fixtureProfile(), override)
    expect(stale).toEqual([])
    expect(profile.overview.items).toEqual([
      { text: 'Jane Doe was elected to the board in 2020.', cites: [3] },
      { text: 'She worked as a civil engineer.', cites: [3] },
    ])
    expect(profile.endorsements.items).toEqual([
      {
        organization: 'Chicago Federation of Labor',
        kind: 'union',
        cites: [3],
      },
    ])
    expect(profile.sources.map((s) => s.id)).toEqual([1, 2, 3])
  })

  it('is idempotent', () => {
    const once = applyOverride(fixtureProfile(), override).profile
    const twice = applyOverride(once, override)
    expect(twice.profile).toEqual(once)
    expect(twice.stale).toEqual([])
  })

  it('reports a replacement that matches nothing', () => {
    const { stale } = applyOverride(fixtureProfile(), {
      overview: [
        {
          action: 'replace',
          match: 'not there',
          text: 'New.',
          sources: [tribune],
        },
      ],
    })
    expect(stale).toHaveLength(1)
  })

  it('removes a paragraph', () => {
    const { profile } = applyOverride(fixtureProfile(), {
      overview: [{ action: 'remove', match: 'budget committee' }],
    })
    expect(profile.overview.items).toEqual([])
  })
})

describe('compactSources', () => {
  it('drops uncited sources and renumbers without gaps', () => {
    const { profile } = applyOverride(fixtureProfile(), {
      overview: [{ action: 'remove', match: 'budget' }],
    })
    const compact = compactSources(profile)
    expect(compact.sources).toHaveLength(1)
    expect(compact.sources[0]).toMatchObject({
      id: 1,
      publisher: 'Sierra Club',
    })
    expect(compact.endorsements.items[0].cites).toEqual([1])
  })

  it('renumbers sentence citations with their paragraph', () => {
    const base = fixtureProfile()
    const compact = compactSources({
      ...base,
      overview: {
        ...base.overview,
        items: [
          paragraphOf([
            { text: 'One.', cites: [2] },
            { text: 'Two.', cites: [2] },
          ]),
        ],
      },
      endorsements: { ...base.endorsements, items: [] },
    })
    expect(compact.sources.map((s) => s.id)).toEqual([1])
    expect(compact.overview.items[0].cites).toEqual([1])
    expect(compact.overview.items[0].sentences?.map((s) => s.cites)).toEqual([
      [1],
      [1],
    ])
  })

  it('drops sentence citations when a correction replaces the paragraph', () => {
    const base = fixtureProfile()
    const { profile } = applyOverride(
      {
        ...base,
        overview: {
          ...base.overview,
          items: [
            paragraphOf([{ text: 'Chairs the budget committee.', cites: [1] }]),
          ],
        },
      },
      {
        overview: [
          {
            action: 'replace',
            match: 'budget committee',
            text: 'Chairs the finance committee.',
            sources: [tribune],
          },
        ],
      },
    )
    expect(profile.overview.items[0].text).toBe('Chairs the finance committee.')
    expect(profile.overview.items[0].sentences).toBeUndefined()
  })
})

describe('mergeBarRatings', () => {
  const judge = fixtureProfile({
    kind: 'retention',
    endorsements: {
      asOf: '2026-10-01',
      items: [
        {
          organization: 'Chicago Bar Association',
          kind: 'bar_evaluation',
          rating: 'Qualified',
          cites: [2],
        },
      ],
    },
  })
  const bar = (n: number, publisher: string) => ({
    id: n,
    title: `${publisher} ratings`,
    publisher,
    url: `https://example.org/bar/${n}`,
    viewedAt: '2026-10-03',
    kind: 'bar' as const,
  })
  const SOURCE: Record<string, number> = {
    'Chicago Bar Association': 1,
    'Chicago Council of Lawyers': 3,
    'Illinois State Bar Association': 4,
  }
  /** A judge's file entry: every member's rating, as judges.ts writes it. */
  const fileEntry = (
    context: BarContext,
    rated: Record<string, string>,
    contextLabel?: string,
  ): Endorsement[] =>
    ['Chicago Bar Association', ...ALLIANCE_MEMBERS].map((organization) => ({
      organization,
      kind: 'bar_evaluation',
      rating: rated[organization] ?? NO_RATING,
      context,
      ...(contextLabel ? { contextLabel } : {}),
      cites: [SOURCE[organization] ?? 2],
    }))
  const sources = [
    bar(1, 'Chicago Bar Association'),
    bar(2, ALLIANCE),
    bar(3, 'Chicago Council of Lawyers'),
    bar(4, 'Illinois State Bar Association'),
  ]
  const yes = Object.fromEntries(ALLIANCE_OTHERS.map((m) => [m, 'Yes']))
  const retention: BarRatings = {
    endorsements: fileEntry('retention', {
      ...yes,
      "Black Men Lawyers' Association": 'No',
      'Cook County Bar Association': NO_RATING,
      'Chicago Bar Association': 'Qualified',
      'Illinois State Bar Association': 'Yes',
    }),
    sources,
  }

  it('shows three groups word for word and one Alliance count', () => {
    const merged = mergeBarRatings(judge, retention)
    const items = merged.endorsements.items
    expect(items.map((e) => e.organization)).toEqual([
      'Chicago Bar Association',
      'Chicago Council of Lawyers',
      'Illinois State Bar Association',
      ALLIANCE,
    ])
    expect(items[0]).toEqual({
      organization: 'Chicago Bar Association',
      kind: 'bar_evaluation',
      context: 'retention',
      rating: 'Qualified',
      cites: [3],
    })
    // "No rating published" becomes an entry without a rating.
    expect(items[1].rating).toBeUndefined()
    expect(items[3].tally).toEqual({
      members: 11,
      ratings: [
        { rating: 'Yes', count: 9 },
        { rating: 'No', count: 1 },
      ],
      notEvaluated: 0,
    })
    expect(items[3].rating).toBeUndefined()
    const cited = (e: Endorsement) =>
      merged.sources.find((s) => s.id === e.cites[0])?.publisher
    expect(items.map(cited)).toEqual([
      'Chicago Bar Association',
      'Chicago Council of Lawyers',
      'Illinois State Bar Association',
      ALLIANCE,
    ])
    expect(mergeBarRatings(merged, retention)).toEqual(merged)
  })

  it('gives a judge in a race and up for retention two labeled sets', () => {
    const rice: BarRatings = {
      endorsements: [
        ...fileEntry(
          'election',
          Object.fromEntries(ALLIANCE_OTHERS.map((m) => [m, 'Recommended'])),
          'For the Appellate Court election',
        ),
        ...fileEntry('retention', yes, 'For retention as a circuit judge'),
      ],
      sources,
    }
    const items = mergeBarRatings(
      { ...judge, kind: 'judicial_candidate' },
      rice,
    ).endorsements.items
    expect(items.map((e) => [e.contextLabel, e.organization])).toEqual(
      [
        'For the Appellate Court election',
        'For retention as a circuit judge',
      ].flatMap((label) =>
        [...SHOWN_ON_OWN_LINE, ALLIANCE].map((o) => [label, o]),
      ),
    )
    expect(items[3].tally?.ratings).toEqual([
      { rating: 'Recommended', count: 11 },
    ])
  })

  it('throws when a group is missing from the file', () => {
    expect(() =>
      mergeBarRatings(judge, {
        endorsements: retention.endorsements.slice(0, 5),
        sources,
      }),
    ).toThrow(/no Chicago Council of Lawyers entry/)
  })

  it('leaves non-judges alone', () => {
    expect(mergeBarRatings(fixtureProfile(), retention)).toEqual(
      fixtureProfile(),
    )
  })

  it('gives every judge in the file the same four lines per vote', async () => {
    const file = JSON.parse(await readFile(BAR_RATINGS, 'utf8')) as Record<
      string,
      BarRatings
    >
    expect(Object.keys(file).length).toBeGreaterThan(80)
    for (const [key, ratings] of Object.entries(file)) {
      const votes = new Set(ratings.endorsements.map((e) => e.context))
      const items = mergeBarRatings(
        fixtureProfile({ key, kind: 'judicial_candidate' }),
        ratings,
      ).endorsements.items.filter((e) => e.kind === 'bar_evaluation')
      expect(items.map((e) => e.organization)).toEqual(
        [...votes].flatMap(() => [...SHOWN_ON_OWN_LINE, ALLIANCE]),
      )
      for (const e of items.filter((x) => x.tally))
        expect(e.tally?.members).toBe(11)
    }
  })
})

describe('mergeMoney', () => {
  it('shows a joint committee only when there is no own committee', () => {
    const shared = {
      name: 'Committee for Retention',
      url: 'https://example.gov/c',
    }
    const p = mergeMoney(
      fixtureProfile(),
      { summaries: [], sharedCommittee: shared },
      '2026-10-05',
    )
    expect(p.money).toEqual({
      asOf: '2026-10-05',
      items: [],
      sharedCommittee: shared,
    })
    expect(mergeMoney(fixtureProfile(), undefined, '2026-10-05').money).toEqual(
      {
        asOf: '2026-10-05',
        items: [],
      },
    )
  })
})

describe('mergeMoney names', () => {
  it('makes an all-caps committee name readable and keeps the breakdown', () => {
    // A real name from data/build/profiles/money.json.
    const summary = {
      source: 'FEC' as const,
      committee: 'JULIANA FOR ILLINOIS',
      url: 'https://www.fec.gov/data/committee/C00000000/',
      period: 'January 1, 2025 to September 30, 2026',
      raised: 6000,
      breakdown: [
        { kind: 'small' as const, amount: 1000 },
        { kind: 'pac' as const, amount: 5000 },
      ],
    }
    const [money] = mergeMoney(
      fixtureProfile(),
      { summaries: [summary] },
      '2026-10-05',
    ).money.items
    expect(money.committee).toBe('Juliana for Illinois')
    expect(money.breakdown).toEqual(summary.breakdown)
    // The input is unchanged.
    expect(summary.committee).toBe('JULIANA FOR ILLINOIS')
  })

  it('drops fields from older money files', () => {
    const old = {
      source: 'ISBE' as const,
      committee: 'Friends of Jane Doe',
      url: 'https://example.org/',
      period: 'April 1 to June 30, 2026',
      topContributors: [{ name: 'Climate PAC', amount: 5000 }],
      smallDonorShare: 0.2,
      fromIndividuals: 1000,
      largeSince: {
        since: '2026-06-30',
        total: 6000,
        count: 2,
        organizations: [{ name: 'Climate PAC', amount: 5000 }],
      },
    }
    const [money] = mergeMoney(
      fixtureProfile(),
      { summaries: [old] },
      '2026-10-05',
    ).money.items
    expect(money).toEqual({
      source: 'ISBE',
      committee: 'Friends of Jane Doe',
      url: 'https://example.org/',
      period: 'April 1 to June 30, 2026',
      largeSince: { since: '2026-06-30', total: 6000, count: 2 },
    })
  })

  it('makes a joint committee name readable', () => {
    const p = mergeMoney(
      fixtureProfile(),
      {
        summaries: [],
        sharedCommittee: {
          name: 'COMMITTEE FOR RETENTION OF JUDGES IN COOK COUNTY',
          url: 'https://example.gov/c',
        },
      },
      '2026-10-05',
    )
    expect(p.money.sharedCommittee?.name).toBe(
      'Committee for Retention of Judges in Cook County',
    )
  })
})

describe('needsResearch and versioned', () => {
  const current = fixtureProfile({
    meta: {
      ...fixtureProfile().meta,
      model: 'm',
      promptVersion: PROMPT_VERSION,
    },
  })

  it('researches only when the listing, model or prompt changed', () => {
    expect(needsResearch(undefined, fixtureSubject(), 'm')).toBe(true)
    expect(needsResearch(current, fixtureSubject(), 'm')).toBe(false)
    expect(needsResearch(current, fixtureSubject(), 'other')).toBe(true)
    expect(
      needsResearch(current, fixtureSubject({ party: 'Republican' }), 'm'),
    ).toBe(true)
  })

  it('bumps the version only when content changes', () => {
    expect(versioned(current, undefined)?.meta.version).toBe(1)
    expect(versioned(current, current)).toBeNull()
    const changed = mergeMoney(current, undefined, '2026-10-06')
    expect(versioned(changed, current)?.meta.version).toBe(2)
  })
})

describe('planFor', () => {
  const subject = fixtureSubject()
  const current = fixtureProfile({
    meta: {
      model: 'm',
      promptVersion: PROMPT_VERSION,
      generatedAt: '2026-10-01T12:00:00Z',
      version: 1,
    },
  })
  const outdated = fixtureProfile()

  it('researches new and outdated profiles by default', () => {
    expect(planFor(undefined, subject, 'm', {})).toBe('research')
    expect(planFor(outdated, subject, 'm', {})).toBe('research')
    expect(planFor(current, subject, 'm', {})).toBe('refresh')
    expect(planFor(current, subject, 'm', { refresh: true })).toBe('research')
  })

  it('never researches with --no-research, even when the prompt changed', () => {
    expect(planFor(outdated, subject, 'm', { noResearch: true })).toBe(
      'refresh',
    )
    expect(planFor(undefined, subject, 'm', { noResearch: true })).toBe('skip')
  })

  it('never researches a locked profile', () => {
    expect(planFor(outdated, subject, 'm', { locked: true })).toBe('refresh')
    expect(planFor(undefined, subject, 'm', { locked: true })).toBe('skip')
  })
})

describe('mergeIncumbent', () => {
  const entry = {
    incumbent: true as const,
    office: 'Commissioner, Metropolitan Water Reclamation District',
    source: 'https://mwrd.org/board-commissioners',
    checked: '2026-10-11',
  }

  it('sets incumbent right after tier when an official list confirms it', () => {
    const p = mergeIncumbent(fixtureProfile(), entry)
    expect(p.incumbent).toBe(true)
    const keys = Object.keys(p)
    expect(keys[keys.indexOf('tier') + 1]).toBe('incumbent')
    // Idempotent: a rerun writes the same JSON.
    expect(JSON.stringify(mergeIncumbent(p, entry))).toBe(JSON.stringify(p))
  })

  it('drops the label without an entry', () => {
    const p = mergeIncumbent(fixtureProfile({ incumbent: true }), undefined)
    expect('incumbent' in p).toBe(false)
  })

  it('never labels a judge up for retention', () => {
    const p = mergeIncumbent(fixtureProfile({ kind: 'retention' }), entry)
    expect('incumbent' in p).toBe(false)
  })
})
