// The site menu in the header: inline links on wide screens, a Menu button
// on narrow ones (the CSS decides which shows; jsdom shows both).
import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ballotStore } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import { THEME_KEY, themeStore } from '../theme/themePreference.ts'

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </QueryClientProvider>,
  )
}

const menu = () => screen.getByRole('navigation', { name: 'Site' })
const menuButton = () => screen.getByRole('button', { name: 'Menu' })

const IL = 'ocd-division/country:us/state:il'
const ballot: Ballot = {
  election: {
    id: 'il-2026-11-03-general',
    name: 'Illinois General Election',
    date: '2026-11-03',
    divisionId: IL,
  },
  contests: [
    {
      kind: 'candidate',
      id: 'gov',
      electionId: 'il-2026-11-03-general',
      authorityId: `${IL}/county:cook`,
      districtId: IL,
      title: 'Governor and Lieutenant Governor',
      office: 'Governor and Lieutenant Governor',
      voteFor: 1,
      candidates: [{ name: 'Jane Doe', party: 'Democratic' }],
      sources: [],
      lastVerified: '2026-10-04',
    },
  ],
  coverage: { status: 'complete', notes: [] },
}

describe('site menu', () => {
  it('links My ballot (home), About and Saved choices', () => {
    renderAt('/')
    expect(
      within(menu())
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['My ballot', '/'],
      ['About', '/about'],
      ['Saved choices', '/saved-choices'],
    ])
  })

  it('links Support, Press, GitHub and Contact in the footer', () => {
    renderAt('/')
    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer).getByRole('link', { name: 'Support VoteStack' }),
    ).toHaveAttribute('href', '/support')
    expect(within(footer).getByRole('link', { name: 'Press' })).toHaveAttribute(
      'href',
      '/press',
    )
    expect(footer).toHaveTextContent('© 2026 VoteStack, LLC.')
    expect(footer).toHaveTextContent(
      `Version ${JSON.parse(readFileSync('package.json', 'utf8')).version}.`,
    )
    expect(
      within(footer).getByRole('link', { name: 'GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/nikolai-laba/votestack')
    expect(
      within(footer).getByRole('link', { name: 'Contact' }),
    ).toHaveAttribute('href', 'mailto:nikolai@votestack.org')
  })

  it('marks the current page', async () => {
    renderAt('/about')
    await screen.findByRole('heading', { level: 1, name: 'About VoteStack' })
    expect(within(menu()).getByRole('link', { name: 'About' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const name of ['My ballot', 'Saved choices'])
      expect(within(menu()).getByRole('link', { name })).not.toHaveAttribute(
        'aria-current',
      )
    // The current link gets the highlight fill, and an underline in
    // forced-colours mode, where fills are dropped.
    expect(within(menu()).getByRole('link', { name: 'About' })).toHaveClass(
      'bg-highlight',
      'forced-colors:underline',
    )
  })

  it('shows the pick count once something is picked', () => {
    ballotStore.saveBallot(ballot)
    renderAt('/')
    // Nothing picked yet: no count.
    expect(
      within(menu()).getByRole('link', { name: 'Saved choices' }),
    ).toHaveAttribute('href', '/saved-choices')
    act(() => {
      ballotStore.toggle(ballot.contests[0], 'jane-doe')
    })
    expect(
      within(menu()).getByRole('link', { name: 'Saved choices (1 picked)' }),
    ).toHaveAttribute('href', '/saved-choices')
  })

  it('opens and closes from the Menu button with the keyboard', async () => {
    renderAt('/')
    const button = menuButton()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', menu().id)
    expect(menu()).toHaveClass('max-md:hidden')

    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(menu()).not.toHaveClass('max-md:hidden')

    // Into the list, then Escape closes it and returns focus to the button.
    await userEvent.tab()
    expect(
      within(menu()).getByRole('link', { name: 'My ballot' }),
    ).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    expect(menu()).toHaveClass('max-md:hidden')

    await userEvent.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('links the logo home, in the version for the current mode', async () => {
    renderAt('/')
    const home = screen.getByRole('link', { name: 'VoteStack home' })
    expect(home).toHaveAttribute('href', '/')
    const logo = () => home.querySelector('img')!
    expect(logo()).toHaveAttribute('src', '/brand/votestack-wordmark.png')
    await userEvent.click(
      within(menu()).getByRole('button', { name: 'Dark mode' }),
    )
    expect(logo()).toHaveAttribute('src', '/brand/votestack-wordmark-dark.png')
    // Back to the device's mode for the tests after this one.
    await userEvent.click(
      within(menu()).getByRole('button', { name: 'Light mode' }),
    )
  })

  it('switches between light and dark mode and remembers it', async () => {
    renderAt('/')
    const root = document.documentElement
    // jsdom has no dark device setting, so the site starts light.
    expect(root).not.toHaveAttribute('data-theme')
    await userEvent.click(
      within(menu()).getByRole('button', { name: 'Dark mode' }),
    )
    expect(root).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')

    // Back to the device's mode: the choice is forgotten.
    await userEvent.click(
      within(menu()).getByRole('button', { name: 'Light mode' }),
    )
    expect(root).not.toHaveAttribute('data-theme')
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull()
    expect(
      within(menu()).getByRole('button', { name: 'Dark mode' }),
    ).toBeInTheDocument()
  })

  it('starts in a saved mode', () => {
    window.localStorage.setItem(THEME_KEY, 'dark')
    themeStore.reload()
    renderAt('/')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(
      within(menu()).getByRole('button', { name: 'Light mode' }),
    ).toBeInTheDocument()
  })

  it('switches mode with storage unavailable', async () => {
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
    try {
      themeStore.reload()
      renderAt('/')
      await userEvent.click(
        within(menu()).getByRole('button', { name: 'Dark mode' }),
      )
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      expect(
        within(menu()).getByRole('button', { name: 'Light mode' }),
      ).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'localStorage', storage)
    }
  })

  it('closes after following a link', async () => {
    renderAt('/')
    await userEvent.click(menuButton())
    await userEvent.click(within(menu()).getByRole('link', { name: 'About' }))
    await screen.findByRole('heading', { level: 1, name: 'About VoteStack' })
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  })
})
