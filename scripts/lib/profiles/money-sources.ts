// Which money source modules each non-Cook region uses, in order: the
// first module that handles a person owns them. Cook County's sources (FEC
// and ISBE) run in scripts/profiles/money.ts itself. A region missing here
// stops profiles:money, so a new area can't skip campaign money.

import type { MoneySourceModule } from './money-ca.ts'
import { calAccessModule } from './money-calaccess-module.ts'
import { citiesModule } from './money-cities-module.ts'
import { fecModule } from './money-fec-module.ts'
import { netfileModule } from './money-netfile-module.ts'

export const MONEY_MODULES: Record<string, () => MoneySourceModule[]> = {
  'ca-la': () => [
    fecModule('CA'),
    calAccessModule(),
    citiesModule(),
    netfileModule(),
  ],
}
