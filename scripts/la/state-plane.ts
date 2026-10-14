// California State Plane Zone 5 (NAD83, US survey feet; EPSG:2229) to
// latitude and longitude, for LA County data published in that projection.
// Inverse Lambert Conformal Conic (two standard parallels) on the GRS80
// ellipsoid; NAD83 and WGS84 differ by about a meter here, which is well
// inside an address point's own accuracy.

const FOOT = 1200 / 3937 // US survey foot in meters
const A = 6378137
const F = 1 / 298.257222101
const E = Math.sqrt(2 * F - F * F)
const RAD = Math.PI / 180

const PHI1 = (35 + 28 / 60) * RAD
const PHI2 = (34 + 2 / 60) * RAD
const PHI0 = 33.5 * RAD
const LAMBDA0 = -118 * RAD
const X0 = 2_000_000 // meters
const Y0 = 500_000

const m = (phi: number) =>
  Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2)
const t = (phi: number) =>
  Math.tan(Math.PI / 4 - phi / 2) /
  ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2)

const N =
  (Math.log(m(PHI1)) - Math.log(m(PHI2))) /
  (Math.log(t(PHI1)) - Math.log(t(PHI2)))
const BIG_F = m(PHI1) / (N * t(PHI1) ** N)
const RHO0 = A * BIG_F * t(PHI0) ** N

/** EPSG:2229 easting and northing (US feet) → `{ lat, lng }` in degrees. */
export function statePlaneZone5ToLatLng(
  xFeet: number,
  yFeet: number,
): { lat: number; lng: number } {
  const x = xFeet * FOOT - X0
  const y = RHO0 - (yFeet * FOOT - Y0)
  const rho = Math.sign(N) * Math.sqrt(x * x + y * y)
  const tt = (rho / (A * BIG_F)) ** (1 / N)
  const theta = Math.atan2(x, y)
  let phi = Math.PI / 2 - 2 * Math.atan(tt)
  for (let i = 0; i < 10; i++) {
    const s = E * Math.sin(phi)
    const next =
      Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (E / 2))
    if (Math.abs(next - phi) < 1e-12) {
      phi = next
      break
    }
    phi = next
  }
  return { lat: phi / RAD, lng: (theta / N + LAMBDA0) / RAD }
}
