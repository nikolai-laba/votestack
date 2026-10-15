// The staged profile pipeline (prompt f006-1): a writer drafts the overview
// from search results, a checker opens every cited page and keeps, corrects,
// re-sources or removes each sentence, and a researcher finds endorsements.
// This file holds the prompts, schemas and the merge into a ProfileOutput;
// providers/staged.ts makes the calls.

import {
  paragraphOf,
  type Endorsement,
  type ProfileSource,
} from '../../../src/shared/profile.ts'
import { briefFor } from './briefs.ts'
import { PLACE } from './place.ts'
import type { EvidenceDoc } from './generator.ts'
import {
  IDENTITY_RULES,
  isJudicial,
  PRIVACY_RULES,
  SOURCE_KINDS_RULE,
  TIER_LENGTH,
  VOICE_RULES,
  type ProfileOutput,
  type ProfileRequest,
} from './prompt.ts'

type SourceKind = ProfileSource['kind']
type EndorsementKind = Endorsement['kind']

const SOURCE_KINDS: SourceKind[] = [
  'news',
  'candidate',
  'reference',
  'official',
  'bar',
  'endorser',
]

const ENDORSER_KINDS: EndorsementKind[] = [
  'organization',
  'union',
  'party',
  'elected_official',
  'editorial_board',
]

const SOURCE_KIND_NOTE =
  '"kind" of a source: news, candidate (their own campaign or office site), reference (Wikipedia, Ballotpedia), official (government, courts, election boards), bar, endorser (the endorsing group\'s own page).'

const INTRO = `You work for VoteStack, a nonpartisan ballot guide for ${PLACE.guide}. Voters read these profiles to decide how to vote, so accuracy matters more than length. VoteStack never tells anyone how to vote.`

/** What the overview covers and how much room each part gets. */
function coverage(req: ProfileRequest): string {
  if (isJudicial(req.kind)) {
    return `Write the most informative profile the sources allow, weighted roughly:
- About 40%: who they are: current court and assignment, years on the bench, legal career before it, and organizations they led or worked for (name them).
- About 60%: their record: notable rulings or cases reported in the news, programs or courtrooms they ran, and what bar evaluations say about their experience (not the ratings themselves).
Judges may not announce views on issues, so never describe positions, promises or how they would rule.`
  }
  return `Write the most informative profile the sources allow, weighted roughly:
- About 25%: who they are: current role, career and background that bear on the office, and organizations they led or worked with (name them).
- About 60%: positions and stances: what they support, oppose or propose, as specifically as the sources allow (named bills, programs, dollar amounts, targets). Use news coverage, candidate questionnaires, debates and their voting record, not only their own website. When a position comes only from their campaign, say so ("Her campaign says she supports…").
- About 15%: record and major wins: bills passed, programs or projects they led, measurable results.
Positions and record may blend together. Put what a voter most needs to know first.`
}

const LEAVE_OUT = `Leave out:
- The horse race: polls, vote shares, primary results, fundraising, who they beat or face. Never mention opponents.
- Trivia: "firsts", personal milestones, hobbies, anything that doesn't help a voter judge them for this office.
- Endorsements and campaign money; VoteStack shows those in their own sections.
- Party labels other than the one printed on the ballot (given below).`

/** The writer's instruction: overview only, from the given search results. */
export function writerInstructions(req: ProfileRequest): string {
  return `${INTRO}

Write the Overview section of this candidate's profile from the search results the user gives you. You can't search the web; use only those results.

## What to cover
${coverage(req)}
If the results say little about positions or record, write less. A short profile is better than padding or guessing.

${LEAVE_OUT}

Length: ${TIER_LENGTH[req.tier]}.

## Citations
- Every sentence cites exactly one search result by its number in "source". That result must state everything in the sentence. If a sentence needs two results, split it into two sentences.
- In "sources", list each result you cited once: "id" is its number, plus its publisher (e.g. ${PLACE.publisherExamples}) and kind.
- ${SOURCE_KINDS_RULE} Skip any result that isn't one of these.
- ${SOURCE_KIND_NOTE}
- Summarize in your own words; don't quote.${PLACE.writerRules ? `\n${PLACE.writerRules}` : ''}

${IDENTITY_RULES}

${VOICE_RULES}

${PRIVACY_RULES}

If no result is clearly about this person, return empty "paragraphs" and "sources".`
}

