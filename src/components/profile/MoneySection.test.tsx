import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MoneySummary } from '../../shared/profile.ts'
import { MoneySection } from './MoneySection.tsx'

const large: NonNullable<MoneySummary['largeSince']> = {
  since: '2026-06-30',
  total: 1050000,
  count: 3,
}

const summary: MoneySummary = {
  source: 'ISBE',
  committee: 'Friends of Jane Doe',
  url: 'https://elections.il.gov/committee/1',
  period: 'April 1 to June 30, 2026',
  raised: 600000,
  cashOnHand: 100000,
  breakdown: [
    { kind: 'small', amount: 3000 },
    { kind: 'large', amount: 296000 },
    { kind: 'transfer', amount: 300000 },
    { kind: 'other', amount: 1000 },
  ],
  largeSince: large,
}

const renderMoney = (s: MoneySummary) =>
  render(<MoneySection section={{ asOf: '2026-10-06', items: [s] }} />)

const breakdownTable = () =>
  screen.getByRole('table', { name: 'Where the money came from' })

const rowTexts = () =>
  within(breakdownTable())
    .getAllByRole('row')
    .slice(1) // the header row (read by screen readers only)
    .map((r) => r.textContent)

describe('MoneySection', () => {
  it('says how much of the money came from the candidate', () => {
    renderMoney({
      ...summary,
      fromCandidate: 500000,
      largeSince: { ...large, fromCandidate: 1000000 },
    })
    const money = screen.getByRole('region', { name: 'Campaign money' })
    expect(money).toHaveTextContent(
      'Raised$600,000Of this, $500,000 came from the candidate.',
    )
    expect(money).toHaveTextContent(
      'Large contributions reported since June 30, 2026: $1,050,000 in 3 gifts. Of this, $1,000,000 came from the candidate.',
    )
  })

  it('says nothing about the candidate when none of the money is theirs', () => {
    renderMoney(summary)
    expect(
      screen.getByRole('region', { name: 'Campaign money' }),
    ).not.toHaveTextContent('from the candidate')
  })

  it('leaves the candidate line out when the total is not reported', () => {
    renderMoney({ ...summary, raised: undefined, fromCandidate: 500 })
    const money = screen.getByRole('region', { name: 'Campaign money' })
    expect(money).toHaveTextContent('RaisedNot reported')
    expect(money).not.toHaveTextContent('from the candidate')
  })

  it('breaks the money down by source, with amounts and shares', () => {
    renderMoney(summary)
    expect(rowTexts()).toEqual([
      'Small gifts ($150 or less)$3,0001%',
      'Larger gifts$296,00049%',
      'PACs, parties and other campaign committees$300,00050%',
      'Other receipts$1,000Under 1%',
    ])
    // Sources are row headers, so each amount is read with its source.
    expect(
      within(breakdownTable()).getByRole('rowheader', { name: 'Larger gifts' }),
    ).toBeInTheDocument()
  })

  it('uses the federal labels for FEC reports', () => {
    renderMoney({
      ...summary,
      source: 'FEC',
      raised: 1000000,
      breakdown: [
        { kind: 'small', amount: 100000 },
        { kind: 'large', amount: 400000 },
        { kind: 'pac', amount: 200000 },
        { kind: 'party', amount: 50000 },
        { kind: 'transfer', amount: 50000 },
        { kind: 'candidate', amount: 150000 },
        { kind: 'loan', amount: 40000 },
        { kind: 'other', amount: 10000 },
      ],
      fromCandidate: 150000,
      largeSince: undefined,
    })
    expect(rowTexts()).toEqual([
      'Small gifts from people ($200 or less)$100,00010%',
      'Larger gifts from people$400,00040%',
      'PACs and other committees$200,00020%',
      'Party committees$50,0005%',
      'Transfers from other campaign committees$50,0005%',
      'The candidate$150,00015%',
      'Loans from others$40,0004%',
      'Other receipts$10,0001%',
    ])
  })

  it('shows amounts without shares when little was raised', () => {
    renderMoney({
      ...summary,
      raised: 4899.07,
      breakdown: [
        { kind: 'small', amount: 399.07 },
        { kind: 'transfer', amount: 4500 },
      ],
    })
    expect(rowTexts()).toEqual([
      'Small gifts ($150 or less)$399',
      'PACs, parties and other campaign committees$4,500',
    ])
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('says the breakdown is not reported when the parts are missing', () => {
    renderMoney({ ...summary, breakdown: undefined })
    expect(rowTexts()).toEqual(['Not reported'])
  })

  it('has no breakdown when nothing was raised', () => {
    renderMoney({ ...summary, raised: 0, breakdown: [] })
    expect(
      screen.queryByRole('table', { name: 'Where the money came from' }),
    ).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Campaign money' }),
    ).toHaveTextContent('Raised$0')
  })

  it('ignores fields from older profiles', () => {
    renderMoney({
      ...summary,
      topContributors: [{ name: 'Chicago Laborers PAC', amount: 50000 }],
      smallDonorShare: 0.1,
      largeSince: {
        ...large,
        organizations: [{ name: 'Chicago Laborers PAC', amount: 50000 }],
      },
    } as MoneySummary)
    const money = screen.getByRole('region', { name: 'Campaign money' })
    expect(money).not.toHaveTextContent('Chicago Laborers PAC')
    expect(money).not.toHaveTextContent('small donors')
  })

  it('names each committee only in its source line, with a rule between them', () => {
    const fec: MoneySummary = {
      ...summary,
      source: 'FEC',
      committee: 'Doe for Congress',
      url: 'https://www.fec.gov/data/committee/C1/',
      largeSince: undefined,
    }
    render(
      <MoneySection section={{ asOf: '2026-10-06', items: [summary, fec] }} />,
    )
    const money = screen.getByRole('region', { name: 'Campaign money' })
    // The section title is the only heading.
    expect(
      within(money)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual(['Campaign money'])
    expect(
      within(money).getByRole('link', {
        name: 'Federal Election Commission filings for Doe for Congress',
      }),
    ).toHaveAttribute('href', 'https://www.fec.gov/data/committee/C1/')
    const list = within(money)
      .getByRole('link', {
        name: 'Illinois State Board of Elections filings for Friends of Jane Doe',
      })
      .closest('.divide-y')
    expect(list?.children).toHaveLength(2)
  })
})
