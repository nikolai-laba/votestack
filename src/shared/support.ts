// The facts about paying toward VoteStack that more than one place states:
// the Support page, the Press page and the notice shown after an election.

/** Stripe Payment Link where the payer picks the amount (one-time only). */
export const PAY_ONCE_URL = 'https://buy.stripe.com/3cIeVd0otdaX6Ph7Pt9EI00'

/** AI spent on candidate profiles so far, in dollars, across every area. */
export const AI_SPENT_SO_FAR = 400.37

/**
 * Candidates with published profiles in every area (the profile lists in
 * content/profiles/published/). A test checks it against those lists, so
 * update it, and AI_SPENT_SO_FAR, when an area is added or republished.
 */
export const CANDIDATES_COVERED = 1176
