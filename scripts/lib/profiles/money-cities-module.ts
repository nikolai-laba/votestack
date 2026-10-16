// Campaign money for city candidates in cities that post their own filings
// (not NetFile): the systems in city-filings.ts, configured per city in
// content/money/<region>/city-filings.json. For each city council and
// citywide candidate it finds the committee's posted Form 460s and 497s,
// reads them (form460-pdf.ts) and summarizes the latest 460, with late
// contributions since its period as `largeSince`. Where the filings can't
// be read (the city gives them only on request, its site refuses automated
// requests, the PDF is a scan, or nothing is posted yet), the entry points
// at the filing officer through `filingsAt` and says why in its note.
//
// Manual folder: data/raw/money/manual/<region>/<candidate key>/*.pdf
// (gitignored). PDFs saved there by hand are read for any candidate this
// module handles, whatever their city's system. The City of Los Angeles
// needs it: ethics.lacity.gov disallows automated access, so download each
// candidate's latest Form 460 and any later 497s from the statement link in
// the note (the "View" link on the Ethics Commission's statement page) into
// data/raw/money/manual/ca-la/<key>/. On-request cities' replies go there
// too. Where a filing could only be seen as page images, the folder holds
// an agreed read of its Summary Page instead (*.read.json, the same shape
// as the scan reads in form460-pdf.ts).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MoneySummary } from '../../../src/shared/profile.ts'
import { RAW } from '../data.ts'
import {
  cityFilingsPath,
  docsForPerson,
  downloadDoc,
  listCityDocs,
  loadCityFilings,
  officerOf,
  placeOf,
  WallError,
  type CityDoc,
  type CityFilings,
  type CityListing,
  type PersonLink,
} from './city-filings.ts'
import {
  form460Summary,
  lateSince,
  latestReport,
  type Form460,
  type LateContribution,
} from './form460.ts'
import {
  form460OfScanRead,
  readForm460Pdf,
  readForm497Pdf,
  type CommitteeHint,
  type PdfRead,
  type ScanRead,
} from './form460-pdf.ts'
import type {
  MoneyContext,
  MoneyEntry,
  MoneyPerson,
  MoneyResult,
  MoneySourceModule,
} from './money-ca.ts'

/** Newest Form 460s read per person (the latest period is among them). */
const MAX_460 = 3
/** Newest Form 497s read per person. */
const MAX_497 = 10

type Read497 = {
  committee: string
  committeeId?: string
  contributions: LateContribution[]
}

/** Everything the module reaches outside itself, so tests can stand in for it. */
export interface CitiesDeps {
  /** The region id, for the manual folder's path. */
  region: string
  cities: CityFilings[]
  list: (
    city: CityFilings,
    people: MoneyPerson[],
    options: { maxAgeHours: number; year: number },
  ) => Promise<CityListing>
  download: (city: CityFilings, doc: CityDoc) => Promise<string>
  read460: (
    path: string,
    candidate?: { first: string; last: string },
    committee?: CommitteeHint,
  ) => Promise<PdfRead<Form460>>
  read497: (
    path: string,
    candidate?: { first: string; last: string },
    committee?: CommitteeHint,
  ) => Promise<PdfRead<Read497>>
  /** PDFs saved by hand for a person. */
  manualPdfs: (key: string) => Promise<string[]>
  /** Agreed reads of filings seen only as page images, for a person. */
  manualReads?: (key: string) => Promise<ScanRead[]>
}

/** How each person came out, for the run log and coverage counts. */
export type CityStatus =
  | 'summary'
  | 'committee-no-460'
  | 'nothing-posted'
  | 'scanned'
  | 'pdf-unreadable'
  | 'no-download'
  | 'manual-missing'
  | 'on-request'
  | 'wall'
  | 'unmatched'

export interface CityRun {
  result: MoneyResult
  status: Record<
    string,
    { place: string; system: string; status: CityStatus; pdfs: number }
  >
}

const isCityOffice = (p: MoneyPerson) =>
  p.officeType === 'city_council' || p.officeType === 'city_executive'

export function defaultDeps(region = 'ca-la'): CitiesDeps {
  return {
    region,
    cities: loadCityFilings(cityFilingsPath(region)),
    list: listCityDocs,
    download: downloadDoc,
    read460: readForm460Pdf,
    read497: readForm497Pdf,
    manualPdfs: async (key) => {
      const dir = join(RAW, 'money', 'manual', region, key)
      const files = await readdir(dir).catch(() => [] as string[])
      return files
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
        .sort()
        .map((f) => join(dir, f))
    },
    manualReads: async (key) => {
      const dir = join(RAW, 'money', 'manual', region, key)
      const files = await readdir(dir).catch(() => [] as string[])
      return Promise.all(
        files
          .filter((f) => f.endsWith('.read.json'))
          .sort()
          .map(
            async (f) =>
              JSON.parse(await readFile(join(dir, f), 'utf8')) as ScanRead,
          ),
      )
    },
  }
}