/** The writer's user message: who, the research brief and the results. */
export function writerMessage(
  req: ProfileRequest,
  evidence: EvidenceDoc[],
): string {
  return `${candidateLines(req)}
Where to look: ${briefFor(req).focus}

Search results:

${evidence
  .map(
    (d, i) =>
      `[${i + 1}] ${d.title}\nURL: ${d.url}${d.date ? `\nDate: ${d.date}` : ''}\n${d.snippet}`,
  )
  .join('\n\n')}`
}

function candidateLines(req: ProfileRequest): string {
  return [
    `Candidate: ${req.name}`,
    req.party ? `Party on the ballot: ${req.party}` : 'No party on the ballot',
    `Office: ${req.office}${req.officeDescription ? ` (${req.officeDescription})` : ''}`,
    PLACE.electionLine,
    req.kind === 'retention'
      ? 'This is a retention vote: the judge is already on the bench and voters decide whether to keep them.'
      : undefined,
    `Today is ${req.asOf}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The writer's output, before the checker sees it. */
export interface Draft {
  paragraphs: { sentences: { text: string; source: number }[] }[]
  sources: { id: number; publisher: string; kind: SourceKind }[]
}

export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['paragraphs', 'sources'],
  properties: {
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentences'],
        properties: {
          sentences: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'source'],
              properties: {
                text: { type: 'string' },
                source: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'publisher', 'kind'],
        properties: {
          id: { type: 'integer' },
          publisher: { type: 'string' },
          kind: { type: 'string', enum: SOURCE_KINDS },
        },
      },
    },
  },
} as const

/** A source as the checker and researcher give it: the page itself. */
export interface PageRef {
  url: string
  title: string
  publisher: string
  kind: SourceKind
}

/** A drafted sentence with its page, as the checker receives it. */
export interface DraftSentence {
  /** "1.2": paragraph 1, sentence 2. */
  ref: string
  text: string
  source?: PageRef & { excerpt: string }
}

/**
 * Joins the draft's sentences to the pages they cite. A sentence citing a
 * number that isn't in the results keeps no source, so the checker must
 * find one or remove it.
 */
export function draftSentences(
  draft: Draft,
  evidence: EvidenceDoc[],
  excerptChars = 3000,
): DraftSentence[][] {
  return draft.paragraphs.map((p, pi) =>
    p.sentences.map((s, si) => {
      const doc = evidence[s.source - 1]
      const meta = draft.sources.find((x) => x.id === s.source)
      return {
        ref: `${pi + 1}.${si + 1}`,
        text: s.text.trim(),
        source: doc && {
          url: doc.url,
          title: doc.title,
          publisher: meta?.publisher ?? new URL(doc.url).hostname,
          kind: meta?.kind ?? 'news',
          excerpt: doc.snippet.slice(0, excerptChars),
        },
      }
    }),
  )
}

const OUTPUT_SOURCE_FIELDS =
  '"url" (the exact page, never a homepage when a specific page exists), "title", "publisher", "kind" (one of news, candidate, reference, official, bar, endorser)'

/** The checker's instruction: verify every sentence, fix or remove. */
export function checkerInstructions(req: ProfileRequest): string {
  return `${INTRO}

You fact-check a drafted Overview section of a candidate profile before it is published. You can open web pages (URL context) and search Google.

## For every sentence
${PLACE.checkerOpenStep}
2. If the page states everything in the sentence (names, numbers, dates, roles, positions), keep it. You may tighten the wording to match the page.
3. If the page doesn't support it, or supports only part of it, search for a source that does. If you find one, keep the sentence (corrected to match that source) and cite the new page instead.
4. If no source confirms it, remove the claim, and reword the paragraph so it reads naturally and stays accurate. Never keep a claim you couldn't confirm.
5. Each sentence in your answer cites exactly one page, and that page must state everything in the sentence.

## Also fix
- Anything about a different election or year presented as current. The election is the November 3, 2026 general election.
- Old positions written as current. A position or statement from a source dated before 2025 must say when ("In his 2022 campaign, he said…") or be removed; prefer 2025–2026 sources. Never change past tense to present tense.
- A candidate's own claims stated as fact. Accomplishments and figures that come only from the candidate or their campaign say so ("He says he…", "Her campaign says…").
- Sentences about what a candidate lacks or didn't do (no website, didn't answer a questionnaire, no voting record, never held office) and past campaigns and whether they won or lost. Remove them.
- Loaded or selective framing ("claimed credit", "the only bill he passed"). Restate neutrally or remove.
- Bar association comments; VoteStack shows the bar evaluations separately.
- Filler and trivia: "is the Republican candidate for…", "first-time candidate", "not a career politician", where they live or grew up, family or immigrant background, hobbies, ceremonial resolutions and awareness months, license plates, facts about the office or district rather than the candidate.
- Misconduct, ethics findings or dismissals: keep only with an official record or a mainstream news source that clearly identifies this same person (office, town, career); otherwise remove. Never include criminal charges or accusations that weren't proven in court.
- Shortened or garbled proper names. Never shorten a name to match a terse source ("J. Garcia"); use the full, correct name.
- A role the candidate was removed from, when the cited page says so: name the role and the removal together, neutrally, with the reason the organization gave ("SEIU's board removed her in 2025 over social media posts it called…"). Never name the role alone.
- Anything on the leave-out list below.
- Wording that breaks the voice rules below.

Don't add new topics. You may only correct, re-source, reword or remove what the draft says. Keep the draft's balance between who they are, positions and record, and stay within: ${TIER_LENGTH[req.tier]}.

${LEAVE_OUT}

## Sources
${SOURCE_KINDS_RULE}
Give the exact URL of the page you read. Never make up or reconstruct a URL.

${IDENTITY_RULES}

${VOICE_RULES}

${PRIVACY_RULES}

## Output
Return only a JSON object, with no other text and no code fences:
{"paragraphs": [{"sentences": [{"text": "...", "source": {${OUTPUT_SOURCE_FIELDS}}}]}],
 "review": [{"ref": "1.2", "verdict": "supported" | "corrected" | "re-sourced" | "removed", "note": "one short line on what you found"}]}
"review" has one entry for every drafted sentence, by its ref. If nothing can be confirmed, return empty "paragraphs".`
}

/** The checker's user message: the candidate and the numbered draft. */
export function checkerMessage(
  req: ProfileRequest,
  sentences: DraftSentence[][],
): string {
  const body = sentences
    .map((paragraph, i) =>
      [
        `Paragraph ${i + 1}:`,
        ...paragraph.map((s) =>
          s.source
            ? `[${s.ref}] ${s.text}\n  Source: ${s.source.title} (${s.source.publisher}, ${s.source.kind})\n  URL: ${s.source.url}\n  Excerpt: ${s.source.excerpt.replace(/\s+/g, ' ')}`
            : `[${s.ref}] ${s.text}\n  Source: none (the draft cited a page that doesn't exist)`,
        ),
      ].join('\n'),
    )
    .join('\n\n')
  return `${candidateLines(req)}
Where to look: ${briefFor(req).focus}

Draft:

${body}`
}

