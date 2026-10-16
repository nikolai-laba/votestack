// Campaign statements that Los Angeles County cities post themselves, for
// the cities that don't file through NetFile. Each city's entry in
// content/money/<region>/city-filings.json names its system and where its
// filings are; this module lists the documents there, works out which
// candidate and form each one is, and downloads the Form 460 and 497 PDFs.
//
// Systems:
//   civicplus     CivicPlus Document Center folders, read through the JSON
//                 the public folder page loads.
//   laserfiche    Laserfiche WebLink and the hosted Laserfiche portal, read
//                 through the folder listing service the browse page uses;
//                 scanned documents come out through the viewer's own
//                 "download PDF" route.
//   burbank-efile Burbank's eFile portal: its public API lists the
//                 candidates on each election with their committees, and
//                 each committee's filings.
//   southtech     SouthTech CampaignDocs (ASP.NET forms): lists each
//                 committee's filings; the PDF viewer needs a browser, so
//                 these documents have no download.
//   webpage       City pages that link the PDFs; the nearest heading or tab
//                 name says whose they are, unless the config ties a page to
//                 one candidate.
//   lacity-manual The City of Los Angeles: committees and statement links
//                 from the Ethics Commission's open data (data.lacity.org);
//                 its own site disallows automated access, so the PDFs are
//                 downloaded by hand (see the manual folder in
//                 money-cities-module.ts).
//   on-request    Cities that post nothing; copies come from the clerk.
//
// Every request is a plain public GET or the same POST the city's own page
// makes, one at a time with a pause, under a descriptive User-Agent. A 403,
// 429 or bot check stops that city with a WallError; nothing tries to get
// past it. Raw downloads are cached under data/raw/money/cities/<place>/.

import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import https from 'node:https'
import { dirname, join } from 'node:path'
import tls from 'node:tls'
import type { IsoDate } from '../../../src/shared/ballot.ts'
import { RAW, ROOT } from '../data.ts'
import type { MoneyPerson } from './money-ca.ts'
import { namesMatch, splitCommaName } from './names.ts'

export type CitySystem =
  | 'civicplus'
  | 'laserfiche'
  | 'southtech'
  | 'burbank-efile'
  | 'webpage'
  | 'lacity-manual'
  | 'on-request'

/** One city's entry in city-filings.json. */
export interface CityFilings {
  /** The place slug in OCD-IDs (`place:<slug>`). */
  place: string
  name: string
  system: CitySystem
  /** The official pages that list the filings. */
  filingsUrls: string[]
  clerkUrl: string
  /** Who candidates file with, as a voter would say it; defaults to `name`. */
  filingOfficer?: string
  /** For on-request cities: how to ask the clerk. */
  contact?: { url: string; email?: string; phone?: string }
  /** False when the URLs come from the FPPC's list because the city's site refuses automated requests. */
  verified?: boolean
  /** Why the filings can't be read automatically. */
  wall?: string
  notes?: string
  civicplus?: { host: string; folders: number[] }
  laserfiche?: { base: string; repo: string; folders: number[] }
  southtech?: { base: string }
  burbank?: { api: string; site: string; electionDate: string }
  webpage?: { pages: { url: string; person?: string }[] }
  lacity?: { statements: string; electionDate: string }
}

export const cityFilingsPath = (region: string) =>
  join(ROOT, 'content', 'money', region, 'city-filings.json')

export function loadCityFilings(path: string): CityFilings[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as { cities: CityFilings[] })
    .cities
}

export const officerOf = (city: CityFilings) => city.filingOfficer ?? city.name

/** The place slug in an OCD-ID, or null. */
export const placeOf = (districtId: string): string | null =>
  districtId.match(/\/place:([a-z0-9_~-]+)/)?.[1] ?? null

export type FormKind = '460' | '497'

/** How to download a document's PDF. */
export type DocFetch =
  | { kind: 'url'; url: string }
  | {
      kind: 'laserfiche'
      base: string
      repo: string
      id: number
      edoc: boolean
    }
  | { kind: 'burbank'; api: string; docId: string }

/** One posted document. */
export interface CityDoc {
  /** Unique within the city; also the cached PDF's file name. */
  id: string
  /** Its name or link text (plus the link's file name, for web pages). */
  title: string
  /** Where it sits: folder path, heading or tab name. */
  context: string
  form: FormKind | null
  /** The official page for the document. */
  viewUrl: string
  /** The official page for the committee's filings, when the system has one. */
  committeeUrl?: string
  /** When it was posted or filed. */
  posted?: IsoDate
  /** The period end, when the listing gives it. */
  through?: IsoDate
  /** The committee, when the listing gives it. */
  committee?: string
  /** Set when the source itself ties the document to one person. */
  person?: string
  /** Absent when the system offers no download. */
  fetch?: DocFetch
}