export function citiesModule(
  deps: CitiesDeps = defaultDeps(),
): MoneySourceModule {
  const byPlace = new Map(deps.cities.map((c) => [c.place, c]))
  return {
    id: 'cities',
    handles: (p) => isCityOffice(p) && byPlace.has(placeOf(p.districtId) ?? ''),
    collect: async (people, ctx) =>
      (await collectCities(people, ctx, deps)).result,
  }
}

/** The module's work, with each person's status for reporting. */
export async function collectCities(
  people: MoneyPerson[],
  ctx: MoneyContext,
  deps: CitiesDeps,
): Promise<CityRun> {
  const run: CityRun = { result: { byKey: {}, unmatched: [] }, status: {} }
  const byPlace = new Map<string, MoneyPerson[]>()
  for (const p of people) {
    const place = placeOf(p.districtId) ?? ''
    byPlace.set(place, [...(byPlace.get(place) ?? []), p])
  }
  for (const [place, cityPeople] of byPlace) {
    const city = deps.cities.find((c) => c.place === place)
    if (!city) {
      for (const p of cityPeople)
        unmatched(run, p, place, '-', `No filings entry for ${place}`)
      continue
    }
    let listing: CityListing = { docs: [], links: {} }
    let wall = blocked(city)
    if (!wall)
      try {
        listing = await deps.list(city, cityPeople, {
          maxAgeHours: ctx.maxAgeHours,
          year: ctx.year,
        })
      } catch (e) {
        if (!(e instanceof WallError)) console.warn(`${city.name}: ${e}`)
        wall = `The city's filings couldn't be read automatically (${(e as Error).message}).`
      }
    for (const p of cityPeople)
      await collectPerson(run, p, city, cityPeople, listing, wall, ctx, deps)
  }
  return run
}

/** Why a city's filings can't be listed at all, or undefined if they can. */
function blocked(city: CityFilings): string | undefined {
  if (city.system === 'on-request') return undefined
  if (
    city.wall &&
    city.system !== 'southtech' &&
    city.system !== 'lacity-manual'
  )
    return city.wall
  return undefined
}

function unmatched(
  run: CityRun,
  p: MoneyPerson,
  place: string,
  system: string,
  reason: string,
) {
  run.result.unmatched.push({
    key: p.key,
    name: p.name,
    office: p.office,
    reason,
  })
  run.status[p.key] = { place, system, status: 'unmatched', pdfs: 0 }
}

