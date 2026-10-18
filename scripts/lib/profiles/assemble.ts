// Builds the profile that gets committed and published from a
// model's research plus the parts no model writes: campaign money from
// filings, judges' bar ratings and hand corrections (override files). Every
// step is idempotent, so running it again on a finished profile changes
// nothing; that lets `generate` refresh money or overrides without paying for
// new research.

import type {
  BarContext,
  CandidateProfile,
  OverviewParagraph,
  Endorsement,
  MoneySectionData,
  ProfileSource,
} from '../../../src/shared/profile.ts'
import { readableName } from '../../../src/shared/text.ts'
import {
  ALLIANCE,
  ALLIANCE_OTHERS,
  allianceTally,
  NO_RATING,
  SHOWN_ON_OWN_LINE,
} from './bar.ts'
import type { IncumbentEntry } from '../incumbents.ts'
import { PROMPT_VERSION, type ProfileRequest } from './prompt.ts'
import type { Subject } from './subjects.ts'

/**
 * Sets `incumbent` from the incumbent labels (content/incumbents/):
 * true only when the person has an entry there, and never for a judge up for
 * retention. The field always sits right after `tier`, so a rerun writes the
 * same JSON.
 */
export function mergeIncumbent(
  p: CandidateProfile,
  entry: IncumbentEntry | undefined,
): CandidateProfile {
  const { incumbent: _, ...rest } = p
  if (!entry || p.kind === 'retention') return rest
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rest)) {
    out[k] = v
    if (k === 'tier') out.incumbent = true
  }
  return out as unknown as CandidateProfile
}

/** A source given in full (no number yet), as override files give them. */
export type SourceInput = Omit<ProfileSource, 'id'>

/** money.json's entry for one person (scripts/profiles/money.ts). */
export interface MoneyInput {
  summaries: MoneySectionData['items']
  sharedCommittee?: MoneySectionData['sharedCommittee']
  filingsAt?: MoneySectionData['filingsAt']
  noCommittee?: MoneySectionData['noCommittee']
}

/**
 * One judge's entry in content/profiles/judges/bar-ratings.json (built by
 * scripts/profiles/judges.ts): bar evaluations citing that entry's own
 * numbered sources.
 */
export interface BarRatings {
  endorsements: Endorsement[]
  sources: ProfileSource[]
}

/** content/profiles/overrides/{key}.json */
export interface Override {
  /** Why this correction was made, for reviewers. */
  reason?: string
  /** Keep the current research and never regenerate this profile. */
  lock?: boolean
  overview?: OverviewEdit[]
  endorsements?: EndorsementEdit[]
}

export type OverviewEdit =
  /** Drops the paragraph that contains `match`. */
  | { action: 'remove'; match: string }
  /** Replaces the paragraph that contains `match` with `text`, cited to `sources`. */
  | { action: 'replace'; match: string; text: string; sources: SourceInput[] }
  /** Adds a paragraph at the end. */
  | { action: 'add'; text: string; sources: SourceInput[] }

export type EndorsementEdit =
  | { action: 'remove'; organization: string }
  | {
      action: 'replace'
      organization: string
      endorsement: Omit<Endorsement, 'cites'>
      sources: SourceInput[]
    }
  | {
      action: 'add'
      endorsement: Omit<Endorsement, 'cites'>
      sources: SourceInput[]
    }

/** The research request for a subject. */
export function requestFor(
  subject: Subject,
  electionId: string,
  asOf: string,
): ProfileRequest {
  return {
    key: subject.key,
    electionId,
    name: subject.name,
    party: subject.party,
    office: subject.office,
    officeDescription: subject.officeDescription,
    contestIds: subject.contestIds,
    kind: subject.kind,
    tier: subject.tier,
    officeType: subject.officeType,
    asOf,
  }
}

/**
 * Whether a profile needs new research: it's missing, the person's ballot
 * listing changed, or it was made with another model or prompt.
 */
