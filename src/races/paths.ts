// Addresses of the race pages (src/shared/races.ts has the scheme).

import type { Region } from '../shared/regions.ts'
import { RACES_PATH } from '../shared/races.ts'

/** Every race on a region's ballots in its current election: `/races/il/cook-county/2026-11-03`. */
export const raceAreaPath = (region: Region) =>
  `${RACES_PATH}/${region.state.toLowerCase()}/${region.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}/${region.election.date}`
