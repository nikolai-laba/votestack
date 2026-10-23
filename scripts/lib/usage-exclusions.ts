// Counts the usage report leaves out (scripts/usage-report.ts). The stored
// counts in Supabase are never changed; this only shapes what the report shows.
//
// A scraper swept every report page ("Report an error", /candidates/*/report)
// from residential proxies with a plain Chrome user agent, Oct 18 to 22, 2026.
// It ran the app, so each page load counted a report-page view as the first
// page opened plus a stretch of time on screen without a ballot. Since
// 2026-10-22 the app counts nothing from a visit that starts on a report page
// (src/metrics/listen.ts); this applies the same rule to the hours before.

/** One count as written into the report: [hour (Unix seconds), event, a, b, c, n, d1…d8, live (1 = not rolled up yet)]. */
export type Row = [number, string, string, string, string, number, ...number[]]

/** First hour the deployed app no longer counted visits that start on a report page. */
export const REPORT_LANDINGS_COUNTED_UNTIL =
  Date.parse('2026-10-22T17:00:00Z') / 1000

const isReportLanding = (r: Row) =>
  r[1] === 'view' && r[2] === 'report' && r[3] === 'landing'

/**
 * Drops report-page landings from before the app stopped counting them, and
 * takes one no-ballot time count off the same hour for each one dropped,
 * with its share of the seconds. Time counts are hourly totals shared with
 * real visitors, so that part is an estimate.
 */
export function excludeScraper(rows: Row[]): {
  rows: Row[]
  dropped: { views: number; active: number }
} {
  const landings = new Map<number, number>()
  for (const r of rows)
    if (isReportLanding(r) && r[0] < REPORT_LANDINGS_COUNTED_UNTIL)
      landings.set(r[0], (landings.get(r[0]) ?? 0) + r[5])

  const dropped = { views: 0, active: 0 }
  const kept: Row[] = []
  for (const r of rows) {
    if (isReportLanding(r) && r[0] < REPORT_LANDINGS_COUNTED_UNTIL) {
      dropped.views += r[5]
      continue
    }
    const left = landings.get(r[0]) ?? 0
    if (r[1] === 'active' && r[2] === '0' && left > 0 && r[5] > 0) {
      const take = Math.min(left, r[5])
      landings.set(r[0], left - take)
      dropped.active += take
      const n = r[5] - take
      const secs = Math.round((r[6] * n) / r[5])
      kept.push([r[0], r[1], r[2], r[3], r[4], n, secs, ...r.slice(7)] as Row)
      continue
    }
    kept.push(r)
  }
  return { rows: kept, dropped }
}
