// What a prerendered page hands the app (src/prerender.tsx writes it,
// main.tsx reads it): which on-demand page to load before the app's first
// render, and the profile shown, so the app needn't fetch it again. Race
// pages and profiles also load the race list first (src/races/data.ts).

import type { CandidateProfile } from './shared/profile.ts'

export interface PrerenderData {
  page: 'profile' | 'about' | 'notify' | 'races'
  profile?: CandidateProfile
}

export const PRERENDER_DATA_ID = 'prerender-data'

/** The data as a script tag. `<` is escaped so no text can end the tag. */
export function prerenderData(data: PrerenderData): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<script type="application/json" id="${PRERENDER_DATA_ID}">${json}</script>`
}

/** The data the page was built with, or null for a page built empty. */
export function readPrerenderData(): PrerenderData | null {
  const el = document.getElementById(PRERENDER_DATA_ID)
  if (!el?.textContent) return null
  try {
    return JSON.parse(el.textContent) as PrerenderData
  } catch {
    return null
  }
}
