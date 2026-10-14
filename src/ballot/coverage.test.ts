import { describe, expect, it } from 'vitest'
import { andList, coveredFullNames, coveredNames } from './coverage.ts'

describe('coverage', () => {
  it('names the areas VoteStack covers', () => {
    expect(coveredNames()).toBe('Cook County and Los Angeles County')
    expect(coveredFullNames()).toBe(
      'Cook County, Illinois, and Los Angeles County, California',
    )
  })

  it('joins lists in plain English', () => {
    expect(andList(['A'])).toBe('A')
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C')
  })
})
