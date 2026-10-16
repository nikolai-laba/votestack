// Which area the profile scripts work on, from `--region=<id>` (or
// `--region <id>`) on the command line: `il-cook` (the default) or `ca-la`.
// Cook County's files stay where they were first published; other areas get
// a folder of their own next to them, so the two never mix.

import { join } from 'node:path'
import { COOK, REGIONS, type Region } from '../../../src/shared/regions.ts'

/** The region named on the command line, or Cook County. */
export function regionFromArgs(argv: string[] = process.argv): Region {
  const i = argv.findIndex((a) => a === '--region' || a.startsWith('--region='))
  if (i < 0) return COOK
  const id = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1]
  const region = REGIONS.find((r) => r.id === id)
  if (!region)
    throw new Error(
      `Unknown region "${id}"; use one of ${REGIONS.map((r) => r.id).join(', ')}`,
    )
  return region
}

export const REGION = regionFromArgs()
export const IS_COOK = REGION.id === COOK.id
export const ELECTION = REGION.election

/** A folder for a region's files: Cook's is `base` itself, others `base/{id}`. */
export const folderFor = (base: string, region: Region) =>
  region.id === COOK.id ? base : join(base, region.id)

/** A folder for this region's files (see folderFor). */
export const regionDir = (base: string) => folderFor(base, REGION)

/** For parseArgs: scripts accept --region as an option. */
export const REGION_OPTION = { region: { type: 'string' as const } }
