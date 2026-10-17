import { describe, expect, it } from 'vitest'
import {
  ALLIANCE_MEMBERS,
  ALLIANCE_OTHERS,
  allianceTally,
  buildEntries,
  contextLabel,
  htmlText,
  matchJudge,
  NO_RATING,
  NOT_EVALUATED,
  parseAlliance,
  parseCba,
  parseCcl,
  parseIsba,
  parseLacbaGuide,
  sameJudge,
  type BarList,
} from './bar.ts'

// Lines from `pdftotext -layout` of the Alliance's 2026 table (a form feed added).
const ALLIANCE = [
  '      Illinois Appellate Court –    B    B      L      L      L      B     L    A   A   B       G       B       A',
  'Judith C. Rice                      R    R     HQ      R     Q       R     HR   R   Q   Q   HR      HR          R',
  '  Cook Circuit Court – Countywide   B    B      L       L      L     B     L    A   A   B   G       B       A',
  'Steven Q. McKenzie                  R     ¹      ¹     R      Q      R     R    R   Q   R   NR      R       R',
  '                                        B       B       L       L       L   B    L   A   A   B    G    B   A',
  '\fRachel Marrello                         R       R   NR          R    Q      NR   R   R   Q   Q    NR   R   R',
  '        Shall each of the persons listed be retained in office as Judge of the Cook Circuit Court?',
  '       Cook County               B      B     L      L      L      B       L     A     A     B     G     B     A',
  'Lewis Nixon                     Yes    Yes   Yes    Yes    Yes             Yes   Yes   Yes   Yes   Yes   Yes   Yes',
  'Maritza Martinez                Yes                 Yes    Yes             Yes   Yes   Yes   Yes   Yes   Yes   Yes',
].join('\n')

describe('parseAlliance', () => {
  const columns = parseAlliance(ALLIANCE)
  const ratingOf = (member: string, name: string) =>
    columns[ALLIANCE_MEMBERS.indexOf(member as never)].find(
      (r) => r.name === name,
    )?.rating

  it('expands codes with the Alliance key, per member column', () => {
    expect(ratingOf("Black Men Lawyers' Association", 'Judith C. Rice')).toBe(
      'Highly Qualified',
    )
    expect(ratingOf('Decalogue Society of Lawyers', 'Judith C. Rice')).toBe(
      'Highly Recommended',
    )
    expect(
      ratingOf("Women's Bar Association of Illinois", 'Judith C. Rice'),
    ).toBe('Recommended')
  })

  it('places cells by position, also after a form feed', () => {
    expect(ratingOf("Black Men Lawyers' Association", 'Rachel Marrello')).toBe(
      'Not Recommended',
    )
    expect(ratingOf('Cook County Bar Association', 'Rachel Marrello')).toBe(
      'Not Recommended',
    )
  })

  it('leaves blank retention cells out and marks retention', () => {
    expect(
      ratingOf('Cook County Bar Association', 'Lewis Nixon'),
    ).toBeUndefined()
    expect(ratingOf('Decalogue Society of Lawyers', 'Lewis Nixon')).toBe('Yes')
    expect(
      ratingOf(
        'Asian American Bar Association of the Greater Chicago Area',
        'Maritza Martinez',
      ),
    ).toBeUndefined()
    expect(columns[0].find((r) => r.name === 'Lewis Nixon')?.context).toBe(
      'retention',
    )
    expect(columns[0].find((r) => r.name === 'Judith C. Rice')?.context).toBe(
      'election',
    )
  })

  it('reads the footnote mark as not evaluated', () => {
    expect(
      ratingOf(
        'Asian American Bar Association of the Greater Chicago Area',
        'Steven Q. McKenzie',
      ),
    ).toBe('Not Evaluated Through No Fault of the Candidate')
  })

  it('fails loudly when a contested row is short a column', () => {
    const short =
      ALLIANCE.split('\n').slice(0, 1).join('\n') +
      '\nJane Doe                            R    R'
    expect(() => parseAlliance(short)).toThrow(/Expected 13/)
  })
})