const lastName = (p: MoneyPerson) => p.ballot.words.at(-1) ?? ''
const candidateOf = (p: MoneyPerson) => ({
  first: p.ballot.given[0] ?? '',
  last: lastName(p),
})
const foldWords = (s: string) =>
  ` ${s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

/** Newest first: by period end, then posting date, then id. */
const newest = (a: CityDoc, b: CityDoc) =>
  (b.through ?? '').localeCompare(a.through ?? '') ||
  (b.posted ?? '').localeCompare(a.posted ?? '') ||
  b.id.localeCompare(a.id, undefined, { numeric: true })

async function collectPerson(
  run: CityRun,
  p: MoneyPerson,
  city: CityFilings,
  cityPeople: MoneyPerson[],
  listing: CityListing,
  wall: string | undefined,
  ctx: MoneyContext,
  deps: CitiesDeps,
): Promise<void> {
  const officer = officerOf(city)
  const setStatus = (status: CityStatus, pdfs = 0) =>
    (run.status[p.key] = {
      place: city.place,
      system: city.system,
      status,
      pdfs,
    })
  const link: PersonLink | undefined = listing.links[p.key]
  const pointAt = (
    url: string,
    note: string,
    onRequest = false,
  ): MoneyEntry => ({
    summaries: [],
    filingsAt: { name: officer, url, ...(onRequest && { onRequest: true }) },
    note,
  })
  const listUrl = city.filingsUrls[0] ?? city.clerkUrl

  // PDFs saved by hand come first: they're the filings we were given.
  const manual = await deps.manualPdfs(p.key)
  const pageReads = (await deps.manualReads?.(p.key)) ?? []
  const reads460: { report: Form460; url: string }[] = []
  const reads497: Read497[] = []
  const failures: string[] = []
  const manualUrl = link?.url ?? listUrl
  // The committee as the city lists it; OCR'd names are less reliable.
  const hint: CommitteeHint | undefined = link?.committee
    ? { name: link.committee }
    : undefined
  for (const read of pageReads) {
    const report = form460OfScanRead(read, hint)
    if (report) reads460.push({ report, url: manualUrl })
  }
  for (const path of manual) {
    const r = await safeRead(() => deps.read460(path, candidateOf(p), hint))
    if (r.ok) {
      reads460.push({ report: r.value, url: manualUrl })
      continue
    }
    if (r.reason === 'not-460') {
      const r497 = await safeRead(() =>
        deps.read497(path, candidateOf(p), hint),
      )
      if (r497.ok) reads497.push(r497.value)
      else failures.push(`${path.split('/').pop()}: ${r497.reason}`)
    } else
      failures.push(
        `${path.split('/').pop()}: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`,
      )
  }

  if (reads460.length === 0 && city.system === 'on-request') {
    run.result.byKey[p.key] = pointAt(
      city.contact?.url ?? city.clerkUrl,
      `${city.name} doesn't post campaign statements online; copies come from the City Clerk on request.${failures.length ? ` Manual PDFs not read: ${failures.join('; ')}.` : ''}`,
      true,
    )
    setStatus('on-request')
    return
  }
  if (reads460.length === 0 && wall) {
    run.result.byKey[p.key] = pointAt(listUrl, wall)
    setStatus('wall')
    return
  }

  // Which posted documents are theirs.
  if (link?.problem && !link.committee) {
    // Nothing on file is a fact to show; several possible matches is not ours to pick.
    if (/^(No|Not) /.test(link.problem)) {
      run.result.byKey[p.key] = pointAt(
        listUrl,
        `${link.problem} (checked ${ctx.today}).`,
      )
      setStatus('nothing-posted')
    } else unmatched(run, p, city.place, city.system, link.problem)
    return
  }
  const { docs, shared } = docsForPerson(p, cityPeople, listing.docs)
  if (docs.length === 0 && shared.length > 0 && reads460.length === 0) {
    unmatched(
      run,
      p,
      city.place,
      city.system,
      `Posted filings could belong to more than one candidate: ${shared
        .slice(0, 4)
        .map((d) => d.title)
        .join('; ')}`,
    )
    return
  }
  // Reports for periods before this election cycle don't count.
  const oldest = `${ctx.year - 1}-07-01`
  const current = (d: CityDoc) => !d.through || d.through >= oldest
  const f460 = docs.filter((d) => d.form === '460' && current(d)).sort(newest)
  const f497 = docs.filter((d) => d.form === '497').sort(newest)
  const committeeUrl =
    link?.url ?? docs.find((d) => d.committeeUrl)?.committeeUrl ?? listUrl

  let scanned = 0
  let fetched = 0
  for (const d of f460.filter((d) => d.fetch).slice(0, MAX_460)) {
    const path = await safeDownload(() => deps.download(city, d))
    if (!path) {
      failures.push(`${d.title}: download failed`)
      continue
    }
    fetched++
    const r = await safeRead(() => deps.read460(path, candidateOf(p), hint))
    if (r.ok)
      reads460.push({ report: r.value, url: d.committeeUrl ?? committeeUrl })
    else {
      if (r.reason === 'scanned') scanned++
      failures.push(
        `${d.title}: ${r.reason}${r.detail ? ` (${r.detail})` : ''}`,
      )
    }
  }

  const latest = latestReport(reads460.map((r) => r.report))
  if (latest) {
    const own = foldWords(latest.committee).includes(` ${lastName(p)} `)
    const tied =
      docs.some((d) => d.person === p.key) ||
      manual.length + pageReads.length > 0
    if (!own && !tied) {
      unmatched(
        run,
        p,
        city.place,
        city.system,
        `The latest Form 460 found is filed by "${latest.committee}", which doesn't name the candidate`,
      )
      return
    }
    if (latest.through < oldest) {
      run.result.byKey[p.key] = pointAt(
        committeeUrl,
        `The latest Form 460 found covers a period ending ${latest.through}, before this election cycle.${form470Note(docs, oldest)}`,
      )
      setStatus('committee-no-460', fetched)
      return
    }
    // Late contributions from 497s posted after the period ended.
    for (const d of f497
      .filter((d) => d.fetch && (!d.posted || d.posted > latest.through))
      .slice(0, MAX_497)) {
      const path = await safeDownload(() => deps.download(city, d))
      if (!path) continue
      fetched++
      const r = await safeRead(() => deps.read497(path, candidateOf(p), hint))
      if (r.ok) reads497.push(r.value)
    }
    const late = reads497
      .filter((r) => sameCommittee(r, latest))
      .flatMap((r) => r.contributions)
    const where = reads460.find((r) => r.report === latest)!
    const summary: MoneySummary = form460Summary(latest, {
      filedWith: officer,
      url: where.url,
    })
    const largeSince = lateSince(latest.through, dedupe(late))
    run.result.byKey[p.key] = {
      summaries: [largeSince ? { ...summary, largeSince } : summary],
      matchedCommittee: latest.committeeId ?? latest.committee,
      ...(link?.problem && { note: `Committee ${link.problem}.` }),
    }
    setStatus('summary', fetched)
    return
  }

  // No readable 460.
  const committee = link?.committee ?? f460[0]?.committee
  if (city.system === 'lacity-manual') {
    run.result.byKey[p.key] = pointAt(
      committeeUrl,
      `${committee ? `Committee "${committee}". ` : ''}Save the latest Form 460 and later 497s from ${committeeUrl} into data/raw/money/manual/${deps.region}/${p.key}/.${failures.length ? ` Not read: ${failures.join('; ')}.` : ''}`,
    )
    setStatus(link?.committee ? 'manual-missing' : 'nothing-posted')
    return
  }
  if (f460.length > 0) {
    const period = f460[0].through ? ` (period ending ${f460[0].through})` : ''
    const noDownload = fetched === 0 && !f460.some((d) => d.fetch)
    const why = noDownload
      ? `the city's system offers the PDF only in a browser (save it into data/raw/money/manual/${deps.region}/${p.key}/ to include it)`
      : scanned > 0
        ? 'the posted PDF is a scanned image'
        : `the PDF couldn't be read: ${failures.join('; ')}`
    run.result.byKey[p.key] = pointAt(
      committeeUrl,
      `A Form 460${period} is posted${committee ? ` for "${committee}"` : ''}, but ${why}.`,
    )
    setStatus(
      noDownload ? 'no-download' : scanned > 0 ? 'scanned' : 'pdf-unreadable',
      fetched,
    )
    return
  }
  if (docs.length > 0 || link?.committee) {
    const forms = [
      ...new Set(docs.map((d) => d.form ?? formName(d.title))),
    ].filter(Boolean)
    const entry = pointAt(
      committeeUrl,
      `Has filings with ${officer}${forms.length ? ` (Form ${forms.join(', ')})` : ''} but no Form 460 for this election cycle.${form470Note(docs, oldest)}`,
    )
    if (form470Note(docs, oldest) && entry.filingsAt)
      entry.filingsAt = { ...entry.filingsAt, underThreshold: true }
    run.result.byKey[p.key] = entry
    setStatus('committee-no-460')
    return
  }
  run.result.byKey[p.key] = pointAt(
    listUrl,
    `No filings for this candidate in ${officer}'s posted campaign statements (checked ${ctx.today}).`,
  )
  setStatus('nothing-posted')
}

