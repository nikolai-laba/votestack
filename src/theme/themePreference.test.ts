/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { THEME_KEY, createThemeStore } from './themePreference.ts'

/** A stand-in for matchMedia('(prefers-color-scheme: dark)'). */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    change(next: boolean) {
      media.matches = next
      for (const l of listeners) l()
    },
  }
  return media
}

function setup({ dark = false, saved }: { dark?: boolean; saved?: string }) {
  const storage = new MemoryStorage()
  if (saved) storage.setItem(THEME_KEY, saved)
  const media = fakeMedia(dark)
  const root = document.createElement('html')
  const store = createThemeStore({
    getStorage: () => storage,
    getMedia: () => media as unknown as MediaQueryList,
    getRoot: () => root,
  })
  return { storage, media, root, store }
}

describe('theme preference', () => {
  it('follows the device until a choice is made', () => {
    const { store, root, media } = setup({ dark: true })
    expect(store.getSnapshot()).toBe('dark')
    expect(root.dataset.theme).toBeUndefined()
    const seen: string[] = []
    store.subscribe(() => seen.push(store.getSnapshot()))
    media.change(false)
    expect(seen).toEqual(['light'])
  })

  it('saves a choice that differs from the device and sets data-theme', () => {
    const { store, root, storage } = setup({ dark: false })
    store.set('dark')
    expect(store.getSnapshot()).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(storage.getItem(THEME_KEY)).toBe('dark')
  })

  it('follows the device again after switching back to its mode', () => {
    const { store, root, storage } = setup({ dark: false, saved: 'dark' })
    expect(root.dataset.theme).toBe('dark')
    store.set('light')
    expect(store.getSnapshot()).toBe('light')
    expect(root.dataset.theme).toBeUndefined()
    expect(storage.getItem(THEME_KEY)).toBeNull()
  })

  it('keeps a saved choice when the device changes', () => {
    const { store, media } = setup({ dark: true, saved: 'light' })
    expect(store.getSnapshot()).toBe('light')
    media.change(false)
    expect(store.getSnapshot()).toBe('light')
  })

  it('ignores an unknown saved value', () => {
    const { store, root } = setup({ dark: false, saved: 'sepia' })
    expect(store.getSnapshot()).toBe('light')
    expect(root.dataset.theme).toBeUndefined()
  })

  it('still switches for this page when storage is blocked', () => {
    const blocked = () => {
      throw new Error('SecurityError')
    }
    const root = document.createElement('html')
    const store = createThemeStore({
      getStorage: () =>
        ({ getItem: blocked, setItem: blocked, removeItem: blocked }) as never,
      getMedia: () => null,
      getRoot: () => root,
    })
    expect(store.getSnapshot()).toBe('light')
    store.set('dark')
    expect(store.getSnapshot()).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
  })

  it('matches the script in index.html that applies it before first paint', () => {
    // Vitest runs from the project root.
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain(`localStorage.getItem('${THEME_KEY}')`)
    expect(html).toContain("theme === 'light' || theme === 'dark'")
    expect(html).toContain('document.documentElement.dataset.theme = theme')
  })
})
