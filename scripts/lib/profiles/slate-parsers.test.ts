import { describe, expect, it } from 'vitest'
import {
  columnLines,
  hintFor,
  laHint,
  lagopRecords,
  parseAflCio,
  parseBbox,
  parseCadem,
  parseCagop,
  parseCfl,
  parseCft,
  parseCra,
  parseCplc,
  parseCraLa,
  parseCta,
  parseDfiLa,
  parseDsaLa,
  parseEnviroVoters,
  parseLacdp,
  parseLaFed,
  parseLagop,
  parseLavoteParties,
  parseLocal150,
  parsePersonalPac,
  parsePpapLa,
  parseSeiu721,
  parseKnockLa,
  parseLaForward,
  parseReformCa,
  parseUtla,
  parseWfpCa,
  vacancySurname,
  type TranscribedPage,
} from './slate-parsers.ts'

/** [x, y, text]: a phrase whose words are set 3 points apart. */
type Phrase = [number, number, string]

/** Fake `pdftotext -bbox` output, one array of phrases per page. */
function bbox(pages: Phrase[][]): string {
  const page = (phrases: Phrase[]) =>
    phrases
      .flatMap(([x0, y, text]) => {
        let x = x0
        return text.split(' ').map((w) => {
          const xMax = x + w.length * 5
          const word = `<word xMin="${x}" yMin="${y}" xMax="${xMax}" yMax="${y + 10}">${w.replace(/&/g, '&amp;')}</word>`
          x = xMax + 3
          return word
        })
      })
      .join('\n')
  return `<doc>${pages.map((p) => `<page width="612" height="792">\n${page(p)}\n</page>`).join('\n')}</doc>`
}

describe('columnLines', () => {
  it('reads columns left to right and splits fields at wide gaps', () => {
    const words = parseBbox(
      bbox([
        [
          [10, 100, 'Left one'],
          [200, 100, 'far'],
          [10, 112, 'Left two'],
          [320, 99, 'Right one'],
        ],
      ]),
    )
    expect(columnLines(words, 1, [0, 300])).toEqual([
      ['Left one', 'far'],
      ['Left two'],
      ['Right one'],
    ])
  })

  it('joins split ordinals and leaves out titles above `top`', () => {
    const words = parseBbox(
      bbox([
        [
          [10, 20, 'TITLE'],
          [10, 100, '2 1 st District'],
        ],
      ]),
    )
    expect(columnLines(words, 1, [0], { top: 50 })).toEqual([['21st District']])
  })
})

describe('vacancySurname and hintFor', () => {
  it('reads the vacancy surname', () => {
    expect(vacancySurname('Curry, Jr.')).toBe('curry')
    expect(vacancySurname('Martin C. Kelley')).toBe('kelley')
    expect(vacancySurname('O’Malley')).toBe('omalley')
  })

  it('builds hints per section', () => {
    expect(hintFor('state_house', { district: 4 })).toEqual({
      types: ['state_legislature'],
      includes: ['State Representative'],
      district: 4,
    })
    expect(hintFor('school_board', { school: '1A' })).toEqual({
      types: ['school_board'],
      includes: ['Subdistrict 1A'],
    })
    expect(hintFor('other')).toBeNull()
  })
})

describe('parseCfl', () => {
  const page1: Phrase[] = [
    [25, 30, 'NOVEMBER 3, 2026 GENERAL ELECTION'],
    [25, 100, 'U.S. Senate'],
    [25, 112, 'Juliana Stratton'],
    [238, 112, 'Democrat'],
    [25, 130, 'U.S. House of Representatives'],
    [25, 142, 'Jonathan Jackson'],
    [170, 142, '1st District'],
    [238, 142, 'Democrat'],
    [25, 160, 'Illinois House of Representatives'],
    [25, 172, 'Aaron Ortiz'],
    [170, 172, '1st District'],
    [238, 172, 'Democrat'],
    // Right column: names drawn as outlines, only the district is text.
    [460, 104, '4th District'],
    [533, 104, 'Democrat'],
  ]
  const page2: Phrase[] = [
    [304, 100, 'Cook County Judicial Subcircuits'],
    [304, 112, 'Ashley Greer Shambley'],
    [422, 112, '1st Subcircuit'],
    [510, 112, 'Walker Vacancy'],
    [590, 112, 'D'],
    [304, 130, 'Chicago Board of Education'],
    [304, 142, 'Neutral'],
    [422, 142, 'School Board District 1A'],
    [304, 154, 'Claudia Peralta'],
    [422, 154, 'School Board District 1B'],
    [304, 170, 'Vote “YES” on the Moraine Valley Community College'],
    [304, 182, 'District #524 Bond Referendum'],
  ]

  it('reads names, districts and vacancies, with transcribed State House names', () => {
    const entries = parseCfl(bbox([page1, page2]), { 4: 'Lilian Jimenez' })
    expect(entries.map((e) => [e.name, e.office])).toEqual([
      ['Juliana Stratton', 'U.S. Senate'],
      ['Jonathan Jackson', 'U.S. House, 1st District'],
      ['Aaron Ortiz', 'Illinois House, 1st District'],
      ['Lilian Jimenez', 'Illinois House, 4th District'],
      ['Ashley Greer Shambley', 'Subcircuit, 1st Subcircuit, Walker Vacancy'],
      [
        'Claudia Peralta',
        'Chicago Board of Education, School Board District 1B',
      ],
    ])
    expect(entries[4].hint).toEqual({
      types: ['judicial_candidate'],
      includes: ['Subcircuit'],
      district: 1,
      vacancy: 'walker',
    })
  })

  it('stops when the drawn State House rows change', () => {
    expect(() =>
      parseCfl(bbox([page1, page2]), { 4: 'Lilian Jimenez', 5: 'Someone' }),
    ).toThrow(/transcribed/)
  })
})

