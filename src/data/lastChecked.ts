// When candidate information was last checked against its sources, shown on
// the About page. Profiles load one at a time, so the app has no cheap way to
// read this at runtime. Whoever runs the profile scripts (profiles:generate,
// then profiles:publish) updates it on each refresh to the newest
// `meta.generatedAt` date in content/profiles/; lastChecked.test.ts fails
// when it falls behind.

/** ISO date (YYYY-MM-DD). */
export const LAST_CHECKED = '2026-10-07'
