// Which order the voter reads the ballot in: by level of government
// (the default) or in paper ballot order. Remembered on this device only,
// in its own localStorage key, like the picks store (src/picks/store.ts):
// every storage call is wrapped, so a blocked storage just means the choice
// lasts until the page is closed.

import { useSyncExternalStore } from 'react'

export type BallotOrder = 'level' | 'paper'

export const ORDER_KEY = 'votestack:ballot-order:v1'

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function createOrderStore(
  getStorage: () => Storage | null = defaultStorage,
) {
  let order: BallotOrder = 'level'
  const listeners = new Set<() => void>()

  function load() {
    try {
      order = getStorage()?.getItem(ORDER_KEY) === 'paper' ? 'paper' : 'level'
    } catch {
      order = 'level'
    }
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  // Another tab changed it: follow.
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== ORDER_KEY) return
    load()
    emit()
  }

  load()

  return {
    getSnapshot: () => order,
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
    set(next: BallotOrder) {
      order = next
      try {
        getStorage()?.setItem(ORDER_KEY, next)
      } catch {
        // Blocked or full: keep the choice for this page only.
      }
      emit()
    },
    /** Re-reads storage, e.g. between tests. */
    reload() {
      load()
      emit()
    },
  }
}

/** The app’s one order preference, shared by the ballot and Saved choices. */
export const orderStore = createOrderStore()

export function useBallotOrder(): [BallotOrder, (order: BallotOrder) => void] {
  const order = useSyncExternalStore(
    orderStore.subscribe,
    orderStore.getSnapshot,
    orderStore.getSnapshot,
  )
  return [order, orderStore.set]
}