describe('parseCba', () => {
  const html = `<p>seeking <strong>ELECTION</strong></p>
    <p>#102 &nbsp;|&nbsp; Judith C. Rice (D) &nbsp;|&nbsp; Q</p>
    <p>#107 | D&rsquo;Anthony &ldquo;Tony&rdquo; Thedford (D) | HQ</p>
    <p>#114 | Rachel Marrello (D) | NR</p>
    <p>seeking <strong>RETENTION</strong></p>
    <p>201 | <span>
    Bertina E. Lampkin</span> | Q</p>`

  it('reads both lists and expands the codes', () => {
    expect(parseCba(html)).toEqual([
      { name: 'Judith C. Rice', context: 'election', rating: 'Qualified' },
      {
        name: 'D’Anthony “Tony” Thedford',
        context: 'election',
        rating: 'Highly Qualified',
      },
      {
        name: 'Rachel Marrello',
        context: 'election',
        rating: 'Not Recommended',
      },
      { name: 'Bertina E. Lampkin', context: 'retention', rating: 'Qualified' },
    ])
  })
})

describe('parseCcl', () => {
  const text = `Judicial Candidates on the Ballot in Cook County
\fRadiance Ward (1st Subcircuit) – Well Qualified
Ms. Ward was admitted in 2001. The Council finds her Well Qualified for the
Felony Review Unit (2018—Jan. 2019, 2015-2016)
Natalia Moore (17th Subcircuit) – Not Recommended
Judicial Candidates on the Ballot for Retention in Cook County
Judith C. Rice—Qualified
`

  it('reads headings, drops the subcircuit and ignores body text', () => {
    expect(parseCcl(text)).toEqual([
      { name: 'Radiance Ward', context: 'election', rating: 'Well Qualified' },
      { name: 'Natalia Moore', context: 'election', rating: 'Not Recommended' },
      { name: 'Judith C. Rice', context: 'retention', rating: 'Qualified' },
    ])
  })
})

describe('parseLacbaGuide', () => {
  // Lines from `pdftotext -layout` of the LACBA's November 2026 voter guide,
  // plus a made-up third row to cover the rest of the scale.
  const text = [
    'The Los Angeles County Bar Association’s Judicial Elections Evaluation Committee',
    'issued its final report in April 2026, evaluating the following candidates for Los Ange-',
    '                  2026 Judicial Elections Candidate Ratings:',
    '',
    'SUPERIOR COURT OFFICE NO. 64                 SUPERIOR COURT OFFICE NO. 87',
    'Maria Ghobadi            Well Qualified      Anthony Bayne            Well Qualified',
    'Rhonda Haymon            Qualified           David DeJute             Qualified',
    'Jane Q. Example          Not Qualified       John Example             Exceptionally Well Qualified',
    '',
    '\fSUPERIOR COURT OFFICE NO. 65                 SUPERIOR COURT OFFICE NO. 131',
    'Anna Slotky Reitano      Qualified           Donna Tryfman            Qualified',
    '                                                                             lacba.org',
  ].join('\n')

  it('reads both columns under their own office, words as printed', () => {
    const row = (name: string, office: string, rating: string) => ({
      name,
      context: 'election',
      rating,
      office,
    })
    expect(parseLacbaGuide(text)).toEqual([
      row('Maria Ghobadi', '64', 'Well Qualified'),
      row('Anthony Bayne', '87', 'Well Qualified'),
      row('Rhonda Haymon', '64', 'Qualified'),
      row('David DeJute', '87', 'Qualified'),
      row('Jane Q. Example', '64', 'Not Qualified'),
      row('John Example', '87', 'Exceptionally Well Qualified'),
      row('Anna Slotky Reitano', '65', 'Qualified'),
      row('Donna Tryfman', '131', 'Qualified'),
    ])
  })

  it("matches the guide's short names with the ballot's", () => {
    const ballot = new Map([
      ['anthony-aj-bayne', 'Anthony (A.J.) Bayne'],
      ['david-dejute', 'David Dejute'],
      ['rhonda-a-haymon', 'Rhonda A. Haymon'],
    ])
    expect(matchJudge('Anthony Bayne', ballot, {})).toBe('anthony-aj-bayne')
    expect(matchJudge('David DeJute', ballot, {})).toBe('david-dejute')
    expect(matchJudge('Rhonda Haymon', ballot, {})).toBe('rhonda-a-haymon')
  })
})