export function needsResearch(
  existing: CandidateProfile | undefined,
  subject: Subject,
  model: string,
): boolean {
  if (!existing) return true
  return (
    existing.name !== subject.name ||
    (existing.party ?? null) !== (subject.party ?? null) ||
    existing.office !== subject.office ||
    existing.kind !== subject.kind ||
    existing.tier !== subject.tier ||
    existing.meta.promptVersion !== PROMPT_VERSION ||
    existing.meta.model !== model
  )
}

/**
 * What generate does with one person: research them, refresh their
 * committed profile without a model, or skip them. A lock or --no-research
 * never researches; --no-research skips people without a profile.
 */
export function planFor(
  prev: CandidateProfile | undefined,
  subject: Subject,
  model: string,
  options: { refresh?: boolean; noResearch?: boolean; locked?: boolean },
): 'research' | 'refresh' | 'skip' {
  if (options.noResearch) return prev ? 'refresh' : 'skip'
  if (options.locked) return prev ? 'refresh' : 'skip'
  return options.refresh || needsResearch(prev, subject, model)
    ? 'research'
    : 'refresh'
}

/** Ballot fields always follow the subject, even without new research. */
export function withSubject(
  p: CandidateProfile,
  subject: Subject,
): CandidateProfile {
  return {
    ...p,
    name: subject.name,
    party: subject.party,
    office: subject.office,
    contestIds: subject.contestIds,
    kind: subject.kind,
    tier: subject.tier,
  }
}

type MoneySummary = MoneySectionData['items'][number]

/** Fields older money files had, which profiles no longer show. */
interface LegacySummary extends MoneySummary {
  topContributors?: unknown
  smallDonorShare?: unknown
  fromIndividuals?: unknown
  largeSince?: MoneySummary['largeSince'] & { organizations?: unknown }
}

/**
 * A summary with a readable committee name (the FEC and ISBE file many in
 * all caps, "JULIANA FOR ILLINOIS", and the site never shows all caps),
 * without fields from older money files.
 */
function readableSummary(summary: LegacySummary): MoneySummary {
  const {
    topContributors: _top,
    smallDonorShare: _share,
    fromIndividuals: _individuals,
    largeSince,
    ...rest
  } = summary
  const next: MoneySummary = {
    ...rest,
    committee: readableName(summary.committee),
  }
  if (largeSince) {
    const { organizations: _organizations, ...large } = largeSince
    next.largeSince = large
  }
  return next
}

/** Replaces the money section with the filings data (never from a model). */
export function mergeMoney(
  p: CandidateProfile,
  money: MoneyInput | undefined,
  asOf: string,
): CandidateProfile {
  const section: MoneySectionData = {
    asOf,
    items: (money?.summaries ?? []).map(readableSummary),
  }
  if (money?.sharedCommittee && section.items.length === 0)
    section.sharedCommittee = {
      ...money.sharedCommittee,
      name: readableName(money.sharedCommittee.name),
    }
  else if (money?.filingsAt && section.items.length === 0)
    section.filingsAt = money.filingsAt
  if (
    money?.noCommittee &&
    section.items.length === 0 &&
    !section.sharedCommittee
  )
    section.noCommittee = money.noCommittee
  return { ...p, money: section }
}

const sameUrl = (a: string, b: string) =>
  a.replace(/\/+$/, '').replace(/^http:/, 'https:') ===
  b.replace(/\/+$/, '').replace(/^http:/, 'https:')

/** Adds sources (or finds them by URL) and returns their numbers. */
export function addSources(
  sources: ProfileSource[],
  inputs: SourceInput[],
): { sources: ProfileSource[]; ids: number[] } {
  const next = [...sources]
  const ids = inputs.map((input) => {
    const found = next.find((s) => sameUrl(s.url, input.url))
    if (found) return found.id
    const id = Math.max(0, ...next.map((s) => s.id)) + 1
    next.push({ ...input, id })
    return id
  })
  return { sources: next, ids: [...new Set(ids)] }
}

