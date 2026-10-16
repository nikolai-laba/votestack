// Builds Los Angeles County's lookup data for one election from the
// Registrar's own data:
// - precinct shapes from the Registrar's precinct map
//   (data/raw/la/precincts.geojson, fetch-la-precincts.ts);
// - each precinct's ballot style, and each style's contests in ballot order,
//   from the Interactive Sample Ballot files (data/raw/la/isb/, fetch-la-isb.ts).
//
// A voter's contests are exactly those on their precinct's ballot style. Each
// contest is also given the district it's elected from (scripts/la/districts.ts)
// for race pages; the build checks that contests sharing a district always
// appear together, so a district never brings in a contest from another style.
//
// Writes data/build/la/: contests.json, precinct-splits.json (the districts on
// each precinct's ballot, in the same shape as the Cook Clerk's precinct
// splits), precinct-shapes.geojson, precincts.json and report.json.
// Run: node scripts/la/build-la.ts [election id, default 4348]

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Candidate,
  Contest,
  OcdId,
  SourceRef,
} from '../../src/shared/ballot.ts'
import { BALLOT_STYLE_LAYER, type ClerkSplit } from '../../src/shared/cook.ts'
import type { AreaGeometry, PolygonCoords } from '../../src/shared/geo.ts'
import { LOS_ANGELES } from '../../src/shared/regions.ts'
import { readableCase } from '../../src/shared/text.ts'
import {
  BUILD,
  RAW,
  readJson,
  writeJson,
  type FeatureCollection,
} from '../lib/data.ts'
import { contestTitle, measureDistrict, officeDistrict } from './districts.ts'
import { AreaGrid, loadSegments, segmentStyle } from './segments.ts'
import {
  measureText,
  propositionTitle,
  stateMeasure,
  titleCase,
  voterGuideUrl,
} from './titles.ts'

const ELECTION = process.argv[2] ?? '4348'
const ISB = join(RAW, 'la', 'isb', ELECTION)
const OUT = join(BUILD, 'la')
const AUTHORITY = LOS_ANGELES.authorityFor(undefined)
/** The layer name the Worker sees for districts from a ballot style. */
const LAYER = BALLOT_STYLE_LAYER

type Text = Record<string, string | null | undefined>
interface IsbCandidate {
  id: string
  name: Text[]
  occupation: (Text | null)[]
  partyId?: string
  order: number
  isWriteIn: boolean
}
interface IsbContest {
  id: string
  name: Text
  long_description: Text
  contest_class: 'candidate_class' | 'retention_class' | 'ballot_measure_class'
  vote_for_max: number
  candidates: IsbCandidate[]
}
interface IsbBallot {
  id: string
  contests: {
    contest_id: string
    order: number
    candidates: { candidate_id: string; order: number }[]
  }[]
}
interface IsbSegment {
  PrecinctID: string
  partyBallotMap: Record<string, string>
}

/** "JUDGE OF THE SUPERIOR COURT Office No. 64" → "Office No. 64". */
function seatOf(name: string): string | undefined {
  const office = /\bOffice No\.? ?(\d+)/i.exec(name)?.[1]
  if (office) return `Office No. ${office}`
  const seat = /\bSeat (\d+)/i.exec(name)?.[1]
  return seat ? `Seat ${seat}` : undefined
}

/**
 * A candidate's name, readable: the Registrar's names are in capitals
 * ("NORMA J. TORRES" → "Norma J. Torres"); names in mixed case are kept.
 */
