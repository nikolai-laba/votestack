// The one instruction and output schema every profile model gets.
// Models return only the researched parts of a CandidateProfile:
// overview, endorsements and the numbered sources they cite. Everything else
// (key, office, tier, money, meta) comes from the ballot data and the script.

import {
  OVERVIEW_PARAGRAPH_LIMITS,
  OVERVIEW_WORD_LIMITS,
  type CandidateProfile,
  type Endorsement,
  type OverviewParagraph,
  type ProfileKind,
  type ProfileSource,
  type ProfileTier,
} from '../../../src/shared/profile.ts'
import type { OfficeType } from './subjects.ts'

/** Bump when the instruction or schema changes, so outputs can be compared. */
export const PROMPT_VERSION = 'f006-5'

/** Who to research: one person on the ballot, from the contest files. */
export interface ProfileRequest {
  key: string
  electionId: string
  name: string
  party?: string
  /** The office as voters see it. */
  office: string
  /** One plain line on what the office does, to steer the search. */
  officeDescription?: string
  contestIds: string[]
  kind: ProfileKind
  tier: ProfileTier
  /** Picks the research brief (briefs.ts); guessed from `kind` when absent. */
  officeType?: OfficeType
  /** Date of the research, used as "viewed" for every source. */
  asOf: string
}

/** What a model returns: the researched sections, before checks. */
export interface ProfileOutput {
  overview: OverviewParagraph[]
  endorsements: Endorsement[]
  sources: Omit<ProfileSource, 'viewedAt'>[]
}

const SOURCE_KINDS = [
  'news',
  'candidate',
  'reference',
  'official',
  'bar',
  'endorser',
] as const

const ENDORSEMENT_KINDS = [
  'organization',
  'union',
  'party',
  'elected_official',
  'editorial_board',
  'bar_evaluation',
] as const

/**
 * JSON Schema for ProfileOutput. Every property is required and nothing extra
 * is allowed, so it works as an OpenAI strict schema; `rating` is nullable
 * instead of optional for the same reason.
 */
export const PROFILE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'endorsements', 'sources'],
  properties: {
    overview: {
      type: 'array',
      description: 'One item per paragraph.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'cites'],
        properties: {
          text: { type: 'string' },
          cites: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    endorsements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['organization', 'kind', 'rating', 'cites'],
        properties: {
          organization: { type: 'string' },
          kind: { type: 'string', enum: [...ENDORSEMENT_KINDS] },
          rating: { type: ['string', 'null'] },
          cites: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'publisher', 'url', 'kind'],
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          publisher: { type: 'string' },
          url: { type: 'string' },
          kind: { type: 'string', enum: [...SOURCE_KINDS] },
        },
      },
    },
  },
} as const

/** Shared by every prompt: telling namesakes apart. */
export const IDENTITY_RULES = `## Make sure it is the right person
Many people share names. Only use pages that clearly match this candidate's name and office or career in Illinois. If you can't tell, leave the fact out.`

/** Shared by every prompt: VoteStack's voice. */
export const VOICE_RULES = `## Voice
- Plain, calm and specific, at a grade 6 to 8 reading level. Short sentences, one idea each, active voice.
- Neutral: "Supports…", "Has proposed…", "Voted for…", "Was elected in 2018". Report facts and attribute claims to their source.
- Never use loaded or flattering words (for example controversial, radical, extreme, staunch, beloved, embattled, tireless, champion, passionate) or superlatives (best, most respected, leading).
- Never use these words: unlock, empower, seamless, transform, supercharge, elevate, delve, tapestry, landscape, pivotal, crucial, foster, robust, journey.
- No em dashes. No "not just X, but Y" or "it's not X, it's Y" framing. No lists of three used for rhythm.`

/** Shared by every prompt: what a profile never includes. */
export const PRIVACY_RULES = `## Privacy
Never include a home address, phone number, email address, birth date, age, family members or children, or allegations that were not proven in court.`

/** Sources every stage may use, and never. */
export const SOURCE_KINDS_RULE = `Use only these kinds of sources: news organizations; the candidate's own campaign or official website; Wikipedia; Ballotpedia; official government sources (.gov sites, the Illinois State Board of Elections, the FEC, ilga.gov, courts); bar associations; the endorsing organization's own announcement. Never use social media (Facebook, X/Twitter, Instagram, TikTok, LinkedIn, YouTube, Reddit and similar) or an opponent's material.`

export const TIER_LENGTH: Record<ProfileTier, string> = {
  top: `2 or ${OVERVIEW_PARAGRAPH_LIMITS.top} short paragraphs, ${OVERVIEW_WORD_LIMITS.top} words or fewer in total`,
  mid: `1 or ${OVERVIEW_PARAGRAPH_LIMITS.mid} short paragraphs, ${OVERVIEW_WORD_LIMITS.mid} words or fewer in total`,
  short: `${OVERVIEW_PARAGRAPH_LIMITS.short} paragraph, ${OVERVIEW_WORD_LIMITS.short} words or fewer`,
}