const sameOrg = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Puts the bar ratings from the judges' file in place of every rating the
 * model found: the file is copied from each association's published list for
 * this election and covers every judge, while a model may find an old one.
 *
 * Every judge gets the same four lines per vote, in the same order: the
 * Chicago Bar Association, the Chicago Council of Lawyers and the Illinois
 * State Bar Association word for word, then one line for the Alliance of Bar
 * Associations for Judicial Screening that counts its other members' ratings
 * (`tally`). The file keeps every member's rating. "No rating published"
 * becomes an entry without a rating, so the page can show it as our wording.
 */
export function mergeBarRatings(
  p: CandidateProfile,
  ratings: BarRatings | undefined,
): CandidateProfile {
  if (!ratings?.endorsements.length || p.kind === 'candidate') return p
  let sources = p.sources
  const cite = (cites: number[]) => {
    const inputs = cites.map((id) => {
      const source = ratings.sources.find((s) => s.id === id)
      if (!source)
        throw new Error(`${p.key}: bar rating cites missing source ${id}`)
      const { id: _id, ...input } = source
      return input
    })
    const result = addSources(sources, inputs)
    sources = result.sources
    return result.ids
  }
  const fallback: BarContext = p.kind === 'retention' ? 'retention' : 'election'
  const contextOf = (e: Endorsement): BarContext => e.context ?? fallback
  const contexts = [...new Set(ratings.endorsements.map(contextOf))]

  // Lists without Cook County's groups (Los Angeles County: one bar
  // association) are shown as published, one line per rating.
  const cookGroups = ratings.endorsements.some((e) =>
    (SHOWN_ON_OWN_LINE as readonly string[]).includes(e.organization),
  )
  const added: Endorsement[] = cookGroups
    ? contexts.flatMap(cookRatings)
    : ratings.endorsements.map((e) => ({
        organization: e.organization,
        kind: 'bar_evaluation' as const,
        context: contextOf(e),
        ...(e.contextLabel ? { contextLabel: e.contextLabel } : {}),
        ...(e.rating && e.rating !== NO_RATING ? { rating: e.rating } : {}),
        cites: cite(e.cites),
      }))

  function cookRatings(context: BarContext): Endorsement[] {
    const set = ratings!.endorsements.filter((e) => contextOf(e) === context)
    const label = set.find((e) => e.contextLabel)?.contextLabel
    const common = {
      kind: 'bar_evaluation' as const,
      context,
      ...(label ? { contextLabel: label } : {}),
    }
    const find = (organization: string) => {
      const e = set.find((x) => x.organization === organization)
      if (!e)
        throw new Error(
          `${p.key}: no ${organization} entry for the ${context} ratings`,
        )
      return e
    }
    const own = SHOWN_ON_OWN_LINE.map((organization): Endorsement => {
      const e = find(organization)
      return {
        organization,
        ...common,
        ...(e.rating && e.rating !== NO_RATING ? { rating: e.rating } : {}),
        cites: cite(e.cites),
      }
    })
    const members = ALLIANCE_OTHERS.map(find)
    const alliance: Endorsement = {
      organization: ALLIANCE,
      ...common,
      tally: allianceTally(members.map((e) => e.rating ?? NO_RATING)),
      cites: cite([...new Set(members.flatMap((e) => e.cites))]),
    }
    return [...own, alliance]
  }

  const kept = p.endorsements.items.filter((e) => e.kind !== 'bar_evaluation')
  return {
    ...p,
    endorsements: { ...p.endorsements, items: [...kept, ...added] },
    sources,
  }
}

export interface OverrideResult {
  profile: CandidateProfile
  /** Edits that found nothing to change and weren't applied before either. */
  stale: string[]
}

/**
 * Applies a hand correction. Each edit is idempotent: a removal that finds
 * nothing, or a replacement or addition whose text is already there, is a
 * no-op. An edit that matches nothing at all is reported as stale (the
 * research changed under it) for a person to look at.
 */
