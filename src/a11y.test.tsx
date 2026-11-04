// Page-wide accessibility behaviour: the skip link, page titles and
// where focus lands when a page opens on its own.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from './routes.tsx'
import { NOTICE_WORDS_PATH } from './shared/afterElection.ts'

// Switches the site to its after-election mode for the tests that say so.
const mode = vi.hoisted(() => ({ on: false }))
vi.mock('./shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('./shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  mode.on = false
  vi.unstubAllGlobals()
})

describe('page accessibility', () => {
  it('starts with a skip link to the main content', async () => {
    renderAt('/')
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('starts the methods page at its title', () => {
    renderAt('/how-profiles-are-made')
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('starts the sign-up page at its title', async () => {
    renderAt('/notify')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('names the not-found page in the title', () => {
    renderAt('/nope')
    expect(document.title).toBe('Page not found | VoteStack')
  })

  it('keeps the page’s own start with the thank-you notice open', async () => {
    mode.on = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === NOTICE_WORDS_PATH
          ? Response.json({
              version: 1,
              heading: 'Thank you for using VoteStack',
              intro: 'Voting has ended.',
              signup: { heading: 'Hear from us', body: 'Sign up below.' },
              support: {
                heading: 'Help fund voter education',
                body: 'VoteStack is free to use.',
                payLabel: 'Pay what you want',
                payUrl: 'https://buy.stripe.com/test_notice',
                fine: 'Payments aren’t tax-deductible.',
                linkLabel: 'How payments are used',
              },
              line: {
                text: 'Voting has ended.',
                open: 'Sign up or support',
                openSignedUp: 'Support VoteStack',
              },
            })
          : new Response(null, { status: 404 }),
      ),
    )
    renderAt('/how-profiles-are-made')
    // A named landmark between the header and the page, whose heading sits
    // under the page's one h1 and can take focus.
    const notice = await screen.findByRole('complementary', {
      name: 'Thank you notice',
    })
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Thank you for using VoteStack',
    })
    expect(notice).toContainElement(heading)
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(
      screen.getByRole('banner').compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('main')).not.toContainElement(notice)
    // Arriving doesn't pull focus into the notice: the page starts at its
    // title, and the skip link still goes past the notice to the page.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main')
    expect(
      screen.getByRole('button', { name: 'Close the thank-you notice' }),
    ).toBeVisible()
  })
})
