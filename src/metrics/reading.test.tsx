import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateProfile } from '../shared/profile.ts'
import type { Usage } from './usage.ts'
import { useProfileReading } from './useReading.ts'

/** An IntersectionObserver the test reports in view by hand. */
class FakeObserver {
  static all: FakeObserver[] = []
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeObserver.all.push(this)
  }
  observe() {}
  disconnect() {}
  report(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  show() {
    this.report(true)
  }
  hide() {
    this.report(false)
  }
}

const profileOf = (key: string) =>
  ({ key, kind: 'candidate' }) as unknown as CandidateProfile

function setup() {
  const calls: { key: string; secs: number; sourcesSeen: boolean }[] = []
  const counter = {
    reading: (profile: { key: string }, secs: number, sourcesSeen: boolean) =>
      calls.push({ key: profile.key, secs, sourcesSeen }),
  } as unknown as Usage
  const hook = renderHook(
    ({ profile }) => useProfileReading(profile, [['a', 'b']], counter),
    { initialProps: { profile: profileOf('a') } },
  )
  return { calls, hook, last: () => calls[calls.length - 1] }
}

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  FakeObserver.all = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useProfileReading', () => {
  it('reports visible seconds while the tab is shown', () => {
    const { last } = setup()
    act(() => vi.advanceTimersByTime(21_000))
    expect(last().secs).toBeGreaterThanOrEqual(20)
    expect(last().key).toBe('a')
  })

  it('stops the clock while the tab is hidden', () => {
    const { last } = setup()
    act(() => vi.advanceTimersByTime(5_000))
    const before = last().secs
    visibility = 'hidden'
    act(() => vi.advanceTimersByTime(30_000))
    expect(last().secs).toBe(before)
    visibility = 'visible'
    act(() => vi.advanceTimersByTime(1_000))
    expect(last().secs).toBe(before + 1)
  })

  it('reports Sources in view', () => {
    const { hook, last } = setup()
    act(() => hook.result.current(document.createElement('section')))
    act(() => vi.advanceTimersByTime(3_000))
    expect(last().sourcesSeen).toBe(false)
    act(() => FakeObserver.all[0].show())
    expect(last()).toEqual({ key: 'a', secs: 3, sourcesSeen: true })
  })

  it('reports Sources as out of view once scrolled away', () => {
    const { hook, last } = setup()
    act(() => hook.result.current(document.createElement('section')))
    act(() => vi.advanceTimersByTime(2_000))
    act(() => FakeObserver.all[0].show())
    expect(last()).toEqual({ key: 'a', secs: 2, sourcesSeen: true })
    act(() => vi.advanceTimersByTime(3_000))
    act(() => FakeObserver.all[0].hide())
    act(() => vi.advanceTimersByTime(5_000))
    expect(last()).toEqual({ key: 'a', secs: 10, sourcesSeen: false })
  })

  it('reports Sources still in view as the seconds go on', () => {
    const { hook, last } = setup()
    act(() => hook.result.current(document.createElement('section')))
    act(() => vi.advanceTimersByTime(2_000))
    act(() => FakeObserver.all[0].show())
    act(() => vi.advanceTimersByTime(8_000))
    expect(last()).toEqual({ key: 'a', secs: 10, sourcesSeen: true })
  })

  it('time on one profile never counts toward the next', () => {
    const { hook, calls, last } = setup()
    act(() => hook.result.current(document.createElement('section')))
    act(() => vi.advanceTimersByTime(15_000))
    act(() => FakeObserver.all[0].show())
    hook.rerender({ profile: profileOf('b') })
    act(() => vi.advanceTimersByTime(1_000))
    expect(last()).toEqual({ key: 'b', secs: 1, sourcesSeen: false })
    expect(calls.filter((c) => c.key === 'b').map((c) => c.secs)).toEqual([1])
  })

  it('counts nothing for a sample profile', () => {
    const calls: unknown[] = []
    const counter = {
      reading: () => calls.push(1),
    } as unknown as Usage
    const sample = {
      ...profileOf('a'),
      sample: { forName: 'B', forOffice: 'Governor' },
    } as CandidateProfile
    renderHook(() => useProfileReading(sample, undefined, counter))
    act(() => vi.advanceTimersByTime(30_000))
    expect(calls).toEqual([])
  })
})
