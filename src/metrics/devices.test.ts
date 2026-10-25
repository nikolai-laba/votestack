import { describe, expect, it } from 'vitest'
import type { UsageEvent } from '../shared/metrics.ts'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { SEEN_KEY, createDevices } from './devices.ts'

function setup(
  opts: { storage?: Storage | null; older?: boolean; day?: string } = {},
) {
  const storage =
    opts.storage === undefined ? new MemoryStorage() : opts.storage
  const sent: UsageEvent[] = []
  const clock = { day: opts.day ?? '2026-10-19' }
  const make = () =>
    createDevices({
      storage: () => storage,
      today: () => clock.day,
      add: (e) => sent.push(e),
      hadOlderNotes: () => opts.older ?? false,
    })
  return { storage, sent, clock, make, devices: make() }
}

const visit = { started: 1, entry: 'profile', source: 'search' } as const
const periods = (sent: UsageEvent[]) =>
  sent.map((e) => (e.e === 'device' ? `${e.period}:${e.seen}` : e.e))

describe('devices', () => {
  it('counts a brand-new device in every period', () => {
    const { devices, sent } = setup()
    devices.counted(visit)
    expect(periods(sent)).toEqual([
      'day:new',
      'week:new',
      'month:new',
      'election:new',
    ])
  })

  it('counts nothing more the same day', () => {
    const { devices, sent, make } = setup()
    devices.counted(visit)
    sent.length = 0
    make().counted(visit)
    expect(sent).toEqual([])
  })

  it('counts nothing more on a second call in one instance', () => {
    const { devices, sent, clock } = setup()
    devices.counted(visit)
    sent.length = 0
    // even if the page stays open past midnight, this load counts once
    clock.day = '2026-10-20'
    devices.counted(visit)
    expect(sent).toEqual([])
  })

  it('counts only the day on the next day of the same week', () => {
    const { devices, sent, clock, make } = setup()
    devices.counted(visit)
    sent.length = 0
    clock.day = '2026-10-20'
    make().counted(visit)
    expect(periods(sent)).toEqual(['day:back'])
  })

  it('counts a new week and a new month', () => {
    const { devices, sent, clock, make } = setup({ day: '2026-10-31' })
    devices.counted(visit)
    sent.length = 0
    clock.day = '2026-11-02'
    make().counted(visit)
    expect(periods(sent)).toEqual(['day:back', 'week:back', 'month:back'])
  })

  it('treats a device with older VoteStack notes as back', () => {
    const { devices, sent } = setup({ older: true })
    devices.counted(visit)
    expect(periods(sent)).toEqual([
      'day:back',
      'week:back',
      'month:back',
      'election:back',
    ])
  })

  it('keeps the first arrival and credits the lookup', () => {
    const { devices, sent } = setup()
    devices.counted(visit)
    sent.length = 0
    devices.origin(1)
    expect(sent).toEqual([
      { e: 'origin', entry: 'profile', source: 'search', when: 'same' },
    ])
    // a later visit says 'later'
    const later = setup()
    later.devices.counted(visit)
    later.sent.length = 0
    later.make().origin(2)
    expect(later.sent).toEqual([
      { e: 'origin', entry: 'profile', source: 'search', when: 'later' },
    ])
  })

  it('never changes the first arrival afterward', () => {
    const { devices, sent, clock, make } = setup()
    devices.counted(visit)
    clock.day = '2026-10-21'
    make().counted({ started: 7, entry: 'ballot', source: 'direct' })
    sent.length = 0
    make().origin(7)
    expect(sent).toEqual([
      { e: 'origin', entry: 'profile', source: 'search', when: 'later' },
    ])
  })

  it('sends the origin once per device ever', () => {
    const { devices, sent, make } = setup()
    devices.counted(visit)
    sent.length = 0
    devices.origin(1)
    devices.origin(1)
    make().origin(2)
    expect(sent).toHaveLength(1)
  })

  it('marks the first arrival unknown for older devices', () => {
    const { devices, sent } = setup({ older: true })
    devices.counted(visit)
    sent.length = 0
    devices.origin(5)
    expect(sent).toEqual([
      { e: 'origin', entry: 'unknown', source: 'unknown', when: 'later' },
    ])
  })

  it('keeps the credit across a new election', () => {
    const { devices, sent, storage } = setup()
    devices.counted(visit)
    devices.origin(1)
    sent.length = 0
    const note = JSON.parse((storage as Storage).getItem(SEEN_KEY) as string)
    expect(note.credited).toBe(true)
    ;(storage as Storage).setItem(
      SEEN_KEY,
      JSON.stringify({ ...note, election: '2024-11-05' }),
    )
    const again = setup({ storage })
    again.devices.counted(visit)
    again.devices.origin(9)
    expect(periods(again.sent)).toEqual(['election:back'])
  })

  it('counts as new for the page load when storage is blocked', () => {
    const { devices, sent } = setup({ storage: null })
    expect(() => devices.counted(visit)).not.toThrow()
    expect(periods(sent)).toEqual([
      'day:new',
      'week:new',
      'month:new',
      'election:new',
    ])
    devices.origin(1)
    devices.origin(1)
    expect(sent.filter((e) => e.e === 'origin')).toHaveLength(1)
  })
})
