// Addresses of the race pages (src/shared/races.ts has the scheme).

import { CURRENT_ELECTION } from '../shared/cook.ts'
import { RACES_PATH } from '../shared/races.ts'

/** Every race on Cook County ballots in the current election. */
export const CURRENT_RACES_AREA_PATH = `${RACES_PATH}/il/cook-county/${CURRENT_ELECTION.date}`
