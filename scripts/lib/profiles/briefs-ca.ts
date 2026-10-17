// Research briefs for Los Angeles County, California: the same shape as the
// Cook County briefs in briefs.ts, with California's records, papers and
// questionnaires. Every candidate for the same office gets the same brief,
// so no one in a race is researched harder than an opponent.

import type { ResearchBrief } from './briefs.ts'
import type { ProfileRequest } from './prompt.ts'
import type { OfficeType } from './subjects.ts'

/**
 * The city or district in a local office's name ("City of Burbank, City
 * Clerk" → "Burbank"; "Walnut Valley Water District, Member, …" → "Walnut
 * Valley Water District"), or "Los Angeles" for county, state and federal
 * offices, whose names don't start with a place.
 */
export function placeOf(office: string): string {
  const first = office.split(',')[0].trim()
  if (!office.includes(',')) return 'Los Angeles'
  if (/^City of /i.test(first)) return first.replace(/^City of /i, '')
  if (/\b(District|Agency|Authority)$/i.test(first)) return first
  return 'Los Angeles'
}

const LOCAL_NEWS =
  'the Los Angeles Times, LAist, the Los Angeles Daily News and the area’s local paper (Daily Breeze, Pasadena Star-News, San Gabriel Valley Tribune, Long Beach Post, Santa Clarita Valley Signal, Antelope Valley Press, Santa Monica Daily Press, Pasadena Now)'

const VOTER_GUIDE =
  'the candidate statement in the county’s official voter information guide (lavote.gov)'

const QUESTIONNAIRES =
  'questionnaires and forums (Voter’s Edge, Ballotpedia Candidate Connection, LA Forward, League of Women Voters and chamber of commerce forums)'

const LEGISLATIVE_FOCUS = `For positions and record: bills they wrote and how they voted (leginfo.legislature.ca.gov, CalMatters’ Digital Democracy), CalMatters, ${LOCAL_NEWS}, ${VOTER_GUIDE}, and ${QUESTIONNAIRES}.`

const SPECIAL_DISTRICT: ResearchBrief = {
  focus: `For background and record: the district’s own site (board members, agendas and minutes), ${VOTER_GUIDE}, local papers (Daily Breeze, Pasadena Star-News, San Gabriel Valley Tribune, Santa Clarita Valley Signal, Antelope Valley Press) and candidate forums. Little may be published; that is fine.`,
  queries: ({ name, place }) => [
    `${name} ${place} board member`,
    `${name} ${place} board meeting`,
    `${name} candidate statement 2026`,
    `${name} candidate forum`,
  ],
}

const OTHER: ResearchBrief = {
  focus: `For positions and record: official sites for the office, ${VOTER_GUIDE}, local news, ${QUESTIONNAIRES}.`,
  queries: ({ name, office }) => [
    `${name} ${office} positions`,
    `${name} questionnaire 2026`,
    `${name} record`,
    `${name} Los Angeles County news`,
  ],
}