/** What a listing says about one person, for systems that match people themselves. */
export interface PersonLink {
  committee?: string
  url?: string
  /** Why the person couldn't be matched (not listed, or several matches). */
  problem?: string
}

export interface CityListing {
  docs: CityDoc[]
  links: Record<string, PersonLink>
}

/** A city's site refused or challenged an automated request. */
export class WallError extends Error {}

// ---------------------------------------------------------------- requests

const USER_AGENT = 'VoteStack data import (votestack.org)'
const PAUSE_MS = 300
let lastRequest = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * How to reach hosts that Node's fetch can't: one that sends a header line
 * starting with a space (old IIS), or one that leaves the intermediate
 * certificate out of its chain. Browsers and curl cope with both; here the
 * first gets Node's lenient header parser, and the second gets the missing
 * intermediate from the address in the site's own certificate (AIA), the
 * way browsers fetch it, so the connection is still fully verified.
 */
const hostModes = new Map<string, { lenient?: boolean; ca?: string[] }>()

type Init = { method?: string; body?: string }

async function send(
  url: string,
  init: Init,
  headers: Record<string, string>,
): Promise<Response> {
  const host = new URL(url).hostname
  const mode = hostModes.get(host)
  if (mode) return nodeRequest(url, init, headers, mode)
  try {
    return await fetch(url, { ...init, headers, redirect: 'manual' })
  } catch (e) {
    const cause = (e as { cause?: { code?: string; name?: string } }).cause
    if (cause?.name === 'HTTPParserError') {
      hostModes.set(host, { lenient: true })
      return send(url, init, headers)
    }
    if (cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      hostModes.set(host, { ca: await withIntermediate(host) })
      return send(url, init, headers)
    }
    // One retry after a pause for network errors (DNS hiccups), never for HTTP answers.
    await sleep(3000)
    return fetch(url, { ...init, headers, redirect: 'manual' })
  }
}

/** The root certificates plus the issuer named in the host's own certificate. */
async function withIntermediate(host: string): Promise<string[]> {
  // Only reads the certificate the server presents; no request is sent.
  const leaf = await new Promise<tls.PeerCertificate>((resolve, reject) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: false },
      () => {
        resolve(socket.getPeerCertificate())
        socket.end()
      },
    )
    socket.on('error', reject)
  })
  const issuer = leaf.infoAccess?.['CA Issuers - URI']?.[0]
  if (!issuer) throw new Error(`${host}: incomplete certificate chain`)
  const der = new Uint8Array(await (await fetch(issuer)).arrayBuffer())
  return [...tls.rootCertificates, new X509Certificate(der).toString()]
}

function nodeRequest(
  url: string,
  init: Init,
  headers: Record<string, string>,
  mode: { lenient?: boolean; ca?: string[] },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: init.method ?? 'GET',
        headers: {
          ...headers,
          ...(init.body && { 'Content-Length': Buffer.byteLength(init.body) }),
        },
        ...(mode.lenient && { insecureHTTPParser: true }),
        ...(mode.ca && { ca: mode.ca }),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          const h = new Headers()
          for (const [k, v] of Object.entries(res.headers))
            for (const x of [v].flat()) if (x !== undefined) h.append(k, x)
          const status = res.statusCode ?? 500
          const empty =
            status === 204 || status === 304 || (status >= 300 && status < 400)
          resolve(
            new Response(empty ? null : Buffer.concat(chunks), {
              status,
              headers: h,
            }),
          )
        })
      },
    )
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  })
}

/** Polite HTTP with a cookie jar, for one city at a time. */
export class Session {
  private cookies = new Map<string, string>()

