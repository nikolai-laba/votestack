import type { BarContext, BarTally } from '../../shared/profile.ts'

/** The summary line for a group's members, with notes in our own words. */
export interface BarSummary {
  /** Counts of the published ratings; null when no member published one. */
  text: string | null
  /** Members that published nothing, or didn't evaluate the judge. */
  notes: string[]
}

const quote = (rating: string) => `“${rating}”`
const groups = (n: number) => `${n} other member group${n === 1 ? '' : 's'}`

/**
 * How the other members of the Alliance rated a judge, counting only members
 * that published a rating: "10 of 11 other member groups said “Yes”, 1 said
 * “No”." Ratings are quoted word for word, most common first.
 */
export function barSummary(tally: BarTally, context: BarContext): BarSummary {
  const rated = tally.ratings.reduce((n, r) => n + r.count, 0)
  const unrated = tally.members - rated - tally.notEvaluated
  const notes: string[] = []
  if (rated > 0 || tally.notEvaluated > 0) {
    if (unrated > 0) notes.push(`${groups(unrated)} published no rating.`)
    if (tally.notEvaluated > 0)
      notes.push(
        `${groups(tally.notEvaluated)} marked this judge “Not Evaluated Through No Fault of the Candidate”.`,
      )
  }
  if (rated === 0) return { text: null, notes }

  const [first, ...rest] = tally.ratings
  let text: string
  if (rest.length === 0) {
    text =
      rated === 1
        ? `The only other member group that rated this judge said ${quote(first.rating)}.`
        : `All ${rated} other member groups that rated this judge said ${quote(first.rating)}.`
  } else {
    const lead =
      context === 'retention'
        ? `said ${quote(first.rating)}`
        : `rated this judge ${quote(first.rating)}`
    const others = rest.map((r) =>
      context === 'retention'
        ? `${r.count} said ${quote(r.rating)}`
        : `${r.count} ${quote(r.rating)}`,
    )
    text = `${first.count} of ${rated} other member groups ${lead}, ${others.join(', ')}.`
  }
  return { text, notes }
}