describe('parseIsba', () => {
  const html = `<h2>Candidates Seeking to Fill Judicial Vacancies</h2>
<details><summary class="plain" data-suffix="Read Evaluation">Monica Somerville <span class="judicial-rating"> &ndash; Not Qualified</span></summary><p>ISBA finds ...</p></details>
<h2>Retention</h2>
<details><summary class="plain">Lewis Nixon <span class="judicial-rating"> &ndash; Yes</span></summary></details>`

  it('reads the rating after the name and splits at Retention', () => {
    expect(parseIsba(html)).toEqual([
      {
        name: 'Monica Somerville',
        context: 'election',
        rating: 'Not Qualified',
      },
      { name: 'Lewis Nixon', context: 'retention', rating: 'Yes' },
    ])
  })
})

describe('htmlText', () => {
  it('decodes entities and collapses space', () => {
    expect(htmlText('<b>O&#8217;Brien</b>&nbsp; &amp; co')).toBe('O’Brien & co')
  })
})

describe('matching names', () => {
  const ballot = new Map([
    ['anthony-c-tony-kyriakopoulos', 'Anthony C. "Tony" Kyriakopoulos'],
    ['danthony-tony-thedford', 'D\'Anthony "Tony" Thedford'],
    ['regina-a-mescall', 'Regina A. Mescall'],
    ['judith-c-rice', 'Judith C. Rice'],
    ['ashonta-c-rice', 'Ashonta C. Rice'],
    ['teresa-molina-gonzalez', 'Teresa Molina-Gonzalez'],
    ['dan-naranjo', 'Dan Naranjo'],
    ['marie-aileen-dempsey', 'Marie Aileen Dempsey'],
    ['gerardo-tristan-jr', 'Gerardo Tristan, Jr.'],
  ])

  it('accepts middle initials, nicknames and spacing differences', () => {
    expect(matchJudge('Anthony C. Kyriakopoulos', ballot, {})).toBe(
      'anthony-c-tony-kyriakopoulos',
    )
    expect(matchJudge("Anthony C. ''Tony'' Kyriakopoulos", ballot, {})).toBe(
      'anthony-c-tony-kyriakopoulos',
    )
    expect(matchJudge('D’ Anthony “Tony” Thedford', ballot, {})).toBe(
      'danthony-tony-thedford',
    )
    expect(matchJudge('Regina Ann Mescall', ballot, {})).toBe(
      'regina-a-mescall',
    )
    expect(matchJudge('Teresa Molina - Gonzalez', ballot, {})).toBe(
      'teresa-molina-gonzalez',
    )
    expect(matchJudge('Daniel Naranjo', ballot, {})).toBe('dan-naranjo')
    expect(matchJudge('Gerardo Tristan, Jr.', ballot, {})).toBe(
      'gerardo-tristan-jr',
    )
  })

  it('never matches on the last name alone', () => {
    expect(sameJudge('Judith C. Rice', 'Ashonta C. Rice')).toBe(false)
    expect(matchJudge('J. Rice', ballot, {})).toBeUndefined()
    expect(sameJudge('Regina B. Mescall', 'Regina A. Mescall')).toBe(false)
  })

  it('leaves misspellings unmatched unless an alias was reviewed', () => {
    expect(matchJudge('Maire Aileen Dempsey', ballot, {})).toBeUndefined()
    expect(
      matchJudge('Maire Aileen Dempsey', ballot, {
        'Maire Aileen Dempsey': 'marie-aileen-dempsey',
      }),
    ).toBe('marie-aileen-dempsey')
  })
})

