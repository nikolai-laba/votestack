import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { lintTone } from '../../scripts/lib/profiles/checks.ts'
import { LAST_CHECKED } from '../data/lastChecked.ts'
import { longDate } from '../format.ts'
import { routes } from '../routes.tsx'

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
  screen.findByRole('heading', { level: 1, name: 'About VoteStack' })

describe('About page', () => {
  it('has one title and its sections in order', async () => {
    renderAt('/about')
    expect(await title()).toHaveFocus()
    expect(document.title).toBe('About VoteStack | VoteStack')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      'What is VoteStack?',
      'Who makes VoteStack',
      'How we stay fair',
      'Where ballot information comes from',
      'When we last checked',
      'How we make profiles',
      'Official ballot order',
      'Your privacy',
      'Open source',
      'Report an error',
    ])
  })

  it('says who we are and what it covers', async () => {
    renderAt('/about')
    await title()
    const what = screen.getByRole('region', { name: 'What is VoteStack?' })
    expect(what).toHaveTextContent(
      'doesn’t support or oppose any candidate, party, referendum or measure',
    )
    expect(what).toHaveTextContent('isn’t a government site')
    expect(what).toHaveTextContent('We don’t tell you how to vote')
    expect(what).toHaveTextContent(
      'It covers Chicago and suburban Cook County, Illinois, and Los Angeles County, California.',
    )
    expect(what).toHaveTextContent('Knowing who the candidates are is harder')
    expect(what).toHaveTextContent('Campaign money:')
    expect(what).toHaveTextContent('Every sentence links to its source')
    const who = screen.getByRole('region', { name: 'Who makes VoteStack' })
    expect(who).toHaveTextContent(
      'I’m Nikolai Laba, a voter living in Oak Park (Cook County), IL',
    )
    expect(who).toHaveTextContent(
      'VoteStack is published by VoteStack, LLC, a company I own.',
    )
    expect(who).toHaveTextContent(
      'It takes no money from candidates, parties, campaigns, political committees or governments',
    )
    expect(
      within(who).getByRole('link', { name: 'Support VoteStack' }),
    ).toHaveAttribute('href', '/support')
    expect(
      within(who).getByRole('link', { name: 'Nikolai@VoteStack.org' }),
    ).toHaveAttribute('href', 'mailto:nikolai@votestack.org')
    const fair = screen.getByRole('region', { name: 'How we stay fair' })
    expect(fair).toHaveTextContent('Party is shown as text, never as a color.')
    expect(
      within(fair).getByRole('link', { name: 'official ballot order' }),
    ).toHaveAttribute('href', '/about#ballot-order')
    const sources = screen.getByRole('region', {
      name: 'Where ballot information comes from',
    })
    expect(sources).toHaveTextContent('Cook County Clerk')
    expect(sources).toHaveTextContent('Chicago Board of Election Commissioners')
    expect(sources).toHaveTextContent(
      'Los Angeles County Registrar-Recorder/County Clerk’s Interactive Sample Ballot data',
    )
    expect(sources).toHaveTextContent('The County doesn’t endorse VoteStack.')
    expect(
      within(sources).getByRole('link', { name: 'isb.lavote.gov' }),
    ).toHaveAttribute('href', 'https://isb.lavote.gov/')
    expect(sources).toHaveTextContent(
      'We mark a candidate as the incumbent only when an official list confirms they hold the seat.',
    )
  })

  it('shows when candidate information was last checked', async () => {
    renderAt('/about')
    await title()
    expect(
      screen.getByRole('region', { name: 'When we last checked' }),
    ).toHaveTextContent(
      `We last checked candidate information on ${longDate(LAST_CHECKED)}.`,
    )
  })

  it('links to the methods page and explains ballot order', async () => {
    renderAt('/about')
    await title()
    expect(
      within(
        screen.getByRole('region', { name: 'How we make profiles' }),
      ).getByRole('link', { name: 'How we make profiles' }),
    ).toHaveAttribute('href', '/how-profiles-are-made')
    expect(
      screen.getByRole('region', { name: 'Official ballot order' }),
    ).toHaveTextContent('public lotteries')
    expect(
      screen.getByRole('region', { name: 'Your privacy' }),
    ).toHaveTextContent('It isn’t saved, logged or added to the page link.')
    expect(
      screen.getByRole('region', { name: 'Your privacy' }),
    ).toHaveTextContent('We keep only totals, by page, level of government')
    expect(
      screen.getByRole('region', { name: 'Open source' }),
    ).toHaveTextContent('Apache License 2.0')
  })

  it('opens at the ballot order explainer from its link', async () => {
    renderAt('/about')
    const fair = await screen.findByRole('region', { name: 'How we stay fair' })
    await userEvent.click(
      within(fair).getByRole('link', { name: 'official ballot order' }),
    )
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Official ballot order',
      }),
    ).toHaveFocus()
  })

  it('passes the tone check', async () => {
    renderAt('/about')
    await title()
    const text = screen.getByRole('article').textContent ?? ''
    expect(lintTone(text)).toEqual([])
    expect(text).not.toMatch(/[—·]/)
  })

  it('links to email updates without a form, and describes them under Your privacy', async () => {
    renderAt('/about')
    await title()
    expect(
      screen.queryByRole('region', {
        name: 'Hear from VoteStack before your next election',
      }),
    ).toBeNull()
    expect(
      screen.getByRole('link', {
        name: 'get an email when VoteStack covers your area',
      }),
    ).toHaveAttribute('href', '/notify')
    expect(
      screen.getByText(
        /We use those to notify you when VoteStack is ready for your next election and to share big VoteStack news\./,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/sign-up banner/)).toBeNull()
    expect(screen.queryByText(/count where people are asking from/)).toBeNull()
  })
})
