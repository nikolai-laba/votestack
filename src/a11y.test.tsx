// Page-wide accessibility behaviour: the skip link, page titles and
// where focus lands when a page opens on its own.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routes } from './routes.tsx'

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </QueryClientProvider>,
  )
}

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
})
