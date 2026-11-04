import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../test/memoryStorage.ts'
import {
  createNoticeVisit,
  NOTICE_CLOSED_KEY,
  NOTICE_FULL_KEY,
  NOTICE_LINE_KEY,
} from './visit.ts'

/** A store for one page load of a visit: this tab's storage. */
function visit(session: Storage) {
  return createNoticeVisit(() => session)
}

/** Storage whose every call throws, like some private windows. */
const blocked = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
  removeItem() {
    throw new Error('blocked')
  },
} as unknown as Storage

describe('createNoticeVisit', () => {
  it('starts a new visit with the full notice not yet shown or closed', () => {
    expect(visit(new MemoryStorage()).getSnapshot()).toEqual({
      fullShown: false,
      closed: false,
    })
  })

  it('remembers that the full notice was shown, for the visit', () => {
    const session = new MemoryStorage()
    const store = visit(session)
    let calls = 0
    const stop = store.subscribe(() => calls++)
    const before = store.getSnapshot()

    store.markFullShown()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot()).toEqual({ fullShown: true, closed: false })
    expect(session.getItem(NOTICE_FULL_KEY)).toBe('1')

    // The next page of the same visit starts from there.
    expect(visit(session).getSnapshot()).toEqual({
      fullShown: true,
      closed: false,
    })
    stop()
  })

  it('does not tell listeners again when nothing changed', () => {
    const store = visit(new MemoryStorage())
    store.markFullShown()
    store.close()
    let calls = 0
    const stop = store.subscribe(() => calls++)
    const settled = store.getSnapshot()

    store.markFullShown()
    store.close()
    expect(calls).toBe(0)
    expect(store.getSnapshot()).toBe(settled)
    stop()
  })

  it('remembers a close, for the visit', () => {
    const session = new MemoryStorage()
    const store = visit(session)
    let calls = 0
    const stop = store.subscribe(() => calls++)
    const before = store.getSnapshot()

    store.close()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot()).toEqual({ fullShown: false, closed: true })
    expect(session.getItem(NOTICE_CLOSED_KEY)).toBe('1')

    expect(visit(session).getSnapshot()).toEqual({
      fullShown: false,
      closed: true,
    })
    stop()
  })

  it('stops telling a listener once it unsubscribes', () => {
    const store = visit(new MemoryStorage())
    let calls = 0
    const stop = store.subscribe(() => calls++)
    stop()
    store.markFullShown()
    expect(calls).toBe(0)
  })

  it('shows again with no limit on a new visit, even after closes', () => {
    for (let i = 0; i < 5; i++) {
      const store = visit(new MemoryStorage())
      expect(store.getSnapshot()).toEqual({ fullShown: false, closed: false })
      store.markFullShown()
      store.close()
    }
    expect(visit(new MemoryStorage()).getSnapshot()).toEqual({
      fullShown: false,
      closed: false,
    })
  })

  it('counts the one-line notice once per visit', () => {
    const session = new MemoryStorage()
    const store = visit(session)
    expect(store.firstLineThisVisit()).toBe(true)
    expect(session.getItem(NOTICE_LINE_KEY)).toBe('1')
    expect(store.firstLineThisVisit()).toBe(false)
    expect(visit(session).firstLineThisVisit()).toBe(false)
    expect(visit(new MemoryStorage()).firstLineThisVisit()).toBe(true)
  })

  it('does not count the line as part of the full notice or a close', () => {
    const store = visit(new MemoryStorage())
    store.markFullShown()
    store.close()
    expect(store.firstLineThisVisit()).toBe(true)
  })

  it('keeps working in memory when storage is blocked', () => {
    for (const store of [
      createNoticeVisit(() => null),
      createNoticeVisit(() => blocked),
      createNoticeVisit(() => {
        throw new Error('blocked')
      }),
    ]) {
      expect(store.getSnapshot()).toEqual({ fullShown: false, closed: false })
      expect(() => {
        store.markFullShown()
        store.close()
      }).not.toThrow()
      expect(store.getSnapshot()).toEqual({ fullShown: true, closed: true })

      expect(store.firstLineThisVisit()).toBe(true)
      expect(store.firstLineThisVisit()).toBe(false)

      // A reload is a new page load: nothing was kept.
      store.reload()
      expect(store.getSnapshot()).toEqual({ fullShown: false, closed: false })
      expect(store.firstLineThisVisit()).toBe(true)
    }
  })

  it('reload re-reads this visit from storage and tells listeners', () => {
    const session = new MemoryStorage()
    const store = visit(session)
    let calls = 0
    const stop = store.subscribe(() => calls++)

    session.setItem(NOTICE_CLOSED_KEY, '1')
    store.reload()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).toEqual({ fullShown: false, closed: true })

    session.clear()
    store.reload()
    expect(store.getSnapshot()).toEqual({ fullShown: false, closed: false })
    stop()
  })

  it('keeps the notice in this tab only, never in localStorage', () => {
    // The default store reads the browser's own storage.
    const store = createNoticeVisit()
    store.markFullShown()
    store.close()
    store.firstLineThisVisit()
    store.reload()

    expect(window.sessionStorage.getItem(NOTICE_FULL_KEY)).toBe('1')
    expect(window.sessionStorage.getItem(NOTICE_CLOSED_KEY)).toBe('1')
    expect(window.sessionStorage.getItem(NOTICE_LINE_KEY)).toBe('1')
    const keys = Array.from({ length: window.localStorage.length }, (_, i) =>
      window.localStorage.key(i),
    )
    expect(keys.filter((k) => k?.startsWith('votestack:notice'))).toEqual([])
  })
})
