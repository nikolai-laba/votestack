// Local geocoder over Cook County Address Points (data/raw/address-points.tsv).
// Addresses never leave the machine. The file-based version is for scripts
// and prototyping; the Worker's lookup does the same in PostGIS.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  alternateStreetKeys,
  matchOnStreet,
  parseAddress,
  streetKey,
  type AddressPoint,
  type GeocodeResult,
} from '../../src/shared/address.ts'
import type { Geocoder } from '../../src/shared/provider.ts'
import { RAW } from './data.ts'

export class LocalGeocoder implements Geocoder {
  private readonly streets: Map<string, AddressPoint[]>

  private constructor(streets: Map<string, AddressPoint[]>) {
    this.streets = streets
  }

  static async load(): Promise<LocalGeocoder> {
    const text = await readFile(join(RAW, 'address-points.tsv'), 'utf8')
    const streets = new Map<string, AddressPoint[]>()
    for (const line of text.split('\n').slice(1)) {
      if (!line) continue
      const [address, city, zip, lat, lng] = line.split('\t')
      const parsed = parseAddress(address)
      if (!parsed) continue
      const key = streetKey(parsed)
      let street = streets.get(key)
      if (!street) streets.set(key, (street = []))
      street.push({
        number: parsed.number,
        type: parsed.type,
        city: city || undefined,
        zip: zip || undefined,
        lat: Number(lat),
        lng: Number(lng),
      })
    }
    return new LocalGeocoder(streets)
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const parsed = parseAddress(address)
    if (!parsed) return null
    const match = (key: string) =>
      matchOnStreet(parsed, this.streets.get(key) ?? [])
    const found = match(streetKey(parsed))
    if (found) return found
    const others = alternateStreetKeys(parsed).flatMap(
      (key) => match(key) ?? [],
    )
    return others.length === 1 ? others[0] : null
  }
}
