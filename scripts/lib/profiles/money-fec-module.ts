// The FEC as a money source module for any state: U.S. House and Senate
// candidates, matched by name and seat in the FEC's candidate summary, as
// profiles:money does for Cook County.

import {
  downloadFec,
  fecSummary,
  loadFec,
  matchFecCandidates,
  principalCommittee,
} from './fec.ts'
import { join } from 'node:path'
import { RAW } from '../data.ts'
import type { MoneyPerson, MoneyResult, MoneySourceModule } from './money-ca.ts'

const FEC_DIR = join(RAW, 'money', 'fec')

const seatOf = (p: MoneyPerson) =>
  p.officeType === 'us_house'
    ? {
        office: 'H' as const,
        district: Number(p.districtId.match(/\/cd:(\d+)/)?.[1]),
      }
    : p.officeType === 'us_senate'
      ? { office: 'S' as const }
      : null

export function fecModule(state: string): MoneySourceModule {
  return {
    id: 'fec',
    handles: (p) => seatOf(p) !== null,
    async collect(people, ctx): Promise<MoneyResult> {
      await downloadFec(FEC_DIR, ctx.maxAgeHours)
      const fec = await loadFec(FEC_DIR, state)
      const result: MoneyResult = { byKey: {}, unmatched: [] }
      const miss = (p: MoneyPerson, reason: string) =>
        result.unmatched.push({
          key: p.key,
          name: p.name,
          office: p.office,
          reason,
        })
      for (const p of people) {
        const matches = matchFecCandidates(p.ballot, seatOf(p)!, fec.candidates)
        if (matches.length === 0) {
          miss(p, 'No FEC candidate with this name for this seat')
          continue
        }
        // A person sometimes has several candidate IDs; only one with a
        // funded committee counts.
        const funded = matches.flatMap((m) => {
          const summary = fecSummary(m, fec)
          return summary ? [{ m, summary }] : []
        })
        if (funded.length > 1) {
          miss(
            p,
            `Several FEC candidates with reports match: ${funded.map((f) => f.m.id).join(', ')}`,
          )
          continue
        }
        if (funded.length === 0) {
          result.byKey[p.key] = {
            summaries: [],
            note: `No campaign committee reports with the FEC for ${ctx.year} (candidate ${matches.map((m) => m.id).join(', ')}).`,
          }
          continue
        }
        const { m, summary } = funded[0]
        result.byKey[p.key] = {
          summaries: [summary],
          matchedCommittee: principalCommittee(m.id, fec.committees)?.id,
        }
      }
      return result
    },
  }
}
