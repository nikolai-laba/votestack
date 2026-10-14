// Loads Cook County's lookup data (address points, district and precinct
// boundaries, contests) from data/raw and data/build into Supabase, replacing
// that region's rows; other regions' rows are left alone. Apply
// supabase/migrations first. Needs SUPABASE_URL and SUPABASE_SECRET_KEY in
// .env (never commit it).
// Run after data:fetch and data:build: node --env-file=.env scripts/load-supabase.ts

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAddress, streetKey } from '../src/shared/address.ts'
import type { Contest } from '../src/shared/ballot.ts'
import type { ClerkSplit } from '../src/shared/cook.ts'
import type { AreaGeometry, PolygonCoords } from '../src/shared/geo.ts'
import { COOK } from '../src/shared/regions.ts'
import { BUILD, RAW, readJson, type FeatureCollection } from './lib/data.ts'
import { ELECTION_ID } from './lib/election.ts'
import { loadLayers } from './lib/layers.ts'
import { withIncumbents, type Incumbents } from './lib/incumbents.ts'
import { withPaperOrder, type PaperRanks } from './lib/paper-order.ts'
import { INCUMBENTS } from './lib/profiles/content.ts'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env, then run with node --env-file=.env',
  )
  process.exit(1)
}
const headers = { apikey: key, 'Content-Type': 'application/json' }

/** The lookup tables' tag for this data (see src/shared/regions.ts). */
const REGION = COOK.id

async function rpc(fn: string, args: object = {}) {
  const res = await send(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<unknown>
}

/** Supabase sometimes drops a connection mid-load; retry with backoff. */
async function send(
  path: string,
  init: RequestInit,
  attempts = 5,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${url}${path}`, init)
      if (res.ok || (res.status < 500 && res.status !== 429)) return res
      if (attempt >= attempts) return res
    } catch (error) {
      if (attempt >= attempts) throw error
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
  }
}

async function insert(table: string, rows: object[], batchSize: number) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const res = await send(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(
        rows.slice(i, i + batchSize).map((r) => ({ ...r, region: REGION })),
      ),
    })
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    process.stdout.write(
      `\r${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}`,
    )
  }
  process.stdout.write('\n')
  // A retried batch may have been saved before the connection dropped, so
  // check the row count matches what was sent.
  const count = await send(`/rest/v1/${table}?select=*&region=eq.${REGION}`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact' },
  })
  const total = Number(count.headers.get('content-range')?.split('/')[1])
  if (total !== rows.length) {
    throw new Error(
      `${table}: expected ${rows.length} rows, found ${total}. Run the load again.`,
    )
  }
}

/** GeoJSON polygon(s) → EWKT MultiPolygon, which PostGIS accepts as text. */
function ewkt(geometry: AreaGeometry): string {
  const polygons: PolygonCoords[] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const ring = (r: [number, number][]) =>
    `(${r.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(',')})`
  return `SRID=4326;MULTIPOLYGON(${polygons.map((p) => `(${p.map(ring).join(',')})`).join(',')})`
}

// Empty this region's rows, a batch at a time.
for (let deleted = 1; deleted > 0;) {
  deleted = Number(await rpc('reset_lookup_batch', { p_region: REGION }))
  if (deleted) process.stdout.write(`\rcleared ${deleted} rows`)
}
process.stdout.write('\n')

// Address points.
const text = await readFile(join(RAW, 'address-points.tsv'), 'utf8')
const points = text
  .split('\n')
  .slice(1)
  .flatMap((line) => {
    const [address, city, zip, lat, lng] = line.split('\t')
    const parsed = address ? parseAddress(address) : null
    if (!parsed) return []
    return [
      {
        street_key: streetKey(parsed),
        number: parsed.number,
        street_type: parsed.type ?? null,
        city: city || null,
        zip: zip || null,
        lat: Number(lat),
        lng: Number(lng),
      },
    ]
  })
await insert('address_points', points, 2000)

// District boundaries.
const districts = (await loadLayers()).flatMap((layer) =>
  layer.areas.map((area) => ({
    ocd_id: area.value,
    layer: layer.type,
    required: layer.required,
    geom: ewkt(area.geometry),
  })),
)
await insert('districts', districts, 20)

// Precincts.
const shapes = await readJson<FeatureCollection>(
  join(BUILD, 'precinct-shapes.geojson'),
)
const { precincts } = await readJson<{
  precincts: { id: string; name: string }[]
}>(join(BUILD, 'precincts.json'))
const names = new Map(precincts.map((p) => [p.id, p.name]))
await insert(
  'precincts',
  shapes.features.map((f) => ({
    id: String(f.properties.id),
    name: names.get(String(f.properties.id)) ?? String(f.properties.id),
    geom: ewkt(f.geometry as AreaGeometry),
  })),
  100,
)

// Contests (with their paper ballot position) and the ones not yet
// placed in a district.
const paperOrderFile = join(BUILD, 'paper-order.json')
const paperRanks: PaperRanks = existsSync(paperOrderFile)
  ? (await readJson<{ ranks: PaperRanks }>(paperOrderFile)).ranks
  : {}
if (!existsSync(paperOrderFile))
  console.log(
    'No paper-order.json (run build-paper-order.ts): the app will offer only the order by level',
  )
// Incumbent labels (scripts/build-incumbents.ts), committed in content/.
const incumbents: Incumbents = existsSync(INCUMBENTS)
  ? await readJson<Incumbents>(INCUMBENTS)
  : {}
if (!existsSync(INCUMBENTS))
  console.log(
    'No incumbents file (run npm run data:incumbents): no candidate is labeled incumbent',
  )
const contests: object[] = []
const unplaced: object[] = []
for (const file of await readdir(join(BUILD, 'contests'))) {
  const data = await readJson<{ contests: Contest[]; unmapped: string[] }>(
    join(BUILD, 'contests', file),
  )
  for (const c of withIncumbents(
    withPaperOrder(data.contests, paperRanks),
    incumbents,
  )) {
    contests.push({
      id: c.id,
      election_id: c.electionId,
      district_id: c.districtId,
      authority_id: c.authorityId,
      data: c,
    })
  }
  const authority = data.contests[0]?.authorityId
  for (const description of data.unmapped) {
    unplaced.push({
      election_id: ELECTION_ID,
      authority_id: authority,
      description,
    })
  }
}
await insert('contests', contests, 500)
await insert('unplaced_contests', unplaced, 500)

// Official district assignments per precinct split: the Clerk's for suburban
// precincts, the Board of Election Commissioners' lists for Chicago.
const splitsFrom = async (file: string) =>
  (
    await readJson<{ precincts: Record<string, ClerkSplit[]> }>(
      join(BUILD, file),
    )
  ).precincts
const official = {
  ...(await splitsFrom('clerk-precincts.json')),
  ...(await splitsFrom('chicago-precincts.json')),
}
await insert(
  'clerk_precinct_splits',
  Object.entries(official).flatMap(([precinctId, splits]) =>
    splits.map((s) => ({
      precinct_id: precinctId,
      split: s.split,
      districts: s.districts,
      covers: s.covers ?? [],
    })),
  ),
  500,
)

console.log('Done.')