export const isJudicial = (kind: ProfileKind) => kind !== 'candidate'

/** The system instruction, shared by every provider. */
export function buildInstructions(req: ProfileRequest): string {
  const judicial = isJudicial(req.kind)
  const overviewScope = judicial
    ? 'who they are, their legal background, time on the bench and court assignment, and notable work. Judges may not announce views on issues, so never describe positions, promises or how they would rule.'
    : 'who they are, key positions, voting history or track record, and major wins or projects they led.'
  const endorsementScope = judicial
    ? 'Organizations that endorsed them, and bar association evaluations for this election: the Alliance of Bar Associations for Judicial Screening (voteforjudges.org), the Chicago Bar Association, the Chicago Council of Lawyers and the Illinois State Bar Association. Put a bar rating word for word in "rating" (for example "Recommended", "Qualified", "Not Recommended") with kind "bar_evaluation". Only use ratings published for this election.'
    : 'Organizations that endorsed them for this election (unions, advocacy groups, parties, newspaper editorial boards), each cited to the page where the endorsement was announced. Leave out endorsements by individual people unless they hold elected office.'

  return `You research candidates for VoteStack, a nonpartisan ballot guide for Cook County, Illinois. Voters read these profiles to decide how to vote, so accuracy matters more than length. VoteStack never tells anyone how to vote.

Research the candidate with web search, then return a JSON object for their profile.

## Overview
${overviewScope}
Length: ${TIER_LENGTH[req.tier]}. One array item per paragraph.

## Endorsements
${endorsementScope}
Return an empty list if you find none. Never guess.

## Sources
- Every overview paragraph and every endorsement cites at least one source by its number ("cites": [1, 3]). Every cited number must appear in "sources".
- A source must directly support the sentence that cites it. Summarize in your own words; do not quote.
- Use only these kinds of sources: news organizations; the candidate's own campaign or official website; Wikipedia; Ballotpedia; official government sources (.gov sites, the Illinois State Board of Elections, the FEC, ilga.gov, courts); bar associations; the endorsing organization's own announcement.
- Never use social media (Facebook, X/Twitter, Instagram, TikTok, LinkedIn, YouTube, Reddit and similar) or an opponent's material.
- Give the exact URL of the page you read. Never make up or reconstruct a URL.
- "kind" of a source: news, candidate (their own site), reference (Wikipedia, Ballotpedia), official, bar, endorser.

${IDENTITY_RULES}

${VOICE_RULES}

${PRIVACY_RULES}

## If little is known
Write only what the sources support. A short or empty profile is better than a guess. If you find nothing reliable, return empty "overview", "endorsements" and "sources" lists.

## Output
Return only the JSON object, with no other text and no code fences. It must match this JSON Schema:
${JSON.stringify(PROFILE_OUTPUT_SCHEMA)}`
}

/** The user message: who to research. */
export function buildUserMessage(req: ProfileRequest): string {
  const lines = [
    `Candidate: ${req.name}`,
    req.party ? `Party on the ballot: ${req.party}` : undefined,
    `Office: ${req.office}${req.officeDescription ? ` (${req.officeDescription})` : ''}`,
    `Election: Illinois general election, Tuesday, November 3, 2026, Cook County.`,
    req.kind === 'retention'
      ? 'This is a retention vote: the judge is already on the bench and voters decide whether to keep them.'
      : undefined,
    `Today is ${req.asOf}.`,
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * Pulls the JSON object out of a model's text answer: some models wrap it in
 * code fences or add a sentence despite the instruction.
 */
export function parseProfileJson(text: string): ProfileOutput {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object in output')
  const value = JSON.parse(body.slice(start, end + 1)) as Partial<ProfileOutput>
  return {
    overview: Array.isArray(value.overview) ? value.overview : [],
    endorsements: (Array.isArray(value.endorsements)
      ? value.endorsements
      : []
    ).map((e) => ({
      ...e,
      // Strict schemas send null for "no rating"; the profile omits it.
      rating: e.rating ?? undefined,
    })),
    sources: Array.isArray(value.sources) ? value.sources : [],
  }
}

/** Assembles a full profile from the request and a model's output. */
export function toProfile(
  req: ProfileRequest,
  output: ProfileOutput,
  model: string,
  generatedAt: string,
): CandidateProfile {
  const asOf = req.asOf
  return {
    key: req.key,
    electionId: req.electionId,
    name: req.name,
    party: req.party,
    office: req.office,
    contestIds: req.contestIds,
    kind: req.kind,
    tier: req.tier,
    overview: { asOf, items: output.overview },
    // Campaign money comes from ISBE/FEC filings, never from a model.
    money: { asOf, items: [] },
    endorsements: { asOf, items: output.endorsements },
    sources: output.sources.map((s) => ({ ...s, viewedAt: asOf })),
    meta: { model, promptVersion: PROMPT_VERSION, generatedAt, version: 1 },
  }
}