describe('parseLocal150', () => {
  it('reads labels, wrapped names and sections across columns', () => {
    const html = bbox([
      [
        [7, 30, 'GENERAL ELECTION DAY: NOVEMBER 3, 2026'],
        [7, 63, 'Statewide:'],
        [7, 75, 'Governor: JB Pritzker'],
        [7, 87, 'Illinois Senate'],
        [7, 99, 'District 2: Omar Aquino'],
        [163, 63, 'District 32: Karen Battaglia'],
        [163, 75, 'Illinois House of Representatives'],
        [163, 87, 'District 2:'],
        [163, 99, 'Elizabeth “Lisa” Hernandez'],
        [319, 63, 'Metropolitan Water Reclamation'],
        [319, 75, 'District Commissioners:'],
        [319, 87, 'Precious Brady-Davis'],
        [319, 99, 'Chicago School Board:'],
        [319, 111, '1A: Margie Luczak'],
        [475, 63, 'Judicial:'],
        [475, 75, 'Circuit Court, Vac. of Burke:'],
        [475, 87, 'Steven McKenzie'],
        [475, 99, 'Subcircuits:'],
        [475, 111, '13th, Vac. of Curry, Jr.:'],
        [475, 123, 'Robert “Bob” Groebner'],
      ],
    ])
    const entries = parseLocal150(html)
    expect(entries.map((e) => [e.name, e.hint])).toEqual([
      ['JB Pritzker', { types: ['statewide'], includes: ['Governor'] }],
      [
        'Omar Aquino',
        {
          types: ['state_legislature'],
          includes: ['State Senator'],
          district: 2,
        },
      ],
      [
        'Karen Battaglia',
        {
          types: ['state_legislature'],
          includes: ['State Senator'],
          district: 32,
        },
      ],
      [
        'Elizabeth “Lisa” Hernandez',
        {
          types: ['state_legislature'],
          includes: ['State Representative'],
          district: 2,
        },
      ],
      ['Precious Brady-Davis', { types: ['water_reclamation'] }],
      [
        'Margie Luczak',
        { types: ['school_board'], includes: ['Subdistrict 1A'] },
      ],
      [
        'Steven McKenzie',
        {
          types: ['judicial_candidate'],
          includes: ['Circuit Court Judge, Cook County'],
          vacancy: 'burke',
        },
      ],
      [
        'Robert “Bob” Groebner',
        {
          types: ['judicial_candidate'],
          includes: ['Subcircuit'],
          district: 13,
          vacancy: 'curry',
        },
      ],
    ])
  })
})

describe('parseAflCio', () => {
  it('reads numbered rows, statewide names and the appellate court', () => {
    const html = bbox([
      [
        [50, 36, 'Illinois AFL-CIO 2026 General Election Endorsements'],
        [50, 134, 'italics – incumbent'],
        [50, 146, '* – union member'],
        [50, 158, 'Governor'],
        [50, 170, 'JB Pritzker (D)'],
        [50, 182, 'State Senate'],
        [50, 194, '14th – Emil Jones Jr (D)'],
        [233, 70, '15th – Napoleon Harris III (D)'],
        [233, 82, 'State House'],
        [233, 94, '10th – Omar Williams (D)*'],
        [415, 70, 'Judicial'],
        [415, 82, '1st App – Judith Rice (D)'],
        [415, 94, '3rd App – Margaret “Peggy” O’Connell'],
        [415, 106, '(D)'],
      ],
    ])
    expect(parseAflCio(html).map((e) => [e.name, e.office])).toEqual([
      ['JB Pritzker', 'Governor'],
      ['Emil Jones Jr', 'Illinois Senate, 14th'],
      ['Napoleon Harris III', 'Illinois Senate, 15th'],
      ['Omar Williams', 'Illinois House, 10th'],
      ['Judith Rice', 'Appellate Court, 1st District'],
      ['Margaret “Peggy” O’Connell', 'Appellate Court, 3rd District'],
    ])
  })
})

describe('parsePersonalPac', () => {
  it('reads every name under each office', () => {
    const html = `<h2>Personal PAC 2026 General Election Endorsements:</h2>
      <div class="endorsement-item"><div class="endorsement-office">HD-004</div>
      <div class="endorsement-name">Lilian Jiménez</div></div>
      <div class="endorsement-item"><div class="endorsement-office">Chicago School Board, District 2B</div>
      <div class="endorsement-name">Daniel Basco<br/>Deborah &quot;Debby&quot; Pope</div></div>
      <div class="endorsement-item"><div class="endorsement-office">Cook Circuit - 13th Subcircuit - Martin C. Kelley Vacancy</div>
      <div class="endorsement-name">Brittany Michelle Pedersen</div></div>
      <div class="endorsement-item"><div class="endorsement-office">County Board Chairperson</div>
      <div class="endorsement-name">Deb Conroy</div></div>`
    const entries = parsePersonalPac(html)
    expect(entries.map((e) => e.name)).toEqual([
      'Lilian Jiménez',
      'Daniel Basco',
      'Deborah "Debby" Pope',
      'Brittany Michelle Pedersen',
      'Deb Conroy',
    ])
    expect(entries[2].hint).toEqual({
      types: ['school_board'],
      includes: ['Subdistrict 2B'],
    })
    expect(entries[3].hint?.vacancy).toBe('kelley')
    expect(entries[4].hint).toBeNull()
  })
})

