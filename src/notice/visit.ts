// What the after-election thank-you notice remembers about this visit: the
// full notice was shown (so later pages show one line), it was closed, and the
// one-line version was already counted. All three are sessionStorage notes, so
// they last for one browser tab and a new visit starts clear: the notice shows
// again with no limit. Nothing goes in localStorage and nothing counts closes.
// Like the sign-up record (src/signup/device.ts), every storage call is
// wrapped: blocked storage means this lasts for the page load only.

import { useSyncExternalStore } from 'react'

export const NOTICE_FULL_KEY = 'votestack:notice:full'
export const NOTICE_CLOSED_KEY = 'votestack:notice:closed'
export const NOTICE_LINE_KEY = 'votestack:notice:line'

export interface NoticeVisit {
  /** The full notice was shown on an earlier page of this visit. */
  fullShown: boolean
  /** The notice was closed on this visit. */
  closed: boolean
}

const NOTHING: NoticeVisit = { fullShown: false, closed: false }

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** The storage, or nothing when getting it throws, like blocked storage. */
function storageFrom(getSession: () => Storage | null): Storage | null {
  try {
    return getSession()
  } catch {
    return null
  }
}

function getItem(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function setItem(storage: Storage | null, key: string, value: string) {
  try {
    storage?.setItem(key, value)
  } catch {
    // Blocked or full: the page keeps its own copy.
  }
}

export function createNoticeVisit(
  getSession: () => Storage | null = sessionStorageOrNull,
) {
  let state = NOTHING
  /** Counted as a line on this page, for when sessionStorage is blocked. */
  let lineHere = false
  const listeners = new Set<() => void>()

  function session() {
    return storageFrom(getSession)
  }

  function load() {
    const storage = session()
    state = {
      fullShown: getItem(storage, NOTICE_FULL_KEY) === '1',
      closed: getItem(storage, NOTICE_CLOSED_KEY) === '1',
    }
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  load()

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** The full notice was shown: later pages of this visit show one line. */
    markFullShown() {
      if (state.fullShown) return
      setItem(session(), NOTICE_FULL_KEY, '1')
      state = { ...state, fullShown: true }
      emit()
    },
    /** Closed: hidden for the rest of this visit, back on the next one. */
    close() {
      if (state.closed) return
      setItem(session(), NOTICE_CLOSED_KEY, '1')
      state = { ...state, closed: true }
      emit()
    },
    /** True the first time it's asked on this visit, for the one-line count. */
    firstLineThisVisit() {
      if (lineHere || getItem(session(), NOTICE_LINE_KEY) === '1') {
        lineHere = true
        return false
      }
      lineHere = true
      setItem(session(), NOTICE_LINE_KEY, '1')
      return true
    },
    /** Re-reads storage and forgets this page's notes, e.g. between tests. */
    reload() {
      lineHere = false
      load()
      emit()
    },
  }
}

/** The app's one record of this visit, shared by the notice and its lines. */
export const noticeVisit = createNoticeVisit()

export function useNoticeVisit(): NoticeVisit {
  return useSyncExternalStore(
    noticeVisit.subscribe,
    noticeVisit.getSnapshot,
    noticeVisit.getSnapshot,
  )
}
