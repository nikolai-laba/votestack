import { describe, expect, it } from 'vitest'
import {
  burbankDocs,
  civicPlusDocs,
  docsForPerson,
  formOf,
  isOldFolder,
  isoDate,
  laCityListing,
  laserficheDocs,
  matchCandidate,
  pageDocs,
  yearOption,
  placeOf,
  southTechDocs,
  WallError,
  type CityDoc,
  type CityFilings,
  type CityListing,
} from './city-filings.ts'
import type { Form460 } from './form460.ts'
import type { MoneyPerson } from './money-ca.ts'
import { collectCities, type CitiesDeps } from './money-cities-module.ts'
import { parseBallotName } from './names.ts'

// Everything here is synthetic: made-up cities, candidates and committees.

const person = (
  key: string,
  name: string,
  place = 'testville',
  office = 'City of Testville, Member of the City Council',
): MoneyPerson => ({
  key,
  name,
  ballot: parseBallotName(name),
  office,
  officeType: 'city_council',
  districtId: `ocd-division/country:us/state:ca/place:${place}`,
  contestIds: [],
})

const doc = (over: Partial<CityDoc>): CityDoc => ({
  id: 'cp-1',
  title: '',
  context: '',
  form: null,
  viewUrl: 'https://testville.example.gov/DocumentCenter/View/1',
  ...over,
})

describe('formOf', () => {
  it.each([
    ['Form 460 (07-01-2026 - 9-19-2026) Pre-Election Statement', '460'],
    ['FPPC 460; pre-election', '460'],
    ['First Pre-Election (PDF) QDoe PE 26 1 Redacted', '460'],
    ['Semi-Annual (PDF)', '460'],
    ['Form 497 2026', '497'],
    ['10/7/2026 - Contribution Report', '497'],
    ['24-hour Contribution Report', '497'],
    ['Form 410 - Initial 2026', null],
    ['Candidate Intention Statement (PDF)', null],
    ['Doe for Council 2026 - Form 501 (06-17-26)', null],
    ['2026-10-08 470 Filing', null],
  ])('%s → %s', (text, form) => {
    expect(formOf(text)).toBe(form)
  })
})

describe('small parsers', () => {
  it('reads dates in the formats cities use', () => {
    expect(isoDate('Sep 28, 2026')).toBe('2026-09-28')
    expect(isoDate('9/22/2026 5:25:59 PM')).toBe('2026-09-22')
    expect(isoDate('2026-07-01T00:00:00.000')).toBe('2026-07-01')
    expect(isoDate('')).toBeUndefined()
  })

  it('skips folders for earlier cycles only', () => {
    expect(isOldFolder('Quill Doe for Council 2022', 2026)).toBe(true)
    expect(isOldFolder('2025', 2026)).toBe(false)
    expect(isOldFolder('Quill Doe (November 2026 Election)', 2026)).toBe(false)
    expect(isOldFolder('Candidate Committees', 2026)).toBe(false)
  })

  it('finds the place in an OCD-ID', () => {
    expect(
      placeOf(
        'ocd-division/country:us/state:ca/place:el_testo/council_district:2',
      ),
    ).toBe('el_testo')
    expect(
      placeOf('ocd-division/country:us/state:ca/county:los_angeles'),
    ).toBeNull()
  })
})

