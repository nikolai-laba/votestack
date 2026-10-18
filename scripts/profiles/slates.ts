// Downloads published general-election endorsement lists (slates) and
// writes content/profiles/slates/{slug}.json (committed; another region's
// lists go in content/profiles/slates/{region}/), with each entry matched to
// a person on the ballot by name and office. generate merges matched entries
// into profiles. Needs `pdftotext` (poppler) and the region's subjects.json.
//
// Entries that fit no one, or more than one person, are printed for review
// and never merged.
//
// Lists no parser reads are transcribed by a researcher into
// content/profiles/slates-transcribed[/{region}]/{slug}.json (each entry with
// the office as our ballots name it and the exact text on the page), and
// matched here the same way.
//
// Run:  node scripts/profiles/slates.ts [--region ca-la] [--only slug,slug]

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  PIPELINE_BUILD,
  SLATES_DIR,
  TRANSCRIBED_DIR,
  readSubjects,
  today,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import { IS_COOK, REGION, REGION_OPTION } from '../lib/profiles/region.ts'
import {
  parseAflCio,
  parseCadem,
  parseCagop,
  parseCfl,
  parseCft,
  parseCplc,
  parseCra,
  parseCraLa,
  parseCta,
  parseDfiLa,
  parseDsaLa,
  parseEnviroVoters,
  parseLacdp,
  parseLaFed,
  parseKnockLa,
  parseLaForward,
  parseLagop,
  parseLavoteParties,
  parseLocal150,
  parsePersonalPac,
  parsePpapLa,
  parseReformCa,
  parseSeiu721,
  parseUtla,
  parseWfpCa,
  type ParsedEntry,
} from '../lib/profiles/slate-parsers.ts'
import {
  matchSlate,
  slateNameMatches,
  type Slate,
} from '../lib/profiles/slates.ts'
import type { OfficeType } from '../lib/profiles/subjects.ts'

const { values } = parseArgs({
  options: { only: { type: 'string' }, ...REGION_OPTION },
})

const USER_AGENT = 'VoteStack data import (votestack.org)'
const WORK = join(PIPELINE_BUILD, 'slates')

