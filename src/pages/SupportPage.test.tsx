import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintTone } from '../../scripts/lib/profiles/checks.ts'
import { routes } from '../routes.tsx'
import { CANDIDATES_COVERED } from './SupportPage.tsx'

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </QueryClientProvider>,
  )
}

const title = () =>
  screen.findByRole('heading', { level: 1, name: 'Support VoteStack' })

describe('Support page', () => {
  it('has one title and its sections in order', async () => {
    renderAt('/support')
    expect(await title()).toHaveFocus()
    expect(document.title).toBe('Support VoteStack | VoteStack')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'What your money pays for',
      'Money we don’t take',
      'Other ways to help',
    ])
  })

  it('says payments are not tax-deductible, under the payment link', async () => {
    renderAt('/support')
    await title()
    const link = screen.getByRole('link', { name: 'Help support VoteStack' })
    expect(link).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/buy\.stripe\.com\//),
    )
    const note = screen.getByText(/a company, not a charity/)
    expect(note).toHaveTextContent(
      'Payments to VoteStack aren’t tax-deductible.',
    )
    expect(
      link.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows the costs, with the candidate count from the published lists', async () => {
    const dir = 'content/profiles/published'
    const lists = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    const published = lists.reduce(
      (n, l) => n + Object.keys(l.profiles).length,
      0,
    )
    expect(CANDIDATES_COVERED).toBe(published)

    renderAt('/support')
    await title()
    const costs = screen.getByRole('region', {
      name: 'What your money pays for',
    })
    expect(costs).toHaveTextContent(
      'Hosting, email and the database that finds your districts: $33.40 a month.',
    )
    expect(costs).toHaveTextContent(
      '$400.37 so far for 1,176 candidates, or about 34 cents a candidate',
    )
    expect(costs).not.toHaveTextContent('TO CONFIRM')
  })

  it('names the money it refuses and keeps payers away from profiles', async () => {
    renderAt('/support')
    await title()
    const rules = screen.getByRole('region', { name: 'Money we don’t take' })
    expect(rules).toHaveTextContent(
      'candidates, officeholders, campaigns, political parties',
    )
    expect(rules).toHaveTextContent('we refund it')
    expect(rules).toHaveTextContent('can’t review or change them')
    expect(
      within(rules).getByRole('link', { name: 'How we stay fair' }),
    ).toHaveAttribute('href', '/about#fair')
  })

  it('never calls a payment a donation and passes the tone check', async () => {
    renderAt('/support')
    await title()
    const text = screen.getByRole('article').textContent ?? ''
    expect(text).not.toMatch(/donat/i)
    expect(lintTone(text)).toEqual([])
    expect(text).not.toMatch(/[—·]/)
  })
})