/** The single checker's opening and output, which a packed check replaces. */
const SINGLE_TASK =
  'You fact-check a drafted Overview section of a candidate profile before it is published.'
const SINGLE_OUTPUT = /## Output\n[\s\S]*$/

/**
 * The checker's instruction for several candidates in the same race at
 * once, so one request checks them all: the same rules as
 * checkerInstructions, with each candidate checked on their own.
 */
export function packedCheckerInstructions(
  req: ProfileRequest,
  count: number,
): string {
  const single = checkerInstructions(req)
  if (!single.includes(SINGLE_TASK) || !SINGLE_OUTPUT.test(single))
    throw new Error('checkerInstructions changed; update the packed version')
  return single
    .replace(
      SINGLE_TASK,
      `You fact-check the drafted Overview sections of ${count} candidates' profiles in the same race before they are published. Check each candidate on their own, as if theirs were the only draft: a page supports a sentence only for the candidate whose draft cites it, and you never move a fact, a source or wording from one candidate's profile to another's. Give every candidate the same care.`,
    )
    .replace(
      SINGLE_OUTPUT,
      `## Output
Return only a JSON object, with no other text and no code fences, with one entry per candidate, in the order given:
{"candidates": [{"candidate": 1,
 "paragraphs": [{"sentences": [{"text": "...", "source": {${OUTPUT_SOURCE_FIELDS}}}]}],
 "review": [{"ref": "1.2", "verdict": "supported" | "corrected" | "re-sourced" | "removed", "note": "one short line on what you found"}]}]}
Each candidate's "review" has one entry for every sentence in that candidate's draft, by its ref. If nothing can be confirmed for a candidate, return empty "paragraphs" for them.`,
    )
}

