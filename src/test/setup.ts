import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { orderStore } from '../ballot/orderPreference.ts'
import { noticeVisit } from '../notice/visit.ts'
import { ballotStore } from '../picks/store.ts'
import { signupStore } from '../signup/device.ts'
import { themeStore } from '../theme/themePreference.ts'
import { MemoryStorage } from './memoryStorage.ts'

// Newer Node versions put their own localStorage and sessionStorage on the
// global object, which hide jsdom's and have no methods without a storage
// file. Give the jsdom tests working ones, then load the app's stores from
// them.
if (typeof window !== 'undefined') {
  for (const kind of ['localStorage', 'sessionStorage'])
    Object.defineProperty(window, kind, {
      configurable: true,
      value: new MemoryStorage(),
    })
  ballotStore.reload()
  orderStore.reload()
  themeStore.reload()
  signupStore.reload()
  noticeVisit.reload()
}

afterEach(() => {
  cleanup()
  // Each test starts with no saved ballot, picks, theme, sign-up or notice
  // notes, as a new visit. (Node-environment tests have no window.)
  if (typeof window === 'undefined') return
  window.localStorage.clear()
  window.sessionStorage.clear()
  ballotStore.reload()
  orderStore.reload()
  themeStore.reload()
  signupStore.reload()
  noticeVisit.reload()
})
