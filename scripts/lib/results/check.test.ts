import { describe, expect, it } from 'vitest'
import type {
  RaceResult,
  ResultsFile,
} from '../../../src/shared/raceResults.ts'
import { checkResults } from './check.ts'
import type { CheckContext } from './check.ts'
import type { ApCount, ApCountsFile, MatchEntry, MatchFile } from './inputs.ts'
import type { OfficialFile } from './types.ts'

const NOW = '2026-11-05T01:30:00.000Z'
const AS_OF = '2026-11-05T00:40:00.000Z'

const clerkEntry: MatchEntry = {
  contestIds: ['chicago-boe:clerk', 'cook-clerk:120300'],
  kind: 'candidate',
  scope: 'within',
  official: [{ source: 'cook', title: 'Clerk' }],
  names: { 'KIM PARK': 'Kim Park', 'ALEX RIVERA': 'Alex Rivera' },
  ballotOrder: ['Kim Park', 'Alex Rivera'],
  voteFor: 1,
  certifyBy: '2026-11-24',
}
const judgeEntry: MatchEntry = {
  contestIds: ['cook-clerk:150100'],
  kind: 'retention',
  scope: 'within',
  official: [{ source: 'cook', title: 'Pat Morgan' }],
  names: { YES: 'Yes', NO: 'No' },
  ballotOrder: ['Yes', 'No'],
  threshold: 0.6,
  certifyBy: '2026-11-24',
}
const senateEntry: MatchEntry = {
  contestIds: ['il-senate'],
  kind: 'candidate',
  scope: 'beyond',
  official: [],
  names: {},
  ballotOrder: ['Kim Park', 'Alex Rivera'],
  voteFor: 1,
  certifyBy: '2026-12-01',
  apUrl: 'https://apnews.com/senate',
}

const match = (...contests: MatchEntry[]): MatchFile => ({
  version: 1,
  electionId: 'cook-2026-11-03',
  area: 'cook',
  contests,
})

const source = (asOf = AS_OF) => ({
  name: 'Cook County Clerk',
  url: 'https://example.org/',
  retrievedAt: NOW,
  official: true,
  asOf,
})

const clerk = (over: Partial<RaceResult> = {}): RaceResult => ({
  contestIds: [...clerkEntry.contestIds],
  kind: 'candidate',
  status: 'counting',
  voteFor: 1,
  choices: [
    { name: 'Kim Park', votes: 60 },
    { name: 'Alex Rivera', votes: 40 },
  ],
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [source()],
  changedAt: NOW,
  ...over,
})
const judge = (over: Partial<RaceResult> = {}): RaceResult => ({
  contestIds: [...judgeEntry.contestIds],
  kind: 'retention',
  status: 'counting',
  threshold: 0.6,
  choices: [
    { name: 'Yes', votes: 70 },
    { name: 'No', votes: 30 },
  ],
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [source()],
  changedAt: NOW,
  ...over,
})
const senate = (over: Partial<RaceResult> = {}): RaceResult => ({
  contestIds: ['il-senate'],
  kind: 'candidate',
  status: 'counting',
  voteFor: 1,
  choices: [
    { name: 'Kim Park', votes: 60 },
    { name: 'Alex Rivera', votes: 40 },
  ],
  certifyBy: '2026-12-01',
  scope: 'beyond',
  sources: [{ ...source(), name: 'AP', official: false, counted: 0.5 }],
  changedAt: NOW,
  ...over,
})

const file = (...results: RaceResult[]): ResultsFile => ({
  version: 1,
  electionId: 'cook-2026-11-03',
  checkedAt: NOW,
  results,
})

const apCount = (over: Partial<ApCount> = {}): ApCount => ({
  contestIds: ['il-senate'],
  url: 'https://apnews.com/senate',
  asOf: AS_OF,
  counted: 0.5,
  choices: [
    { name: 'Kim Park', votes: 60 },
    { name: 'Alex Rivera', votes: 40 },
  ],
  ...over,
})
const reads = (a: ApCount[], b: ApCount[]): ApCountsFile[] => [
  { version: 1, reader: 'a', checkedAt: NOW, counts: a },
  { version: 1, reader: 'b', checkedAt: NOW, counts: b },
]

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  match: match(clerkEntry, judgeEntry),
  apCounts: [],
  now: NOW,
  ...over,
})