describe('laHint', () => {
  it.each([
    ['CA 26', { types: ['us_house'], district: 26 }],
    [
      "California's 26th Congressional District",
      { types: ['us_house'], district: 26 },
    ],
    [
      'SD 20',
      {
        types: ['state_legislature'],
        includes: ['State Senator'],
        district: 20,
      },
    ],
    [
      'Assembly District 39',
      { types: ['state_legislature'], includes: ['Assembly'], district: 39 },
    ],
    ['Lt. Governor', { types: ['statewide'], includes: ['Governor'] }],
    ['CA State Treasurer', { types: ['statewide'], includes: ['Treasurer'] }],
    ['boed 1', { types: ['board_of_equalization'], district: 1 }],
    [
      'LA County Sheriff',
      { types: ['county_executive'], includes: ['Sheriff'] },
    ],
    [
      'LA Superior Court, Seat 64',
      {
        types: ['judicial_candidate'],
        includes: ['Superior Court'],
        district: 64,
      },
    ],
    [
      'Alhambra City Council, CD 5',
      { types: ['city_council'], place: 'Alhambra', district: 5 },
    ],
    [
      'Culver City Council, At Large',
      { types: ['city_council'], place: 'Culver' },
    ],
    [
      'Arcadia — District 2, City Council Member',
      { types: ['city_council'], place: 'Arcadia', district: 2 },
    ],
    [
      'Mayor of Los Angeles',
      { types: ['city_executive'], includes: ['Mayor'], place: 'Los Angeles' },
    ],
    [
      'City of Montebello Treasurer',
      {
        types: ['city_executive'],
        includes: ['Treasurer'],
        place: 'Montebello',
      },
    ],
    [
      'Southgate City Council',
      { types: ['city_council'], place: 'South Gate' },
    ],
    [
      'LACCD Board of Trustees, Seat 6',
      { types: ['community_college'], place: 'Los Angeles', district: 6 },
    ],
    [
      'Pasadena City College, Seat 3',
      { types: ['community_college'], place: 'Pasadena', district: 3 },
    ],
    [
      'College of the Canyons, Board Area 1',
      { types: ['community_college'], place: 'Santa Clarita', district: 1 },
    ],
    [
      'East Whittier City School Board, Seat 1',
      { types: ['school_board'], place: 'East Whittier', district: 1 },
    ],
    [
      'Hart School District, Board Area 2',
      { types: ['school_board'], place: 'William S. Hart', district: 2 },
    ],
    [
      'Torrance Unified, Area D',
      { types: ['school_board'], place: 'Torrance', includes: ['Area D'] },
    ],
    [
      'Water Replenishment District, Div 3',
      {
        types: ['special_district'],
        place: 'Water Replenishment',
        district: 3,
      },
    ],
    [
      'OC Board of Supervisors District 4',
      { types: ['county_board'], district: 4 },
    ],
  ])('%s', (label, hint) => {
    expect(laHint(label)).toEqual(hint)
  })

  it('leaves out what it does not know', () => {
    expect(laHint('Measure A')).toBeNull()
  })
})