describe('docsForPerson', () => {
  const quill = person('quill-doe', 'Quill Doe')
  const rana = person('rana-doe', 'Rana Doe')
  const ezra = person('ezra-de-la-vega', 'Ezra De La Vega')

  it('matches by last name, and by given name when two candidates share it', () => {
    const docs = [
      doc({ id: 'a', title: 'Quill Doe 460 Pre-Election', form: '460' }),
      doc({ id: 'b', title: 'Doe for Council 2026 Form 460', form: '460' }),
      doc({
        id: 'c',
        title: 'Form 460',
        context: 'Ezra De La Vega',
        form: '460',
      }),
    ]
    const mine = docsForPerson(quill, [quill, rana, ezra], docs)
    expect(mine.docs.map((d) => d.id)).toEqual(['a'])
    expect(mine.shared.map((d) => d.id)).toEqual(['b'])
    expect(docsForPerson(quill, [quill], docs).docs.map((d) => d.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('reads compound last names run together, and skips third-party committees', () => {
    const docs = [
      doc({
        id: 'a',
        title: 'DelaVega for Council 2026 Form 460',
        form: '460',
      }),
      doc({
        id: 'b',
        title: 'Testville Neighbors Supporting De La Vega - Form 497',
        form: '497',
      }),
    ]
    expect(docsForPerson(ezra, [ezra], docs).docs.map((d) => d.id)).toEqual([
      'a',
    ])
  })

  it('takes documents the source tied to the person as theirs', () => {
    const docs = [
      doc({ id: 'a', title: 'Semi-Annual', form: '460', person: 'quill-doe' }),
    ]
    expect(docsForPerson(quill, [quill, rana], docs).docs).toHaveLength(1)
    expect(docsForPerson(rana, [quill, rana], docs).docs).toHaveLength(0)
  })
})

describe('listings', () => {
  it('maps CivicPlus and Laserfiche entries', () => {
    const cp = civicPlusDocs(
      'https://testville.example.gov',
      [
        {
          ID: 77,
          DisplayName: 'Quill Doe 460 - 1st Pre Election_Redacted',
          URL: '/DocumentCenter/View/77/x',
          LastModifiedDateString: 'Sep 28, 2026',
        },
      ],
      ['2026'],
    )
    expect(cp[0]).toMatchObject({
      id: 'cp-77',
      form: '460',
      posted: '2026-09-28',
      context: '2026',
      fetch: {
        kind: 'url',
        url: 'https://testville.example.gov/DocumentCenter/View/77/x',
      },
    })
    const lf = laserficheDocs(
      { base: 'https://lf.example.gov/WebLink', repo: 'Testville' },
      [
        { entryId: 5, name: 'Quill Doe', type: 0, isEdoc: false, data: [] },
        {
          entryId: 9,
          name: '07/01/26 thru 09/19/26',
          type: -2,
          isEdoc: true,
          data: ['x', '9/22/2026 5:25:59 PM'],
        },
      ],
      ['Name', 'CreationDate'],
      ['Quill Doe', '460 Recipient Committee Campaign Statement'],
      'https://lf.example.gov/WebLink/Browse.aspx?id=4&dbid=0&repo=Testville',
    )
    expect(lf).toHaveLength(1)
    expect(lf[0]).toMatchObject({
      id: 'lf-9',
      form: '460',
      posted: '2026-09-22',
      committeeUrl:
        'https://lf.example.gov/WebLink/Browse.aspx?id=4&dbid=0&repo=Testville',
      fetch: { kind: 'laserfiche', id: 9, edoc: true },
    })
  })

  it('reads PDF links on a page with the tab or heading before them', () => {
    const html = `
      <h2>Campaign Disclosure Reports</h2>
      <ol class="cpTabs">
        <li><a href="#tabW_0" class="tabButton"><span class="tabName" data-tabname="Councilmember Quill Doe">Councilmember Quill Doe</span></a></li>
        <li><a href="#tabW_1" class="tabButton"><span class="tabName" data-tabname="Uma Poe">Uma Poe</span></a></li>
      </ol>
      <div class="cpTabPanel" id="tabW_0"><ul>
        <li><a href="/DocumentCenter/View/31/Form-460-07-01-2026">Form 460 (07-01-2026 - 09-19-2026)</a></li>
        <li><a href="/DocumentCenter/View/32">Form 497 2026</a></li></ul></div>
      <div class="cpTabPanel" id="tabW_1"><a href="/DocumentCenter/View/33">Form 410</a></div>
      <h3><strong>Rana Roe</strong></h3>
      <a href="https://files.example.gov/roe-460.pdf">Pre-Election Statement</a>
      <a href="/news">News</a>`
    const docs = pageDocs(html, 'https://testville.example.gov/186/Campaign')
    expect(docs.map((d) => [d.id.slice(0, 4), d.form, d.context])).toEqual([
      ['cp-3', '460', 'Councilmember Quill Doe'],
      ['cp-3', '497', 'Councilmember Quill Doe'],
      ['cp-3', null, 'Uma Poe'],
      ['pdf-', '460', 'Rana Roe'],
    ])
  })

  it('reads SouthTech grid rows', () => {
    const row = (i: number, cells: string[]) =>
      `<tr id="ctl00_DefaultContent_gridFilingForms_DXDataRow${i}">${cells
        .map((c) => `<td class="dxgv">${c}</td>`)
        .join('')}</tr>`
    const html =
      row(0, ['497', '24-hour Contribution Report', '10/6/2026', '2026']) +
      row(1, [
        '460',
        'Recipient Committee Campaign Statement',
        '9/24/2026',
        '7/1/2026 - 9/19/2026',
      ])
    const docs = southTechDocs(
      html,
      'quill-doe',
      'Doe for Council 2026',
      'https://st.example',
    )
    expect(docs.map((d) => [d.form, d.posted, d.through, d.fetch])).toEqual([
      ['497', '2026-10-06', undefined, undefined],
      ['460', '2026-09-24', '2026-09-19', undefined],
    ])
  })

  it('finds the year filter option by its position', () => {
    const page = `'itemsValue':['0','2330','2326','2329'],
      <table id="x_ASPxDDL_Years_DDD_L_LBT"><tr><td>All</td></tr><tr><td>2030</td></tr>
      <tr><td>2026</td></tr><tr><td>2029</td></tr></table>`
    expect(yearOption(page, 2026)).toBe('2326')
    expect(yearOption(page, 2027)).toBeUndefined()
  })

  it('maps Burbank-style filings', () => {
    const docs = burbankDocs(
      { api: 'https://efile.example/api/v1', site: 'https://efile.example' },
      'quill-doe',
      [
        {
          entity_id: 'e1',
          name: 'Doe for Council 2026',
          doc_public: 'Ext_1',
          period_start: '07/01/2026',
          period_end: '09/19/2026',
          filing_type: 'FPPC 460; pre-election',
          filing_date: '09/24/2026',
          form_name: 'fppc460_220',
        },
        {
          entity_id: 'e1',
          name: 'Doe for Council 2026',
          doc_public: null,
          period_start: null,
          period_end: null,
          filing_type: 'FPPC 501',
          filing_date: '06/01/2026',
          form_name: 'fppc501',
        },
      ],
      'https://efile.example/c/e1',
    )
    expect(docs[0]).toMatchObject({
      form: '460',
      through: '2026-09-19',
      person: 'quill-doe',
      fetch: { kind: 'burbank', docId: 'Ext_1' },
    })
    expect(docs[1].form).toBeNull()
    expect(docs[1].fetch).toBeUndefined()
  })
})

describe('matching official candidate lists', () => {
  const nikki = person('nikki-roe', 'Nikki Roe')
  const list = [
    { last: 'Roe', first: 'Nicolette', office: 'Council Member' },
    { last: 'Poe', first: 'Ann', office: 'Council Member' },
    { last: 'Roe', first: 'Nicolette', office: 'City Clerk' },
  ]

  it('falls back to the only same-office candidate with the last name', () => {
    const m = matchCandidate(nikki, list, (c) => c)
    expect(m.match).toBe(list[0])
    expect(m.bySurname).toBe(true)
  })

  it('reports two candidates with the same last name instead of choosing', () => {
    const m = matchCandidate(
      nikki,
      [...list, { last: 'Roe', first: 'Dana', office: 'Council Member' }],
      (c) => c,
    )
    expect(m.match).toBeUndefined()
    expect(m.problem).toMatch(/candidate list/)
  })

  it('takes only one general-election committee per LA City candidate', () => {
    const quill = person('quill-doe', 'Quill Doe', 'los_angeles')
    const rana = person('rana-roe', 'Rana Roe', 'los_angeles')
    const row = (
      cand: string,
      id: string,
      flag: string,
      to: string,
      doc: string,
    ) => ({
      cand_name: cand,
      cmt_id: id,
      cmt_name: `${cand} committee ${id}`,
      filing_type_desc: 'Pre-Election',
      period_to_date: `${to}T00:00:00.000`,
      stmt_link: { url: `https://ethics.example/view/?document_id=${doc}` },
      primary_general_flg: flag,
    })
    const listing = laCityListing(
      [
        row('Doe, Quill', '1', 'P', '2026-06-30', '10'),
        row('Doe, Quill', '2', 'G', '2026-06-30', '11'),
        row('Doe, Quill', '2', 'G', '2026-09-19', '12'),
        row('Roe, Rana', '3', 'G', '2026-09-19', '13'),
        row('Roe, Rana', '4', 'G', '2026-09-19', '14'),
      ],
      [quill, rana],
    )
    expect(listing.links['quill-doe'].url).toBe(
      'https://ethics.example/view/?document_id=12',
    )
    expect(listing.docs.filter((d) => d.person === 'quill-doe')).toHaveLength(2)
    expect(listing.links['rana-roe'].problem).toMatch(/3, 4/)
  })
})

// ------------------------------------------------------------- the module

const report = (over: Partial<Form460> = {}): Form460 => ({
  committee: 'Quill Doe for Testville Council 2026',
  committeeId: '1999001',
  from: '2026-07-01',
  through: '2026-09-19',
  summary: {
    monetary: 9_000,
    loans: 1_000,
    nonmonetary: 0,
    total: 10_000,
    cashOnHand: 4_000,
  },
  byCode: { IND: 8_000, COM: 900 },
  unitemized: 100,
  loansFromCandidate: 1_000,
  ...over,
})

const city = (over: Partial<CityFilings> = {}): CityFilings => ({
  place: 'testville',
  name: 'City of Testville',
  system: 'civicplus',
  filingsUrls: ['https://testville.example.gov/DocumentCenter/Index/1'],
  clerkUrl: 'https://testville.example.gov/clerk',
  ...over,
})

/** Fake deps: PDFs are named by doc id, and the reader answers from `reads`. */
function deps(
  cities: CityFilings[],
  listings: Record<string, CityListing | Error>,
  reads: Record<
    string,
    Form460 | 'scanned' | { late: number; date: string; committeeId?: string }
  >,
  manual: Record<string, string[]> = {},
): CitiesDeps {
  return {
    region: 'ca-la',
    cities,
    list: async (c) => {
      const l = listings[c.place]
      if (l instanceof Error) throw l
      return l ?? { docs: [], links: {} }
    },
    download: async (_c, d) => `/fake/${d.id}.pdf`,
    read460: async (path) => {
      const r = reads[path]
      if (r === 'scanned') return { ok: false, reason: 'scanned' }
      if (!r || !('summary' in r)) return { ok: false, reason: 'not-460' }
      return { ok: true, value: r }
    },
    read497: async (path) => {
      const r = reads[path]
      if (!r || r === 'scanned' || !('late' in r))
        return { ok: false, reason: 'not-497' }
      return {
        ok: true,
        value: {
          committee: 'Quill Doe for Testville Council 2026',
          committeeId: r.committeeId ?? '1999001',
          contributions: [{ date: r.date, amount: r.late, code: 'IND' }],
        },
      }
    },
    manualPdfs: async (key) => manual[key] ?? [],
  }
}

const ctx = { maxAgeHours: 1, today: '2026-10-15', year: 2026 }

describe('collectCities', () => {
  const quill = person('quill-doe', 'Quill Doe')

  it('summarizes the latest 460 with later 497s, and skips other committees’ 497s', async () => {
    const docs = [
      doc({
        id: 'old',
        title: 'Doe 460 semi-annual',
        form: '460',
        posted: '2026-07-20',
      }),
      doc({
        id: 'new',
        title: 'Doe 460 pre-election',
        form: '460',
        posted: '2026-09-25',
      }),
      doc({ id: 'l1', title: 'Doe 497', form: '497', posted: '2026-10-01' }),
      doc({ id: 'l2', title: 'Doe 497', form: '497', posted: '2026-10-08' }),
      doc({ id: 'l3', title: 'Doe 497', form: '497', posted: '2026-10-09' }),
    ].map((d) => ({ ...d, fetch: { kind: 'url' as const, url: d.viewUrl } }))
    const run = await collectCities(
      [quill],
      ctx,
      deps(
        [city()],
        { testville: { docs, links: {} } },
        {
          '/fake/old.pdf': report({
            from: '2026-01-01',
            through: '2026-06-30',
          }),
          '/fake/new.pdf': report(),
          '/fake/l1.pdf': { late: 2_000, date: '2026-09-30' },
          '/fake/l2.pdf': { late: 1_500, date: '2026-10-07' },
          '/fake/l3.pdf': {
            late: 5_000,
            date: '2026-10-08',
            committeeId: '1999002',
          },
        },
      ),
    )
    const entry = run.result.byKey['quill-doe']
    expect(entry.summaries[0]).toMatchObject({
      source: 'CA',
      filedWith: 'City of Testville',
      committee: 'Quill Doe for Testville Council 2026',
      period: 'July 1 to September 19, 2026',
      raised: 10_000,
      cashOnHand: 4_000,
      fromCandidate: 1_000,
      largeSince: { since: '2026-09-19', total: 3_500, count: 2 },
    })
    expect(entry.matchedCommittee).toBe('1999001')
    expect(run.status['quill-doe']).toMatchObject({
      status: 'summary',
      pdfs: 5,
    })
  })

  it('points on-request cities at the clerk', async () => {
    const run = await collectCities(
      [quill],
      ctx,
      deps(
        [
          city({
            system: 'on-request',
            contact: { url: 'https://testville.example.gov/records' },
          }),
        ],
        {},
        {},
      ),
    )
    expect(run.result.byKey['quill-doe']).toMatchObject({
      summaries: [],
      filingsAt: {
        name: 'City of Testville',
        url: 'https://testville.example.gov/records',
        onRequest: true,
      },
    })
    expect(run.status['quill-doe'].status).toBe('on-request')
  })

  it('reads manual PDFs, for on-request cities as for Los Angeles', async () => {
    const run = await collectCities(
      [quill],
      ctx,
      deps(
        [city({ system: 'on-request' })],
        {},
        {
          '/manual/a.pdf': report(),
          '/manual/b.pdf': { late: 1_200, date: '2026-10-02' },
        },
        { 'quill-doe': ['/manual/a.pdf', '/manual/b.pdf'] },
      ),
    )
    expect(run.result.byKey['quill-doe'].summaries[0]).toMatchObject({
      raised: 10_000,
      largeSince: { total: 1_200, count: 1 },
    })
  })

  it('tells LA City candidates without a manual PDF where to get one', async () => {
    const la = person('quill-doe', 'Quill Doe', 'los_angeles')
    const listing: CityListing = {
      docs: [
        doc({
          id: 'la-12',
          form: '460',
          person: 'quill-doe',
          through: '2026-09-19',
          committee: 'Doe 2026-General',
        }),
      ],
      links: {
        'quill-doe': {
          committee: 'Doe 2026-General',
          url: 'https://ethics.example/view/?document_id=12',
        },
      },
    }
    const run = await collectCities(
      [la],
      ctx,
      deps(
        [
          city({
            place: 'los_angeles',
            system: 'lacity-manual',
            filingOfficer: 'Testville Ethics Commission',
            wall: 'robots',
          }),
        ],
        { los_angeles: listing },
        {},
      ),
    )
    const entry = run.result.byKey['quill-doe']
    expect(entry.filingsAt).toEqual({
      name: 'Testville Ethics Commission',
      url: 'https://ethics.example/view/?document_id=12',
    })
    expect(entry.note).toMatch(/data\/raw\/money\/manual\/ca-la\/quill-doe\//)
    expect(run.status['quill-doe'].status).toBe('manual-missing')
  })

  it('says when the posted 460 is a scan, and when a site walls us out', async () => {
    const scanned = await collectCities(
      [quill],
      ctx,
      deps(
        [city()],
        {
          testville: {
            docs: [
              doc({
                id: 's',
                title: 'Doe Form 460',
                form: '460',
                fetch: { kind: 'url', url: 'x' },
              }),
            ],
            links: {},
          },
        },
        { '/fake/s.pdf': 'scanned' },
      ),
    )
    expect(scanned.result.byKey['quill-doe'].note).toMatch(/scanned/)
    expect(scanned.result.byKey['quill-doe'].filingsAt?.url).toBe(
      'https://testville.example.gov/DocumentCenter/Index/1',
    )
    const walled = await collectCities(
      [quill],
      ctx,
      deps(
        [city()],
        { testville: new WallError('403 from testville.example.gov') },
        {},
      ),
    )
    expect(walled.result.byKey['quill-doe'].note).toMatch(/403/)
    expect(walled.status['quill-doe'].status).toBe('wall')
  })

  it('never takes a 460 whose committee doesn’t name the candidate', async () => {
    const run = await collectCities(
      [quill],
      ctx,
      deps(
        [city()],
        {
          testville: {
            docs: [
              doc({
                id: 'x',
                title: 'Doe 460',
                form: '460',
                fetch: { kind: 'url', url: 'x' },
              }),
            ],
            links: {},
          },
        },
        { '/fake/x.pdf': report({ committee: 'Testville Neighbors PAC' }) },
      ),
    )
    expect(run.result.byKey['quill-doe']).toBeUndefined()
    expect(run.result.unmatched[0].reason).toMatch(/doesn't name the candidate/)
  })

  it('shows a person missing from a system’s own list as nothing posted, and reports ties', async () => {
    const rana = person('rana-roe', 'Rana Roe')
    const run = await collectCities(
      [quill, rana],
      ctx,
      deps(
        [city({ system: 'southtech' })],
        {
          testville: {
            docs: [],
            links: {
              'quill-doe': {
                problem: 'No committee under this name in CampaignDocs',
              },
              'rana-roe': { problem: '2 2026 committees match: A; B' },
            },
          },
        },
        {},
      ),
    )
    expect(run.result.byKey['quill-doe'].filingsAt?.name).toBe(
      'City of Testville',
    )
    expect(run.result.unmatched.map((u) => u.key)).toEqual(['rana-roe'])
  })

  it('notes committees with no 460 this cycle, and people with nothing posted', async () => {
    const rana = person('rana-roe', 'Rana Roe')
    const run = await collectCities(
      [quill, rana],
      ctx,
      deps(
        [city()],
        {
          testville: {
            docs: [
              doc({
                id: 'f',
                title: 'Doe 2026-10-08 470 Filing',
                posted: '2026-10-13',
              }),
            ],
            links: {},
          },
        },
        {},
      ),
    )
    expect(run.result.byKey['quill-doe'].note).toMatch(/Form 470/)
    expect(run.result.byKey['rana-roe'].note).toMatch(/No filings/)
    expect(run.result.byKey['rana-roe'].filingsAt?.url).toBe(
      'https://testville.example.gov/DocumentCenter/Index/1',
    )
  })
})
