// Paths and download helpers shared by the data scripts.
// Raw downloads go to data/raw/, generated files to data/build/. Both are
// gitignored; see data/README.md for sources and terms.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const RAW = join(ROOT, 'data', 'raw')
export const BUILD = join(ROOT, 'data', 'build')

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VoteStack data import (votestack.org)' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return (await res.json()) as T
}

export interface Feature<P = Record<string, unknown>> {
  type: 'Feature'
  properties: P
  geometry: { type: string; coordinates: unknown } | null
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: Feature<P>[]
}

/** Every feature of an ArcGIS REST layer as GeoJSON in WGS84, following pagination. */
export async function arcgisLayer(
  layerUrl: string,
): Promise<FeatureCollection> {
  const features: Feature[] = []
  for (let offset = 0; ;) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      resultOffset: String(offset),
    })
    const page = await getJson<
      FeatureCollection & {
        exceededTransferLimit?: boolean
        properties?: { exceededTransferLimit?: boolean }
      }
    >(`${layerUrl}/query?${params}`)
    features.push(...page.features)
    offset += page.features.length
    const more =
      page.exceededTransferLimit ?? page.properties?.exceededTransferLimit
    if (!more || page.features.length === 0) break
  }
  return { type: 'FeatureCollection', features }
}

/** Every row of a Socrata dataset, following pagination. */
export async function socrataRows<T>(
  domain: string,
  id: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 50_000
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({
      ...query,
      $limit: String(pageSize),
      $offset: String(offset),
      $order: ':id',
    })
    const page = await getJson<T[]>(
      `https://${domain}/resource/${id}.json?${params}`,
    )
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

/** A Socrata dataset with a geometry column as GeoJSON. */
export async function socrataGeoJson(
  domain: string,
  id: string,
): Promise<FeatureCollection> {
  return getJson<FeatureCollection>(
    `https://${domain}/resource/${id}.geojson?$limit=50000`,
  )
}
