// The place-specific words in the research prompts, per region (--region,
// see region.ts): where the guide is, the election, which official sources
// and news outlets to use, and examples of endorsers. Cook County's text is
// the text the published Cook profiles were made with; keep it unchanged.

import { REGION } from './region.ts'

export interface PromptPlace {
  /** "Cook County, Illinois". */
  guide: string
  /** Where a namesake's career should be: "Illinois". */
  careerIn: string
  /** The election line in every user message. */
  electionLine: string
  /** Official sources in the list of allowed source kinds. */
  officialSources: string
  /** Example publisher names for the writer's source list. */
  publisherExamples: string
  /** News outlets that cover endorsements. */
  endorsementNews: string
  /** Endorsers' own announcements and voter guides to check. */
  endorserExamples: string
  /** An extra guide for judicial races, appended to the endorsers. */
  judicialGuide: string
  /** Elected officials whose endorsements count. */
  officialExamples: string
  /** An official named with their office. */
  officialNameExample: string
  /** An official whose office changed. */
  currentOfficeExample: string
  /** Offices elected with party labels. */
  partyBallotOffices: string
  /** Offices elected without party labels. */
  nonpartisanOffices: string
  /** Bar evaluations that judicial candidates' profiles use. */
  barEvaluations: string
  /** Extra endorsement rules for this place, one "- " line each (none for Cook County). */
  endorsementRules: string
  /** Extra guidance on endorsers' party labels (none for Cook County). */
  partyNote: string
  /**
   * Sites never used as sources: voter-guide aggregators and one person's
   * guides, which restate others' reporting, sometimes written by AI. Their
   * pages are dropped from search results before anyone sees them.
   */
  blockedSites: string[]
  /** Extra writer rules, one "- " line each (none for Cook County). */
  writerRules: string
  /** The checker's first step for each sentence. */
  checkerOpenStep: string
  /**
   * County parties that ratify their state party's picks, with that state
   * party: when a profile lists both, the county party is dropped (it's one
   * endorsement). None for Cook County.
   */
  partyPairs: [county: string, state: string][]
  /**
   * Groups whose support says nothing about a candidate's positions
   * (Ballotpedia's descriptive test: an organization counts when it has
   * clear, identifiable issue stances), such as alumni and hometown
   * associations, homeowners associations and service clubs. Matched
   * against the endorser's name, ignoring case.
   */
  excludedEndorsers: RegExp[]
}

const COOK: PromptPlace = {
  guide: 'Cook County, Illinois',
  careerIn: 'Illinois',
  electionLine:
    'Election: Illinois general election, Tuesday, November 3, 2026, Cook County.',
  officialSources:
    '.gov sites, the Illinois State Board of Elections, the FEC, ilga.gov, courts',
  publisherExamples:
    '"Chicago Sun-Times", "Ballotpedia", "Juliana Stratton campaign"',
  endorsementNews:
    "Chicago Tribune, Chicago Sun-Times, Capitol News Illinois, WBEZ, Crain's, Daily Herald, local papers",
  endorserExamples:
    "the Chicago Federation of Labor, Illinois AFL-CIO, the Cook County Democratic Party, the Cook County Republican Party, IVI-IPO, Personal PAC, Planned Parenthood Illinois Action, Sierra Club Illinois, Giffords, Moms Demand Action, Chicago Teachers Union, SEIU, Illinois Education Association, Fraternal Order of Police, Illinois Chamber of Commerce, Illinois Manufacturers' Association",
  judicialGuide: ", Injustice Watch's judicial guide",
  officialExamples:
    'senators, members of Congress, the governor, state legislators, mayors, aldermen, county commissioners',
  officialNameExample: 'U.S. Sen. Tammy Duckworth',
  currentOfficeExample:
    'someone who moved from the county board to the City Council is an alderman now',
  partyBallotOffices: 'federal, statewide, state legislature, county',
  nonpartisanOffices:
    'mayors, village and township officials, Chicago aldermen, judges, Chicago school board',
  barEvaluations:
    'the Alliance of Bar Associations for Judicial Screening (voteforjudges.org), the Chicago Bar Association, the Chicago Council of Lawyers and the Illinois State Bar Association',
  endorsementRules: '',
  partyNote: '',
  blockedSites: [],
  partyPairs: [],
  excludedEndorsers: [],
  writerRules: '',
  checkerOpenStep:
    "1. Open the page it cites. If the page can't be opened, use the excerpt given with it, which was captured from that page.",
}