  async request(
    url: string,
    init: {
      method?: string
      body?: string
      headers?: Record<string, string>
    } = {},
    hops = 0,
  ): Promise<Response> {
    const wait = lastRequest + PAUSE_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...init.headers,
    }
    if (this.cookies.size)
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await send(url, init, headers)
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0]
      const i = kv.indexOf('=')
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1))
    }
    // Old IIS servers fold the next header into Location; the URL ends at the first space.
    const location = res.headers.get('location')?.trim().split(/\s+/)[0]
    if (res.status >= 300 && res.status < 400 && location) {
      if (hops > 5) throw new Error(`Too many redirects from ${url}`)
      await res.body?.cancel()
      return this.request(new URL(location, url).href, {}, hops + 1)
    }
    if (
      res.status === 403 ||
      res.status === 429 ||
      res.headers.has('cf-mitigated')
    ) {
      await res.body?.cancel()
      throw new WallError(`${res.status} from ${new URL(url).host}`)
    }
    return res
  }

  async text(url: string, init?: Parameters<Session['request']>[1]) {
    const res = await this.request(url, init)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    return res.text()
  }

  async json<T>(url: string, init?: Parameters<Session['request']>[1]) {
    return JSON.parse(await this.text(url, init)) as T
  }

  postJson<T>(url: string, body: unknown) {
    return this.json<T>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  async bytes(url: string): Promise<Uint8Array> {
    const res = await this.request(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

// ----------------------------------------------------------------- parsing

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Lowercase words separated by single spaces, with a space at each end. */
const spaced = (s: string) =>
  ` ${fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))

const textOf = (html: string) =>
  decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** "Sep 28, 2026", "9/22/2026 5:25:59 PM" or "09/24/2026" → "2026-09-28". */
export function isoDate(s: string | null | undefined): IsoDate | undefined {
  if (!s) return undefined
  const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')
  let m = s.match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/)
  if (m) {
    const mo = months.indexOf(m[1].toLowerCase()) + 1
    if (mo > 0) return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
}
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Which form a document is, from its name: a 460 (pre-election, semi-annual
 * or other recipient committee statement) or a 497 (24-hour contribution
 * report). Null for anything else (410, 470, 501, 700, 496…).
 */
export function formOf(text: string): FormKind | null {
  const t = ` ${fold(text).replace(/[_]+/g, ' ')} `
  const numbers = [...t.matchAll(/(?<![0-9])(4\d\d|50\d|700|806)(?![0-9])/g)]
    .map((m) => m[1])
    // A 460's period ("07-01-2026 - 9-19-2026") has no three-digit numbers,
    // but file names sometimes carry other ids; only form numbers count.
    .filter((n) => /^(4[0-9]{2}|50[0-9]|700|806)$/.test(n))
  if (numbers.includes('497')) return '497'
  if (numbers.includes('460')) return '460'
  if (numbers.length > 0) return null
  if (/24.?hour|contribution report|late contribution/.test(t)) return '497'
  if (
    /pre.?election|semi.?annual|recipient committee campaign statement|campaign statement|quarterly statement/.test(
      t,
    )
  )
    return '460'
  return null
}

/** Committees other than the candidate's own: PACs, independent expenditures, recalls. */
const THIRD_PARTY =
  / (pac|supporting|support of|opposing|oppose|opposition|recall|independent expenditure|sponsored by|association|union|chamber|measure|yes on|no on) /

/** True when a folder name only carries years before the election cycle. */
export function isOldFolder(name: string, year: number): boolean {
  const years = [...name.matchAll(/(?<!\d)(19|20)\d\d(?!\d)/g)].map((m) =>
    Number(m[0]),
  )
  return years.length > 0 && Math.max(...years) < year - 1
}

/** True when the haystack names the person's last name (a word, or compound run together). */
function surnameIn(hay: string, p: MoneyPerson): boolean {
  const w = p.ballot.words
  const last = w.at(-1)
  if (!last) return false
  if (hay.includes(` ${last} `)) return true
  const compact = hay.replace(/ /g, '')
  for (const n of [2, 3]) {
    if (w.length <= n) break
    const joined = w.slice(-n).join('')
    if (joined.length >= 6 && compact.includes(joined)) return true
  }
  return false
}

const givenIn = (hay: string, p: MoneyPerson) =>
  p.ballot.given.some((g) => g.length >= 2 && hay.includes(` ${g} `))

/**
 * The documents that are this person's, from a city's listing: those the
 * source tied to them, and those whose name or folder carries their last
 * name. When another candidate in the city has the same last name, the
 * given name must appear too. Third-party committees' documents never
 * count. `shared` lists documents that would fit more than one person.
 */
export function docsForPerson(
  p: MoneyPerson,
  cityPeople: MoneyPerson[],
  docs: CityDoc[],
): { docs: CityDoc[]; shared: CityDoc[] } {
  const mine: CityDoc[] = []
  const shared: CityDoc[] = []
  const others = cityPeople.filter((o) => o.key !== p.key)
  for (const d of docs) {
    if (d.person) {
      if (d.person === p.key) mine.push(d)
      continue
    }
    const hay = spaced(`${d.context} ${d.title} ${d.committee ?? ''}`)
    if (THIRD_PARTY.test(hay) || !surnameIn(hay, p)) continue
    const rivals = others.filter((o) => surnameIn(hay, o))
    if (rivals.length === 0) {
      mine.push(d)
      continue
    }
    const fits = givenIn(hay, p)
    const rivalFits = rivals.filter((o) => givenIn(hay, o))
    if (fits && rivalFits.length === 0) mine.push(d)
    else if (fits || rivalFits.length === 0) shared.push(d)
  }
  return { docs: mine, shared }
}

// ------------------------------------------------------------------ caches

const cityDir = (place: string) => join(RAW, 'money', 'cities', place)

async function fresh(path: string, maxAgeHours: number): Promise<boolean> {
  const s = await stat(path).catch(() => null)
  return !!s && Date.now() - s.mtimeMs < maxAgeHours * 3_600_000
}

async function writeAtomic(path: string, data: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.partial`, data)
  await rename(`${path}.partial`, path)
}

/**
 * A city's documents and person links, cached as listing.json for
 * maxAgeHours (and refetched when the set of people changes).
 */
export async function listCityDocs(
  city: CityFilings,
  people: MoneyPerson[],
  options: { maxAgeHours: number; year: number },
): Promise<CityListing> {
  const path = join(cityDir(city.place), 'listing.json')
  const keys = people.map((p) => p.key).sort()
  if (await fresh(path, options.maxAgeHours)) {
    const cached = JSON.parse(await readFile(path, 'utf8')) as CityListing & {
      keys: string[]
    }
    if (cached.keys.join() === keys.join())
      return { docs: cached.docs, links: cached.links }
  }
  const session = new Session()
  const listing = await LISTERS[city.system](session, city, people, options)
  await writeAtomic(path, JSON.stringify({ keys, ...listing }))
  return listing
}

type Lister = (
  s: Session,
  city: CityFilings,
  people: MoneyPerson[],
  options: { year: number },
) => Promise<CityListing>

const none: Lister = async () => ({ docs: [], links: {} })

const LISTERS: Record<CitySystem, Lister> = {
  civicplus: (s, c, _p, o) => listCivicPlus(s, c, o.year),
  laserfiche: (s, c, _p, o) => listLaserfiche(s, c, o.year),
  webpage: (s, c) => listWebpages(s, c),
  'burbank-efile': (s, c, p) => listBurbank(s, c, p),
  southtech: (s, c, p, o) => listSouthTech(s, c, p, o.year),
  'lacity-manual': (s, c, p) => listLaCity(s, c, p),
  'on-request': none,
}

/** Downloads a document's PDF (once; documents don't change) and returns its path. */
export async function downloadDoc(
  city: CityFilings,
  doc: CityDoc,
): Promise<string> {
  if (!doc.fetch) throw new Error(`${doc.id} has no download`)
  const path = join(
    cityDir(city.place),
    `${doc.id.replace(/[^\w.-]/g, '_')}.pdf`,
  )
  if (await fresh(path, Infinity)) return path
  const s = new Session()
  const f = doc.fetch
  let bytes: Uint8Array
  if (f.kind === 'url') bytes = await s.bytes(f.url)
  else if (f.kind === 'burbank') {
    const { data } = await s.json<{ data: { url: string } }>(
      `${f.api}/public/document?doc_id=${encodeURIComponent(f.docId)}`,
    )
    bytes = await s.bytes(data.url)
  } else bytes = await laserfichePdf(s, f)
  if (!isPdf(bytes)) throw new Error(`${doc.id}: the download isn't a PDF`)
  console.log(`Downloaded ${city.place} ${doc.id}: ${doc.title.slice(0, 80)}`)
  await writeAtomic(path, bytes)
  return path
}

export const isPdf = (b: Uint8Array) =>
  b.length > 4 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-'

// --------------------------------------------------------------- CivicPlus

interface CpFolder {
  Text: string
  Value: string
}
interface CpDocument {
  ID: number
  DisplayName: string
  URL: string
  LastModifiedDateString?: string
}

async function listCivicPlus(
  s: Session,
  city: CityFilings,
  year: number,
): Promise<CityListing> {
  const cp = city.civicplus!
  const origin = `https://${cp.host}`
  const docs: CityDoc[] = []
  const walk = async (id: number, path: string[], depth: number) => {
    const { Documents } = await s.postJson<{ Documents: CpDocument[] }>(
      `${origin}/Admin/DocumentCenter/Home/Document_AjaxBinding?renderMode=0&loadSource=7`,
      {
        folderId: id,
        getDocuments: 1,
        imageRepo: false,
        renderMode: 0,
        loadSource: 7,
        requestingModuleID: 75,
        searchString: '',
        pageNumber: 1,
        rowsPerPage: 1000,
        sortColumn: 'DisplayName',
        sortOrder: 0,
      },
    )
    docs.push(...civicPlusDocs(origin, Documents, path))
    if (depth >= 4) return
    const { Data } = await s.postJson<{ Data: CpFolder[] }>(
      `${origin}/admin/DocumentCenter/Home/_AjaxLoadingReact?type=0`,
      { value: String(id), expandTree: false, loadSource: 7 },
    )
    for (const f of Data ?? [])
      if (!isOldFolder(f.Text, year))
        await walk(Number(f.Value), [...path, f.Text], depth + 1)
  }
  for (const id of cp.folders) await walk(id, [], 1)
  return { docs, links: {} }
}

export function civicPlusDocs(
  origin: string,
  documents: CpDocument[],
  path: string[],
): CityDoc[] {
  return documents.map((d) => ({
    id: `cp-${d.ID}`,
    title: d.DisplayName,
    context: path.join(' / '),
    form: formOf(d.DisplayName),
    viewUrl: new URL(d.URL, origin).href,
    posted: isoDate(d.LastModifiedDateString),
    fetch: { kind: 'url', url: new URL(d.URL, origin).href },
  }))
}

// -------------------------------------------------------------- Laserfiche

interface LfEntry {
  entryId: number
  name: string
  type: number
  isEdoc: boolean
  data: unknown[]
}
interface LfListing {
  name: string
  totalEntries: number
  colTypes: { name: string }[]
  results: (LfEntry | null)[]
}

async function listLaserfiche(
  s: Session,
  city: CityFilings,
  year: number,
): Promise<CityListing> {
  const lf = city.laserfiche!
  // The browse page sets the session cookie some servers check.
  await s.request(
    `${lf.base}/Browse.aspx?id=${lf.folders[0]}&dbid=0&repo=${lf.repo}`,
  )
  const docs: CityDoc[] = []
  const walk = async (id: number, path: string[], depth: number) => {
    const entries: LfEntry[] = []
    let cols: string[] = []
    for (let start = 0; ; start += 500) {
      const { data } = await s.postJson<{ data: LfListing | null }>(
        `${lf.base}/FolderListingService.aspx/GetFolderListing2`,
        {
          repoName: lf.repo,
          folderId: id,
          getNewListing: true,
          start,
          end: start + 500,
          sortColumn: '',
          sortAscending: true,
        },
      )
      if (!data) return
      cols = data.colTypes.map((c) => c.name)
      entries.push(...data.results.filter((e): e is LfEntry => !!e))
      if (start + 500 >= data.totalEntries) break
    }
    const folderUrl = `${lf.base}/Browse.aspx?id=${id}&dbid=0&repo=${lf.repo}`
    docs.push(...laserficheDocs(lf, entries, cols, path, folderUrl))
    if (depth >= 4) return
    for (const e of entries)
      if (
        e.type === 0 &&
        !isOldFolder(e.name, year) &&
        !THIRD_PARTY.test(spaced(e.name))
      )
        await walk(e.entryId, [...path, e.name], depth + 1)
  }
  for (const id of lf.folders) await walk(id, [], 1)
  return { docs, links: {} }
}

/** Documents (entry type -2) in one Laserfiche folder listing. */
export function laserficheDocs(
  lf: { base: string; repo: string },
  entries: LfEntry[],
  cols: string[],
  path: string[],
  folderUrl: string,
): CityDoc[] {
  const created = cols.indexOf('CreationDate')
  return entries
    .filter((e) => e.type === -2)
    .map((e) => ({
      id: `lf-${e.entryId}`,
      title: e.name,
      context: path.join(' / '),
      form: formOf(`${path.at(-1) ?? ''} ${e.name}`),
      viewUrl: `${lf.base}/DocView.aspx?id=${e.entryId}&dbid=0&repo=${lf.repo}`,
      // A folder named for the candidate is their committee's page.
      ...(path.length > 0 && { committeeUrl: folderUrl }),
      posted: created >= 0 ? isoDate(String(e.data[created] ?? '')) : undefined,
      fetch: {
        kind: 'laserfiche',
        base: lf.base,
        repo: lf.repo,
        id: e.entryId,
        edoc: e.isEdoc,
      },
    }))
}

/**
 * A Laserfiche document as PDF: an electronic file as uploaded, or a
 * scanned one through the viewer's PDF route (generate, poll, download).
 */
async function laserfichePdf(
  s: Session,
  f: Extract<DocFetch, { kind: 'laserfiche' }>,
): Promise<Uint8Array> {
  const q = `dbid=0&repo=${encodeURIComponent(f.repo)}`
  await s.request(`${f.base}/DocView.aspx?id=${f.id}&${q}`)
  if (f.edoc) {
    const b = await s.bytes(`${f.base}/ElectronicFile.aspx?docid=${f.id}&${q}`)
    if (isPdf(b)) return b
  }
  const started = await s.text(
    `${f.base}/GeneratePDF10.aspx?key=${f.id}&PageRange=&Watermark=0&repo=${encodeURIComponent(f.repo)}`,
    {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  )
  const key = started.split('\n')[0].trim()
  if (!/^[\w-]{8,}$/.test(key))
    throw new Error(`Laserfiche ${f.id}: no PDF key`)
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const { data } = await s.postJson<{
      data: { finished: boolean; success: boolean; errMsg: string | null }
    }>(`${f.base}/DocumentService.aspx/PDFTransition`, { Key: key })
    if (data.finished) {
      if (!data.success) throw new Error(`Laserfiche ${f.id}: ${data.errMsg}`)
      return s.bytes(`${f.base}/PDF10/${key}/${f.id}`)
    }
  }
  throw new Error(`Laserfiche ${f.id}: PDF not ready after a minute`)
}

// ---------------------------------------------------------------- web pages

async function listWebpages(
  s: Session,
  city: CityFilings,
): Promise<CityListing> {
  const docs: CityDoc[] = []
  for (const page of city.webpage?.pages ?? []) {
    const html = await s.text(page.url)
    for (const d of pageDocs(html, page.url))
      docs.push({
        ...d,
        ...(page.person && { person: page.person, committeeUrl: page.url }),
      })
  }
  // A document linked from two pages counts once.
  return { docs: [...new Map(docs.map((d) => [d.id, d])).values()], links: {} }
}

/**
 * PDF links on a page, each with the nearest heading, tab name or bold
 * line before it as context (that's where city pages name the candidate).
 * Tabbed widgets list every tab name before the panels, so a panel takes
 * the name of the tab button that points at it.
 */
export function pageDocs(html: string, pageUrl: string): CityDoc[] {
  const docs: CityDoc[] = []
  const tabNames = new Map<string, string>()
  for (const m of html.matchAll(
    /<a\b[^>]*href="#([\w-]+)"[^>]*>[\s\S]*?data-tabname="([^"]*)"[\s\S]*?<\/a>/gi,
  ))
    tabNames.set(m[1], decode(m[2]))
  let context = ''
  const re =
    /<(h[1-6]|strong|b|dt|summary)\b[^>]*>([\s\S]*?)<\/\1>|<div\b[^>]*\bid="([\w-]+)"|<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const t = textOf(m[2])
      if (t && !/<a\b/i.test(m[2])) context = t
      continue
    }
    if (m[3] !== undefined) {
      const tab = tabNames.get(m[3])
      if (tab) context = tab
      continue
    }
    const href = m[4].match(/href\s*=\s*"([^"]+)"/i)?.[1]
    if (!href) continue
    let url: URL
    try {
      url = new URL(decode(href), pageUrl)
    } catch {
      continue
    }
    const cp = url.pathname.match(/\/DocumentCenter\/View\/(\d+)/i)
    if (!cp && !/\.pdf$/i.test(url.pathname)) continue
    const slug = decodeURIComponent(url.pathname.split('/').pop() ?? '')
      .replace(/[-_]+/g, ' ')
      .replace(/pdf$/i, '')
    const title = `${textOf(m[5])} ${cp ? slug : ''}`.trim()
    docs.push({
      id: cp ? `cp-${cp[1]}` : `pdf-${hash(url.href)}`,
      title,
      context,
      form: formOf(title),
      viewUrl: url.href,
      fetch: { kind: 'url', url: url.href },
    })
  }
  return docs
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ------------------------------------------------------------ Burbank eFile

