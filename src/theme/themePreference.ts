// Light or dark mode. By default the site follows the
// device setting. The site menu's button switches to the other mode and
// remembers it on this device, in its own localStorage key. Switching back to
// whatever the device shows forgets the choice, so the site follows the device
// again. Every storage call is wrapped: a blocked storage just means the
// choice lasts until the page is closed.
//
// index.html applies a saved choice before first paint; keep THEME_KEY and the
// values in step with the script there (themePreference.test.ts checks).

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'votestack:theme:v1'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function defaultMedia(): MediaQueryList | null {
  try {
    return typeof window === 'undefined' || !window.matchMedia
      ? null
      : window.matchMedia(DARK_QUERY)
  } catch {
    return null
  }
}

function defaultRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

export function createThemeStore({
  getStorage = defaultStorage,
  getMedia = defaultMedia,
  getRoot = defaultRoot,
}: {
  getStorage?: () => Storage | null
  getMedia?: () => MediaQueryList | null
  getRoot?: () => HTMLElement | null
} = {}) {
  // The explicit choice, or null to follow the device.
  let choice: Theme | null = null
  const listeners = new Set<() => void>()
  const media = getMedia()

  const device = (): Theme => (media?.matches ? 'dark' : 'light')

  function load() {
    try {
      const saved = getStorage()?.getItem(THEME_KEY)
      choice = saved === 'light' || saved === 'dark' ? saved : null
    } catch {
      choice = null
    }
  }

  // The CSS reads data-theme on <html>; no attribute means follow the device.
  function apply() {
    const root = getRoot()
    if (!root) return
    if (choice) root.dataset.theme = choice
    else delete root.dataset.theme
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  // Another tab changed it: follow.
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== THEME_KEY) return
    load()
    apply()
    emit()
  }

  load()
  apply()

  return {
    /** The mode on screen now: the choice, or else the device's. */
    getSnapshot: (): Theme => choice ?? device(),
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        if (typeof window !== 'undefined')
          window.addEventListener('storage', onStorage)
        media?.addEventListener?.('change', emit)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          if (typeof window !== 'undefined')
            window.removeEventListener('storage', onStorage)
          media?.removeEventListener?.('change', emit)
        }
      }
    },
    set(next: Theme) {
      choice = next === device() ? null : next
      try {
        const storage = getStorage()
        if (choice) storage?.setItem(THEME_KEY, choice)
        else storage?.removeItem(THEME_KEY)
      } catch {
        // Blocked or full: keep the choice for this page only.
      }
      apply()
      emit()
    },
    /** Re-reads storage, e.g. between tests. */
    reload() {
      load()
      apply()
      emit()
    },
  }
}

/** The app's one theme preference. */
export const themeStore = createThemeStore()

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  )
  return [theme, themeStore.set]
}