/** A Form 470 this cycle means the committee expects to raise less than $2,000 and files no 460. */
function form470Note(docs: CityDoc[], oldest: string): string {
  const filed = docs.some(
    (d) => /\b470\b/.test(d.title) && (d.through ?? d.posted ?? '') >= oldest,
  )
  return filed
    ? ' Filed a Form 470 this cycle: the campaign expects to raise and spend under $2,000, so it files no Form 460.'
    : ''
}

/** "Form 501 …" → "Form 501", for notes. */
const formName = (title: string) => title.match(/\b(4\d\d|50\d)\b/)?.[0] ?? ''

/** A 497 belongs with the 460 when the committee ID matches, or the name does when either has no ID. */
function sameCommittee(r: Read497, report: Form460): boolean {
  if (r.committeeId && report.committeeId)
    return r.committeeId === report.committeeId
  return foldWords(r.committee) === foldWords(report.committee)
}

/** The same contribution reported twice (an amended 497) counts once. */
function dedupe(late: LateContribution[]): LateContribution[] {
  const seen = new Set<string>()
  return late.filter((c) => {
    const k = `${c.date}|${c.amount}|${c.code}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function safeRead<T>(
  read: () => Promise<PdfRead<T>>,
): Promise<PdfRead<T>> {
  try {
    return await read()
  } catch (e) {
    return { ok: false, reason: 'unreadable', detail: (e as Error).message }
  }
}

async function safeDownload(
  download: () => Promise<string>,
): Promise<string | null> {
  try {
    return await download()
  } catch (e) {
    console.warn(`${(e as Error).message}`)
    return null
  }
}
