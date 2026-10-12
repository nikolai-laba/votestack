import { describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '../test/memoryStorage.ts'
import { createOrderStore, ORDER_KEY } from './orderPreference.ts'

describe('order preference', () => {
  it('starts by level and remembers paper order on the device', () => {
    const storage = new MemoryStorage()
    const store = createOrderStore(() => storage)
    expect(store.getSnapshot()).toBe('level')
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('paper')
    expect(listener).toHaveBeenCalled()
    expect(storage.getItem(ORDER_KEY)).toBe('paper')
    expect(createOrderStore(() => storage).getSnapshot()).toBe('paper')
  })

  it('ignores anything else stored under its key', () => {
    const storage = new MemoryStorage()
    storage.setItem(ORDER_KEY, 'alphabetical')
    expect(createOrderStore(() => storage).getSnapshot()).toBe('level')
  })

  it('keeps the choice for the page when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    } as unknown as Storage
    const store = createOrderStore(() => blocked)
    expect(store.getSnapshot()).toBe('level')
    store.set('paper')
    expect(store.getSnapshot()).toBe('paper')
    expect(createOrderStore(() => null).getSnapshot()).toBe('level')
  })
})