/** The packed check's user message: each candidate's draft, numbered. */
export function packedCheckerMessage(
  items: { req: ProfileRequest; sentences: DraftSentence[][] }[],
): string {
  return items
    .map(
      ({ req, sentences }, i) =>
        `# Candidate ${i + 1} of ${items.length}\n\n${checkerMessage(req, sentences)}`,
    )
    .join('\n\n---\n\n')
}

/** The endorsement researcher's instruction. */
export function endorsementInstructions(req: ProfileRequest): string {
  const judicial = isJudicial(req.kind)
  return `${INTRO}

Find who has endorsed this candidate in their 2026 campaign for this office. Search Google and open pages (URL context) to confirm each one.

## Who counts
- Organizations: unions, advocacy and civic groups, professional groups, political parties and party organizations (for example a county party's slate), and newspaper editorial boards.
- Elected officials: people who hold or have held elected office (for example ${PLACE.officialExamples}). Leave out other individuals, including party committeepersons and party officers, and voter guides written by individuals, blogs, newsletters and Substacks.
- Only endorsements of this person for this office in the 2026 election. Prefer general-election endorsements. An endorsement from the primary counts unless newer information replaces it: the endorser withdrew it, backed someone else for the general election, or published a general-election list for this race without this candidate. Leave out endorsements from earlier campaigns or other offices, and the candidate's own committees.${judicial ? "\n- Leave out bar association ratings and evaluations; VoteStack shows those from the bar associations' own lists." : ''}

## Where to look
Search broadly, with several different searches, and confirm each endorsement on a page you opened.
- The campaign's endorsements page, if it has one; it often lists the most. Try the campaign site's pages given below, and its /endorsements page.
- The leads below, from a web search. Check each one: they may be about another person, another year or another race.
- News coverage of endorsements (${PLACE.endorsementNews}).
- Endorsers' own announcements and voter guides (for example ${PLACE.endorserExamples}${judicial ? PLACE.judicialGuide : ''}).
- Newspaper editorial board endorsements for this race.

## List
- Up to 40. If there are more, keep the most prominent: elected officials by level (federal, then statewide, then state legislature, county, city), organizations by reach (national and statewide before local).
- Within each kind, put the most prominent first.
- Use the organization's or official's full name; for an official add their office, e.g. "${PLACE.officialNameExample}".
- Each endorsement cites one page that shows it: the endorser's own announcement or list (preferred), a news report, or the campaign's endorsements page. Never cite a personal blog.
- Don't cite iVoterGuide, Ballotpedia or Wikipedia for an endorsement unless the page dates it to the 2026 campaign; they mix in earlier campaigns.
- A page that only lists the candidate as an invitee, attendee, donor or recipient of a contribution is not an endorsement.
- A page on another candidate's campaign site lists who endorses that other candidate, not who they endorse.
- Newspaper editorial endorsements from the party primaries don't count; only general-election editorials do. When a group published a general-election list for this race, use that list rather than its primary list.
- Give an official's current office as of today (for example, ${PLACE.currentOfficeExample}).
- Spell names as the endorser spells them, and list each endorser once (a state chapter and a local chapter of the same group are one endorsement unless both announced it).
- Never guess. If you find none, return an empty list.${PLACE.endorsementRules ? `\n${PLACE.endorsementRules}` : ''}

## Sources
${SOURCE_KINDS_RULE}
Give the exact URL of the page you read. Never make up or reconstruct a URL.

${IDENTITY_RULES}

## Output
Return only a JSON object, with no other text and no code fences:
{"endorsements": [{"name": "...", "kind": ${ENDORSER_KINDS.map((k) => `"${k}"`).join(' | ')}, "party": "..." | null, "source": {${OUTPUT_SOURCE_FIELDS}}}]}
"party" is for elected officials only: the party they belong to, as a source states it ("Democratic", "Republican", "Libertarian", "Green", "Independent"). Fill it for every official elected on a party ballot (${PLACE.partyBallotOffices}) whenever a source states it. Use null for organizations, for offices elected without party labels (${PLACE.nonpartisanOffices}) and when you aren't sure.${PLACE.partyNote ? ` ${PLACE.partyNote}` : ''}`
}