export function applyOverride(
  p: CandidateProfile,
  override: Override | undefined,
): OverrideResult {
  if (!override) return { profile: p, stale: [] }
  let sources = p.sources
  let overview: OverviewParagraph[] = [...p.overview.items]
  let endorsements: Endorsement[] = [...p.endorsements.items]
  const stale: string[] = []

  for (const edit of override.overview ?? []) {
    if (edit.action === 'add') {
      if (overview.some((o) => o.text === edit.text)) continue
      const r = addSources(sources, edit.sources)
      sources = r.sources
      overview.push({ text: edit.text, cites: r.ids })
      continue
    }
    const index = overview.findIndex((o) => o.text.includes(edit.match))
    if (edit.action === 'remove') continue
    if (index < 0) {
      if (!overview.some((o) => o.text === edit.text))
        stale.push(`overview replace: no paragraph contains "${edit.match}"`)
      continue
    }
    const r = addSources(sources, edit.sources)
    sources = r.sources
    overview[index] = { text: edit.text, cites: r.ids }
  }
  overview = overview.filter(
    (o) =>
      !(override.overview ?? []).some(
        (e) => e.action === 'remove' && o.text.includes(e.match),
      ),
  )

  for (const edit of override.endorsements ?? []) {
    if (edit.action === 'remove') {
      endorsements = endorsements.filter(
        (e) => !sameOrg(e.organization, edit.organization),
      )
      continue
    }
    const r = addSources(sources, edit.sources)
    if (edit.action === 'add') {
      if (
        endorsements.some((e) =>
          sameOrg(e.organization, edit.endorsement.organization),
        )
      )
        continue
      sources = r.sources
      endorsements.push({ ...edit.endorsement, cites: r.ids })
      continue
    }
    const index = endorsements.findIndex((e) =>
      sameOrg(e.organization, edit.organization),
    )
    if (index < 0) {
      if (
        !endorsements.some((e) =>
          sameOrg(e.organization, edit.endorsement.organization),
        )
      )
        stale.push(`endorsement replace: no "${edit.organization}"`)
      continue
    }
    sources = r.sources
    endorsements[index] = { ...edit.endorsement, cites: r.ids }
  }

  return {
    profile: {
      ...p,
      overview: { ...p.overview, items: overview },
      endorsements: { ...p.endorsements, items: endorsements },
      sources,
    },
    stale,
  }
}

/**
 * Drops sources nothing cites and numbers the rest 1, 2, 3… in their
 * current order, so the list voters see has no gaps.
 */
export function compactSources(p: CandidateProfile): CandidateProfile {
  const cited = new Set([
    ...p.overview.items.flatMap((o) => o.cites),
    ...p.endorsements.items.flatMap((e) => e.cites),
  ])
  const kept = p.sources.filter((s) => cited.has(s.id))
  const renumber = new Map(kept.map((s, i) => [s.id, i + 1]))
  const map = (cites: number[]) =>
    cites
      .map((c) => renumber.get(c) ?? c)
      .filter((c, i, a) => a.indexOf(c) === i)
  return {
    ...p,
    overview: {
      ...p.overview,
      items: p.overview.items.map((o) => ({
        ...o,
        cites: map(o.cites),
        ...(o.sentences && {
          sentences: o.sentences.map((s) => ({ ...s, cites: map(s.cites) })),
        }),
      })),
    },
    endorsements: {
      ...p.endorsements,
      items: p.endorsements.items.map((e) => ({ ...e, cites: map(e.cites) })),
    },
    sources: kept.map((s) => ({ ...s, id: renumber.get(s.id) ?? s.id })),
  }
}

/** The profile without its meta, for "did the content change?". */
const body = (p: CandidateProfile) => JSON.stringify({ ...p, meta: undefined })

/**
 * Sets meta.version: the previous version when nothing but meta changed,
 * otherwise one more. Returns null when the profile is identical to what's
 * on disk (nothing to write).
 */
export function versioned(
  next: CandidateProfile,
  existing: CandidateProfile | undefined,
): CandidateProfile | null {
  if (!existing) return { ...next, meta: { ...next.meta, version: 1 } }
  if (body(next) === body(existing) && next.meta.model === existing.meta.model)
    return null
  return {
    ...next,
    meta: { ...next.meta, version: existing.meta.version + 1 },
  }
}