export const CA_BRIEFS: Record<OfficeType, ResearchBrief> = {
  us_senate: {
    focus:
      'For positions: the campaign issues page, news coverage of the campaign (AP, CalMatters, the Los Angeles Times, LAist, Politico California), debates, the candidate statement in the state voter guide (voterguide.sos.ca.gov) and questionnaires (Voter’s Edge, Ballotpedia). For record: votes and bills from current or past offices (congress.gov, leginfo.legislature.ca.gov) and major initiatives they led.',
    queries: ({ name }) => [
      `${name} Senate positions issues`,
      `${name} questionnaire 2026`,
      `${name} record bills votes`,
      `${name} CalMatters`,
    ],
  },
  us_house: {
    focus: `For positions: the campaign issues page, news coverage (${LOCAL_NEWS}), questionnaires (Voter’s Edge, Ballotpedia Candidate Connection) and candidate forums. For record: votes and bills on congress.gov for incumbents, and past offices for others (leginfo.legislature.ca.gov for past state legislators).`,
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} questionnaire 2026`,
      `${name} congress.gov bills votes`,
      `${name} Congress record`,
    ],
  },
  statewide: {
    focus:
      'For positions: the campaign issues page, news coverage (CalMatters, the Los Angeles Times, LAist, AP, Politico California, the Sacramento Bee), debates, the candidate statement in the state voter guide (voterguide.sos.ca.gov) and questionnaires (Voter’s Edge, Ballotpedia). For record: what they did in office (state agency sites, leginfo.legislature.ca.gov for past legislators, local government sites for past city or county officials).',
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} questionnaire 2026`,
      `${name} record in office`,
      `${name} CalMatters`,
    ],
  },
  board_of_equalization: {
    focus: `For positions and record: the Board of Equalization’s site (boe.ca.gov), property tax and tax administration work, CalMatters, ${LOCAL_NEWS}, leginfo.legislature.ca.gov for past legislators, the candidate statement in the state voter guide (voterguide.sos.ca.gov), and ${QUESTIONNAIRES}.`,
    queries: ({ name }) => [
      `${name} Board of Equalization`,
      `${name} questionnaire 2026`,
      `${name} property tax record`,
      `${name} CalMatters`,
    ],
  },
  county_executive: {
    focus: `For positions and record: the office’s own site (lacounty.gov and the department’s site), reports from the county’s oversight bodies (Civilian Oversight Commission, Office of Inspector General), ${LOCAL_NEWS}, CalMatters, ${VOTER_GUIDE}, and ${QUESTIONNAIRES}.`,
    queries: ({ name, office }) => [
      `${name} ${office} positions`,
      `${name} questionnaire 2026`,
      `${name} Los Angeles County record budget`,
      `${name} LAist`,
    ],
  },
  state_legislature: {
    focus: LEGISLATIVE_FOCUS,
    queries: ({ name, office }) => [
      `${name} ${office} positions issues`,
      `${name} bills authored legislature`,
      `${name} questionnaire 2026`,
      `${name} CalMatters`,
    ],
  },
  county_board: {
    focus: `For positions and record: the supervisor’s page and Board of Supervisors motions and votes (bos.lacounty.gov), ${LOCAL_NEWS}, ${VOTER_GUIDE}, and ${QUESTIONNAIRES}.`,
    queries: ({ name }) => [
      `${name} Los Angeles County Board of Supervisors`,
      `${name} questionnaire 2026`,
      `${name} motion budget vote`,
      `${name} positions issues`,
    ],
  },
  city_executive: {
    focus: `For positions and record: the city’s own site (city council agendas, minutes and staff reports, the city clerk’s election page), ${LOCAL_NEWS}, ${VOTER_GUIDE}, and ${QUESTIONNAIRES}. For a past city office, its council votes and reports.`,
    queries: ({ name, office, place }) => [
      `${name} ${office} positions`,
      `${name} ${place} city council`,
      `${name} ${place} candidate forum`,
      `${name} questionnaire 2026`,
    ],
  },
  city_council: {
    focus: `For positions and record: the city’s own site (council agendas, minutes and votes), ${LOCAL_NEWS}, ${VOTER_GUIDE}, and ${QUESTIONNAIRES}.`,
    queries: ({ name, place }) => [
      `${name} ${place} City Council`,
      `${name} ${place} council vote`,
      `${name} ${place} candidate forum`,
      `${name} questionnaire 2026`,
    ],
  },
  school_board: {
    focus: `For positions and record: the school district’s own site (board members, agendas and minutes), ${VOTER_GUIDE}, EdSource, ${LOCAL_NEWS}, candidate forums and questionnaires (Voter’s Edge, Ballotpedia, League of Women Voters, parent and teacher groups), and their work in schools or community groups. Little may be published; that is fine.`,
    queries: ({ name, place }) => [
      `${name} ${place} school board`,
      `${name} ${place} trustee`,
      `${name} school board candidate forum 2026`,
      `${name} questionnaire 2026 school board`,
    ],
  },
  community_college: {
    focus: `For positions and record: the college district’s own site (board of trustees, agendas and minutes), ${VOTER_GUIDE}, EdSource, ${LOCAL_NEWS}, candidate forums and questionnaires (Voter’s Edge, Ballotpedia, League of Women Voters). Little may be published; that is fine.`,
    queries: ({ name, place }) => [
      `${name} ${place} trustee`,
      `${name} community college board`,
      `${name} candidate forum 2026`,
      `${name} questionnaire 2026`,
    ],
  },
  special_district: SPECIAL_DISTRICT,
  judicial_candidate: {
    focus:
      'For background and record: the Los Angeles County Bar Association’s Judicial Elections Evaluation Committee rating (lacba.org; it describes experience), the State Bar attorney profile (calbar.ca.gov), the Superior Court’s site, the candidate statement in the county’s official voter information guide (lavote.gov), LAist’s judicial voter guide, the Los Angeles Times, the Daily Journal, the Metropolitan News-Enterprise, and their law practice or past positions (prosecutor, public defender, firm).',
    queries: ({ name }) => [
      `${name} Los Angeles County Superior Court`,
      `${name} attorney California`,
      `${name} Los Angeles County Bar Association rating`,
      `${name} judge LAist 2026`,
    ],
  },
  retention: {
    focus:
      'For background and record: the court’s biography page (courts.ca.gov), the Governor’s appointment announcement (gov.ca.gov), Commission on Judicial Appointments confirmation coverage (courts.ca.gov newsroom), the Daily Journal, the Metropolitan News-Enterprise, the Los Angeles Times, and notable opinions reported in the news.',
    queries: ({ name }) => [
      `${name} justice appointed Governor`,
      `${name} Commission on Judicial Appointments`,
      `${name} justice opinion ruling`,
      `${name} retention 2026`,
    ],
  },
  // Offices on Cook County's ballot only.
  board_of_review: OTHER,
  water_reclamation: SPECIAL_DISTRICT,
  regional_superintendent: OTHER,
  sanitary_district: SPECIAL_DISTRICT,
  other: OTHER,
}

/**
 * Every search for one candidate: name and office, local news, the brief's
 * searches, and endorsements.
 */
export function caResearchQueries(
  req: ProfileRequest,
  brief: ResearchBrief,
): string[] {
  const name = `"${req.name}"`
  const place = placeOf(req.office)
  const office = /california/i.test(req.office)
    ? req.office
    : `${req.office} California`
  return [
    `${name} ${office}`,
    `${name} ${place} news 2026`,
    ...brief.queries({ name, office: req.office, place }),
    `${name} endorsements 2026`,
    `${name} biography background`,
  ]
}

/** Searches for endorsement leads, one request (5 queries). */
export function caEndorsementQueries(req: ProfileRequest): string[] {
  const name = `"${req.name}"`
  return [
    `${name} endorsements 2026`,
    `endorses ${name} 2026`,
    `${name} ${req.office} endorsement`,
    `${name} voter guide endorsements Los Angeles`,
    req.kind === 'candidate'
      ? `editorial board endorsement ${name}`
      : `${name} judge endorsed 2026`,
  ]
}