interface BurbankCandidate {
  filer_id: string
  first_name: string
  last_name: string
  office: string
  candidate_name: string
}
interface BurbankFiling {
  entity_id: string
  name: string
  doc_public: string | null
  period_start: string | null
  period_end: string | null
  filing_type: string
  filing_date: string
  form_name: string
}

/** Our office and an official office name agree (council, mayor, clerk, treasurer, attorney). */
export function sameOffice(ours: string, theirs: string): boolean {
  const kind = (s: string) =>
    /clerk/i.test(s)
      ? 'clerk'
      : /treasurer/i.test(s)
        ? 'treasurer'
        : /attorney/i.test(s)
          ? 'attorney'
          : /mayor/i.test(s)
            ? 'mayor'
            : /council/i.test(s)
              ? 'council'
              : s
  return kind(ours) === kind(theirs)
}

/**
 * The official candidate who is this person: same office, and the name
 * matches, or failing that theirs is the only candidate for the office with
 * this last name (ballot names often use a nickname: "Nikki" for "Nicole").
 */
export function matchCandidate<T>(
  p: MoneyPerson,
  candidates: T[],
  name: (c: T) => { last: string; first: string; office: string },
): { match?: T; problem?: string; bySurname?: boolean } {
  const office = candidates.filter((c) => sameOffice(p.office, name(c).office))
  const byName = office.filter((c) =>
    namesMatch(p.ballot, name(c).last, name(c).first),
  )
  if (byName.length === 1) return { match: byName[0] }
  if (byName.length > 1)
    return { problem: `${byName.length} candidates on the city's list match` }
  const last = p.ballot.words.at(-1) ?? ''
  const sameLast = office.filter(
    (c) => spaced(name(c).last).trim().split(' ').at(-1) === last,
  )
  if (sameLast.length === 1) return { match: sameLast[0], bySurname: true }
  return { problem: "Not on the city's candidate list for this office" }
}

