// The areas VoteStack covers, in words for the site's copy. The regions
// themselves (src/shared/regions.ts) decide what is covered.

import { REGIONS, type Region } from '../shared/regions.ts'

/** "A and B", "A, B and C"; with a comma before "and" when the items hold commas. */
export function andList(items: string[]): string {
  if (items.length < 2) return items[0] ?? ''
  const serial = items.some((i) => i.includes(',')) ? ',' : ''
  return `${items.slice(0, -1).join(', ')}${serial} and ${items.at(-1)}`
}

/** "Cook County and Los Angeles County" */
export const coveredNames = (regions: Region[] = REGIONS) =>
  andList(regions.map((r) => r.name))

/** "Cook County, Illinois, and Los Angeles County, California" */
export const coveredFullNames = (regions: Region[] = REGIONS) =>
  andList(regions.map((r) => r.fullName))