describe('buildEntries', () => {
  const source = (n: number) => ({
    title: `List ${n}`,
    publisher: `Bar ${n}`,
    url: `https://example.org/${n}`,
    kind: 'bar' as const,
  })
  const lists: BarList[] = [
    { organization: 'Bar A', source: source(1), ratings: [] },
    { organization: 'Bar B', source: source(2), ratings: [] },
    { organization: 'Bar C', source: source(2), ratings: [] },
  ]

  it('lists every organization, with a placeholder when unrated', () => {
    const matched = new Map([
      [
        'jane-doe',
        [
          {
            list: 1,
            rating: {
              name: 'Jane Doe',
              context: 'retention' as const,
              rating: 'Yes',
            },
          },
        ],
      ],
    ])
    const out = buildEntries(lists, matched, 'jane-doe', '2026-10-06', {
      retention: 'For retention as a circuit judge',
    })
    const entry = (organization: string, rating: string, cite: number) => ({
      organization,
      kind: 'bar_evaluation',
      rating,
      context: 'retention',
      cites: [cite],
    })
    expect(out.endorsements).toEqual([
      entry('Bar A', NO_RATING, 1),
      entry('Bar B', 'Yes', 2),
      entry('Bar C', NO_RATING, 2),
    ])
    expect(out.sources.map((s) => [s.id, s.url, s.viewedAt])).toEqual([
      [1, 'https://example.org/1', '2026-10-06'],
      [2, 'https://example.org/2', '2026-10-06'],
    ])
  })

  it('gives a judge in a race and up for retention one labeled set per vote', () => {
    const r = (context: 'election' | 'retention', rating: string) => ({
      list: 0,
      rating: { name: 'Judith C. Rice', context, rating },
    })
    const matched = new Map([
      ['judith-c-rice', [r('retention', 'Yes'), r('election', 'Qualified')]],
    ])
    const out = buildEntries(
      lists.slice(0, 2),
      matched,
      'judith-c-rice',
      '2026-10-06',
      {
        election: 'For the Appellate Court election',
        retention: 'For retention as a circuit judge',
      },
    )
    expect(
      out.endorsements.map((e) => [e.organization, e.contextLabel, e.rating]),
    ).toEqual([
      ['Bar A', 'For the Appellate Court election', 'Qualified'],
      ['Bar B', 'For the Appellate Court election', NO_RATING],
      ['Bar A', 'For retention as a circuit judge', 'Yes'],
      ['Bar B', 'For retention as a circuit judge', NO_RATING],
    ])
  })
})

describe('contextLabel', () => {
  it('names the court from the contest', () => {
    expect(
      contextLabel(
        'election',
        'Judge Judge, Illinois Appellate Court, 1st District (Vacancy of Hoffman)',
      ),
    ).toBe('For the Appellate Court election')
    expect(
      contextLabel(
        'retention',
        'Judge, Cook County Judicial Circuit Retention: Judge, Cook County Judicial Circuit',
      ),
    ).toBe('For retention as a circuit judge')
    expect(contextLabel('retention', 'Judge, Appellate Court')).toBe(
      'For retention as an appellate judge',
    )
  })
})

describe('allianceTally', () => {
  it('counts the 11 other members, never the Council or the ISBA', () => {
    expect(ALLIANCE_OTHERS).toHaveLength(11)
    expect(ALLIANCE_OTHERS).not.toContain('Chicago Council of Lawyers')
    expect(ALLIANCE_OTHERS).not.toContain('Illinois State Bar Association')
  })

  it('counts published ratings only, most common first', () => {
    const ratings = [
      ...Array<string>(8).fill('Yes'),
      'No',
      NO_RATING,
      NO_RATING,
    ]
    expect(allianceTally(ratings)).toEqual({
      members: 11,
      ratings: [
        { rating: 'Yes', count: 8 },
        { rating: 'No', count: 1 },
      ],
      notEvaluated: 0,
    })
  })

  it('keeps "not evaluated" apart from ratings and breaks ties by the key', () => {
    expect(
      allianceTally([
        'Qualified',
        'Recommended',
        NOT_EVALUATED,
        'Recommended',
        'Qualified',
      ]),
    ).toEqual({
      members: 5,
      ratings: [
        { rating: 'Qualified', count: 2 },
        { rating: 'Recommended', count: 2 },
      ],
      notEvaluated: 1,
    })
  })
})
