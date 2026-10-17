// Cal-Access (the California Secretary of State) as a money source module:
// statewide offices, the Legislature, the Board of Equalization, superior
// court candidates and appellate and Supreme Court justices up for
// retention. See calaccess.ts for the data and the matching rules.

import { join } from 'node:path'
import { RAW } from '../data.ts'
import {
  collectCalAccess,
  downloadCalAccess,
  loadBase,
  loadItems,
  ZIP_NAME,
} from './calaccess.ts'
import type { MoneySourceModule } from './money-ca.ts'

const CALACCESS_DIR = join(RAW, 'money', 'calaccess')

const OFFICE_TYPES = new Set([
  'statewide',
  'state_legislature',
  'board_of_equalization',
  'judicial_candidate',
  'retention',
])

export function calAccessModule(): MoneySourceModule {
  return {
    id: 'calaccess',
    handles: (p) => OFFICE_TYPES.has(p.officeType),
    async collect(people, ctx) {
      await downloadCalAccess(CALACCESS_DIR, ctx.maxAgeHours)
      const zip = join(CALACCESS_DIR, ZIP_NAME)
      const base = await loadBase(zip, ctx.year)
      return collectCalAccess(
        people,
        base,
        (filings, filers) => loadItems(zip, filings, filers),
        ctx,
      )
    },
  }
}
