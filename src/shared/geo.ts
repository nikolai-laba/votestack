// Point-in-polygon for GeoJSON polygons, without dependencies, so the same
// code runs in the Worker, the browser and the import scripts.

import type { LatLng } from './provider.ts'

/** GeoJSON position: [longitude, latitude]. */
export type Position = [number, number]
export type PolygonCoords = Position[][]

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: PolygonCoords
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: PolygonCoords[]
}

export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry

/** [minLng, minLat, maxLng, maxLat] */
export type BBox = [number, number, number, number]

/** Ray casting. Points exactly on an edge may land on either side. */
function inRing(point: LatLng, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point.lat !== yj > point.lat) {
      const x = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
      if (point.lng < x) inside = !inside
    }
  }
  return inside
}

function inPolygon(point: LatLng, polygon: PolygonCoords): boolean {
  const [outer, ...holes] = polygon
  if (!outer || !inRing(point, outer)) return false
  return !holes.some((hole) => inRing(point, hole))
}

export function containsPoint(geometry: AreaGeometry, point: LatLng): boolean {
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates)
  return geometry.coordinates.some((polygon) => inPolygon(point, polygon))
}

export function bbox(geometry: AreaGeometry): BBox {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0] ?? []) {
      box[0] = Math.min(box[0], lng)
      box[1] = Math.min(box[1], lat)
      box[2] = Math.max(box[2], lng)
      box[3] = Math.max(box[3], lat)
    }
  }
  return box
}

export function bboxContains(box: BBox, point: LatLng): boolean {
  return (
    point.lng >= box[0] &&
    point.lng <= box[2] &&
    point.lat >= box[1] &&
    point.lat <= box[3]
  )
}

/**
 * A point guaranteed to lie inside the geometry (unlike a centroid, which can
 * fall outside a concave shape). Casts a horizontal line through the middle of
 * the largest polygon and takes the midpoint of the widest inside stretch.
 * `fraction` picks the line's height within the bounding box (0.5 = middle).
 */
export function interiorPoint(geometry: AreaGeometry, fraction = 0.5): LatLng {
  const polygons =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const area = (p: PolygonCoords) => {
    const b = bbox({ type: 'Polygon', coordinates: p })
    return (b[2] - b[0]) * (b[3] - b[1])
  }
  const largest = polygons.reduce((a, b) => (area(b) > area(a) ? b : a))
  const box = bbox({ type: 'Polygon', coordinates: largest })
  const lat = box[1] + (box[3] - box[1]) * fraction

  const xs: number[] = []
  for (const ring of largest) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > lat !== yj > lat)
        xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    }
  }
  xs.sort((a, b) => a - b)

  let best = { lng: (box[0] + box[2]) / 2, width: -1 }
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const width = xs[i + 1] - xs[i]
    if (width > best.width) best = { lng: (xs[i] + xs[i + 1]) / 2, width }
  }
  return { lat, lng: best.lng }
}

/** Up to about `target` evenly spaced points inside the geometry, from a grid over its bounding box. */
export function gridPoints(geometry: AreaGeometry, target = 40): LatLng[] {
  const box = bbox(geometry)
  for (let size = Math.ceil(Math.sqrt(target)); size <= 64; size *= 2) {
    const points: LatLng[] = []
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const point = {
          lng: box[0] + ((i + 0.5) / size) * (box[2] - box[0]),
          lat: box[1] + ((j + 0.5) / size) * (box[3] - box[1]),
        }
        if (containsPoint(geometry, point)) points.push(point)
      }
    }
    if (points.length >= target / 2) return points
  }
  return [interiorPoint(geometry)]
}

export interface Area<T> {
  value: T
  geometry: AreaGeometry
  bbox: BBox
}

/** All areas containing the point. Checks bounding boxes first, so a few thousand precincts stay fast. */
export function findContaining<T>(areas: Area<T>[], point: LatLng): T[] {
  return areas
    .filter(
      (area) =>
        bboxContains(area.bbox, point) && containsPoint(area.geometry, point),
    )
    .map((area) => area.value)
}