async function listBurbank(
  s: Session,
  city: CityFilings,
  people: MoneyPerson[],
): Promise<CityListing> {
  const b = city.burbank!
  const { data: elections } = await s.json<{
    data: { election_date: string; election_id: string }[]
  }>(`${b.api}/public/campaign-search/election/list`)
  const election = elections.find((e) => e.election_date === b.electionDate)
  if (!election) throw new Error(`Burbank: no election on ${b.electionDate}`)
  const { data: byOffice } = await s.json<{
    data: Record<string, BurbankCandidate[]>
  }>(`${b.api}/public/campaign-search/candidate/list/${election.election_id}`)
  const candidates = Object.values(byOffice).flat()
  const docs: CityDoc[] = []
  const links: Record<string, PersonLink> = {}
  for (const p of people) {
    const m = matchCandidate(p, candidates, (c) => ({
      last: c.last_name,
      first: c.first_name,
      office: c.office,
    }))
    if (!m.match) {
      links[p.key] = { problem: m.problem }
      continue
    }
    const { data: filings } = await s.json<{ data: BurbankFiling[] }>(
      `${b.api}/public/campaign-search/candidate/filing/list/${m.match.filer_id}`,
    )
    const entity = filings[0]?.entity_id
    const url = entity
      ? `${b.site}/public/search/campaign/filings/${entity}?type=committee`
      : city.filingsUrls[0]
    links[p.key] = {
      committee: filings[0]?.name,
      url,
      ...(m.bySurname && {
        problem: `matched by last name to ${m.match.candidate_name} on the city's candidate list`,
      }),
    }
    docs.push(...burbankDocs(b, p.key, filings, url))
  }
  return { docs, links }
}

