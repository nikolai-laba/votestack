// Where the profile pipeline keeps its files, and reading and writing
// them. Generated profiles are committed under content/profiles/{election
// date}/, so they're written Prettier-formatted for readable diffs.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { format } from 'prettier'
import type { IsoDate } from '../../../src/shared/ballot.ts'
import { chicagoDate } from '../../../src/shared/dates.ts'
import type { CandidateProfile } from '../../../src/shared/profile.ts'
import { BUILD, ROOT, readJson } from '../data.ts'
import type { Region } from '../../../src/shared/regions.ts'
import { ELECTION, folderFor, regionDir } from './region.ts'
import type { SubjectsFile } from './subjects.ts'

export const CONTENT = join(ROOT, 'content', 'profiles')
/**
 * Generated profiles for the region's election (--region, see region.ts), one
 * file per person: content/profiles/{date}/ for Cook County,
 * content/profiles/{region}/{date}/ for other areas.
 */
export const PROFILES_DIR = join(regionDir(CONTENT), ELECTION.date)
/** The same folder for any region (the site's build reads every region's). */
export const profilesDirFor = (region: Region) =>
  join(folderFor(CONTENT, region), region.election.date)
export const OVERRIDES_DIR = join(regionDir(CONTENT), 'overrides')
export const BAR_RATINGS = join(
  regionDir(CONTENT),
  'judges',
  'bar-ratings.json',
)
/** Published endorsement lists (scripts/profiles/slates.ts). */
export const SLATES_DIR = regionDir(join(CONTENT, 'slates'))
/**
 * Lists transcribed by a researcher from a group's page (exact quotes kept),
 * for pages no parser reads; profiles:slates turns each into a slate.
 */
export const TRANSCRIBED_DIR = regionDir(join(CONTENT, 'slates-transcribed'))
/** Official legislative rosters, for endorsing officials' parties (profiles:rosters). */
export const ROSTERS = join(regionDir(CONTENT), 'rosters.json')

/** Incumbent labels (scripts/build-incumbents.ts). */
export const INCUMBENTS = join(
  regionDir(join(ROOT, 'content', 'incumbents')),
  `${ELECTION.date}.json`,
)

/** Pipeline outputs that aren't committed. */
export const PIPELINE_BUILD = regionDir(join(BUILD, 'profiles'))
export const SUBJECTS = join(PIPELINE_BUILD, 'subjects.json')
export const MONEY = join(PIPELINE_BUILD, 'money.json')
export const CHECK = join(PIPELINE_BUILD, 'check.json')
/** Where --dry-run writes, so the committed folder is never touched. */
export const DRY_RUN_DIR = join(PIPELINE_BUILD, 'dry-run', ELECTION.date)

export async function writeFormattedJson(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, await format(JSON.stringify(value), { parser: 'json' }))
}

/** Every profile in a folder, by key. */
export async function readProfiles(
  dir: string,
): Promise<Map<string, CandidateProfile>> {
  const profiles = new Map<string, CandidateProfile>()
  if (!existsSync(dir)) return profiles
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.json')) continue
    const profile = await readJson<CandidateProfile>(join(dir, file))
    if (profile.key !== file.replace(/\.json$/, '')) {
      throw new Error(`${file} holds the profile for ${profile.key}`)
    }
    profiles.set(profile.key, profile)
  }
  return profiles
}

export async function readSubjects(): Promise<SubjectsFile> {
  if (!existsSync(SUBJECTS)) {
    throw new Error(
      'No subjects file; run npm run profiles:subjects first (after data:build)',
    )
  }
  return readJson<SubjectsFile>(SUBJECTS)
}

/** sha256 of a profile's JSON: the content hash stored with the published copy. */
export function contentHash(profile: CandidateProfile): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex')
}

/** Today in Chicago as YYYY-MM-DD, the date every profile is dated by. */
export function today(now = new Date()): IsoDate {
  return chicagoDate(now)
}
