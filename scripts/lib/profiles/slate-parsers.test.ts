import { describe, expect, it } from 'vitest'
import {
  columnLines,
  hintFor,
  parseAflCio,
  parseBbox,
  parseCfl,
  parseLocal150,
  parsePersonalPac,
  vacancySurname,
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
