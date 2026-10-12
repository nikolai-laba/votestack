// Research briefs per office type (prompt f006-1): the searches that
// gather evidence for the writer, and the sources each stage should look at
// first. Every candidate for the same office gets the same brief, so no one
// in a race is researched harder than an opponent.

import type { ProfileRequest } from './prompt.ts'
import type { OfficeType } from './subjects.ts'

export interface ResearchBrief {
  /** Where the record for this office lives, for the writer and checker. */
  focus: string
  /** Searches after the two every candidate gets (name + office, news). */
  queries: (q: QueryParts) => string[]
}

interface QueryParts {
  /** The name in quotes, e.g. "\"Juliana Stratton\"". */
  name: string
  office: string
}

const LEGISLATIVE_FOCUS =
  'For positions and record: bills they sponsored and how they voted (ilga.gov), Capitol News Illinois, the Chicago Tribune, the Chicago Sun-Times, WBEZ, local papers, and candidate questionnaires (Sun-Times, Ballotpedia Candidate Connection, IVI-IPO).'

const BRIEFS: Record<OfficeType, ResearchBrief> = {
  us_senate: {
    focus:
      'For positions: the campaign issues page, news coverage of the campaign (AP, Chicago Tribune, Chicago Sun-Times, WBEZ, Capitol News Illinois, Politico), debates and questionnaires. For record: votes and bills from current or past offices (congress.gov, ilga.gov) and major initiatives they led.',
    queries: ({ name }) => [
      `${name} Senate positions issues`,
      `${name} questionnaire 2026`,
      `${name} record bills votes`,
      `${name} plan proposal policy`,
    ],
  },
  us_house: {
    focus:
      'For positions: the campaign issues page, news coverage (Chicago Tribune, Chicago Sun-Times, WBEZ, Daily Herald, local papers), questionnaires. For record: votes and bills on congress.gov for incumbents, and past offices for others.',
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} questionnaire 2026`,
      `${name} congress.gov bills votes`,
      `${name} Congress record`,
    ],
  },
  statewide: {
    focus:
      'For positions: the campaign issues page, news coverage (Capitol News Illinois, Chicago Tribune, Chicago Sun-Times, WBEZ, State Journal-Register), questionnaires and debates. For record: what they did in office (state agency sites, ilga.gov for past legislators).',
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} questionnaire 2026`,
      `${name} record in office`,
      `${name} Capitol News Illinois`,
    ],
  },
  county_executive: {
    focus:
      'For positions and record: the office’s own site (cookcountyil.gov and the office’s site), the campaign site, Chicago Tribune, Chicago Sun-Times, Crain’s Chicago Business, WBEZ, Block Club Chicago, questionnaires.',
    queries: ({ name, office }) => [
      `${name} ${office} positions`,
      `${name} questionnaire 2026`,
      `${name} Cook County record budget`,
      `${name} Crain's Chicago`,
    ],
  },
  state_legislature: {
    focus: LEGISLATIVE_FOCUS,
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} ilga.gov bills sponsored`,
      `${name} questionnaire 2026`,
      `${name} Capitol News Illinois`,
    ],
  },
  county_board: {
    focus:
      'For positions and record: the commissioner’s page on cookcountyil.gov, ordinances and budget votes, Chicago Tribune, Chicago Sun-Times, WBEZ, Block Club Chicago, local papers, questionnaires.',
    queries: ({ name }) => [
      `${name} Cook County Board commissioner`,
      `${name} questionnaire 2026`,
      `${name} ordinance budget vote`,
      `${name} positions issues`,
    ],
  },
  board_of_review: {
    focus:
      'For positions and record: property tax appeals and assessments, the Board of Review site (cookcountyboardofreview.com), Chicago Tribune, Chicago Sun-Times, Crain’s Chicago Business, WBEZ, questionnaires.',
    queries: ({ name }) => [
      `${name} Board of Review property tax`,
      `${name} questionnaire 2026`,
      `${name} assessment appeals`,
      `${name} positions issues`,
    ],
  },
  water_reclamation: {
    focus:
      'For positions and record: the MWRD site (mwrd.org), flooding, stormwater and water treatment work, Chicago Tribune, Chicago Sun-Times, WBEZ, questionnaires (IVI-IPO, Sierra Club Illinois).',
    queries: ({ name }) => [
      `${name} MWRD commissioner`,
      `${name} questionnaire 2026`,
      `${name} flooding stormwater water reclamation`,
      `${name} positions issues`,
    ],
  },
  school_board: {
    focus:
      'For positions and record: Chalkbeat Chicago, WBEZ, the Chicago Sun-Times and Chicago Tribune, Block Club Chicago, candidate questionnaires (Chalkbeat, WBEZ, Sun-Times), Chicago Board of Education votes, and their work in schools or community groups.',
    queries: ({ name }) => [
      `${name} Chicago Board of Education`,
      `${name} Chalkbeat Chicago`,
      `${name} questionnaire 2026 school board`,
      `${name} Chicago Public Schools positions`,
    ],
  },
  judicial_candidate: {
    focus:
      'For background and record: court and bar pages (illinoiscourts.gov, cookcountycourt.org), bar association evaluations (they describe experience), Injustice Watch, Chicago Tribune, Chicago Sun-Times, Chicago Daily Law Bulletin, their law practice or past positions.',
    queries: ({ name }) => [
      `${name} judge Cook County`,
      `${name} attorney Illinois`,
      `${name} Injustice Watch`,
      `${name} judicial evaluation 2026`,
    ],
  },
  retention: {
    focus:
      'For background and record: court pages (illinoiscourts.gov, cookcountycourt.org), bar association evaluations (they describe experience and assignments), Injustice Watch, Chicago Tribune, Chicago Sun-Times, Chicago Daily Law Bulletin, and notable rulings reported in the news.',
    queries: ({ name }) => [
      `${name} judge Cook County`,
      `${name} judge ruling`,
      `${name} Injustice Watch`,
      `${name} retention 2026`,
    ],
  },
  regional_superintendent: {
    focus:
      'For positions and record: the regional office of education’s site, school district and local news, the Daily Herald and local papers, questionnaires.',
    queries: ({ name }) => [
      `${name} regional superintendent of schools`,
      `${name} education`,
      `${name} questionnaire 2026`,
      `${name} Cook County schools`,
    ],
  },
  sanitary_district: {
    focus:
      'For background and record: the district’s own site, the village or township site, and local papers. Little may be published; that is fine.',
    queries: ({ name }) => [
      `${name} sanitary district trustee`,
      `${name} trustee Illinois`,
      `${name} village township`,
      `${name} election 2026`,
    ],
  },
  other: {
    focus:
      'For positions and record: official sites for the office, local news, questionnaires.',
    queries: ({ name, office }) => [
      `${name} ${office} positions`,
      `${name} questionnaire 2026`,
      `${name} record`,
      `${name} Illinois news`,
    ],
  },
}

/** A fallback office type from the request, for runs without subjects.json. */
function officeTypeOf(req: ProfileRequest): OfficeType {
  if (req.officeType) return req.officeType
  if (req.kind === 'retention') return 'retention'
  if (req.kind === 'judicial_candidate') return 'judicial_candidate'
  return 'other'
}

export function briefFor(req: ProfileRequest): ResearchBrief {
  return BRIEFS[officeTypeOf(req)]
}

/**
 * Every search for one candidate: name and office, news, the brief's
 * searches, and endorsements. Run 5 to a request (the Search API's limit).
 */
export function researchQueries(req: ProfileRequest): string[] {
  const name = `"${req.name}"`
  const parts = { name, office: req.office }
  return [
    `${name} ${req.office} Illinois`,
    `${name} Chicago news 2026`,
    ...briefFor(req).queries(parts),
    `${name} endorsements 2026`,
    `${name} biography background`,
  ]
}

/** Searches for endorsement leads, one request (5 queries). */
export function endorsementQueries(req: ProfileRequest): string[] {
  const name = `"${req.name}"`
  return [
    `${name} endorsements`,
    `endorses ${name} 2026`,
    `${name} endorsed by union`,
    `${name} ${req.office} endorsement`,
    req.kind === 'candidate'
      ? `editorial board endorsement ${name}`
      : `${name} judge endorsed 2026`,
  ]
}