export function burbankDocs(
  b: { api: string; site: string },
  person: string,
  filings: BurbankFiling[],
  committeeUrl: string,
): CityDoc[] {
  return filings.map((f) => ({
    id: `bur-${f.doc_public ?? hash(JSON.stringify(f))}`,
    title: `${f.filing_type} ${f.name}`,
    context: f.name,
    form: /fppc460/.test(f.form_name)
      ? '460'
      : /fppc497/.test(f.form_name)
        ? '497'
        : null,
    viewUrl: committeeUrl,
    committeeUrl,
    committee: f.name,
    posted: isoDate(f.filing_date),
    through: isoDate(f.period_end),
    person,
    ...(f.doc_public && {
      fetch: { kind: 'burbank', api: b.api, docId: f.doc_public } as const,
    }),
  }))
}

// --------------------------------------------------------------- SouthTech

const hiddenFields = (html: string) =>
  Object.fromEntries(
    [
      ...html.matchAll(
        /<input type="hidden" name="([^"]+)" id="[^"]+" value="([^"]*)"/g,
      ),
    ].map((m) => [m[1], decode(m[2])]),
  )

/** A DevExpress grid's data rows, as cell texts. */
export function gridRows(html: string, grid: string): string[][] {
  return [
    ...html.matchAll(
      new RegExp(
        `<tr[^>]*id="${grid}_DXDataRow\\d+"[^>]*>([\\s\\S]*?)</tr>`,
        'g',
      ),
    ),
  ].map((r) =>
    [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1])),
  )
}

