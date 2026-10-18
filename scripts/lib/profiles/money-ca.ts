// Campaign money for a California region, from each office's filing
// officer: the FEC for Congress, the Secretary of State (Cal-Access) for
// state offices and judges, NetFile for the county and the cities and
// districts that use it, and each remaining city's own posted reports.
// Every source module takes the people it handles and says, for each, what
// it found or why not; nobody is left out silently.

import type {
  MoneySectionData,
  MoneySummary,
} from '../../../src/shared/profile.ts'
import type { ParsedName } from './names.ts'

/** Someone on the ballot, as the money sources need them (from subjects.json). */
export interface MoneyPerson {
  key: string
  name: string
  ballot: ParsedName
  office: string
  officeType: string
  districtId: string
  contestIds: string[]
}

export interface MoneyEntry {
  summaries: MoneySummary[]
  matchedCommittee?: string
  sharedCommittee?: MoneySectionData['sharedCommittee']
  /** Where to see the filings when there's no summary (see MoneySectionData). */
  filingsAt?: MoneySectionData['filingsAt']
  /** No active committee or reports on file (see MoneySectionData). */
  noCommittee?: MoneySectionData['noCommittee']
  note?: string
}

export interface Unmatched {
  key: string
  name: string
  office: string
  reason: string
}

export interface MoneyResult {
  byKey: Record<string, MoneyEntry>
  unmatched: Unmatched[]
}

export interface MoneyFile extends MoneyResult {
  generatedAt: string
  /** People per source module, for the log and region:check. */
  bySource?: Record<string, number>
}

/** Options every source module gets. */
export interface MoneyContext {
  /** Downloads younger than this are reused (0 with --refresh). */
  maxAgeHours: number
  /** Today, as a date in the region's time zone. */
  today: string
  /** The election's year. */
  year: number
}

/** A source module: which people it covers and how it collects their money. */
export interface MoneySourceModule {
  id: string
  handles: (p: MoneyPerson) => boolean
  collect: (people: MoneyPerson[], ctx: MoneyContext) => Promise<MoneyResult>
}

/**
 * Runs each module on the people it handles (the first module that handles
 * someone owns them) and merges the results. Anyone no module handles is
 * unmatched with that reason, and any person a module neither matched nor
 * listed as unmatched is an error, so a module can't drop people.
 */
export async function collectMoney(
  people: MoneyPerson[],
  modules: MoneySourceModule[],
  ctx: MoneyContext,
): Promise<MoneyFile> {
  const owner = new Map<string, MoneySourceModule>()
  const unmatched: Unmatched[] = []
  for (const p of people) {
    const m = modules.find((mod) => mod.handles(p))
    if (m) owner.set(p.key, m)
    else
      unmatched.push({
        key: p.key,
        name: p.name,
        office: p.office,
        reason: `No money source handles ${p.officeType}`,
      })
  }
  const byKey: Record<string, MoneyEntry> = {}
  const bySource: Record<string, number> = {}
  for (const m of modules) {
    const mine = people.filter((p) => owner.get(p.key) === m)
    bySource[m.id] = mine.length
    if (mine.length === 0) continue
    const result = await m.collect(mine, ctx)
    const seen = new Set([
      ...Object.keys(result.byKey),
      ...result.unmatched.map((u) => u.key),
    ])
    const dropped = mine.filter((p) => !seen.has(p.key))
    if (dropped.length)
      throw new Error(
        `${m.id} left out ${dropped.length} people: ${dropped
          .slice(0, 10)
          .map((p) => p.key)
          .join(', ')}`,
      )
    Object.assign(byKey, result.byKey)
    unmatched.push(...result.unmatched)
  }
  return {
    generatedAt: new Date().toISOString(),
    byKey,
    unmatched: unmatched.sort((a, b) => a.key.localeCompare(b.key)),
    bySource,
  }
}
