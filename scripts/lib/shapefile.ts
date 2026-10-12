// Minimal reader for polygon shapefiles (.shp + .dbf), enough for the
// boundary files we import. Coordinates are returned as stored, so the file
// must already be in longitude/latitude (check its .prj).
// Format: https://www.esri.com/content/dam/esrisites/sitecore-archive/Files/Pdfs/library/whitepapers/pdfs/shapefile.pdf

import { readFile } from 'node:fs/promises'
import type { Position } from '../../src/shared/geo.ts'
import type { Feature, FeatureCollection } from './data.ts'

const POLYGON = 5

/** Shoelace signed area: positive for counter-clockwise rings. */
function signedArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return sum / 2
}

function readShp(buf: Buffer): Position[][][][] {
  const shapes: Position[][][][] = []
  let pos = 100 // file header
  while (pos < buf.length) {
    const contentLength = buf.readInt32BE(pos + 4) * 2
    const rec = pos + 8
    const type = buf.readInt32LE(rec)
    pos = rec + contentLength
    if (type !== POLYGON) {
      shapes.push([])
      continue
    }
    const numParts = buf.readInt32LE(rec + 36)
    const numPoints = buf.readInt32LE(rec + 40)
    const partsAt = rec + 44
    const pointsAt = partsAt + numParts * 4
    const rings: Position[][] = []
    for (let p = 0; p < numParts; p++) {
      const start = buf.readInt32LE(partsAt + p * 4)
      const end =
        p + 1 < numParts ? buf.readInt32LE(partsAt + (p + 1) * 4) : numPoints
      const ring: Position[] = []
      for (let i = start; i < end; i++) {
        ring.push([
          buf.readDoubleLE(pointsAt + i * 16),
          buf.readDoubleLE(pointsAt + i * 16 + 8),
        ])
      }
      rings.push(ring)
    }
    // Shapefile outer rings are clockwise; holes are counter-clockwise and
    // belong to the outer ring before them.
    const polygons: Position[][][] = []
    for (const ring of rings) {
      if (signedArea(ring) < 0 || polygons.length === 0) polygons.push([ring])
      else polygons[polygons.length - 1].push(ring)
    }
    shapes.push(polygons)
  }
  return shapes
}

function readDbf(buf: Buffer): Record<string, string>[] {
  const count = buf.readUInt32LE(4)
  const headerLength = buf.readUInt16LE(8)
  const recordLength = buf.readUInt16LE(10)
  const fields: { name: string; length: number }[] = []
  for (let pos = 32; buf[pos] !== 0x0d; pos += 32) {
    fields.push({
      name: buf.toString('latin1', pos, pos + 11).replace(/\0.*$/, ''),
      length: buf[pos + 16],
    })
  }
  const rows: Record<string, string>[] = []
  for (let r = 0; r < count; r++) {
    let pos = headerLength + r * recordLength + 1 // skip the deletion flag
    const row: Record<string, string> = {}
    for (const field of fields) {
      row[field.name] = buf.toString('latin1', pos, pos + field.length).trim()
      pos += field.length
    }
    rows.push(row)
  }
  return rows
}

/** Reads `<base>.shp` and `<base>.dbf` into a GeoJSON FeatureCollection. */
export async function readShapefile(
  base: string,
): Promise<FeatureCollection<Record<string, string>>> {
  const [shp, dbf] = await Promise.all([
    readFile(`${base}.shp`),
    readFile(`${base}.dbf`),
  ])
  const shapes = readShp(shp)
  const rows = readDbf(dbf)
  const features: Feature<Record<string, string>>[] = shapes.map(
    (polygons, i) => ({
      type: 'Feature',
      properties: rows[i] ?? {},
      geometry: polygons.length
        ? { type: 'MultiPolygon', coordinates: polygons }
        : null,
    }),
  )
  return { type: 'FeatureCollection', features }
}