const run = (f: ResultsFile, c: Partial<CheckContext> = {}) =>
  checkResults(f, ctx(c))

describe('checkResults', () => {
  it('passes a sound file with nothing to say', () => {
    expect(run(file(clerk(), judge()))).toEqual({ failures: [], warnings: [] })
  })

  it('fails a match entry with no result', () => {
    const { failures } = run(file(judge()))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('no result')
  })

  it('fails a result no match entry has', () => {
    const { failures } = run(file(clerk(), judge()), {
      match: match(judgeEntry),
    })
    expect(failures.join('\n')).toContain('chicago-boe:clerk')
    expect(failures.join('\n')).toContain('no match entry')
  })

  it('fails a choice name not in the entry ballotOrder', () => {
    const { failures } = run(
      file(
        clerk({
          choices: [
            { name: 'Kim Park', votes: 60 },
            { name: 'KIM  PARK', votes: 1 },
          ],
        }),
        judge(),
      ),
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('KIM  PARK')
  })

  it('fails more winners than voteFor', () => {
    const { failures } = run(
      file(
        clerk({
          status: 'called',
          winners: ['Kim Park', 'Alex Rivera'],
        }),
        judge(),
      ),
    )
    expect(failures.join('\n')).toContain('chicago-boe:clerk')
    expect(failures.join('\n')).toContain('2 winners')
  })

  it('fails an AP winner not leading in the counts', () => {
    const { failures } = run(
      file(
        clerk({
          status: 'called',
          winners: ['Alex Rivera'],
          call: { by: 'AP', at: NOW, url: 'https://apnews.com/x' },
        }),
        judge(),
      ),
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('Alex Rivera')
    expect(failures[0]).toContain('not leading')
  })

  it('fails an AP winner not leading in the AP counts', () => {
    const { failures } = run(
      file(
        clerk(),
        judge(),
        senate({
          status: 'called',
          winners: ['Kim Park'],
          call: { by: 'AP', at: NOW, url: 'https://apnews.com/x' },
        }),
      ),
      {
        match: match(clerkEntry, judgeEntry, senateEntry),
        apCounts: reads(
          [
            apCount({
              choices: [
                { name: 'Kim Park', votes: 10 },
                { name: 'Alex Rivera', votes: 40 },
              ],
            }),
          ],
          [
            apCount({
              choices: [
                { name: 'Kim Park', votes: 10 },
                { name: 'Alex Rivera', votes: 40 },
              ],
            }),
          ],
        ),
      },
    )
    expect(failures.join('\n')).toContain('il-senate')
    expect(failures.join('\n')).toContain('not leading')
  })

  it('fails any choice with fewer votes than the previous file', () => {
    const previous = file(
      clerk({
        choices: [
          { name: 'Kim Park', votes: 61 },
          { name: 'Alex Rivera', votes: 40 },
        ],
      }),
      judge(),
    )
    const { failures } = run(file(clerk(), judge()), { previous })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('Kim Park')
  })

  it('fails a source asOf earlier than the previous file', () => {
    const previous = file(
      clerk({ sources: [source('2026-11-05T01:00:00.000Z')] }),
      judge(),
    )
    const { failures } = run(file(clerk(), judge()), { previous })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('earlier')
  })

  it('accepts growing votes and later asOf', () => {
    const previous = file(
      clerk({
        choices: [
          { name: 'Kim Park', votes: 50 },
          { name: 'Alex Rivera', votes: 30 },
        ],
        sources: [source('2026-11-04T20:00:00.000Z')],
      }),
      judge(),
    )
    expect(run(file(clerk(), judge()), { previous }).failures).toEqual([])
  })

  it('fails a write-in winner', () => {
    const { failures } = run(
      file(
        clerk({
          status: 'called',
          winners: ['Write-in: Lee Chen'],
          choices: [
            { name: 'Kim Park', votes: 60 },
            { name: 'Alex Rivera', votes: 40 },
            { name: 'Write-in: Lee Chen', votes: 90 },
          ],
        }),
        judge(),
      ),
    )
    expect(failures.join('\n')).toContain('chicago-boe:clerk')
    expect(failures.join('\n')).toContain('write-in')
  })

  it('fails certified without a certification', () => {
    const { failures } = run(
      file(clerk({ status: 'certified', winners: ['Kim Park'] }), judge()),
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('chicago-boe:clerk')
    expect(failures[0]).toContain('certif')
  })

  it('fails AP reads a and b that differ', () => {
    const { failures } = run(file(clerk(), judge(), senate()), {
      match: match(clerkEntry, judgeEntry, senateEntry),
      apCounts: reads(
        [apCount()],
        [
          apCount({
            choices: [
              { name: 'Kim Park', votes: 61 },
              { name: 'Alex Rivera', votes: 40 },
            ],
          }),
        ],
      ),
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('il-senate')
    expect(failures[0]).toContain('differ')
  })

  it('fails an AP race read by only one reader', () => {
    const { failures } = run(file(clerk(), judge(), senate()), {
      match: match(clerkEntry, judgeEntry, senateEntry),
      apCounts: reads([apCount()], []),
    })
    expect(failures.join('\n')).toContain('il-senate')
    expect(failures.join('\n')).toContain('differ')
  })

  it('fails a measure or retention entry without a threshold', () => {
    const noThreshold = { ...judgeEntry, threshold: undefined }
    const { failures } = run(file(clerk(), judge()), {
      match: match(clerkEntry, noThreshold),
    })
    expect(failures.join('\n')).toContain('cook-clerk:150100')
    expect(failures.join('\n')).toContain('threshold')
  })

  it('fails a retention result with a threshold outside (0, 1]', () => {
    const { failures } = run(file(clerk(), judge({ threshold: 0 })))
    expect(failures.join('\n')).toContain('cook-clerk:150100')
    expect(failures.join('\n')).toContain('threshold')
  })

  it('fails a candidate entry or result with voteFor missing or below 1', () => {
    const entry = { ...clerkEntry, voteFor: undefined }
    const a = run(file(clerk(), judge()), { match: match(entry, judgeEntry) })
    expect(a.failures.join('\n')).toContain('chicago-boe:clerk')
    expect(a.failures.join('\n')).toContain('voteFor')
    const b = run(file(clerk({ voteFor: 0 }), judge()))
    expect(b.failures.join('\n')).toContain('chicago-boe:clerk')
    expect(b.failures.join('\n')).toContain('voteFor')
  })

  it('fails a retention result whose choices are not Yes then No', () => {
    const { failures } = run(
      file(
        clerk(),
        judge({
          choices: [
            { name: 'No', votes: 30 },
            { name: 'Yes', votes: 70 },
          ],
        }),
      ),
    )
    expect(failures.join('\n')).toContain('cook-clerk:150100')
    expect(failures.join('\n')).toContain('Yes')
  })

  it('fails a called or certified result with no winners', () => {
    const { failures } = run(
      file(clerk({ status: 'called', winners: [] }), judge()),
    )
    expect(failures.join('\n')).toContain('chicago-boe:clerk')
    expect(failures.join('\n')).toContain('no winners')
  })

  it('fails an official contest no match entry uses', () => {
    const official: OfficialFile = {
      source: 'cook',
      url: 'https://example.org/',
      retrievedAt: NOW,
      asOf: AS_OF,
      contests: [
        { title: 'Clerk', choices: [] },
        { title: 'Pat Morgan', choices: [] },
        { title: 'Recorder of Deeds', choices: [] },
      ],
    }
    const { failures } = run(file(clerk(), judge()), { official: [official] })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('Recorder of Deeds')
    expect(failures[0]).toContain('cook')
  })

  it('warns on a counting result not updated for more than 3 days', () => {
    const stale = file(
      clerk({ sources: [source('2026-11-01T01:00:00.000Z')] }),
      judge(),
    )
    const { failures, warnings } = run(stale)
    expect(failures).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('chicago-boe:clerk')
  })

  it('does not warn within 3 days', () => {
    const recent = file(
      clerk({ sources: [source('2026-11-02T02:00:00.000Z')] }),
      judge(),
    )
    expect(run(recent).warnings).toEqual([])
  })
})