describe('LA lists', () => {
  it('parseLacdp reads cards and the local list, skipping "No Consensus"', () => {
    const html = `<p>Tuesday, November 3, 2026</p>
      <h3 class="headline content-block-headline h4"><div><span>Dr. Shirley Weber</span></div></h3>
      <h4 class="subheadline content-block-subheadline h5"><div><span>Secretary of State</span></div></h4>
      <h2>Tuesday, November 3, 2026 GENERAL ELECTION ENDORSEMENTS</h2>
      <p><strong>2026 Endorsements:</strong></p>
      <h3>Mayor</h3><p>Compton Mayor</p><p>Emma Sharif</p><p> </p>
      <p>Lynwood City Council, At Large</p><p>Juan Munoz Guevara</p><p>No Consensus</p><p> </p>
      <p>Santa Monica-Malibu Unified, At Large</p><p>Alicia Mignano, Laurie Lieberman</p>
      <p>Torrance Unified, Area D</p><p>Ryan Rauzon</p><hr>
      <p>STATEWIDE PROPOSITIONS</p>`
    expect(parseLacdp(html).map((e) => [e.name, e.office])).toEqual([
      ['Shirley Weber', 'Secretary of State'],
      ['Emma Sharif', 'Compton Mayor'],
      ['Juan Munoz Guevara', 'Lynwood City Council, At Large'],
      ['Alicia Mignano', 'Santa Monica-Malibu Unified, At Large'],
      ['Laurie Lieberman', 'Santa Monica-Malibu Unified, At Large'],
      ['Ryan Rauzon', 'Torrance Unified, Area D'],
    ])
  })

  it('parseLacdp stops on a page without the general election', () => {
    expect(() => parseLacdp('<p>June 2, 2026</p>')).toThrow(/November 3/)
  })

  it("parseLagop keeps the party's own endorsements and recommendations", () => {
    const js = `[{id:"gov",name:"Steve Hilton",office:"Governor",jurisdiction:"California",category:"Statewide",party:"Republican",endorsementSource:"CAGOP",matchTags:[]},{id:"ad-65",name:"Lydia A. Guti\\xe9rrez",office:"State Assembly Member",jurisdiction:"Assembly District 65",category:"State",party:"Republican",endorsementSource:"LAGOP",matchTags:["ca-ad-65"]},{id:"weho",name:'Tatyana "Tanya" Tsikanovsky',office:"City Council Member (vote for 3)",jurisdiction:"West Hollywood",category:"City",party:"Nonpartisan",incumbent:!0,endorsementSource:"LAGOP"},{id:"x",name:"Ann Roe",office:"Mayor",jurisdiction:"City of Los Angeles",category:"City",party:"Nonpartisan",endorsementSource:"Do not vote (DSA-LA slate)"},{id:"la-city-attorney",name:"John McKinney",office:"City Attorney",jurisdiction:"City of Los Angeles",category:"City",party:"Nonpartisan",endorsementSource:"Recommended"},{id:"judge-65",name:"Justin Allen Clayton",office:"Superior Court Judge — Office 065",jurisdiction:"Los Angeles County",category:"Judicial",party:"Nonpartisan",endorsementSource:"Recommended (Steve Cooley)"},{id:"cd-26",name:"Sam Gallucci",office:"U.S. Representative",jurisdiction:"Congressional District 26",category:"Federal",party:"Republican",endorsementSource:"Reform CA"}]`
    expect(lagopRecords(js)).toHaveLength(7)
    expect(parseLagop(js)).toEqual([
      {
        name: 'Lydia A. Gutiérrez',
        office: 'Assembly District 65, State Assembly Member',
        hint: {
          types: ['state_legislature'],
          includes: ['Assembly'],
          district: 65,
        },
      },
      {
        name: 'Tatyana "Tanya" Tsikanovsky',
        office: 'West Hollywood, City Council Member (vote for 3)',
        hint: { types: ['city_council'], place: 'West Hollywood' },
      },
      {
        name: 'John McKinney',
        office: 'City of Los Angeles, City Attorney',
        hint: {
          types: ['city_executive'],
          includes: ['Attorney'],
          place: 'Los Angeles',
        },
      },
    ])
  })

  it('parseCadem reads statewide lines and wrapped column rows', () => {
    const html = bbox([
      [
        [100, 100, 'Governor: Xavier Becerra | Lieutenant Governor: Fiona Ma'],
        [30, 200, 'State Assembly'],
        [30, 212, 'AD 12 - No Consensus'],
        [30, 224, 'AD 39 - Juan Carrillo'],
        [320, 200, 'State Senate'],
        [320, 212, 'SD 28 - Lola'],
        [350, 224, 'Smallwood-Cuevas'],
        [320, 236, 'SD 30 - Bob Archuleta'],
        [460, 212, 'CA 26 - Jacqui Irwin'],
        [100, 400, 'Proposition 1: Support'],
      ],
    ])
    expect(parseCadem(html).map((e) => [e.name, e.office])).toEqual([
      ['Xavier Becerra', 'Governor'],
      ['Fiona Ma', 'Lieutenant Governor'],
      ['Juan Carrillo', 'AD 39'],
      ['Lola Smallwood-Cuevas', 'SD 28'],
      ['Bob Archuleta', 'SD 30'],
      ['Jacqui Irwin', 'CA 26'],
    ])
  })

  it('parseCagop reads "Office: Name" headings and skips propositions', () => {
    const html = `<h2>2026 CRP ENDORSEMENTS</h2>
      <h3 class="elementor-heading-title elementor-size-default">Governor: Steve HIlton</h3>
      <h3 class="elementor-heading-title elementor-size-default">Prop 1: Neutral</h3>
      <h3 class="elementor-heading-title elementor-size-default"><a href="#">CD 23: Jay Obernolte</a></h3>`
    expect(parseCagop(html).map((e) => [e.name, e.office])).toEqual([
      ['Steve HIlton', 'Governor'],
      ['Jay Obernolte', 'CD 23'],
    ])
  })

  it('parseLavoteParties reads one party, with districts, and skips the spending-limit list', () => {
    const table = (party: string, rows: string) =>
      `<table><thead><tr class="header"><th colspan="2" class="header"><h3>${party}</h3></th></tr>
      <tr class="columnHeader"><th><h4>Candidates</h4></th></tr></thead><tbody>${rows}</tbody></table>`
    const html = `<h1>November 3, 2026 General Election</h1>
      <h2>Party Endorsements for Voter-Nominated Offices</h2>
      <h3>Governor</h3>${table('Democratic', '<tr><td>Xavier Becerra</td></tr>')}
      ${table('Republican', '<tr><td>Steve Hilton</td></tr>')}
      <h3>Member of the State Assembly</h3>
      ${table('American Independent', '<tr><td>Juan Carrillo</td><td>39</td></tr>')}
      ${table('Democratic', '<tr><td>Jos&eacute; Luis Solache</td><td>62</td></tr><tr><td>Nicholas &ldquo;Nick&rdquo; Schultz</td><td>44</td></tr>')}
      <p>Pursuant to Elections Code 13302(b) any qualified political party may submit a list.</p>
      <h2>Campaign Finance</h2><h3>State Senator</h3>
      ${table('Democratic', '<tr><td>Susan Rubio</td><td>22</td></tr>')}`
    expect(
      parseLavoteParties(html, 'Democratic').map((e) => [
        e.name,
        e.office,
        e.hint?.district,
      ]),
    ).toEqual([
      ['Xavier Becerra', 'Governor', undefined],
      ['José Luis Solache', 'Member of the State Assembly District 62', 62],
      [
        'Nicholas “Nick” Schultz',
        'Member of the State Assembly District 44',
        44,
      ],
    ])
    expect(parseLavoteParties(html, 'American Independent')).toHaveLength(1)
    expect(parseLavoteParties(html, 'Green')).toEqual([])
  })

  it('parseEnviroVoters reads each card', () => {
    const html = `<p>November 3, 2026 General Election</p><ul>
      <li class="ev-card"><h3 class="ev-card-title" id="a">LACCD Board of Trustees, Seat 6</h3>
      <div class="ev-candidate"><a href="#"><span class="ev-candidate-name">Randall Winston</span></a></div></li></ul>`
    expect(parseEnviroVoters(html).map((e) => [e.name, e.office])).toEqual([
      ['Randall Winston', 'LACCD Board of Trustees, Seat 6'],
    ])
  })

  it("parsePpapLa reads only the Action Fund's own tables", () => {
    const html = `<p>Tuesday November 3, 2026!</p>
      <h2>LOCAL</h2><p>The following candidates for local office have been endorsed by Planned Parenthood Advocacy Project Los Angeles County Action Fund.</p>
      <table><tr><td><strong>Local Races</strong></td><td><strong>Candidate</strong></td></tr>
      <tr><td>Los Angeles Mayor</td><td>Karen Bass</td></tr></table>
      <p>The following candidates have been endorsed by another affiliate.</p>
      <table><tr><td>Assembly District 41: John Harabedian</td><td>Endorsed by Planned Parenthood Advocates of Pasadena</td></tr></table>
      <h2>STATEWIDE</h2><p>The following candidates have been endorsed by Planned Parenthood Affiliates of California Votes PAC.</p>
      <table><tr><td>CA Governor</td><td>Xavier Becerra</td></tr></table>`
    expect(parsePpapLa(html).map((e) => [e.name, e.office])).toEqual([
      ['Karen Bass', 'Los Angeles Mayor'],
    ])
  })

  it('parseLaFed reads the transcription only when the images are unchanged', () => {
    const pages: TranscribedPage[] = [
      {
        file: 'GUIDE-2.jpg',
        sha256: 'abc',
        rows: [
          ['State Assembly, AD 64', ['No Recommendation']],
          ['Burbank City Council', ['Nikki Perez (i)', 'Mike Van Gorder']],
        ],
      },
    ]
    expect(
      parseLaFed([{ file: 'GUIDE-2.jpg', sha256: 'abc' }], pages).map(
        (e) => e.name,
      ),
    ).toEqual(['Nikki Perez', 'Mike Van Gorder'])
    expect(() =>
      parseLaFed([{ file: 'GUIDE-2.jpg', sha256: 'def' }], pages),
    ).toThrow(/changed/)
    expect(() =>
      parseLaFed(
        [
          { file: 'GUIDE-2.jpg', sha256: 'abc' },
          { file: 'GUIDE-7.jpg', sha256: 'abc' },
        ],
        pages,
      ),
    ).toThrow(/changed/)
  })
})

