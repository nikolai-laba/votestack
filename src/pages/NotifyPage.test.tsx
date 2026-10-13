import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, type Ref } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnstileHandle } from '../components/report/Turnstile.tsx'
import { routes } from '../routes.tsx'

// The real widget loads Cloudflare's script; this stand-in hands out a token
// when its button is pressed and counts resets.
const resets = vi.fn()
const actions = vi.fn()
vi.mock('../components/report/Turnstile.tsx', () => ({
  Turnstile: ({
    action,
    onToken,
    ref,
  }: {
    action?: string
    onToken: (t: string | null) => void
    ref?: Ref<TurnstileHandle>
  }) => {
    actions(action)
    useImperativeHandle(ref, () => ({
      reset() {
        resets()
        onToken(null)
      },
    }))
    return (
      <button type="button" onClick={() => onToken('tok-1')}>
        Pass check
      </button>
    )
  },
}))

type Answer = { status: number; body?: unknown }

function stubApi(
  answer: Answer | Answer[] = { status: 201, body: { ok: true } },
) {
  const answers = Array.isArray(answer) ? [...answer] : [answer]
  const sent: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/notify') throw new Error(`unexpected ${url}`)
      sent.push(JSON.parse(String(init?.body)))
      const a = answers.length > 1 ? answers.shift()! : answers[0]
      return Response.json(a.body ?? {}, { status: a.status })
    }),
  )
  return sent
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/notify'] })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const heading = () =>
  screen.findByRole('heading', {
    level: 1,
    name: 'Get an email when VoteStack covers your area',
  })

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  resets.mockClear()
  actions.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  email = ' Pat@Example.com ',
  zip = '53703-1234',
) {
  await user.type(screen.getByRole('textbox', { name: 'Email address' }), email)
  await user.type(screen.getByRole('textbox', { name: 'ZIP code' }), zip)
}

describe('Get an email when VoteStack covers your area', () => {
  it('starts at the title and says what the page is for', async () => {
    stubApi()
    renderPage()
    expect(await heading()).toHaveFocus()
    expect(document.title).toBe(
      'Get an email when VoteStack covers your area | VoteStack',
    )
    expect(
      screen.getByRole('link', { name: 'Find your ballot' }),
    ).toHaveAttribute('href', '/getstarted')
    expect(
      screen.getByText(/We save only your email address and ZIP code/),
    ).toBeInTheDocument()
    expect(actions).toHaveBeenCalledWith('notify')
  })

  it('sends the email and 5-digit ZIP code, then thanks the visitor', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await heading()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    const done = await screen.findByText('Thanks. You’re signed up.')
    expect(done.closest('[role=status]')).toHaveFocus()
    expect(sent).toEqual([
      { email: 'pat@example.com', zip: '53703', turnstileToken: 'tok-1' },
    ])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows each bad field and focuses the first', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await heading()
    await fillIn(user, 'pat@example', '123')
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    const email = screen.getByRole('textbox', { name: 'Email address' })
    expect(email).toHaveFocus()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(
      'Enter an email address like name@example.com.',
    )
    expect(
      screen.getByRole('textbox', { name: 'ZIP code' }),
    ).toHaveAccessibleDescription('Enter a 5-digit ZIP code.')
    expect(sent).toEqual([])

    // Editing clears that field's error.
    await user.type(email, '.com')
    expect(email).not.toHaveAttribute('aria-invalid')
  })

  it('waits for the spam check before sending', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await heading()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(
      screen.getByText(
        'Wait for the spam check to finish, then sign up again.',
      ),
    ).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('keeps what was typed and gets a new token when sending fails', async () => {
    const sent = stubApi([
      { status: 429, body: { error: 'Too many' } },
      { status: 201, body: { ok: true } },
    ])
    const user = userEvent.setup()
    renderPage()
    await heading()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(
      await screen.findByText(
        /Several sign-ups were sent from your connection/,
      ),
    ).toBeInTheDocument()
    expect(resets).toHaveBeenCalledOnce()
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Email address',
        }) as HTMLInputElement
      ).value,
    ).toContain('Pat@Example.com')

    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(await screen.findByText('Thanks. You’re signed up.')).toBeVisible()
    expect(sent).toHaveLength(2)
  })

  it('shows field errors the Worker returns', async () => {
    stubApi({
      status: 400,
      body: { error: 'Check', fields: { zip: 'Enter a 5-digit ZIP code.' } },
    })
    const user = userEvent.setup()
    renderPage()
    await heading()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    const zip = screen.getByRole('textbox', { name: 'ZIP code' })
    await vi.waitFor(() => expect(zip).toHaveFocus())
    expect(zip).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows no form without a Turnstile site key', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    stubApi()
    renderPage()
    await heading()
    expect(screen.getByText('Sign-up isn’t available yet.')).toBeVisible()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign up' })).toBeNull()
  })
})
