import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { lintTone } from '../../scripts/lib/profiles/checks.ts'
import { routes } from '../routes.tsx'

function renderPage() {
  const router = createMemoryRouter(routes, {
    initialEntries: ['/how-profiles-are-made'],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('How we make profiles', () => {
  it('has one title and its sections in order', () => {
    renderPage()
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent),
    ).toEqual(['How we make profiles'])
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'In short',
      'Where the information comes from',
      'How a profile is written',
      'What we can’t promise',
      'Equal treatment',
      'Endorsements and bar ratings',
      'Campaign money',
      'Report an error',
    ])
    for (const name of [
      'Where the information comes from',
      'Campaign money',
      'Report an error',
    ])
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(document.title).toBe('How we make profiles | VoteStack')
  })

  it('names both models and says no person reviews each profile', () => {
    renderPage()
    const writing = screen.getByRole('region', {
      name: 'How a profile is written',
    })
    expect(writing).toHaveTextContent('DeepSeek V4 Pro')
    expect(writing).toHaveTextContent('Claude Opus 5.5')
    expect(writing).toHaveTextContent('Google Gemini 3.1 Pro')
    expect(writing).toHaveTextContent('Each sentence cites one source')
    expect(writing).toHaveTextContent(/removes anything it can.t confirm/)
    expect(writing).toHaveTextContent('No person reviews each profile')
    expect(
      screen.getByRole('region', { name: 'What we can’t promise' }),
    ).toHaveTextContent('AI models can still make mistakes')
  })

  it('opens with a short summary of the method', () => {
    renderPage()
    const summary = screen.getByRole('region', { name: 'In short' })
    expect(summary).toHaveTextContent('A second AI model checks each sentence')
    expect(summary).not.toHaveTextContent('A person checks')
    expect(summary).toHaveTextContent(
      'The rest of this page explains each step in detail.',
    )
  })

  it('says what profiles leave out and where endorsements come from', () => {
    renderPage()
    const sources = screen.getByRole('region', {
      name: 'Where the information comes from',
    })
    expect(sources).toHaveTextContent(/don.t use social media/)
    expect(sources).toHaveTextContent(/allegations that weren.t proven/)
    const endorsements = screen.getByRole('region', {
      name: 'Endorsements and bar ratings',
    })
    expect(endorsements).toHaveTextContent('links to a page that shows it')
    expect(endorsements).toHaveTextContent('No rating published')
  })

  it('treats every candidate in a race the same', () => {
    renderPage()
    const equal = screen.getByRole('region', { name: 'Equal treatment' })
    expect(equal).toHaveTextContent(
      'A race appears only when every candidate in it passes the checks.',
    )
    expect(equal).toHaveTextContent('the same research')
  })

  it('explains when breakdown percentages are left out', () => {
    renderPage()
    const money = screen.getByRole('region', { name: 'Campaign money' })
    expect(money).toHaveTextContent('ISBE')
    expect(money).toHaveTextContent('Cal-Access')
    expect(money).toHaveTextContent('FEC')
    expect(money).toHaveTextContent(
      'We show percentages only when a committee raised at least $5,000 in the period',
    )
    expect(money).not.toHaveTextContent('Top contributors')
  })

  it('says how reports work', () => {
    renderPage()
    const errors = screen.getByRole('region', { name: 'Report an error' })
    expect(errors).toHaveTextContent('Report an error')
    expect(errors).toHaveTextContent(
      /doesn.t save your name, email, IP address/,
    )
    // The form lives on each profile's report page, and there is no made-up
    // contact address. (The home page's address form stays mounted beside.)
    const page = screen.getByRole('article')
    expect(within(page).queryByRole('textbox')).toBeNull()
    expect(within(page).queryByRole('button')).toBeNull()
    expect(page.querySelector('form')).toBeNull()
    expect(page.textContent).not.toMatch(/@\w/)
  })

  it('links back to the address form when no ballot is open', () => {
    renderPage()
    expect(
      screen.getByRole('link', { name: 'Find your ballot' }),
    ).toHaveAttribute('href', '/getstarted')
  })

  it('follows the voice rules it describes', () => {
    renderPage()
    const page = screen.getByRole('article')
    // Words quoted as examples of what the checks reject are left out.
    const text = (page.textContent ?? '').replace(/“[^”]*”/g, '')
    expect(lintTone(text)).toEqual([])
  })
})
