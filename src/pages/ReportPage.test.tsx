import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, type Ref } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnstileHandle } from '../components/report/Turnstile.tsx'
import { routes } from '../routes.tsx'
import type { CandidateProfile } from '../shared/profile.ts'

// The real widget loads Cloudflare's script; this stand-in hands out a token
// when its button is pressed and counts resets.
const resets = vi.fn()
vi.mock('../components/report/Turnstile.tsx', () => ({
  Turnstile: ({
    onToken,
    ref,
  }: {
    onToken: (t: string | null) => void
    ref?: Ref<TurnstileHandle>
  }) => {
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

const profile = {
  key: 'jane-doe',
  name: 'Jane Doe',
  office: 'Governor and Lieutenant Governor',
  kind: 'candidate',
} as CandidateProfile

type ReportAnswer = { status: number; body?: unknown }

function stubApi({
  profileStatus = 200,
  report = { status: 201, body: { ok: true } } as ReportAnswer | ReportAnswer[],
} = {}) {
  const answers = Array.isArray(report) ? [...report] : [report]
  const sent: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/profile/'))
        return profileStatus === 200
          ? Response.json(profile)
          : new Response(null, { status: profileStatus })
      if (url === '/api/report') {
        sent.push(JSON.parse(String(init?.body)))
        const a = answers.length > 1 ? answers.shift()! : answers[0]
        return Response.json(a.body ?? {}, { status: a.status })
      }
      throw new Error(`unexpected ${url}`)
    }),
  )
  return sent
}

function renderPage(path = '/candidates/jane-doe/report') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
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

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  resets.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Campaign money' }))
  await user.type(
    screen.getByRole('textbox', { name: 'What’s wrong?' }),
    'Cash on hand is from the wrong quarter.',
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Link to a source' }),
    'https://elections.il.gov/x',
  )
}

describe('Report an error', () => {
  it('names the profile and links back to it', async () => {
    stubApi()
    renderPage()
    expect(await screen.findByText(/In the profile of/)).toHaveTextContent(
      'In the profile of Jane Doe, Governor and Lieutenant Governor.',
    )
    expect(
      screen.getByRole('link', { name: 'Back to Jane Doe' }),
    ).toHaveAttribute('href', '/candidates/jane-doe')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Report an error' }),
    ).toHaveFocus()
    expect(document.title).toBe(
      'Report an error in Jane Doe’s profile | VoteStack',
    )
  })

  it('sends the report and thanks the reader', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    const done = await screen.findByText(
      'Thanks. We’ll check this against the sources.',
    )
    expect(done.closest('[role=status]')).toHaveFocus()
    expect(sent).toEqual([
      {
        key: 'jane-doe',
        section: 'money',
        message: 'Cash on hand is from the wrong quarter.',
        sourceUrl: 'https://elections.il.gov/x',
        turnstileToken: 'tok-1',
      },
    ])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows each missing field and focuses the first', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await user.type(
      screen.getByRole('textbox', { name: 'Link to a source' }),
      'not a link',
    )
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(screen.getByRole('radio', { name: 'Overview' })).toHaveFocus()
    expect(
      screen.getByText('Choose which part of the profile is wrong.'),
    ).toBeInTheDocument()
    const message = screen.getByRole('textbox', { name: 'What’s wrong?' })
    expect(message).toHaveAttribute('aria-invalid', 'true')
    expect(message).toHaveAccessibleDescription(
      expect.stringContaining('Tell us what is wrong.'),
    )
    expect(
      screen.getByRole('textbox', { name: 'Link to a source' }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('Enter a full web address'),
    )
    expect(sent).toEqual([])

    // Editing clears that field's error.
    await user.type(message, 'x')
    expect(message).not.toHaveAttribute('aria-invalid')
  })

  it('requires a source link and explains why', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await user.click(screen.getByRole('radio', { name: 'Campaign money' }))
    await user.type(
      screen.getByRole('textbox', { name: 'What’s wrong?' }),
      'Cash on hand is from the wrong quarter.',
    )
    const url = screen.getByRole('textbox', { name: 'Link to a source' })
    expect(url).toBeRequired()
    expect(url).toHaveAccessibleDescription(
      'A web page that shows the correct information. We change a profile only when a source shows it’s wrong.',
    )
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))

    expect(url).toHaveFocus()
    expect(url).toHaveAttribute('aria-invalid', 'true')
    expect(url).toHaveAccessibleDescription(
      expect.stringContaining(
        'Add a link to a page that shows the correct information.',
      ),
    )
    expect(sent).toEqual([])

    await user.type(url, 'elections.il.gov')
    await user.tab()
    expect(url).toHaveAccessibleDescription(
      expect.stringContaining('starts with https://'),
    )
  })

  it('counts characters and flags a message that is too long', async () => {
    stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    const message = screen.getByRole('textbox', { name: 'What’s wrong?' })
    expect(screen.getByText('2,000 characters left')).toBeInTheDocument()
    await user.click(message)
    await user.paste('a'.repeat(2003))
    expect(screen.getByText('3 characters too many')).toBeInTheDocument()
    await user.tab()
    expect(message).toHaveAccessibleDescription(
      expect.stringContaining('Use 2,000 characters or fewer.'),
    )
  })

  it('waits for the spam check before sending', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(
      screen.getByText('Wait for the spam check to finish, then send again.'),
    ).toBeInTheDocument()
    expect(sent).toEqual([])
  })

  it('explains a rate limit and gets a fresh token', async () => {
    stubApi({ report: { status: 429 } })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    expect(
      await screen.findByText(/Wait a minute, then send again\./),
    ).toBeInTheDocument()
    expect(resets).toHaveBeenCalledOnce()
    // The reader's words stay in the form.
    expect(screen.getByRole('textbox', { name: 'What’s wrong?' })).toHaveValue(
      'Cash on hand is from the wrong quarter.',
    )
  })

  it('shows field errors the Worker returns', async () => {
    stubApi({
      report: {
        status: 400,
        body: { fields: { sourceUrl: 'Enter a full web address.' } },
      },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/In the profile of/)
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: 'Pass check' }))
    await user.click(screen.getByRole('button', { name: 'Send report' }))
    const url = screen.getByRole('textbox', {
      name: 'Link to a source',
    })
    await vi.waitFor(() => expect(url).toHaveFocus())
    expect(url).toHaveAccessibleDescription(
      expect.stringContaining('Enter a full web address.'),
    )
  })

  it('says reporting is not available without a site key, with no form', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    stubApi()
    renderPage()
    expect(
      await screen.findByText('Reporting errors isn’t available yet.'),
    ).toBeInTheDocument()
    const main = screen.getByRole('heading', { level: 1 }).parentElement!
      .parentElement!
    expect(within(main).queryByRole('textbox')).toBeNull()
    expect(within(main).queryByRole('button')).toBeNull()
    expect(main.querySelector('form')).toBeNull()
  })

  it('has no form for a profile that is not published', async () => {
    stubApi({ profileStatus: 404 })
    renderPage()
    expect(
      await screen.findByText(/no published profile for this candidate/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull()
  })
})