const LOS_ANGELES: PromptPlace = {
  guide: 'Los Angeles County, California',
  careerIn: 'California',
  electionLine:
    'Election: California general election, Tuesday, November 3, 2026, Los Angeles County.',
  officialSources:
    '.gov sites, the California Secretary of State, the Los Angeles County Registrar-Recorder/County Clerk (lavote.gov), the FEC, leginfo.legislature.ca.gov, courts',
  publisherExamples: '"Los Angeles Times", "Ballotpedia", "Jane Doe campaign"',
  endorsementNews:
    'Los Angeles Times, LAist, Los Angeles Daily News, CalMatters, Daily Breeze, Pasadena Star-News, Long Beach Post, local papers',
  endorserExamples:
    'the Los Angeles County Federation of Labor, the California Labor Federation, the Los Angeles County Democratic Party, the Republican Party of Los Angeles County, the California Democratic Party, the California Republican Party, Planned Parenthood Advocates California, the Sierra Club Angeles Chapter, the California League of Conservation Voters, United Teachers Los Angeles, the California Teachers Association, SEIU, Equality California, the Howard Jarvis Taxpayers Association, the Los Angeles Police Protective League, BizFed',
  judicialGuide: '',
  officialExamples:
    'senators, members of Congress, the governor, state legislators, county supervisors, mayors, city council members',
  officialNameExample: 'U.S. Sen. Alex Padilla',
  currentOfficeExample:
    'someone who moved from a city council to the State Assembly is an Assembly member now',
  partyBallotOffices:
    'federal, statewide except Superintendent of Public Instruction, state legislature',
  nonpartisanOffices:
    'county offices and supervisors, mayors, city council members, school, college and special district boards, judges, Superintendent of Public Instruction',
  barEvaluations:
    "the Los Angeles County Bar Association's Judicial Elections Evaluation Committee",
  endorsementRules: `- Sitting judges and court commissioners are not elected officials for this list; leave them out.
- A county party ratifying its state party's endorsement is the same endorsement: list the state party once, not both.
- A party's "recommended" rating that the party itself says is not an endorsement doesn't count.
- For the most prominent endorsers (up to about 10), confirm each on the endorser's own page or in news coverage before citing the campaign's list; cite the campaign's list only when neither shows it.`,
  partyNote:
    'For a sitting federal or state official, their own official government page (for example their .gov biography) counts as a source for their party.',
  partyPairs: [
    ['Los Angeles County Democratic Party', 'California Democratic Party'],
    ['Republican Party of Los Angeles County', 'California Republican Party'],
  ],
  excludedEndorsers: [
    /alumni association/i,
    /\bhomeowners'? association\b|\bHOA\b/i,
    /\b(kiwanis|rotary|lions)( club)?\b/i,
    /\bpen club\b/i,
    /academy of fine arts/i,
    // Hometown associations ("Shaanxi Association of the United States").
    /\bassociation of (the united states|america)$/i,
  ],
  blockedSites: [
    '2026election.com',
    'aprilsballot.com',
    'azvoterguide.com',
    'ballotexplained.com',
    'ballotpages.com',
    'ballotready.org',
    'bayballot.com',
    'bergtholdelectionvoterguide.blog',
    'bluevoterguide.org',
    'butwhatcanyoudo.org',
    'candidatefilings.com',
    'change.vote',
    'cityhallpass.com',
    'civic-mirror.com',
    'civicapi.org',
    'civoren.com',
    'decodethevote.com',
    'electionscali.com',
    'everyelection.app',
    'factually.co',
    'freedomvoterguide.com',
    'garrysguide.org',
    'ivotela.org',
    'knowyoursenator.org',
    'newsagencyamerica.com',
    'politicaldna.org',
    'politicalmediamonitor.com',
    'religiopoliticaltalk.com',
    'repbio.org',
    'sdvote.com',
    'smarter.vote',
    'sway.co',
    'themarijuanaherald.com',
    'theballotbrief.com',
    'vote-usa.org',
    'voteorelse.com',
    'voterguide.craighuey.com',
    'wtfvote.us',
  ],
  writerRules: `- The first sentence names the candidate and the office they hold or held, or their occupation (e.g. "Jane Doe is a member of the Glendale City Council."), never just "She is…".
- A bill, vote or position from before 2025 says the year ("In 2023 she wrote a bill…").
- When the candidate's cited sources report a major lawsuit, investigation or official dispute about the candidate's own conduct in office, state it neutrally, as the sources describe it.
- Never use an endorser's guide or endorsement blurb as a source for who the candidate is.`,
  checkerOpenStep:
    '1. Open the page it cites with URL context. Always open it, even when the excerpt seems enough; the excerpt is a short capture and can leave things out. If the page can\'t be opened (a paywall or a block), judge the sentence by the excerpt: keep it if the excerpt states everything in it, and begin its review note with "Excerpt only:". Never remove a sentence only because the page wouldn\'t open.',
}

export const PLACE: PromptPlace = REGION.id === 'ca-la' ? LOS_ANGELES : COOK

/** Whether a page is on a site this place never uses as a source. */
export function isBlockedSite(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return PLACE.blockedSites.some((d) => host === d || host.endsWith(`.${d}`))
}
