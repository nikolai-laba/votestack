// Candidate profiles: the shape shared by the profile scripts, the
// Worker and the app. A profile has three sections in a fixed order
// (Overview, Campaign money, Endorsements) and a numbered list of sources.
// An empty section is shown as "Not found in public sources as of [date]",
// never hidden, so every candidate in a race looks the same.

import type { IsoDate } from './ballot.ts'

/**
 * How much room a race gets: the top of the ticket gets the most, judges and
 * small offices the least, matching how long voters spend on each.
 */
export type ProfileTier = 'top' | 'mid' | 'short'

/** Most words the overview may use, per tier. */
export const OVERVIEW_WORD_LIMITS: Record<ProfileTier, number> = {
  top: 250,
  mid: 120,
  short: 70,
}

/** Most paragraphs the overview may use, per tier. */
export const OVERVIEW_PARAGRAPH_LIMITS: Record<ProfileTier, number> = {
  top: 3,
  mid: 2,
  short: 1,
}

export type ProfileKind = 'candidate' | 'judicial_candidate' | 'retention'

export interface ProfileSource {
  /** Number shown in citations, from 1. */
  id: number
  title: string
  /** e.g. "Chicago Sun-Times", "Ballotpedia", the candidate's campaign. */
  publisher: string
  url: string
  viewedAt: IsoDate
  kind: 'news' | 'candidate' | 'reference' | 'official' | 'bar' | 'endorser'
}

/** Text with the numbers of the sources that back it. */
export interface CitedText {
  text: string
  /** Source ids; at least one. */
  cites: number[]
}

/**
 * An overview paragraph. `text` and `cites` cover the whole paragraph (every
 * sentence's cites, in order, without repeats). Profiles written since
 * prompt f006-1 also carry `sentences`, one source each, so citations show
 * after the sentence they back; a hand correction that replaces the
 * paragraph drops them and the paragraph is cited as a whole.
 */
export interface OverviewParagraph extends CitedText {
  sentences?: CitedText[]
}

/** Joins cited sentences into one paragraph, keeping their citations. */
export function paragraphOf(sentences: CitedText[]): OverviewParagraph {
  const cites: number[] = []
  for (const s of sentences)
    for (const id of s.cites) if (!cites.includes(id)) cites.push(id)
  return {
    text: sentences.map((s) => s.text.trim()).join(' '),
    cites,
    sentences,
  }
}

export interface Section<T> {
  /** When this section was last researched. */
  asOf: IsoDate
  items: T[]
}

/** Campaign money from official filings (ISBE for state and local races, FEC for federal). */
export interface MoneySummary {
  source: 'ISBE' | 'FEC'
  committee: string
  /** The committee's filings page. */
  url: string
  /** Reporting period, e.g. "July 1 to September 30, 2026". */
  period: string
  raised?: number
  cashOnHand?: number
  /**
   * Where `raised` came from, by kind of source, as the report itself sorts
   * it (see MONEY_SOURCE_LABELS). In MONEY_SOURCE_ORDER, with $0 kinds left
   * out; the amounts add up to `raised`. Undefined when the report's parts
   * don't add up to its total (the breakdown then shows "Not reported").
   */
  breakdown?: MoneySource[]
  /**
   * Part of `raised` that the candidate gave or lent their own committee
   * (FEC: candidate contributions and loans; ISBE: contributions and loans
   * filed under the candidate's own name). Set only when above zero;
   * detection errs towards leaving money out.
   */
  fromCandidate?: number
  /**
   * Large contributions reported after the period ended, so the summary isn't
   * months out of date (ISBE only: A-1 reports of gifts of $1,000 or more,
   * filed within days). Gifts count only in `total` and `count`; no donor
   * is named.
   */
  largeSince?: {
    /** The end of `period`. */
    since: IsoDate
    total: number
    count: number
    /** Part of `total` the candidate gave their own committee (in kind too), when above zero. */
    fromCandidate?: number
  }
}

/**
 * Kinds of sources a committee's money came from, as its report sorts them.
 * Each filing source uses only the kinds its reports support exactly
 * (MONEY_SOURCE_LABELS); the candidate's own money is taken out of the kind
 * the report filed it under, so nothing counts twice.
 */
export type MoneySourceKind =
  | 'small'
  | 'large'
  | 'pac'
  | 'party'
  | 'transfer'
  | 'candidate'
  | 'loan'
  | 'other'

export interface MoneySource {
  kind: MoneySourceKind
  amount: number
}

/** The order breakdown rows show in, the same for every candidate. */
export const MONEY_SOURCE_ORDER: readonly MoneySourceKind[] = [
  'small',
  'large',
  'pac',
  'party',
  'transfer',
  'candidate',
  'loan',
  'other',
]

/** Row labels per filing source; a kind a source doesn't report has none. */
export const MONEY_SOURCE_LABELS: Record<
  MoneySummary['source'],
  Partial<Record<MoneySourceKind, string>>
