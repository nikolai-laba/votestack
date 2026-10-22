// The email sign-up on this device: whether it has signed up and how many
// times the sign-up banner was closed, in its own localStorage key, plus two
// notes that last only for this visit (sessionStorage, one tab): the banner
// was closed, and it was already counted as shown. Never the email address
// or ZIP code. Like the ballot order (src/ballot/orderPreference.ts), every
// storage call is wrapped: blocked storage means this lasts for the page only.

import { useSyncExternalStore } from 'react'

export const SIGNUP_KEY = 'votestack:signup:v1'
export const CLOSED_KEY = 'votestack:signup:closed'
export const SHOWN_KEY = 'votestack:signup:shown'
/** Closes after which the banner never shows again on this device. */
export const MAX_CLOSES = 3

export interface SignupDevice {
  signedUp: boolean
  /** Times the banner was closed, on any visit. */
  closes: number
  closedThisVisit: boolean
}

const NOTHING: SignupDevice = {
  signedUp: false,
  closes: 0,
  closedThisVisit: false,
}

function storageOf(kind: 'localStorage' | 'sessionStorage') {
  return (): Storage | null => {
    try {
      return typeof window === 'undefined' ? null : window[kind]
    } catch {
      return null
    }
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

/** The saved record, or nothing for a missing or damaged one. */
function parseRecord(
  raw: string | null,
): Pick<SignupDevice, 'signedUp' | 'closes'> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return NOTHING
    const r = v as Record<string, unknown>
    const closes = r.closes
    return {
      signedUp: r.signedUp === true,
      closes:
        typeof closes === 'number' && Number.isInteger(closes) && closes > 0
          ? closes
          : 0,
    }
  } catch {
    return NOTHING
  }
}

export function createSignupStore(
  getLocal: () => Storage | null = storageOf('localStorage'),
  getSession: () => Storage | null = storageOf('sessionStorage'),
) {
  let state = NOTHING
  /** Counted as shown on this page, for when sessionStorage is blocked. */
  let shownHere = false
  const listeners = new Set<() => void>()

  function load(closedThisVisit: boolean) {
    state = {
      ...parseRecord(getItem(getLocal(), SIGNUP_KEY)),
      closedThisVisit:
        closedThisVisit || getItem(getSession(), CLOSED_KEY) === '1',
    }
  }

  function save(next: SignupDevice) {
    state = next
    setItem(
      getLocal(),
      SIGNUP_KEY,
      JSON.stringify({ signedUp: next.signedUp, closes: next.closes }),
    )
    emit()
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  // Another tab signed up or closed the banner: follow.
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== SIGNUP_KEY) return
    load(state.closedThisVisit)
    emit()
  }

  load(false)

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1 && typeof window !== 'undefined')
        window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && typeof window !== 'undefined')
          window.removeEventListener('storage', onStorage)
      }
    },
    markSignedUp() {
      save({ ...state, signedUp: true })
    },
    closeBanner() {
      setItem(getSession(), CLOSED_KEY, '1')
      save({ ...state, closes: state.closes + 1, closedThisVisit: true })
    },
    /** True the first time it's asked on this visit, for the "shown" count. */
    firstShowThisVisit() {
      if (shownHere || getItem(getSession(), SHOWN_KEY) === '1') {
        shownHere = true
        return false
      }
      shownHere = true
      setItem(getSession(), SHOWN_KEY, '1')
      return true
    },
    /** Re-reads storage and forgets this page's notes, e.g. between tests. */
    reload() {
      shownHere = false
      load(false)
      emit()
    },
  }
}

/** The app's one sign-up record, shared by the banner and every form. */
export const signupStore = createSignupStore()

export function useSignupDevice(): SignupDevice {
  return useSyncExternalStore(
    signupStore.subscribe,
    signupStore.getSnapshot,
    signupStore.getSnapshot,
  )
}

/** Whether the banner may show: not signed up, not closed too often or this visit. */
export const bannerAllowed = (d: SignupDevice) =>
  !d.signedUp && d.closes < MAX_CLOSES && !d.closedThisVisit
