import { describe, expect, it } from 'vitest'
import {
  bbox,
  containsPoint,
  findContaining,
  interiorPoint,
  type AreaGeometry,
} from './geo.ts'

// A 10×10 square with a 2×2 hole in the middle, in [lng, lat] order.
const squareWithHole: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ],
}

const twoIslands: AreaGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
    [
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
        [5, 5],
      ],
    ],
  ],
}

describe('containsPoint', () => {
  it('finds points inside a polygon and outside it', () => {
    expect(containsPoint(squareWithHole, { lng: 2, lat: 2 })).toBe(true)
    expect(containsPoint(squareWithHole, { lng: 11, lat: 2 })).toBe(false)
  })

  it('excludes points inside a hole', () => {
    expect(containsPoint(squareWithHole, { lng: 5, lat: 5 })).toBe(false)
  })

  it('handles multipolygons', () => {
    expect(containsPoint(twoIslands, { lng: 5.5, lat: 5.5 })).toBe(true)
    expect(containsPoint(twoIslands, { lng: 3, lat: 3 })).toBe(false)
  })
})

describe('findContaining', () => {
  it('returns every area that contains the point', () => {
    const areas = [
      { value: 'square', geometry: squareWithHole, bbox: bbox(squareWithHole) },
      { value: 'islands', geometry: twoIslands, bbox: bbox(twoIslands) },
    ]
    expect(findContaining(areas, { lng: 0.5, lat: 0.5 })).toEqual([
      'square',
      'islands',
    ])
    expect(findContaining(areas, { lng: 5.5, lat: 5.5 })).toEqual(['islands'])
  })
})

describe('interiorPoint', () => {
  it('lands inside a U shape whose centroid is outside', () => {
    const u: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [8, 10],
          [8, 2],
          [2, 2],
          [2, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    }
    expect(containsPoint(u, { lng: 5, lat: 5 })).toBe(false)
    expect(containsPoint(u, interiorPoint(u))).toBe(true)
  })

  it('avoids holes and picks the largest island', () => {
    expect(containsPoint(squareWithHole, interiorPoint(squareWithHole))).toBe(
      true,
    )
    const point = interiorPoint(twoIslands)
    expect(containsPoint(twoIslands, point)).toBe(true)
  })
})
