// Helpers for scripts/usage-report.ts: filling the report templates, reading
// the release list and running costs, and turning the measures module into a
// script the v2 page can inline.

import { stripTypeScriptTypes } from 'node:module'
import { readFile } from 'node:fs/promises'
import { profileKey } from '../../src/shared/profile.ts'
import type { Costs } from './usage-measures.ts'

/** Versions from CHANGELOG.md, newest first, with the first bullet under each as its note. */
export function parseReleases(
  changelog: string,
): { version: string; date: string; note: string }[] {
  const releases: { version: string; date: string; note: string }[] = []
  let current: { version: string; date: string; note: string } | null = null
  for (const line of changelog.split('\n')) {
    const heading = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/.exec(line)
    if (heading) {
      current =
        heading[1] === 'Unreleased'
          ? null
          : { version: heading[1], date: heading[2] ?? '', note: '' }
      if (current) releases.push(current)
    } else if (current && !current.note && line.startsWith('- ')) {
      current.note = line.slice(2).trim()
    }
  }
  return releases
}

const MONTH = /^\d{4}-\d{2}$/

/** The running costs file, or null when it is missing, unreadable or not the expected shape. */
export async function readCosts(path: string): Promise<Costs | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    const monthly = (parsed as { monthly?: unknown } | null)?.monthly
    if (!Array.isArray(monthly)) return null
    for (const m of monthly) {
      if (
        typeof m?.name !== 'string' ||
        typeof m.usd !== 'number' ||
        !Number.isFinite(m.usd) ||
        typeof m.from !== 'string' ||
        !MONTH.test(m.from) ||
        (m.to !== undefined && !(typeof m.to === 'string' && MONTH.test(m.to)))
      )
        return null
    }
    return { monthly } as Costs
  } catch {
    return null
  }
}

/** How much the committed race lists cover: distinct candidates, races and areas. */
export function coverage(
  contestFiles: {
    areaPath: string
    races: { candidates?: { name: string }[] }[]
  }[],
): { candidates: number; races: number; areas: number } {
  const candidates = new Set<string>()
  const areas = new Set<string>()
  let races = 0
  for (const file of contestFiles) {
    areas.add(
      file.areaPath.startsWith('il/')
        ? 'il-cook'
        : file.areaPath.startsWith('ca/')
          ? 'ca-la'
          : 'none',
    )
    for (const race of file.races) {
      races++
      for (const c of race.candidates ?? []) candidates.add(profileKey(c.name))
    }
  }
  return { candidates: candidates.size, races, areas: areas.size }
}

const DATA_PLACEHOLDER = /(["'])__USAGE_DATA__\1/
const MEASURES_PLACEHOLDER = /(["'])__USAGE_MEASURES__\1/

/** Writes the data (and for v2, the measures script) into a template. */
export function fillTemplate(
  template: string,
  data: unknown,
  measuresJs?: string,
): string {
  // `<` is escaped so no value can close the script tag. Either quote style,
  // since formatters may change it.
  if (!DATA_PLACEHOLDER.test(template)) {
    throw new Error('The data placeholder is missing from the template')
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  let html = template.replace(DATA_PLACEHOLDER, () => json)
  if (measuresJs !== undefined) {
    if (!MEASURES_PLACEHOLDER.test(html)) {
      throw new Error('The measures placeholder is missing from the template')
    }
    const js = measuresJs.replace(/<\/script/gi, '<\\/script')
    html = html.replace(MEASURES_PLACEHOLDER, () => js)
  }
  return html
}

/** The measures module as a classic script: types stripped, `export` dropped so its functions are globals. */
export function measuresScript(tsSource: string): string {
  return stripTypeScriptTypes(tsSource, { mode: 'strip' }).replace(
    /^export (?=(?:async )?(?:function|const|let|class)\b)/gm,
    '',
  )
}