> = {
  FEC: {
    small: 'Small gifts from people ($200 or less)',
    large: 'Larger gifts from people',
    pac: 'PACs and other committees',
    party: 'Party committees',
    transfer: 'Transfers from other campaign committees',
    candidate: 'The candidate',
    loan: 'Loans from others',
    other: 'Other receipts',
  },
  ISBE: {
    small: 'Small gifts ($150 or less)',
    large: 'Larger gifts',
    transfer: 'PACs, parties and other campaign committees',
    candidate: 'The candidate',
    loan: 'Loans from others',
    other: 'Other receipts',
  },
}

/**
 * Breakdown percentages show only when the committee raised at least this
 * much in the period. Below it, one or two gifts set the shares, and "100%"
 * reads as a statement about the whole campaign; the amounts still show.
 * The methods page (HowProfilesPage) states the rule.
 */
export const MONEY_SHARES_MIN_RAISED = 5000

/** Whether a summary's breakdown shows percentages (see above). */
export const showsMoneyShares = (s: MoneySummary): boolean =>
  s.raised !== undefined && s.raised >= MONEY_SHARES_MIN_RAISED

/**
 * The money section. `sharedCommittee` is set only when the person has no
 * committee of their own (`items` is empty) and campaigns through a joint
 * one, like judges up for retention in Cook County. The section then names
 * that committee instead of saying nothing was found.
 */
export interface MoneySectionData extends Section<MoneySummary> {
  sharedCommittee?: { name: string; url: string }
}

export interface Endorsement {
  organization: string
  kind:
    | 'organization'
    | 'union'
    | 'party'
    | 'elected_official'
    | 'editorial_board'
    | 'bar_evaluation'
  /**
   * A bar association's rating, word for word ("Recommended", "Qualified").
   * A bar evaluation without one means the group published no rating for
   * this judge (VoteStack's wording, shown as such).
   */
  rating?: string
  /** Bar evaluations only: the vote the rating is for. */
  context?: BarContext
  /**
   * Bar evaluations only, when a judge is rated for two votes (a race and a
   * retention vote): which one, e.g. "For the Appellate Court election".
   */
  contextLabel?: string
  /**
   * Elected officials only: their party as a source states it, e.g.
   * "Democratic", "Republican". Omitted when unknown or nonpartisan.
   */
  party?: string
  /** Bar evaluations only: one line summing up a group's members (BarTally). */
  tally?: BarTally
  cites: number[]
}

/** Whether a judge's bar rating is for a contested race or a retention vote. */
export type BarContext = 'election' | 'retention'

/**
 * How the members of a group of bar associations rated one judge, for a
 * single summary line (the Alliance of Bar Associations for Judicial
 * Screening, minus members shown on their own lines).
 */
export interface BarTally {
  /** Members this line covers. */
  members: number
  /**
   * Each published rating, word for word, with how many members gave it.
   * Most common first. Members with no published rating are left out.
   */
  ratings: { rating: string; count: number }[]
  /** Members that marked the judge "Not Evaluated Through No Fault of the Candidate". */
  notEvaluated: number
}

export interface CandidateProfile {
  /** From profileKey(name). */
  key: string
  electionId: string
  name: string
  party?: string
  /** The office as voters see it, e.g. "Commissioner, Water Reclamation District". */
  office: string
  /** Every contest this person appears in (Chicago and suburban lists). */
  contestIds: string[]
  kind: ProfileKind
  tier: ProfileTier
  /** Holds this seat now, as an official list confirms (see Candidate.incumbent). */
  incumbent?: boolean
  /**
   * Who they are, key positions (not for judges), track record or voting
   * history, and major wins or projects. One item per paragraph.
   */
  overview: Section<OverviewParagraph>
  money: MoneySectionData
  endorsements: Section<Endorsement>
  sources: ProfileSource[]
  /**
   * Pre-launch feedback only: this is another person's profile, shown in
   * place of one that isn't written yet. The page says so above it. Every
   * sample is removed before launch (`profiles:samples -- --clear`).
   */
  sample?: {
    /** The candidate whose row links here. */
    forName: string
    forOffice: string
  }
  meta: {
    model: string
    promptVersion: string
    generatedAt: string
    /** Bumped on every content change. */
    version: number
  }
}

/**
 * The text under a candidate's name: party, plus "incumbent" when an
 * official list confirms they hold the seat ("Democratic, incumbent", or
 * "Incumbent" in a nonpartisan race). Plain text in the party's style for
 * everyone, so no one looks favoured. Judges up for retention never get the word:
 * they hold the seat by definition.
 */
export function partyLine(
  party: string | undefined,
  incumbent: boolean | undefined,
): string | undefined {
  if (!incumbent) return party
  return party ? `${party}, incumbent` : 'Incumbent'
}

/**
 * Stable key for a person, from their name as printed on the ballot:
 * "Deborah 'Debby' Pope" → "deborah-debby-pope". The Clerk's and the Board's
 * lists spell shared candidates the same way, so one key covers both.
 */
export function profileKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"“”.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