interface Source extends Omit<Slate, 'entries' | 'fetchedAt'> {
  /** Downloads the list and returns its entries; may set documentUrl. */
  read(): Promise<{ entries: ParsedEntry[]; documentUrl?: string }>
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** A PDF's words with positions (pdftotext -bbox). */
async function pdfBbox(url: string, slug: string): Promise<string> {
  const pdf = join(WORK, `${slug}.pdf`)
  await mkdir(WORK, { recursive: true })
  const bytes = await download(url)
  if (bytes.subarray(0, 4).toString() !== '%PDF')
    throw new Error(`${url} isn't a PDF`)
  await writeFile(pdf, bytes)
  return execFileSync('pdftotext', ['-bbox', pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

const html = async (url: string) => (await download(url)).toString('utf8')

/** The first link on a page that fits `pattern`, as an absolute URL. */
async function linkOn(page: string, pattern: RegExp): Promise<string> {
  const found = (await html(page)).match(pattern)?.[0]
  if (!found) throw new Error(`No link fitting ${pattern} on ${page}`)
  return new URL(found, page).href
}

const COOK_SOURCES: Source[] = [
  {
    slug: 'chicago-federation-of-labor',
    endorser: 'Chicago Federation of Labor',
    kind: 'union',
    title: 'November 3, 2026 General Election Endorsed Candidates',
    publisher: 'Chicago Federation of Labor',
    url: 'https://chicagolabor.org/wp-content/uploads/CFL-2026-General-Election-Endorsements.pdf',
    note: 'Most State House names are drawn as outlines without text; they were read off the PDF by hand (CFL_STATE_HOUSE_TRANSCRIBED in scripts/lib/profiles/slate-parsers.ts), and the parser stops if the districts change. "Neutral" races are left out.',
    async read() {
      return { entries: parseCfl(await pdfBbox(this.url, this.slug)) }
    },
  },
  {
    slug: 'personal-pac',
    endorser: 'Personal PAC',
    kind: 'organization',
    title: 'Personal PAC 2026 General Election Endorsements',
    publisher: 'Personal PAC',
    url: 'https://personalpac.org/elections/',
    note: 'Lists more than one candidate in some Chicago school board subdistricts; each listed candidate is endorsed.',
    async read() {
      const html = (await download(this.url)).toString('utf8')
      return { entries: parsePersonalPac(html) }
    },
  },
  {
    slug: 'iuoe-local-150',
    endorser: 'International Union of Operating Engineers Local 150',
    kind: 'union',
    title:
      'IUOE Local 150 Illinois Endorsements, General Election, November 3, 2026 (Cook County)',
    publisher: 'IUOE Local 150',
    url: 'https://local150.org/wp-content/uploads/2026/08/2026-IL-GE_D1_Cook-County_83126.pdf',
    async read() {
      return { entries: parseLocal150(await pdfBbox(this.url, this.slug)) }
    },
  },
  {
    slug: 'illinois-afl-cio',
    endorser: 'Illinois AFL-CIO',
    kind: 'union',
    title: 'Illinois AFL-CIO Announces Endorsements for 2026 General Election',
    publisher: 'Illinois AFL-CIO',
    url: 'https://www.ilaflcio.org/release-general-endorsements-072026/',
    note: 'The release embeds the list as a PDF on Google Drive (documentUrl); profiles cite the release. Statewide list: offices outside Cook County are marked "outside".',
    async read() {
      const page = (await download(this.url)).toString('utf8')
      const id = page.match(/drive\.google\.com\/file\/d\/([\w-]+)/)?.[1]
      if (!id) throw new Error(`No Google Drive file on ${this.url}`)
      const documentUrl = `https://drive.google.com/file/d/${id}/view`
      const bbox = await pdfBbox(
        `https://drive.google.com/uc?export=download&id=${id}`,
        this.slug,
      )
      return { entries: parseAflCio(bbox), documentUrl }
    },
  },
]

const LA_SOURCES: Source[] = [
  {
    slug: 'los-angeles-county-democratic-party',
    endorser: 'Los Angeles County Democratic Party',
    kind: 'party',
    title: 'Endorsed Candidates, 2026 General Election (November 3, 2026)',
    publisher: 'Los Angeles County Democratic Party',
    url: 'https://www.lacdp.org/candidates',
    note: 'Cards for federal, state, county and Los Angeles city races (including the state party\'s endorsements the county party ratified), then local races by office. "No Consensus" and "No Endorsement" are left out.',
    async read() {
      return { entries: parseLacdp(await html(this.url)) }
    },
  },
  {
    slug: 'republican-party-of-los-angeles-county',
    endorser: 'Republican Party of Los Angeles County',
    kind: 'party',
    title: 'LAGOP Endorsement Lookup, November 3, 2026 General Election',
    publisher: 'Republican Party of Los Angeles County',
    url: 'https://lagop-endorsement-lookup.vercel.app/',
    note: 'The party\'s endorsement lookup, linked from lagop.org; profiles cite it, since it shows each endorsement. The candidate data is in the lookup page\'s script bundle (documentUrl). Candidates marked "Endorsed by LAGOP" or "Recommended" are entries. The lookup also shows the state party\'s statewide picks, Reform California\'s endorsements, judicial picks credited to Steve Cooley ("Recommended (Steve Cooley)"), races where "Either is acceptable" and candidates it opposes; those are left out.',
    async read() {
      const lookup = this.url
      if (!(await html('https://lagop.org/')).includes(lookup))
        throw new Error(`lagop.org no longer links ${lookup}`)
      const page = await html(lookup)
      const chunk = page.match(
        /\/_next\/static\/chunks\/app\/page-[\w]+\.js[^"]*/,
      )?.[0]
      if (!chunk) throw new Error(`No page script on ${lookup}`)
      const documentUrl = new URL(chunk, lookup).href
      return { entries: parseLagop(await html(documentUrl)), documentUrl }
    },
  },
  {
    slug: 'california-democratic-party',
    endorser: 'California Democratic Party',
    kind: 'party',
    title: '2026 General Election Endorsements & Ballot Measure Positions',
    publisher: 'California Democratic Party',
    url: 'https://cadem.org/wp-content/uploads/2026/08/FINAL-2026-General-Election-Endorsements.pdf',
    note: 'Statewide list: offices outside Los Angeles County are marked "outside". "No Consensus" is left out.',
    async read() {
      return { entries: parseCadem(await pdfBbox(this.url, this.slug)) }
    },
  },
  {
    slug: 'california-republican-party',
    endorser: 'California Republican Party',
    kind: 'party',
    title: '2026 CRP Endorsements',
    publisher: 'California Republican Party',
    url: 'https://cagop.org/endorsements/',
    note: 'Statewide list: offices outside Los Angeles County are marked "outside". Ballot measure positions are left out.',
    async read() {
      return { entries: parseCagop(await html(this.url)) }
    },
  },
  {
    slug: 'los-angeles-county-federation-of-labor',
    endorser: 'Los Angeles County Federation of Labor',
    kind: 'union',
    title:
      '2026 Midterm Election: LA County Federation of Labor Endorsements (Official Voter Guide)',
    publisher: 'Los Angeles County Federation of Labor',
    url: 'https://thelafed.org/resource/lalaborvoterguide/',
    note: 'The guide is published only as page images; they were read by hand (LAFED_TRANSCRIBED in scripts/lib/profiles/slate-parsers.ts), and the parser stops if any image changes. The images are numbered 1 to 9 with no page 7. "No Recommendation" is left out.',
    async read() {
      const page = await html(this.url)
      const files = [
        ...new Set(
          [
            ...page.matchAll(
              /\/app\/uploads\/2026\/10\/(LA-FED-MIDTERM-2026-ENDORSEMENT-GUIDE-[\d-]+?)-\d+x\d+\.jpg/g,
            ),
          ].map((m) => `${m[1]}.jpg`),
        ),
      ]
      const found = []
      for (const file of files) {
        const bytes = await download(
          `https://thelafed.org/app/uploads/2026/10/${file}`,
        )
        found.push({
          file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
      return { entries: parseLaFed(found) }
    },
  },
  {
    slug: 'california-environmental-voters',
    endorser: 'California Environmental Voters',
    kind: 'organization',
    title: "Who We're Endorsing in California's 2026 Election",
    publisher: 'California Environmental Voters',
    url: 'https://envirovoters.org/2026-endorsements/',
    note: 'Statewide list: offices outside Los Angeles County are marked "outside".',
    async read() {
      return { entries: parseEnviroVoters(await html(this.url)) }
    },
  },
  {
    slug: 'planned-parenthood-advocacy-project-los-angeles-county',
    endorser: 'Planned Parenthood Advocacy Project Los Angeles County',
    kind: 'organization',
    title: 'Voter Guide, November 3, 2026',
    publisher: 'Planned Parenthood Advocacy Project Los Angeles County',
    url: 'https://www.plannedparenthoodaction.org/planned-parenthood-advocacy-project-los-angeles-county/voter-guide-ppapx',
    note: "Only the local and state tables the Action Fund says it endorsed are entries; the page's statewide and federal tables are other Planned Parenthood groups' endorsements.",
    async read() {
      return { entries: parsePpapLa(await html(this.url)) }
    },
  },
  {
    slug: 'california-republican-assembly',
    endorser: 'California Republican Assembly',
    kind: 'organization',
    title: 'November 2026 General Election Endorsements: Los Angeles County',
    publisher: 'California Republican Assembly',
    url: 'https://cragop.org/los-angeles-county/',
    note: 'The Los Angeles County page lists local candidates and links the statewide quick sheet (documentUrl), which has the statewide, Board of Equalization, congressional and legislative endorsements. The PDF prints some letter pairs (ti, tt, ffi) as gaps; they are filled from CRA_LIGATURES in scripts/lib/profiles/slate-parsers.ts, and the parser stops on one it does not know. Statewide list: offices outside Los Angeles County are marked "outside". "No Endorsement" and ballot measures are left out.',
    async read() {
      const page = await html(this.url)
      const pdf = page.match(
        /https:\/\/cragop\.org\/wp-content\/uploads\/[^"]*General-Election-Endorsements[^"]*\.pdf/,
      )?.[0]
      if (!pdf) throw new Error(`No endorsement PDF on ${this.url}`)
      return {
        entries: [
          ...parseCra(await pdfBbox(pdf, this.slug)),
          ...parseCraLa(page),
        ],
        documentUrl: pdf,
      }
    },
  },
  {
    slug: 'reform-california',
    endorser: 'Reform California',
    kind: 'organization',
    title: 'Reform California Voter Guide: Los Angeles County',
    publisher: 'Reform California',
    url: 'https://www.reformcalifornia.org/voter-guides/los-angeles',
    note: 'Reform California is a political action committee chaired by Carl DeMaio; the guide page\'s footer reads "Ad paid for by Carl DeMaio for State Assembly 2026". The guide grades candidates and names one pick per race; picks are entries. "You\'re Doomed" (no pick), "Definitely NOT", judicial retention calls and ballot measures are left out.',
    async read() {
      return { entries: parseReformCa(await html(this.url)) }
    },
  },
  {
    slug: 'california-prolife-council',
    endorser: 'California ProLife Council',
    kind: 'organization',
    title: 'California ProLife Council 2026 Voter Guide',
    publisher: 'California ProLife Council',
    url: 'https://californiaprolife.org/2026election/',
    note: 'The guide calls its endorsements "Recommended"; it has no other tier. Statewide and congressional cards, and the Los Angeles County records in the page\'s local list. Offices outside Los Angeles County are marked "outside".',
    async read() {
      return { entries: parseCplc(await html(this.url)) }
    },
  },
  {
    slug: 'california-federation-of-teachers',
    endorser: 'California Federation of Teachers',
    kind: 'union',
    title: 'CFT Endorsements, General Election 2026 (Tuesday, November 3)',
    publisher: 'California Federation of Teachers',
    url: 'https://www.cft.org/2026-midterm-elections-hub',
    note: 'The hub page links the endorsement PDF (documentUrl). Statewide list: offices outside Los Angeles County are marked "outside". Dual endorsements list both candidates.',
    async read() {
      const pdf = await linkOn(
        this.url,
        /\/sites\/main\/files\/file-attachments\/cft_endorsements-general-election_[\d.]+\.pdf/,
      )
      return {
        entries: parseCft(await pdfBbox(pdf, this.slug)),
        documentUrl: pdf,
      }
    },
  },
  {
    slug: 'california-teachers-association',
    endorser: 'California Teachers Association',
    kind: 'union',
    title: '2026 Candidate Recommendations',
    publisher: 'California Teachers Association',
    url: 'https://www.cta.org/our-advocacy/election-2026',
    note: 'CTA calls its endorsements "recommendations" (voted by its State Council); its election page points to the list for the November 2026 election (documentUrl). The PDF says congressional picks are not final until approved by the NEA. Statewide list: offices outside Los Angeles County are marked "outside". "No Recommendation" is left out.',
    async read() {
      const page = await html(this.url)
      if (!/November 2026/.test(page))
        throw new Error(`${this.url} no longer names November 2026`)
      const pdf = await linkOn(
        this.url,
        /https:\/\/www\.cta\.org\/document\/2026-candidate-recommendations/,
      )
      return {
        entries: parseCta(await pdfBbox(pdf, this.slug)),
        documentUrl: pdf,
      }
    },
  },
  {
    slug: 'seiu-local-721',
    endorser: 'SEIU Local 721',
    kind: 'union',
    title: 'SEIU 721 COPE Slate, November 3, 2026 General Election',
    publisher: 'SEIU Local 721',
    url: 'https://seiu721.org/2026election/',
    note: 'The slate site is a script app; its data is in the script bundle (documentUrl). Only the statewide and LA County lists are read; ballot measures are left out.',
    async read() {
      const page = await html(this.url)
      const src = page.match(/src="([^"]*assets\/index-[\w-]+\.js)"/)?.[1]
      if (!src) throw new Error(`No script bundle on ${this.url}`)
      const documentUrl = new URL(src, this.url).href
      return { entries: parseSeiu721(await html(documentUrl)), documentUrl }
    },
  },
  {
    slug: 'united-teachers-los-angeles',
    endorser: 'United Teachers Los Angeles',
    kind: 'union',
    title: 'UTLA 2026 Endorsements',
    publisher: 'United Teachers Los Angeles',
    url: 'https://utla.net/campaigns/2026-endorsements/',
    note: 'Only the "Endorsed Candidates" section; the page also links state affiliates\' lists. City offices are Los Angeles city offices.',
    async read() {
      return { entries: parseUtla(await html(this.url)) }
    },
  },
  {
    slug: 'la-forward',
    endorser: 'LA Forward',
    kind: 'organization',
    title: 'November 2026 LA Progressive Voter Guide',
    publisher: 'LA Forward Action Fund',
    url: 'https://laforwardguide.org/',
    note: 'The guide has a page per area (statewide offices, legislature, county, each city, school and water district), all listed on its /cities page and read here. The guide rates every race "Endorsed", "Recommended" or "No recommendation"; "Endorsed" (LA Forward\'s own endorsement process) and "Recommended" (staff recommendations) candidates are entries; "No recommendation" is left out.',
    async read() {
      const home = await html(this.url)
      const index = new URL('/cities', this.url).href
      const paths = [
        ...new Set(
          (await html(index)).match(
            /(?<=href=")\/(?:guide|districts)\/[\w-]+(?=")/g,
          ),
        ),
      ]
      if (!paths.length) throw new Error(`No guide pages listed on ${index}`)
      const pages = []
      for (const path of paths)
        pages.push(await html(new URL(path, this.url).href))
      return { entries: parseLaForward(home, pages) }
    },
  },
  {
    slug: 'democrats-for-israel-los-angeles',
    endorser: 'Democrats for Israel – Los Angeles',
    kind: 'organization',
    title: 'November 2026 General Election Endorsements',
    publisher: 'Democrats for Israel – Los Angeles',
    url: 'https://dfi-la.org/endorse',
    note: 'A Democratic club; it rates candidates "Strong Support" (bold), "Support", "Neutral" or "Oppose", and may rate more than one candidate in a race. "Strong Support" and "Support" are entries. Its statewide endorsements are made by California Jewish Democrats and are not on this page.',
    async read() {
      return { entries: parseDfiLa(await html(this.url)) }
    },
  },
  {
    slug: 'knock-la',
    endorser: 'Knock LA',
    kind: 'organization',
    title:
      'The Knock LA Progressive Voter Guide for the November 2026 General Election',
    publisher: 'Knock LA (Ground Game LA)',
    url: 'https://knock-la.com/knock-la-los-angeles-progressive-voter-guide-november-2026-general-election/',
    note: 'Knock LA is a journalistic project of Ground Game LA; the guide recommends a candidate per race, and in a few races more than one (Superior Court Office 65: "Anna Reitano or Justin Clayton"). Every recommended candidate is an entry. Burbank and West Hollywood are listed as recommended names under the city with no office; they are the city council races. "No Recommendation", "Not Steve Hilton" (Governor), races still marked "[COMING SOON]", the state judicial retention section and ballot measures are left out.',
    async read() {
      return { entries: parseKnockLa(await html(this.url)) }
    },
  },
  {
    slug: 'dsa-los-angeles',
    endorser: 'Democratic Socialists of America, Los Angeles',
    kind: 'organization',
    title: 'Shake Up Los Angeles: Our Candidates',
    publisher: 'DSA-LA',
    url: 'https://shakeup-la.com/our-candidates',
    note: 'DSA-LA\'s endorsement site for the 2026 general election ("Shake Up LA"), which the 2026 endorsements link on dsa-la.org leads to; it lists the nine members DSA-LA endorsed. The chapter\'s separate voter guide (voterguide.dsa-la.org) does not allow automated reads and is not included.',
    async read() {
      return { entries: parseDsaLa(await html(this.url)) }
    },
  },
  {
    slug: 'california-working-families-party',
    endorser: 'California Working Families Party',
    kind: 'organization',
    title: 'California Working Families Party: Our 2026 Candidates',
    publisher: 'Working Families Party',
    url: 'https://workingfamilies.org/state/california/',
    note: 'The page shows the first candidates and loads the rest on "View More" (the site\'s admin-ajax "more_candidates" request, read here too). The page also lists the November 2026 propositions; the parser stops if they are gone. Statewide list: offices outside Los Angeles County are marked "outside".',
    async read() {
      const page = await html(this.url)
      const state = page.match(
        /state-cands__more-link[^>]*data-state-id="(\d+)"/,
      )?.[1]
      if (!state) throw new Error(`No "View More" list on ${this.url}`)
      const shown = (page.match(/<td class="state-cands__name">/g) ?? []).length
      const res = await fetch(
        'https://workingfamilies.org/wp-admin/admin-ajax.php',
        {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `action=more_candidates&state=${state}&count=${shown}`,
        },
      )
      if (!res.ok) throw new Error(`${res.status} for the rest of ${this.url}`)
      return { entries: parseWfpCa([page, await res.text()]) }
    },
  },
]

// The parties' endorsements filed with the Registrar (Elections Code
// 13302(b)), one list per party, merged like the parties' own lists. The
// filing names only the party, so each is credited to its state party; a
// party's endorsement of another party's candidate is listed as filed.
const LAVOTE_PARTY_SOURCES: Source[] = [
  [
    'American Independent',
    'American Independent Party',
    'american-independent-party',
  ],
  ['Democratic', 'California Democratic Party', 'democratic-party'],
  ['Republican', 'California Republican Party', 'republican-party'],
].map(([party, endorser, slug]) => ({
  slug: `lavote-${slug}`,
  endorser,
  kind: 'party',
  title:
    'Party Endorsements for Voter-Nominated Offices, November 3, 2026 General Election',
  publisher: 'Los Angeles County Registrar-Recorder/County Clerk',
  url: 'https://www.lavote.gov/additional-election-information',
  note: `The ${party} Party's endorsements as filed with the Registrar under Elections Code 13302(b), for state and federal offices. The page's list of candidates who accepted voluntary spending limits is left out.`,
  async read() {
    return { entries: parseLavoteParties(await html(this.url), party) }
  },
}))

/** A transcribed list (see the header). */
interface Transcribed extends Omit<Slate, 'entries' | 'fetchedAt'> {
  generalEvidence: string
  whyItCounts: string
  entries: {
    name: string
    /** The name as the ballot prints it, where the page misspells it. */
    nameOnBallot?: string
    office: string
    stance?: 'support' | 'oppose'
    quote: string
  }[]
}

const { subjects: listed } = await readSubjects()
const OFFICE_TYPES = [...new Set(listed.map((s) => s.officeType))]

/**
 * The office as our ballots name it ("City of El Monte, Member of the City
 * Council"): its first part must begin the person's office, and a seat or
 * district number must match. A "vote No" fits only a judge up for retention.
 */
function transcribedHint(
  name: string,
  office: string,
  oppose: boolean,
): ParsedEntry['hint'] {
  // A retention vote (a "Yes" or a "No" on keeping a judge) is matched among
  // judges up for retention by name; every other office by office and name.
  if (
    oppose ||
    /\bretention\b/i.test(office) ||
    (/\b(judge|justice)\b/i.test(office) &&
      listed.some(
        (s) => s.officeType === 'retention' && slateNameMatches(s.name, name),
      ))
  )
    return { types: ['retention'] as OfficeType[] }
  // A local office names its city or district first ("City of El Monte",
  // "Bassett Unified School District"), which must begin the person's office;
  // state and federal offices are worded differently from list to list, so
  // their seat number and the name decide.
  const first = office.split(',')[0].trim()
  const local =
    /\b(city|town|village|township|school|college|unified|water|district|library|hospital|park)\b/i.test(
      first,
    ) &&
    !/\b(state|united states|u\.s\.|congress|assembly|senate)\b/i.test(first)
  const district = office.match(/\d+/)?.[0]
  return {
    types: OFFICE_TYPES.filter((t) => t !== 'retention'),
    ...(local ? { includes: [first] } : {}),
    ...(district ? { district: Number(district) } : {}),
  }
}

async function transcribedSources(): Promise<Source[]> {
  if (!existsSync(TRANSCRIBED_DIR)) return []
  const files = (await readdir(TRANSCRIBED_DIR)).filter((f) =>
    f.endsWith('.json'),
  )
  return Promise.all(
    files.sort().map(async (f) => {
      const t = JSON.parse(
        await readFile(join(TRANSCRIBED_DIR, f), 'utf8'),
      ) as Transcribed
      const { generalEvidence, whyItCounts, entries, ...meta } = t
      return {
        ...meta,
        note: `Transcribed from the page by a researcher. ${whyItCounts} General election: "${generalEvidence}"`,
        async read() {
          return {
            entries: entries.map((e) => ({
              name: e.nameOnBallot ?? e.name,
              office: e.office,
              hint: transcribedHint(
                e.nameOnBallot ?? e.name,
                e.office,
                e.stance === 'oppose',
              ),
              ...(e.stance === 'oppose' && { stance: 'oppose' as const }),
            })),
          }
        },
      }
    }),
  )
}

const SOURCES: Record<string, Source[]> = {
  'il-cook': [...COOK_SOURCES, ...(await transcribedSources())],
  'ca-la': [
    ...LA_SOURCES,
    ...LAVOTE_PARTY_SOURCES,
    ...(await transcribedSources()),
  ],
}

// A person on the ballot in two races (subjects.ts SAME_PERSON) has one
// profile, filed under the first; lists may name them for the other race, so
// they're matched as that race's candidate too, with the office and type an
// opponent in that race has.
const subjects = listed.flatMap((s) => [
  s,
  ...(s.alsoIn ?? []).flatMap((raceKey) => {
    const other = listed.find((o) => o.key !== s.key && o.raceKey === raceKey)
    return other
      ? [{ ...s, office: other.office, officeType: other.officeType }]
      : []
  }),
])
const only = values.only?.split(',')
const fetchedAt = today()
let problems = 0

for (const source of SOURCES[REGION.id] ?? []) {
  if (only && !only.includes(source.slug)) continue
  const { read, ...meta } = source
  const { entries: parsed, documentUrl } = await read.call(source)
  // Cook lists mark offices off Cook County ballots with no hint on purpose.
  if (!IS_COOK)
    for (const e of parsed.filter((x) => !x.hint))
      console.log(`  office not recognized: ${e.name} (${e.office})`)
  const entries = matchSlate(parsed, subjects)
  const slate: Slate = {
    ...meta,
    ...(documentUrl ? { documentUrl } : {}),
    fetchedAt,
    entries,
  }
  await writeFormattedJson(join(SLATES_DIR, `${source.slug}.json`), slate)

  const count = (status?: string) =>
    entries.filter((e) =>
      status ? e.status === status : e.matchedKey !== null,
    ).length
  console.log(
    `${source.slug}: ${entries.length} entries, ${count()} matched, ${count('outside')} outside ${REGION.name} ballots, ${count('unmatched')} unmatched, ${count('ambiguous')} ambiguous`,
  )
  for (const e of entries.filter(
    (x) => x.status === 'unmatched' || x.status === 'ambiguous',
  )) {
    problems++
    console.log(`  ${e.status}: ${e.name} (${e.office}). ${e.note ?? ''}`)
  }
}
if (problems)
  console.log(
    `${problems} entries to review: fix the parser, or confirm the person and add a rule, then run again.`,
  )
