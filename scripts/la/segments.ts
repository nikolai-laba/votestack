// The LA County Registrar's street segments (Interactive Sample Ballot data):
// house-number ranges on a street, each with its voting precinct and ballot
// style. Used to give map precincts their ballot style from the addresses in
// them, and to audit lookups address by address. Also a grid index for
// finding the map precinct that contains a point quickly.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAddress, streetKey } from '../../src/shared/address.ts'
import {
  bbox,
  containsPoint,
  type AreaGeometry,
  type BBox,
} from '../../src/shared/geo.ts'
import type { LatLng } from '../../src/shared/provider.ts'
import { readJson } from '../lib/data.ts'

export interface Segment {
  /** The street's direction ("N" in N Isabel St). */
  StreetDirection: string
  AddressDirection: string
  StreetName: string
  StreetSuffix: string
  StartHouseNumber: number
  EndHouseNumber: number
  OddEvenBoth: 'odd' | 'even' | 'both'
  Zip: string
  PrecinctID: string
  partyBallotMap: Record<string, string>
}

/**
 * A street key in the form both sides share: the Registrar zero-pads
 * numbered streets ("096TH") and drops hyphens ("AVENUE M4") where the
 * County's address points don't ("96TH", "AVENUE M-4").
 */
const normalKey = (key: string) =>
  key.replace(/\|0+(?=\d)/, '|').replace(/-/g, '')

/** The same street with any direction, for addresses that carry it after the name. */
const anyDirection = (key: string) => `*${key.slice(key.indexOf('|'))}`

/** Segments by street key (src/shared/address.ts), as voters' addresses are keyed. */
export async function loadSegments(
  dir: string,
): Promise<Map<string, Segment[]>> {
  const byStreet = new Map<string, Segment[]>()
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.json')) continue
    for (const s of await readJson<Segment[]>(join(dir, file))) {
      const parsed = parseAddress(
        `1 ${s.StreetDirection || s.AddressDirection} ${s.StreetName} ${s.StreetSuffix}`,
      )
      if (!parsed) continue
      const key = normalKey(streetKey(parsed))
      for (const k of [key, anyDirection(key)]) {
        const list = byStreet.get(k)
        if (list) list.push(s)
        else byStreet.set(k, [s])
      }
    }
  }
  return byStreet
}

const styleOf = (s: Segment) => Object.values(s.partyBallotMap ?? {})[0]

/**
 * The ballot style the street segments give an address: `undefined` if no
 * segment covers it, `null` if segments disagree.
 */
export function segmentStyle(
  segments: Map<string, Segment[]>,
  address: string,
  zip?: string,
): string | null | undefined {
  const parsed = parseAddress(address)
  if (!parsed) return undefined
  const covers = (s: Segment) =>
    parsed.number >= s.StartHouseNumber &&
    parsed.number <= s.EndHouseNumber &&
    (s.OddEvenBoth === 'both' ||
      (s.OddEvenBoth === 'odd') === (parsed.number % 2 === 1)) &&
    (!zip || !s.Zip || s.Zip === zip)
  const key = normalKey(streetKey(parsed))
  // The street as written first; then the same name with any direction, as
  // when the Registrar gives a direction the address doesn't ("W 149th St"
  // for "149th Street", "E 96th St" for "96th Street E"). Disagreeing
  // segments still give null below, so a guess between two streets is never made.
  let matches = (segments.get(key) ?? []).filter(covers)
  if (matches.length === 0)
    matches = (segments.get(anyDirection(key)) ?? []).filter(covers)
  const styles = new Set(matches.map(styleOf).filter(Boolean))
  if (styles.size === 0) return undefined
  return styles.size === 1 ? [...styles][0] : null
}

/** Areas bucketed by a grid of `cell`-degree squares, for fast point lookups. */
export class AreaGrid<T> {
  private readonly cells = new Map<
    string,
    { value: T; geometry: AreaGeometry; box: BBox }[]
  >()
  private readonly cell: number

  constructor(areas: { value: T; geometry: AreaGeometry }[], cell = 0.01) {
    this.cell = cell
    for (const { value, geometry } of areas) {
      const box = bbox(geometry)
      const [minX, minY, maxX, maxY] = box.map((v) => Math.floor(v / cell))
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++) {
          const key = `${x}:${y}`
          const list = this.cells.get(key)
          const entry = { value, geometry, box }
          if (list) list.push(entry)
          else this.cells.set(key, [entry])
        }
    }
  }

  /** Every area containing the point. */
  find(point: LatLng): T[] {
    const key = `${Math.floor(point.lng / this.cell)}:${Math.floor(point.lat / this.cell)}`
    return (this.cells.get(key) ?? [])
      .filter(
        ({ box: [minX, minY, maxX, maxY], geometry }) =>
          point.lng >= minX &&
          point.lng <= maxX &&
          point.lat >= minY &&
          point.lat <= maxY &&
          containsPoint(geometry, point),
      )
      .map((a) => a.value)
  }
}