function candidateName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (/[a-z]/.test(clean)) return clean
  return clean
    .toLowerCase()
    .replace(/(^|[\s\-'’(".])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\bMc(\p{L})/gu, (_, ch) => `Mc${ch.toUpperCase()}`)
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase())
}

const en = (text: Text | null | undefined) =>
  (text?.EN ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const listJson = async (dir: string) =>
  existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')) : []

// Ballot styles per precinct, from the street segments.
const stylesOf = new Map<string, Set<string>>()
for (const file of await listJson(join(ISB, 'street-segments'))) {
  for (const s of await readJson<IsbSegment[]>(
    join(ISB, 'street-segments', file),
  )) {
    const styles = stylesOf.get(s.PrecinctID) ?? new Set<string>()
    for (const style of Object.values(s.partyBallotMap ?? {})) styles.add(style)
    stylesOf.set(s.PrecinctID, styles)
  }
}

const ballots = new Map<string, IsbBallot>()
for (const file of await listJson(join(ISB, 'ballots')))
  ballots.set(
    file.replace(/\.json$/, ''),
    await readJson(join(ISB, 'ballots', file)),
  )
const isbContests = new Map<string, IsbContest>()
for (const file of await listJson(join(ISB, 'contests')))
  isbContests.set(
    file.replace(/\.json$/, ''),
    await readJson(join(ISB, 'contests', file)),
  )

// Precincts on the map, with a signature of every district they're in, so a
// precinct without street segments (no residential streets the Sample Ballot
// knows) can borrow the style of precincts in exactly the same districts.
const map = await readJson<FeatureCollection>(
  join(RAW, 'la', 'precincts.geojson'),
)
const shapes = new Map<string, PolygonCoords[]>()
const signatureOf = new Map<string, string>()
for (const f of map.features) {
  const id = String(f.properties.PRECINCT ?? '').trim()
  const geometry = f.geometry as AreaGeometry | null
  if (!id || !geometry) continue
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  shapes.set(id, [...(shapes.get(id) ?? []), ...polygons])
  const signature = Object.entries(f.properties)
    .filter(([k]) => /^(DIST|DST|DIV)_/.test(k) && !/^DIST_OLD/.test(k))
    .map(([k, v]) => `${k}=${String(v ?? '').trim()}`)
    .join('|')
  signatureOf.set(id, signature)
}

// Signature → styles, from precincts whose style is known.
const stylesBySignature = new Map<string, Set<string>>()
for (const [precinct, styles] of stylesOf) {
  const signature = signatureOf.get(precinct)
  if (!signature) continue
  const known = stylesBySignature.get(signature) ?? new Set<string>()
  for (const s of styles) known.add(s)
  stylesBySignature.set(signature, known)
}

// Global contest order: the order every ballot agrees on (each ballot lists
// a subset of contests in the same relative order).
const after = new Map<string, Set<string>>()
const positions = new Map<string, number[]>()
for (const ballot of ballots.values()) {
  const ordered = [...ballot.contests].sort((a, b) => a.order - b.order)
  ordered.forEach((c, i) => {
    positions.set(c.contest_id, [...(positions.get(c.contest_id) ?? []), i])
    const next = ordered[i + 1]
    if (next) {
      const set = after.get(c.contest_id) ?? new Set<string>()
      set.add(next.contest_id)
      after.set(c.contest_id, set)
    }
  })
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const inDegree = new Map<string, number>()
for (const id of positions.keys()) inDegree.set(id, 0)
for (const nexts of after.values())
  for (const n of nexts) inDegree.set(n, (inDegree.get(n) ?? 0) + 1)
const globalOrder: string[] = []
const ready = [...inDegree].filter(([, d]) => d === 0).map(([id]) => id)
while (ready.length) {
  ready.sort((a, b) => mean(positions.get(a)!) - mean(positions.get(b)!))
  const id = ready.shift()!
  globalOrder.push(id)
  for (const n of after.get(id) ?? []) {
    inDegree.set(n, inDegree.get(n)! - 1)
    if (inDegree.get(n) === 0) ready.push(n)
  }
}
const orderCycles = positions.size - globalOrder.length
for (const id of positions.keys())
  if (!globalOrder.includes(id)) globalOrder.push(id)
const rank = new Map(globalOrder.map((id, i) => [id, i + 1]))

// Styles each contest is on.
const stylesWith = new Map<string, Set<string>>()
for (const [style, ballot] of ballots)
  for (const c of ballot.contests) {
    const set = stylesWith.get(c.contest_id) ?? new Set<string>()
    set.add(style)
    stylesWith.set(c.contest_id, set)
  }

// Each contest's district; contests sharing one must share their styles.
const retrievedAt = new Date().toISOString()
const source: SourceRef = {
  name: 'Los Angeles County Registrar-Recorder/County Clerk, Interactive Sample Ballot',
  url: AUTHORITY.sampleBallotUrl,
  retrievedAt,
  official: true,
}
const unrecognized: string[] = []
const districtOf = new Map<string, OcdId>()
for (const [id, contest] of isbContests) {
  const name = en(contest.name)
  const district =
    contest.contest_class === 'ballot_measure_class'
      ? measureDistrict(name)
      : officeDistrict(name)
  if (!district) unrecognized.push(`${id}: ${name}`)
  // An unrecognized contest still gets its own area, so it's shown exactly
  // where the Registrar lists it.
  districtOf.set(id, district ?? `${AUTHORITY.id}/contest_area:${id}`)
}
const styleKey = (id: string) =>
  [...(stylesWith.get(id) ?? [])].sort().join(' ')
const byDistrict = new Map<OcdId, string[]>()
for (const [id, d] of districtOf)
  byDistrict.set(d, [...(byDistrict.get(d) ?? []), id])
const splitDistricts: string[] = []
for (const [district, ids] of byDistrict) {
  const count = new Map<string, number>()
  for (const id of ids)
    count.set(styleKey(id), (count.get(styleKey(id)) ?? 0) + 1)
  if (count.size <= 1) continue
  // Contests in one district that don't appear on the same ballots as the
  // rest (an LAUSD measure listed under the City of Los Angeles, say) get
  // their own area, so none appears on another's ballots.
  const usual = [...count].sort((a, b) => b[1] - a[1])[0][0]
  for (const id of ids) {
    if (styleKey(id) === usual) continue
    splitDistricts.push(`${district}: ${en(isbContests.get(id)?.name)}`)
    districtOf.set(id, `${district}/contest_area:${id}`)
  }
}

// Every LA voter is in the statewide and countywide districts, so a contest
// filed under one must be on every ballot; one that isn't gets its own area.
const everywhere = new Set<string>(LOS_ANGELES.everywhere)
for (const [id, district] of districtOf) {
  if (
    everywhere.has(district) &&
    (stylesWith.get(id)?.size ?? 0) < ballots.size
  ) {
    splitDistricts.push(
      `${district}: ${en(isbContests.get(id)?.name)} (not on every ballot)`,
    )
    districtOf.set(id, `${district}/contest_area:${id}`)
  }
}

// Party names. The ballot prints "Party Preference: Democratic" (required on
// the ballot for voter-nominated offices); the app shows the party name alone,
// as it does for Cook County.
const election = await readJson<{
  parties: { id: string; display_name: Text }[]
}>(join(ISB, 'election.json'))
const partyName = new Map(
  election.parties
    .filter((p) => !['NP', 'VNC'].includes(p.id))
    .map((p) => [
      p.id,
      en(p.display_name).replace(/^Party Preference:\s*/i, ''),
    ]),
)

/**
 * Where a contest's candidate order differs between ballot styles (California
 * rotates it by Assembly district for some offices), each order is its own
 * contest on the ballots that use it, so every voter sees their ballot's order.
 * Keyed by `style|contest`.
 */
const variantDistrict = new Map<string, OcdId>()

const contests: Contest[] = []
const candidateOrders: string[] = []
for (const [id, c] of isbContests) {
  const name = en(c.name)
  const base = {
    id: `la-${ELECTION}-${id}`,
    electionId: LOS_ANGELES.election.id,
    districtId: districtOf.get(id)!,
    authorityId: AUTHORITY.id,
    title: titleCase(
      c.contest_class === 'ballot_measure_class'
        ? name
        : contestTitle(name.replace(/^For /, '')),
    ),
    ballotOrder: rank.get(id),
    // The Registrar orders contests the same way on every ballot style
    // (orderCycles is 0), so the ballot order is the paper ballot's order.
    paperOrder: rank.get(id),
    sources: [source],
    lastVerified: retrievedAt.slice(0, 10),
  }
  if (c.contest_class === 'ballot_measure_class') {
    // Statewide measures are numbered propositions with the Secretary of
    // State's title; county and local measures keep the Registrar's name.
    const state = stateMeasure(name, c.long_description?.EN ?? '')
    contests.push({
      ...base,
      ...(state && { title: propositionTitle(state) }),
      kind: 'measure',
      question: measureText(c.long_description?.EN ?? ''),
      ...(state && {
        guide: {
          name: 'California voter guide',
          url: voterGuideUrl(state.number),
        },
      }),
    })
    continue
  }
  if (c.contest_class === 'retention_class') {
    const judge = /<b>([^<]+)<\/b>/.exec(c.long_description?.EN ?? '')?.[1]
    contests.push({
      ...base,
      kind: 'retention',
      office: readableCase(name.replace(/^For /, '')),
      judge: candidateName(judge ?? ''),
    })
    continue
  }
  // The candidate order on each ballot style that lists the contest.
  const stylesByOrder = new Map<string, string[]>()
  for (const style of [...(stylesWith.get(id) ?? [])].sort()) {
    const order = [
      ...(ballots.get(style)?.contests.find((x) => x.contest_id === id)
        ?.candidates ?? []),
    ]
      .sort((a, b) => a.order - b.order)
      .map((x) => x.candidate_id)
      .join(',')
    stylesByOrder.set(order, [...(stylesByOrder.get(order) ?? []), style])
  }
  if (stylesByOrder.size > 1)
    candidateOrders.push(`${name}: ${stylesByOrder.size} orders`)
  const byId = new Map(c.candidates.map((x) => [x.id, x]))
  const fileOrder = [...c.candidates]
    .sort((a, b) => a.order - b.order)
    .map((x) => x.id)
    .join(',')
  const orders = stylesByOrder.size
    ? [...stylesByOrder]
    : [[fileOrder, []] as const]
  orders.forEach(([order, styles], k) => {
    const variant = orders.length > 1
    const districtId = variant
      ? `${base.districtId}/ballot_rotation:${k + 1}`
      : base.districtId
    for (const style of styles)
      variantDistrict.set(`${style}|${id}`, districtId)
    const candidates: Candidate[] = order
      .split(',')
      .map((cid) => byId.get(cid))
      .filter((x): x is IsbCandidate => x !== undefined && !x.isWriteIn)
      .map((x, i) => {
        const party = x.partyId ? partyName.get(x.partyId) : undefined
        const designation = en(x.occupation?.[0])
        return {
          name: candidateName(en(x.name[0])),
          ...(party && { party }),
          ...(designation && { designation }),
          ballotOrder: i + 1,
        }
      })
    contests.push({
      ...base,
      id: variant ? `${base.id}-r${k + 1}` : base.id,
      districtId,
      kind: 'candidate',
      office: titleCase(contestTitle(name)),
      voteFor: c.vote_for_max || 1,
      // Names the seat when one district elects several separately
      // (Superior Court "Office No. 64", college board "Seat 2").
      ...(seatOf(name) && { vacancy: seatOf(name) }),
      candidates,
    })
  })
}

// Each precinct's ballot: one split per ballot style, listing the districts
// of the style's contests.
const districtsOfStyle = (style: string) => [
  ...new Set(
    (ballots.get(style)?.contests ?? []).map(
      (c) =>
        variantDistrict.get(`${style}|${c.contest_id}`) ??
        districtOf.get(c.contest_id)!,
    ),
  ),
]
// Ballot styles of the addresses in each map precinct, from the street
// segments, for precincts that neither the segments nor their districts
// give a style.
const segments = await loadSegments(join(ISB, 'street-segments'))
const grid = new AreaGrid(
  [...shapes].map(([id, polygons]) => ({
    value: id,
    geometry: { type: 'MultiPolygon', coordinates: polygons } as AreaGeometry,
  })),
)
const votes = new Map<string, Map<string, number>>()
// The County's address points reach into neighbouring Orange County (La
// Habra, Brea); only points inside an LA County precinct are kept for the
// lookup, so an address elsewhere is "not found" rather than a partial ballot.
const [header, ...rows] = (
  await readFile(join(RAW, 'la', 'address-points.tsv'), 'utf8')
).split('\n')
const inCounty: string[] = []
let outsideCounty = 0
for (const line of rows) {
  if (!line) continue
  const [address, , zip, lat, lng] = line.split('\t')
  const containing = grid.find({ lat: Number(lat), lng: Number(lng) })
  if (!containing.length) {
    outsideCounty++
    continue
  }
  inCounty.push(line)
  const style = segmentStyle(segments, address, zip)
  if (!style) continue
  for (const precinct of containing) {
    const tally = votes.get(precinct) ?? new Map<string, number>()
    tally.set(style, (tally.get(style) ?? 0) + 1)
    votes.set(precinct, tally)
  }
}
/**
 * The styles a precinct's addresses split between when none has 80%: each
 * with at least 10% of them, so one stray address doesn't add a ballot.
 */
function stylesFromSplitAddresses(precinct: string): Set<string> {
  const tally = [...(votes.get(precinct) ?? [])]
  const total = tally.reduce((n, [, v]) => n + v, 0)
  return new Set(tally.filter(([, v]) => v >= 0.1 * total).map(([s]) => s))
}

/** The style most of a precinct's addresses have, if at least 80% agree. */
function styleFromAddresses(precinct: string): string | undefined {
  const tally = [...(votes.get(precinct) ?? [])].sort((a, b) => b[1] - a[1])
  const total = tally.reduce((n, [, v]) => n + v, 0)
  return tally[0] && tally[0][1] >= 0.8 * total ? tally[0][0] : undefined
}

const splits: Record<string, ClerkSplit[]> = {}
let borrowed = 0
let fromAddresses = 0
let splitByAddresses = 0
let noStyle = 0
let ambiguousBorrow = 0
let signatureVsAddresses = 0
for (const precinct of shapes.keys()) {
  let styles = stylesOf.get(precinct)
  if (!styles?.size) {
    const candidates = stylesBySignature.get(signatureOf.get(precinct) ?? '')
    const fromVotes = styleFromAddresses(precinct)
    if (candidates?.size === 1) {
      styles = candidates
      borrowed++
      if (fromVotes && !candidates.has(fromVotes)) signatureVsAddresses++
    } else if (fromVotes) {
      styles = new Set([fromVotes])
      fromAddresses++
    } else if (stylesFromSplitAddresses(precinct).size > 1) {
      // A precinct whose addresses really are on different ballots: every
      // one of them, so the lookup shows all their races and says the
      // precinct is split, rather than leaving the local races out.
      styles = stylesFromSplitAddresses(precinct)
      splitByAddresses++
    } else {
      if (candidates && candidates.size > 1) ambiguousBorrow++
      noStyle++
      continue
    }
  }
  splits[`la:${precinct}`] = [...styles].sort().map((style) => ({
    split: style,
    districts: districtsOfStyle(style)
      .filter((d) => d !== undefined)
      .map((ocdId) => ({ ocdId, layer: LAYER })),
    covers: [LAYER],
  }))
}

// Check: for every ballot style, the contests a lookup would show (those in
// the style's districts and the everywhere districts) are exactly the style's.
const contestIdsIn = new Map<OcdId, string[]>()
for (const c of contests)
  contestIdsIn.set(c.districtId, [
    ...(contestIdsIn.get(c.districtId) ?? []),
    c.id,
  ])
const isbId = (contestId: string) =>
  contestId.replace(`la-${ELECTION}-`, '').replace(/-r\d+$/, '')
const styleMismatches: string[] = []
for (const [style, ballot] of ballots) {
  const shown = new Set(
    [...districtsOfStyle(style), ...everywhere].flatMap(
      (d) => contestIdsIn.get(d) ?? [],
    ),
  )
  const expected = ballot.contests
    .map((c) => c.contest_id)
    .sort()
    .join(' ')
  const got = [...shown].map(isbId).sort().join(' ')
  if (got !== expected || shown.size !== ballot.contests.length)
    styleMismatches.push(style)
}

const precinctsInSegmentsOnly = [...stylesOf.keys()].filter(
  (p) => !shapes.has(p),
)
const multiStyle = [...stylesOf].filter(([, s]) => s.size > 1).length
const signaturesWithManyStyles = [...stylesBySignature.values()].filter(
  (s) => s.size > 1,
).length

const features = [...shapes].map(([id, polygons]) => ({
  type: 'Feature' as const,
  properties: { id: `la:${id}` },
  geometry: { type: 'MultiPolygon', coordinates: polygons },
}))
await writeJson(join(OUT, 'precinct-shapes.geojson'), {
  type: 'FeatureCollection',
  features,
})
await writeJson(join(OUT, 'precincts.json'), {
  precincts: [...shapes.keys()].map((id) => ({ id: `la:${id}`, name: id })),
})
await writeJson(join(OUT, 'precinct-splits.json'), { precincts: splits })
await writeFile(
  join(OUT, 'address-points.tsv'),
  `${header}\n${inCounty.join('\n')}\n`,
)
await writeJson(join(OUT, 'contests.json'), { contests, unmapped: [] })

const report = {
  election: ELECTION,
  addressPoints: inCounty.length,
  addressPointsOutsideEveryPrecinct: outsideCounty,
  precinctsOnMap: shapes.size,
  precinctsWithStyle: Object.keys(splits).length,
  styleFromSegments:
    Object.keys(splits).length - borrowed - fromAddresses - splitByAddresses,
  styleBorrowedFromSameDistricts: borrowed,
  styleFromTheirAddresses: fromAddresses,
  stylesFromAddressesSplitBetweenStyles: splitByAddresses,
  sameDistrictsStyleDisagreesWithAddresses: signatureVsAddresses,
  precinctsWithoutStyle: noStyle,
  precinctsWithoutStyleAmbiguousBorrow: ambiguousBorrow,
  precinctsWithSeveralStyles: multiStyle,
  segmentPrecinctsNotOnMap: precinctsInSegmentsOnly.length,
  districtSignaturesWithSeveralStyles: signaturesWithManyStyles,
  ballotStyles: ballots.size,
  contests: contests.length,
  byKind: Object.fromEntries(
    ['candidate', 'retention', 'measure'].map((k) => [
      k,
      contests.filter((c) => c.kind === k).length,
    ]),
  ),
  candidates: contests.reduce(
    (n, c) => n + (c.kind === 'candidate' ? c.candidates.length : 0),
    0,
  ),
  contestOrderConflicts: orderCycles,
  ballotStylesWhereLookupDiffers: styleMismatches,
  unrecognizedNames: unrecognized,
  districtsSplitByStyle: splitDistricts,
  rotatedCandidateOrders: candidateOrders,
}
await writeJson(join(OUT, 'report.json'), report)
console.log(
  JSON.stringify(
    {
      ...report,
      unrecognizedNames: report.unrecognizedNames.length,
      districtsSplitByStyle: report.districtsSplitByStyle.length,
      rotatedCandidateOrders: report.rotatedCandidateOrders.length,
    },
    null,
    2,
  ),
)