describe('more LA lists', () => {
  const pairs = (entries: { name: string; office: string }[]) =>
    entries.map((e) => [e.name, e.office])

  it('parseCra fills known ligature gaps and reads both columns', () => {
    const html = bbox([
      [
        [60, 20, 'California Republican'],
        [60, 35, 'November 2026 General'],
        [360, 35, 'Election Endorsements'],
        [60, 60, 'Statewide Office'],
        [60, 75, 'Governor - Steve Hilton'],
        [60, 90, 'Insurance Commissioner - No Endorsement'],
        [60, 105, 'Statewide Ballot Measures'],
        [60, 120, 'YES on 39'],
        [200, 120, 'YES on 41'],
        [60, 135, 'U.S. House of Representatives'],
        [60, 150, 'District 27 - Jason Gibbs'],
        [360, 60, 'California State Senate'],
        [360, 75, 'District 30 - Araceli Mar'],
        [490, 75, 'nez'],
      ],
    ])
    expect(pairs(parseCra(html))).toEqual([
      ['Steve Hilton', 'Governor'],
      ['Jason Gibbs', 'U.S. House, District 27'],
      ['Araceli Martinez', 'State Senate, District 30'],
    ])
    const unknown = bbox([
      [
        [60, 35, 'November 2026 General Election Endorsements'],
        [60, 60, 'U.S. House of Representatives'],
        [60, 75, 'District 1 - Pat Ro'],
        [160, 75, 'er'],
      ],
    ])
    expect(() => parseCra(unknown)).toThrow(/Ro_er/)
  })

  it('parseCraLa reads cards and treats city cards as city offices', () => {
    const html = `<h1>November 2026 General Election</h1>
      <h3><span><b>City Councils/Officers</b></span></h3>
      <h2 class="et_pb_module_header"><span>Raymond Vergara</span></h2>
      <div class="et_pb_blurb_description"><h4>Hawthorne Treasurer</h4>
      <p><strong>Candidate</strong></p></div>`
    expect(parseCraLa(html)).toEqual([
      {
        name: 'Raymond Vergara',
        office: 'Hawthorne Treasurer',
        hint: {
          types: ['city_executive'],
          includes: ['Treasurer'],
          place: 'Hawthorne',
        },
      },
    ])
  })

  it('parseCft reads statewide pairs, district rows and dual endorsements', () => {
    const html = bbox([
      [
        [0, 20, 'General Election 2026 Tuesday, November 3'],
        [36, 40, 'STATEWIDE OFFICES'],
        [36, 52, 'Governor'],
        [36, 64, 'Xavier Becerra'],
        [36, 76, 'Insurance Commissioner+'],
        [36, 88, 'Ben Allen |'],
        [36, 100, 'Jane Kim'],
        [36, 112, 'STATEWIDE BALLOT MEASURES'],
        [36, 124, 'Prop 1 YES'],
        [216, 40, 'SD 20'],
        [260, 40, 'Caroline Menjivar*'],
        [396, 40, 'AD 68+'],
        [440, 40, 'David Penaloza |'],
        [440, 52, 'Jessie Lopez'],
      ],
    ])
    expect(pairs(parseCft(html))).toEqual([
      ['Xavier Becerra', 'Governor'],
      ['Ben Allen', 'Insurance Commissioner'],
      ['Jane Kim', 'Insurance Commissioner'],
      ['Caroline Menjivar', 'SD 20'],
      ['David Penaloza', 'AD 68'],
      ['Jessie Lopez', 'AD 68'],
    ])
  })

  it('parseSeiu721 reads statewide and LA County records only', () => {
    const js = `dn={display:"Tuesday, November 3, 2026"};const sc=[{category:"Statewide",office:"Governor",candidate:"Xavier Becerra",links:[]}],Bf={"la-county":[{category:"City",office:"Mayor",candidate:"Karen Bass",jurisdiction:"City of Los Angeles",links:[{label:"x",url:"https://a/]"}]},{category:"Ballot Measure",office:"Measure PRK",candidate:"YES",jurisdiction:"City of Los Angeles"}],"inland-region":[{category:"City",office:"Mayor",candidate:"Joz Sida",jurisdiction:"City of Fontana"}]}`
    expect(pairs(parseSeiu721(js))).toEqual([
      ['Xavier Becerra', 'Governor'],
      ['Karen Bass', 'City of Los Angeles, Mayor'],
    ])
  })

  it('parseLaForward reads "Endorsed" and "Recommended" rows on each area page', () => {
    const row = (label: string, rating: string) =>
      `<details class="Accordion_row__x"><summary><span class="Accordion_label__y">${label}</span><span class="RatingBadge_badge__z"><svg viewBox="0 0 16 16"><path d="M8"></path></svg>${rating}</span></summary><div class="Accordion_panel__p"><p>Why.</p></div></details>`
    const city = `<nav>x</nav><main><h1 class="GuideShell_title__a">Los Angeles</h1>
      <section class="RegionSection_section__s" id="los-angeles"><div><h2 class="RegionSection_groupLabel__g">City Council</h2>
      ${row('District 3: Barri Worth Girvan', 'Endorsed')}${row('District 9: Ann Roe', 'No recommendation')}</div>
      <div><h2 class="RegionSection_groupLabel__g">Ballot measures</h2>${row('Measure FD — Sales Tax', 'Support')}</div></section>
      <section class="RegionSection_section__s"><h2 class="RegionSection_heading__h">LA Community College District</h2>
      <div><h3 class="RegionSection_groupLabel__g">Board of Trustees</h3>${row('Seat 2: Steven Veres', 'Recommended')}</div></section></main>`
    const district = `<main><h1>LA Community College District</h1><section class="RegionSection_section__s"><div><h2 class="RegionSection_groupLabel__g">Board of Trustees</h2>${row('Seat 2: Steven Veres', 'Recommended')}</div></section></main>`
    const state = `<main><h1>State Senate</h1><section class="RegionSection_section__s"><div><h2 class="RegionSection_groupLabel__g">Races</h2>${row('CA Senate District 20: Caroline Menjivar', 'Recommended')}</div></section></main>`
    const home = '<title>November 2026</title><p>NOV 3</p>'
    const entries = parseLaForward(home, [city, district, state])
    expect(pairs(entries)).toEqual([
      ['Barri Worth Girvan', 'Los Angeles, City Council, District 3'],
      [
        'Steven Veres',
        'LA Community College District, Board of Trustees, Seat 2',
      ],
      ['Caroline Menjivar', 'CA Senate District 20'],
    ])
    expect(entries[1].hint).toMatchObject({ place: 'Los Angeles', district: 2 })
    expect(() => parseLaForward('<p>June 2026</p>', [city])).toThrow(/November/)
  })

  it('parseCta reads office and candidate rows, skipping "No Recommendation"', () => {
    const pdf = bbox([
      [
        [10, 50, '2026 Candidate Recommendations'],
        [10, 80, 'District'],
        [100, 80, 'Candidate'],
        [10, 100, 'AD 52'],
        [100, 100, 'Jessica Caloza (D)'],
        [10, 112, 'CD 23'],
        [100, 112, 'No Recommendation'],
        [10, 124, 'SD 20'],
        [100, 124, 'Caroline Menjivar (D)'],
      ],
    ])
    expect(pairs(parseCta(pdf))).toEqual([
      ['Jessica Caloza', 'AD 52'],
      ['Caroline Menjivar', 'SD 20'],
    ])
    expect(() => parseCta(bbox([[[10, 50, 'Other list']]]))).toThrow(/CTA/)
  })

  it('parseCplc reads statewide and congressional cards and LA County records', () => {
    const card = (office: string, name: string) =>
      `<span class="text-xs block mb-0.5">${office}</span><h3 class="font-bold"><span class="print-checkbox"></span>${name}</h3>`
    const html = `<p>Prop 45</p>
      <section id="statewide-section">${card('Governor', 'Steve Hilton')}</section>
      <section id="congress-section">${card('District 23', 'Jay Obernolte')}</section>
      <section id="other-section">${card('Governor', 'Ann Roe')}</section>
      <script>const local = [{ county: "Los Angeles", type: "candidate", office: "Superior Court Judge", district: "Office 64", name: "Maria Ghobadi", status: "Recommended" },
      { county: "Orange", type: "candidate", office: "Supervisor", district: "District 2", name: "Bob Doe", status: "Recommended" }]</script>`
    expect(pairs(parseCplc(html))).toEqual([
      ['Steve Hilton', 'Governor'],
      ['Jay Obernolte', 'U.S. House, District 23'],
      ['Maria Ghobadi', 'Superior Court Judge, Office 64'],
    ])
    expect(() => parseCplc('<p>Prop 1</p>')).toThrow(
      /November 2026 propositions/,
    )
  })

  it('parseReformCa reads one pick per race and skips no-picks, opposition and retention', () => {
    const html = `<p>No on Prop 45</p>
      <h2 class="heading-33">Statewide Candidate Races</h2><div><p><strong>STATEWIDE OFFICES<br/></strong></p>
      <p><strong>Governor:</strong> Steve Hilton</p><p><strong>Insurance Commissioner:</strong> You are Doomed</p>
      <h4><strong>CA SUPREME COURT AND COURT OF APPEALS<em>‍</em></strong></h4>
      <p><strong>California Supreme Court</strong></p><p>Kelli Evans - DO NOT RETAIN<br/>Ann Roe - RETAIN</p></div>
      <h2 class="heading-33">U.S. Congress Races</h2><div><p>‍<strong>U.S. House of Representatives</strong> </p><p>District 23: Jay Obernolte </p><p>District 29: You&#x27;re Doomed </p></div>
      <h2 class="heading-33">County Candidate Races</h2><div><p><strong>Superior Court Judges</strong></p><p>Office 64: Definitely NOT Rhonda A. Haymon</p></div>
      <h2 class="heading-33">City Candidate Races</h2><div><p><strong>Los Angeles:</strong> </p><p>Mayor: YOU ARE DOOMED</p><p><strong>Arcadia</strong></p><p>City Council (District 2): Sharon Kwan </p></div>
      <h2 class="heading-33">School Districts</h2><div><p><strong>Beverly Hills Unified School District</strong></p><p>David Cienfuegos — Dual Endorsement </p></div>
      <h2 class="heading-33 w-condition-invisible">Republican Central Committee</h2>`
    const entries = parseReformCa(html)
    expect(pairs(entries)).toEqual([
      ['Steve Hilton', 'Governor'],
      ['Jay Obernolte', 'U.S. House of Representatives, District 23'],
      ['Sharon Kwan', 'Arcadia, City Council (District 2)'],
      ['David Cienfuegos', 'Beverly Hills Unified School District'],
    ])
    expect(entries[2].hint).toMatchObject({ place: 'Arcadia', district: 2 })
  })

  it('parseDfiLa reads "Support" and "Strong Support" rows under each heading', () => {
    const html = `<p>------<br>ENDORSEMENTS for November 2026 GENERAL ELECTION</p>
      <p><strong>&gt;&gt; California Assembly Districts</strong></p>
      <p><strong>Jesse Gabriel<font>*</font> AD-46 - Strong Support</strong></p>
      <p>Paul Seo AD-66 - Support</p><p>Sara De<font>en AD-66 - </font>Oppose</p>
      <p>John Erickson SD-24 - Neutral</p>
      <p><strong>&gt;&gt; Board of Equalization</strong></p><p>Mike Gipson - Seat 3 - Support</p>
      <p><strong>&gt;&gt; Culver City</strong></p>
      <p>Kimberley Griffin, City Council - Support</p>
      <p><strong>&gt;&gt; El Monte</strong></p>
      <p>Cindy Wu, Board Member, Mountain View School District (incumbent) - Strong Support</p>
      <p><strong>&gt;&gt; Beverly Hills Unified School District Board of Education</strong></p><p>Jackie Kruger - Support</p>
      <p>For a few candidates who returned our questionnaire</p>`
    const entries = parseDfiLa(html)
    expect(pairs(entries)).toEqual([
      ['Jesse Gabriel', 'AD 46'],
      ['Paul Seo', 'AD 66'],
      ['Mike Gipson', 'Board of Equalization, Seat 3'],
      ['Kimberley Griffin', 'Culver City, City Council'],
      [
        'Cindy Wu',
        'Mountain View School District, Board Member, Mountain View School District',
      ],
      [
        'Jackie Kruger',
        'Beverly Hills Unified School District Board of Education',
      ],
    ])
    expect(entries[3].hint).toMatchObject({
      types: ['city_council'],
      place: 'Culver',
    })
    expect(entries[4].hint).toMatchObject({ place: 'Mountain View' })
    expect(() => parseDfiLa('<p>June 2026</p>')).toThrow(/November 2026/)
  })

  it('parseKnockLa reads race headings, several names and city name headings', () => {
    const html = `<h1>November 2026 General Election Races</h1>
      <h2>City of Los Angeles</h2><h3>Mayor: Nithya Raman</h3><p>Why.</p>
      <h3>Los Angeles Community College District, Seat 2:</h3><p>[COMING SOON]</p>
      <h2>LA County</h2><h3>Judge of the Superior Court</h3>
      <h4>Seat 64: DPD Rhonda Haymon</h4><h4>Seat 65: Anna Reitano or Justin Clayton</h4>
      <h2>Neighboring LA Cities</h2><h3>Burbank</h3><h4>Mike Van Gorder</h4>
      <h3>Santa Monica</h3><h4>Santa Monica City Council (3 Seats): Mayor Caroline Torosis, Danny Ivanov, and Brett Morrow</h4>
      <h2>Ballot Measures</h2><h3>Statewide</h3><h4>State Measure 1: Yes</h4>
      <h2>California State Legislature</h2><h3>Statewide Races</h3><h4>Governor: Not Steve Hilton</h4>
      <h3>State Judicial [COMING SOON]</h3><h4>Associate Justice of the Supreme Court, Joshua Groban:</h4>
      <h3>State Senate</h3><h4>State Senate District 20: Caroline Menjivar</h4><h4>State Senate District 22: No Recommendation</h4>
      <h2>US Congress</h2><h3>House of Representatives</h3><h4>District 28: Judy Chu</h4>
      <div class="jp-relatedposts"><h3>Related</h3></div>`
    const entries = parseKnockLa(html)
    expect(pairs(entries)).toEqual([
      ['Nithya Raman', 'Los Angeles, Mayor'],
      ['Rhonda Haymon', 'Superior Court, Seat 64'],
      ['Anna Reitano', 'Superior Court, Seat 65'],
      ['Justin Clayton', 'Superior Court, Seat 65'],
      ['Mike Van Gorder', 'Burbank, City Council'],
      ['Caroline Torosis', 'Santa Monica City Council'],
      ['Danny Ivanov', 'Santa Monica City Council'],
      ['Brett Morrow', 'Santa Monica City Council'],
      ['Caroline Menjivar', 'State Senate District 20'],
      ['Judy Chu', 'U.S. House of Representatives, District 28'],
    ])
    expect(entries.at(-1)?.hint).toMatchObject({
      types: ['us_house'],
      district: 28,
    })
  })

  it('parseDsaLa reads each candidate heading and its "for" line', () => {
    const html = `<p>DSA-LA is proud to endorse nine of our fellow members for the 2026 general election.</p>
      <h2>MEET OUR CANDIDATES!</h2><p>Intro.</p>
      <h2>Nithya Raman</h2><style>#b { color: red }</style><p><span><em>for Los Angeles City Mayor</em></span></p><p>Bio.</p>
      <h2>&nbsp;Estefany Castañeda</h2><p><em>for Centinela Valley </em><span><em>Union High School </em></span><em>District Board</em></p>`
    const entries = parseDsaLa(html)
    expect(pairs(entries)).toEqual([
      ['Nithya Raman', 'Los Angeles City Mayor'],
      [
        'Estefany Castañeda',
        'Centinela Valley Union High School District Board',
      ],
    ])
    expect(entries[0].hint).toMatchObject({ place: 'Los Angeles' })
    expect(() => parseDsaLa('<h2>Ann Roe</h2>')).toThrow(/2026 general/)
  })

  it('parseUtla reads candidate headings and places city offices in LA', () => {
    const html = `<img src="UTLA-Endorsement-Disclaimer-General-2026.png">
      <h2 class="headline">ENDORSED CANDIDATES</h2>
      <h2><strong>Marissa Roy, City Attorney</strong><img src="x.png"></h2>
      <h2>YES on Prop 3</h2>
      <h2>Richard Barrera, State Superintendent of Public Instruction</h2>
      <h3>State Affiliates</h3>`
    const entries = parseUtla(html)
    expect(pairs(entries)).toEqual([
      ['Marissa Roy', 'City Attorney'],
      ['Richard Barrera', 'State Superintendent of Public Instruction'],
    ])
    expect(entries[0].hint).toMatchObject({ place: 'Los Angeles' })
  })

  it('parseWfpCa reads Los Angeles and statewide rows once', () => {
    const row = (name: string, office: string, region: string) =>
      `<tr><td class="state-cands__name">${name}</td>
      <td class="state-cands__info">${office}</td>
      <td class="state-cands__rac">${region}</td></tr>`
    const page = `<p>Prop 45: Reject Corporate Polluting Projects</p>${row('Nikki Perez', 'Burbank City Council', 'Los Angeles')}`
    const more = `${row('Sean Frame', 'State Senate, Distrcit 6', 'Central Valley/Central Coast')}${row('Jane Kim', 'State Insurance Commissioner', 'Statewide')}${row('Nikki Perez', 'Burbank City Council', 'Los Angeles')}`
    expect(pairs(parseWfpCa([page, more]))).toEqual([
      ['Nikki Perez', 'Burbank City Council'],
      ['Jane Kim', 'State Insurance Commissioner'],
    ])
  })
})
