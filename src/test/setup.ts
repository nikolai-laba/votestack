import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { orderStore } from '../ballot/orderPreference.ts'
import { ballotStore } from '../picks/store.ts'
import { themeStore } from '../theme/themePreference.ts'
import { MemoryStorage } from './memoryStorage.ts'

// Newer Node versions put their own localStorage on the global object, which
// hides jsdom's and has no methods without a storage file. Give the jsdom
// tests a working one, then load the app's store from it.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
  ballotStore.reload()
  orderStore.reload()
  themeStore.reload()
}

afterEach(() => {
  cleanup()
  // Each test starts with no saved ballot, picks or theme. (Node-environment
  // tests have no window.)
  if (typeof window === 'undefined') return
  window.localStorage.clear()
  ballotStore.reload()
  orderStore.reload()
  themeStore.reload()
})