/** "7/1/2026 - 9/19/2026" → its end date. */
const periodEnd = (s: string) => isoDate(s.split(/\s+-\s+/)[1] ?? '')

async function listSouthTech(
  s: Session,
  city: CityFilings,
  people: MoneyPerson[],
  year: number,
): Promise<CityListing> {
  const base = city.southtech!.base
  const search = `${base}/Search/SearchByCandidateName.aspx`
  const form = (fields: Record<string, string>) => ({
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const docs: CityDoc[] = []
  const links: Record<string, PersonLink> = {}
  for (const p of people) {
    const page = await s.text(search)
    const yearId = yearOption(page, year)
    const last = p.ballot.words.at(-1) ?? ''
    const results = await s.text(
      search,
      form({
        ...hiddenFields(page),
        ctl00$DefaultContent$ASPxRoundPanel1$txtFilerName: last,
        ctl00$DefaultContent$ASPxRoundPanel1$chbAllowPartialMatch: 'C',
        ctl00$DefaultContent$ASPxRoundPanel1$btnFindFilers: 'Search',
        ...(yearId && {
          ctl00$DefaultContent$ASPxRoundPanel1$ASPxDDL_Years: String(year),
          ctl00_DefaultContent_ASPxRoundPanel1_ASPxDDL_Years_VI: yearId,
        }),
      }),
    )
    const rows = gridRows(results, 'ctl00_GridContent_gridFilers')
    const named = rows
      .map((cells, index) => ({ cells, index }))
      .filter(({ cells }) =>
        namesMatch(p.ballot, cells[1] ?? '', cells[2] ?? ''),
      )
    const current = named.filter(({ cells }) => cells[0].includes(String(year)))
    // A filer named for the person alone (no committee year) is theirs when it's the only match.
    const pick =
      current.length === 1
        ? current[0]
        : current.length === 0 && named.length === 1
          ? named[0]
          : null
    if (!pick) {
      links[p.key] = {
        problem:
          current.length > 1
            ? `${current.length} ${year} committees match: ${current.map((r) => r.cells[0]).join('; ')}`
            : named.length
              ? `No ${year} committee among: ${named.map((r) => r.cells[0]).join('; ')}`
              : 'No committee under this name in CampaignDocs',
      }
      continue
    }
    const args = ['CUSTOMBUTTON', 'CustomBtnID', String(pick.index)]
    const filer = await s.text(
      search,
      form({
        ...hiddenFields(results),
        __EVENTTARGET: 'ctl00$GridContent$gridFilers',
        __EVENTARGUMENT: args.map((a) => `${a.length}|${a}`).join(''),
      }),
    )
    const committee = pick.cells[0]
    if (!textOf(filer).includes(committee))
      throw new Error(
        `SouthTech: opened the wrong filer for ${p.key} (${textOf(filer).match(/Filer: .{0,80}/)?.[0] ?? textOf(filer).slice(0, 200)})`,
      )
    links[p.key] = { committee, url: city.filingsUrls[0] }
    docs.push(...southTechDocs(filer, p.key, committee, city.filingsUrls[0]))
  }
  return { docs, links }
}

/**
 * The value of the year filter's option for `year`. The values are ids in
 * no fixed order, so it's found by the option's position in the list.
 */
export function yearOption(page: string, year: number): string | undefined {
  const values = (page.match(/'itemsValue':\[([^\]]*)\]/)?.[1] ?? '')
    .split(',')
    .map((v) => v.replace(/'/g, '').trim())
  const list = page.slice(page.indexOf('ASPxDDL_Years_DDD_L_LBT'))
  const texts = [
    ...list.slice(0, 20_000).matchAll(/<td[^>]*>([^<]*)<\/td>/g),
  ].map((m) => m[1].trim())
  const i = texts.indexOf(String(year))
  return i >= 0 && texts.length === values.length ? values[i] : undefined
}

export function southTechDocs(
  html: string,
  person: string,
  committee: string,
  url: string,
): CityDoc[] {
  return gridRows(html, 'ctl00_DefaultContent_gridFilingForms').map(
    ([type, description, filed, period], i) => ({
      id: `st-${hash(`${committee}|${type}|${filed}|${period}|${i}`)}`,
      title: `${type} ${description}`,
      context: committee,
      form: formOf(`Form ${type}`),
      viewUrl: url,
      committeeUrl: url,
      committee,
      posted: isoDate(filed),
      through: periodEnd(period ?? ''),
      person,
    }),
  )
}

// ---------------------------------------------------- City of Los Angeles

interface LaStatement {
  cand_name?: string
  cmt_id: string
  cmt_name: string
  filing_type_desc: string
  period_from_date?: string
  period_to_date?: string
  stmt_link?: { url: string }
  primary_general_flg?: string
}

async function listLaCity(
  s: Session,
  city: CityFilings,
  people: MoneyPerson[],
): Promise<CityListing> {
  const la = city.lacity!
  const where = `election_date='${la.electionDate}T00:00:00.000' AND cmt_type_desc='Candidate'`
  const rows = await s.json<LaStatement[]>(
    `${la.statements}?$where=${encodeURIComponent(where)}&$limit=5000`,
  )
  return laCityListing(rows, people)
}

/**
 * Each LA City candidate's general-election committee and its statements.
 * Candidates open a separate committee for the general election, so only
 * committees flagged G count; two such committees for one person is a
 * problem, not a pick.
 */
export function laCityListing(
  rows: LaStatement[],
  people: MoneyPerson[],
): CityListing {
  const docs: CityDoc[] = []
  const links: Record<string, PersonLink> = {}
  for (const p of people) {
    const mine = rows.filter((r) => {
      if (r.primary_general_flg !== 'G' || !r.cand_name) return false
      const { last, first } = splitCommaName(r.cand_name)
      return namesMatch(p.ballot, last, first)
    })
    const committees = [...new Set(mine.map((r) => r.cmt_id))]
    if (committees.length !== 1) {
      links[p.key] = {
        problem: committees.length
          ? `Several general-election committees: ${committees.join(', ')}`
          : 'No general-election committee in the Ethics Commission data',
      }
      continue
    }
    const latest = [...mine].sort((a, b) =>
      (b.period_to_date ?? '').localeCompare(a.period_to_date ?? ''),
    )[0]
    const url = latest.stmt_link?.url ?? 'https://ethics.lacity.gov/campaigns/'
    links[p.key] = { committee: latest.cmt_name, url }
    for (const r of mine)
      docs.push({
        id: `la-${r.stmt_link?.url.match(/(\d+)$/)?.[1] ?? hash(JSON.stringify(r))}`,
        title: `${r.filing_type_desc} ${r.cmt_name}`,
        context: r.cmt_name,
        form: '460',
        viewUrl: r.stmt_link?.url ?? url,
        committeeUrl: url,
        committee: r.cmt_name,
        through: isoDate(r.period_to_date),
        person: p.key,
      })
  }
  return { docs, links }
}