export function endorsementMessage(
  req: ProfileRequest,
  leads: EvidenceDoc[] = [],
  campaignPages: string[] = [],
  excerptChars = 1500,
): string {
  return [
    candidateLines(req),
    campaignPages.length
      ? `\nCampaign site pages found:\n${campaignPages.join('\n')}`
      : '',
    leads.length
      ? `\nLeads:\n\n${leads
          .map(
            (d, i) =>
              `[${i + 1}] ${d.title}\nURL: ${d.url}${d.date ? `\nDate: ${d.date}` : ''}\n${d.snippet.slice(0, excerptChars).replace(/\s+/g, ' ')}`,
          )
          .join('\n\n')}`
      : '',
  ].join('\n')
}

/** Campaign-site pages the writer cited, for the endorsement researcher. */
export function campaignPages(draft: Draft, evidence: EvidenceDoc[]): string[] {
  const urls = draft.sources
    .filter((s) => s.kind === 'candidate')
    .flatMap((s) => (evidence[s.id - 1] ? [evidence[s.id - 1].url] : []))
  return [...new Set(urls)]
}

/** The checker's answer. */
export interface Checked {
  paragraphs: { sentences: { text: string; source: PageRef }[] }[]
  review: {
    ref: string
    verdict: 'supported' | 'corrected' | 're-sourced' | 'removed'
    note: string
  }[]
}

/** The researcher's answer. */
export interface Endorsed {
  endorsements: {
    name: string
    kind: EndorsementKind
    party?: string | null
    source: PageRef
  }[]
}

/**
 * Pulls the JSON object out of a model's text answer; some models wrap it in
 * code fences or add a sentence despite the instruction.
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('No JSON object in output')
  return JSON.parse(body.slice(start, end + 1)) as T
}

/** A party name as voters read it, or undefined when it's missing or odd. */
export function partyName(
  party: string | null | undefined,
): string | undefined {
  const p = party?.trim()
  if (!p || p.length > 40) return undefined
  if (/^(d|dem|democrat|democratic( party)?)$/i.test(p)) return 'Democratic'
  if (/^(r|rep|gop|republican( party)?)$/i.test(p)) return 'Republican'
  if (/^(null|none|n\/a|unknown|nonpartisan)$/i.test(p)) return undefined
  return p.replace(/ party$/i, '')
}

const isKind = <T extends string>(all: T[], value: unknown): value is T =>
  all.includes(value as T)

/**
 * Merges the checked overview and the endorsements into one output: each
 * distinct page becomes one numbered source (the overview's first, in
 * order of use), and sentences and endorsements cite them by number.
 * Entries without a usable URL are dropped.
 */
export function mergeStages(
  checked: Checked | undefined,
  endorsed: Endorsed | undefined,
): ProfileOutput {
  const sources: Omit<ProfileSource, 'viewedAt'>[] = []
  const idOf = (page: PageRef | undefined): number | undefined => {
    if (!page?.url || !/^https?:\/\//.test(page.url)) return undefined
    const existing = sources.find((s) => s.url === page.url)
    if (existing) return existing.id
    const id = sources.length + 1
    sources.push({
      id,
      title: page.title || page.url,
      publisher: page.publisher || new URL(page.url).hostname,
      url: page.url,
      kind: isKind(SOURCE_KINDS, page.kind) ? page.kind : 'news',
    })
    return id
  }

  const overview = (checked?.paragraphs ?? []).flatMap((p) => {
    const sentences = (p.sentences ?? []).flatMap((s) => {
      const id = idOf(s.source)
      const text = s.text?.trim()
      return id && text ? [{ text, cites: [id] }] : []
    })
    return sentences.length ? [paragraphOf(sentences)] : []
  })

  // "Chairs' Association" and "Chairs Association" are the same endorser.
  const sameName = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const seen = new Set<string>()
  const endorsements: Endorsement[] = []
  for (const e of endorsed?.endorsements ?? []) {
    const name = e.name?.trim()
    if (!name || seen.has(sameName(name))) continue
    if (!isKind(ENDORSER_KINDS, e.kind)) continue
    const id = idOf(e.source)
    if (!id) continue
    seen.add(sameName(name))
    const party = e.kind === 'elected_official' ? partyName(e.party) : undefined
    endorsements.push({
      organization: name,
      kind: e.kind,
      ...(party && { party }),
      cites: [id],
    })
  }

  return { overview, endorsements, sources }
}
