import { describe, expect, it } from 'vitest'
import { USAGE_ELECTION } from '../shared/metrics.ts'
import type { UsageEvent, VisitStep } from '../shared/metrics.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { READS_KEY, createReading, type ReadProfile } from './reading.ts'

function setup(opts: { storage?: Storage | null; day?: string } = {}) {
  const storage =
    opts.storage === undefined ? new MemoryStorage() : opts.storage
  const sent: UsageEvent[] = []
  const steps: VisitStep[] = []
  const clock = { day: opts.day ?? '2026-10-19' }
  const make = () =>
    createReading({
      storage: () => storage,
      today: () => clock.day,
      add: (e) => sent.push(e),
      path: () => 'ballot',
      step: (s) => steps.push(s),
    })
  return { storage, sent, steps, clock, make, reading: make() }
}

const cand = (key: string): ReadProfile => ({ key, kind: 'candidate' })
const marks = (sent: UsageEvent[]) =>
  sent.flatMap((e) => (e.e === 'read' ? [e.mark] : []))
const informed = (sent: UsageEvent[]) =>
  sent.flatMap((e) =>
    e.e === 'informed' ? [`${e.period}:${e.kind}:${e.path}`] : [],
  )

describe('reading', () => {
  it('sends each time mark once per profile', () => {
    const { reading, sent } = setup()
    const p = cand('a')
    reading.progress(p, 12, false, undefined)
    expect(marks(sent)).toEqual(['10'])
    sent.length = 0
    reading.progress(p, 25, false, undefined)
    expect(marks(sent)).toEqual(['20', 'read'])
    sent.length = 0
    reading.progress(p, 25, false, undefined)
    expect(sent).toEqual([])
  })

  it('sends every threshold reached in one call', () => {
    const { reading, sent } = setup()
    reading.progress(cand('a'), 65, false, undefined)
    expect(marks(sent)).toEqual(['10', '20', '30', '60', 'read'])
  })

  it('counts a read at Sources only after 10 seconds', () => {
    const { reading, sent } = setup()
    const p = cand('a')
    reading.progress(p, 5, true, undefined)
    expect(marks(sent)).toEqual(['sources'])
    sent.length = 0
    reading.progress(p, 10, true, undefined)
    expect(marks(sent)).toEqual(['10', 'read'])
  })

  it('sends judicial candidates as judicial', () => {
    const { reading, sent } = setup()
    reading.progress(
      { key: 'j', kind: 'judicial_candidate' },
      12,
      false,
      undefined,
    )
    expect(sent[0]).toMatchObject({
      e: 'read',
      kind: 'judicial',
      path: 'ballot',
    })
  })

  it('sends retention as retention', () => {
    const { reading, sent } = setup()
    reading.progress({ key: 'r', kind: 'retention' }, 12, false, undefined)
    expect(sent[0]).toMatchObject({ e: 'read', kind: 'retention' })
  })

  it('calls the read step when the read mark is first sent', () => {
    const { reading, steps } = setup()
    reading.progress(cand('a'), 12, false, undefined)
    expect(steps).toEqual([])
    reading.progress(cand('a'), 25, false, undefined)
    expect(steps).toEqual(['read'])
  })

  it('informs a single-candidate race with one read', () => {
    const { reading, sent, steps } = setup()
    const p = cand('a')
    reading.progress(p, 25, false, [['a']])
    expect(steps).toEqual(['read', 'informed'])
    expect(informed(sent)).toEqual([
      'election:single:ballot',
      'week:single:ballot',
    ])
    const election = sent.find(
      (e) => e.e === 'informed' && e.period === 'election',
    )
    expect(election).toBeDefined()
    expect(USAGE_ELECTION).toBe('2026-11-03')
  })

  it('needs two reads in a contested race', () => {
    const { reading, sent, steps } = setup()
    reading.progress(cand('a'), 25, false, [['a', 'b']])
    expect(informed(sent)).toEqual([])
    expect(steps).toEqual(['read'])
    reading.progress(cand('b'), 25, false, [['a', 'b']])
    expect(informed(sent)).toEqual([
      'election:compared:ballot',
      'week:compared:ballot',
    ])
    expect(steps).toEqual(['read', 'read', 'informed'])
  })

  it('counts informed once per election and once per week', () => {
    const { reading, sent, steps, clock } = setup()
    reading.progress(cand('a'), 25, false, [['a']])
    sent.length = 0
    steps.length = 0
    reading.progress(cand('b'), 25, false, [['b']])
    expect(informed(sent)).toEqual([])
    expect(steps).toEqual(['read', 'informed'])
    clock.day = '2026-10-26'
    reading.progress(cand('c'), 25, false, [['c']])
    expect(informed(sent)).toEqual(['week:single:ballot'])
  })

  it('does not inform on a time mark or Sources alone', () => {
    const { reading, sent, steps } = setup()
    const p = cand('a')
    reading.progress(p, 12, false, [[p.key]])
    reading.progress(cand('s'), 5, true, [['s']])
    expect(informed(sent)).toEqual([])
    expect(steps).not.toContain('informed')
  })

  it('needs a finished read, not a started one, in a contested race', () => {
    const { reading, sent } = setup()
    const races = [['a', 'b']]
    reading.progress(cand('a'), 25, false, races)
    reading.progress(cand('b'), 12, false, races)
    expect(informed(sent)).toEqual([])
    reading.progress(cand('b'), 25, false, races)
    expect(informed(sent)).toEqual([
      'election:compared:ballot',
      'week:compared:ballot',
    ])
  })

  it('informed is checked again when races arrive later', () => {
    const { reading, sent } = setup()
    const p = cand('a')
    reading.progress(p, 25, false, undefined)
    expect(informed(sent)).toEqual([])
    reading.progress(p, 26, false, [[p.key]])
    expect(informed(sent)).toHaveLength(2)
  })

  it('does not inform without races', () => {
    const { reading, steps } = setup()
    reading.progress(cand('a'), 25, false, [])
    expect(steps).toEqual(['read'])
  })

  it('keeps at most 200 profiles', () => {
    const { reading, sent } = setup()
    for (let i = 0; i < 201; i++)
      reading.progress(cand(`p${i}`), 12, false, undefined)
    sent.length = 0
    reading.progress(cand('p0'), 12, false, undefined)
    expect(marks(sent)).toEqual(['10'])
    sent.length = 0
    reading.progress(cand('p200'), 12, false, undefined)
    expect(sent).toEqual([])
  })

  it('evicts the least recently read profile', () => {
    const { reading, sent } = setup()
    for (let i = 0; i < 200; i++)
      reading.progress(cand(`p${i}`), 12, false, undefined)
    reading.progress(cand('p0'), 25, false, undefined) // p0 is now most recent
    reading.progress(cand('new'), 12, false, undefined) // evicts p1
    sent.length = 0
    reading.progress(cand('p0'), 25, false, undefined)
    expect(sent).toEqual([])
    reading.progress(cand('p1'), 12, false, undefined)
    expect(marks(sent)).toEqual(['10'])
  })

  it('shows an informed race again as a visit step', () => {
    const { reading, sent, steps, make } = setup()
    reading.progress(cand('a'), 25, false, [['a']])
    sent.length = 0
    steps.length = 0
    make().progress(cand('a'), 25, false, [['a']])
    expect(sent).toEqual([])
    expect(steps).toEqual(['informed'])
  })

  it('remembers across instances through storage', () => {
    const { reading, sent, make } = setup()
    reading.progress(cand('a'), 12, false, undefined)
    sent.length = 0
    make().progress(cand('a'), 12, false, undefined)
    expect(sent).toEqual([])
  })

  it('ignores a damaged note', () => {
    const { storage, reading, sent } = setup()
    storage!.setItem(READS_KEY, '{"profiles":5}')
    reading.progress(cand('a'), 12, false, undefined)
    expect(marks(sent)).toEqual(['10'])
  })

  it('works from memory when storage is blocked', () => {
    const { reading, sent } = setup({ storage: null })
    reading.progress(cand('a'), 12, false, undefined)
    sent.length = 0
    reading.progress(cand('a'), 12, false, undefined)
    expect(sent).toEqual([])
  })

  it('works when storage throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    const { reading, sent } = setup({ storage: bad })
    reading.progress(cand('a'), 12, false, undefined)
    expect(marks(sent)).toEqual(['10'])
  })
})
