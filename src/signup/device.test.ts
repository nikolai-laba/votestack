import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { bannerAllowed, createSignupStore, SIGNUP_KEY } from './device.ts'

/** A store for one visit: the device's storage, and this tab's. */
function visit(local: Storage, session: Storage = new MemoryStorage()) {
  return createSignupStore(
    () => local,
    () => session,
  )
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

describe('signupStore', () => {
  it('starts with nothing signed up or closed', () => {
    const store = visit(new MemoryStorage())
    expect(store.getSnapshot()).toEqual({
      signedUp: false,
      closes: 0,
      closedThisVisit: false,
    })
    expect(bannerAllowed(store.getSnapshot())).toBe(true)
  })

  it('closing hides the banner for the visit and counts the close', () => {
    const local = new MemoryStorage()
    const store = visit(local)
    store.closeBanner()
    expect(store.getSnapshot()).toEqual({
      signedUp: false,
      closes: 1,
      closedThisVisit: true,
    })
    expect(bannerAllowed(store.getSnapshot())).toBe(false)

    const later = visit(local)
    expect(later.getSnapshot()).toEqual({
      signedUp: false,
      closes: 1,
      closedThisVisit: false,
    })
    expect(bannerAllowed(later.getSnapshot())).toBe(true)
  })

  it('stops the banner for good after the third close', () => {
    const local = new MemoryStorage()
    for (let i = 0; i < 3; i++) visit(local).closeBanner()
    const fourth = visit(local).getSnapshot()
    expect(fourth.closes).toBe(3)
    expect(bannerAllowed(fourth)).toBe(false)
  })

  it('a sign-up stops the banner and keeps no email', () => {
    const local = new MemoryStorage()
    const store = visit(local)
    store.markSignedUp()
    expect(bannerAllowed(store.getSnapshot())).toBe(false)
    expect(local.getItem(SIGNUP_KEY)).toBe('{"signedUp":true,"closes":0}')
    expect(bannerAllowed(visit(local).getSnapshot())).toBe(false)
  })

  it('keeps working when storage is blocked', () => {
    const store = visit(blocked, blocked)
    expect(() => {
      store.closeBanner()
      store.markSignedUp()
    }).not.toThrow()
    expect(store.getSnapshot()).toMatchObject({
      signedUp: true,
      closedThisVisit: true,
    })
  })

  it('ignores a damaged record', () => {
    for (const raw of ['not json', '{"closes":"x"}', '[]', 'null']) {
      const local = new MemoryStorage()
      local.setItem(SIGNUP_KEY, raw)
      expect(visit(local).getSnapshot()).toEqual({
        signedUp: false,
        closes: 0,
        closedThisVisit: false,
      })
    }
  })

  it('counts the banner as shown once per visit', () => {
    const local = new MemoryStorage()
    const store = visit(local)
    expect(store.firstShowThisVisit()).toBe(true)
    expect(store.firstShowThisVisit()).toBe(false)
    expect(visit(local).firstShowThisVisit()).toBe(true)
  })

  it('tells listeners when something changes', () => {
    const store = visit(new MemoryStorage())
    let calls = 0
    const stop = store.subscribe(() => calls++)
    const before = store.getSnapshot()
    store.closeBanner()
    expect(calls).toBe(1)
    expect(store.getSnapshot()).not.toBe(before)
    stop()
  })
})
