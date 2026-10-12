// Removes what rests on a dead source: a page that's gone (404, 410)
// or a login page can't back anything. Every overview sentence and
// endorsement whose only sources are dead is removed, and the sources list
// is renumbered. The removals are returned so a reviewer can look at them;
// a profile that loses a lot is researched again instead.

import {
  paragraphOf,
  type CandidateProfile,
} from '../../../src/shared/profile.ts'
import { compactSources } from './assemble.ts'

export interface Pruned {
  profile: CandidateProfile
  /** What was removed, as text, for the review queue. */
  removed: string[]
}

export function pruneDeadSources(
  p: CandidateProfile,
  dead: (url: string) => boolean,
): Pruned {
  const deadIds = new Set(p.sources.filter((s) => dead(s.url)).map((s) => s.id))
  if (deadIds.size === 0) return { profile: p, removed: [] }
  const alive = (cites: number[]) => cites.some((c) => !deadIds.has(c))
  const removed: string[] = []

  const items = p.overview.items.flatMap((para) => {
    if (!para.sentences?.length) {
      if (alive(para.cites)) return [para]
      removed.push(`overview: ${para.text}`)
      return []
    }
    const kept = para.sentences.filter((s) => {
      if (alive(s.cites)) return true
      removed.push(`overview: ${s.text}`)
      return false
    })
    return kept.length ? [paragraphOf(kept)] : []
  })
  const endorsements = p.endorsements.items.filter((e) => {
    // Bar ratings come from the bar associations' own lists.
    if (e.kind === 'bar_evaluation' || alive(e.cites)) return true
    removed.push(`endorsement: ${e.organization}`)
    return false
  })

  const profile = compactSources({
    ...p,
    overview: { ...p.overview, items },
    endorsements: { ...p.endorsements, items: endorsements },
  })
  return { profile, removed }
}
