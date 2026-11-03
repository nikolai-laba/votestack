// The thank-you notice under the header once voting has ended, through the
// app's routes with the after-election switch on.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, type Ref } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usage } from '../../metrics/usage.ts'
import { NOTICE_FULL_KEY, noticeVisit } from '../../notice/visit.ts'
import { fetchNoticeWords } from '../../notice/words.ts'
import { ballotStore } from '../../picks/store.ts'
import { routes } from '../../routes.tsx'
import {
  NOTICE_WORDS_PATH,
  type NoticeWords,
} from '../../shared/afterElection.ts'
import type { Ballot } from '../../shared/ballot.ts'
import { SIGNUP_KEY, signupStore } from '../../signup/device.ts'
import type { TurnstileHandle } from '../report/Turnstile.tsx'

const mode = vi.hoisted(() => ({ on: false }))
vi.mock('../../shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('../../shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

// The real widget loads Cloudflare's script; this stand-in hands out a token
// when its button is pressed.
vi.mock('../report/Turnstile.tsx', () => ({
  Turnstile: ({
    onToken,
    ref,
  }: {
    onToken: (t: string | null) => void
    ref?: Ref<TurnstileHandle>
  }) => {
    useImperativeHandle(ref, () => ({ reset: () => onToken(null) }))
    return (
      <button type="button" onClick={() => onToken('tok-1')}>
        Pass check
      </button>
    )
  },
}))

const WORDS: NoticeWords = {
  version: 1,
  heading: 'Thank you for using VoteStack',
  intro: 'Voting has ended, and election offices are counting the ballots.',
  signup: {
    heading: 'Hear from us before your next election',
    body: 'Sign up below. We email a few times a year.',
  },
  support: {
    heading: 'Help fund voter education',
    body: 'VoteStack is free to use.',
    payLabel: 'Pay what you want',
    payUrl: 'https://buy.stripe.com/test_notice',
    fine: 'Payments aren’t tax-deductible.',
    linkLabel: 'How payments are used',
  },
  line: {
    text: 'Voting has ended. Thank you for using VoteStack.',
    open: 'Sign up or support',
    openSignedUp: 'Support VoteStack',
  },
}

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

/**
 * Serves the words file with `words`, takes sign-ups and answers anything
 * else with a 404.
 */
function stubFetch(
  words: () => Promise<Response> = async () => Response.json(WORDS),
) {
  const sent: Record<string, unknown>[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === NOTICE_WORDS_PATH) return words()
    if (url === '/api/notify') {
      sent.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true }, { status: 201 })
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, sent }
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, client }
}

/** Waits until the words file has been fetched and read, whatever it held. */
const wordsSettled = (client: QueryClient) =>
  waitFor(() =>
    expect(client.getQueryState(['notice-words'])?.status).toBe('success'),
  )

const notice = () =>
  screen.queryByRole('complementary', { name: 'Thank you notice' })
const findFull = () =>
  screen.findByRole('heading', { level: 2, name: WORDS.heading })
const fullHeading = () =>
  screen.queryByRole('heading', { level: 2, name: WORDS.heading })
const closeButton = () =>
  within(notice()!).getByRole('button', { name: 'Close the thank-you notice' })

/** Notice events queued since the test began. */
const noticeEvents = () => usage.pending().filter((e) => e.e === 'notice')

/** A new visit: a new tab starts with no notes from the last one. */
function newVisit() {
  cleanup()
  sessionStorage.clear()
  act(() => noticeVisit.reload())
}

beforeEach(() => {
  mode.on = true
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  stubFetch()
  // Nothing is sent under tests, so this empties the shared queue.
  usage.flush()
})
afterEach(() => {
  mode.on = false
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the after-election thank-you notice', () => {
  it('shows the full notice on the first page of a visit', async () => {
    renderAt('/press')
    await findFull()
    const aside = notice()!
    expect(aside).toHaveTextContent(WORDS.intro)
    expect(
      within(aside).getByRole('heading', {
        level: 3,
        name: WORDS.signup.heading,
      }),
    ).toBeVisible()
    expect(
      within(aside).getByRole('textbox', { name: 'Email address' }),
    ).toBeVisible()
    expect(
      within(aside).getByRole('heading', {
        level: 3,
        name: WORDS.support.heading,
      }),
    ).toBeVisible()
    expect(
      within(aside).getByRole('link', { name: 'Pay what you want' }),
    ).toHaveAttribute('href', WORDS.support.payUrl)
    expect(aside).toHaveTextContent(WORDS.support.fine)
    expect(
      within(aside).getByRole('link', { name: 'How payments are used' }),
    ).toHaveAttribute('href', '/support')
    expect(closeButton()).toBeVisible()
    // Under the header, before the page itself.
    const header = screen.getByRole('banner')
    expect(
      header.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      aside.compareDocumentPosition(screen.getByRole('main')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(noticeEvents()).toEqual([{ e: 'notice', act: 'full' }])
  })

  it('stays full on that first page after the visit records it', async () => {
    renderAt('/press')
    await findFull()
    expect(noticeVisit.getSnapshot().fullShown).toBe(true)
    expect(sessionStorage.getItem(NOTICE_FULL_KEY)).toBe('1')
    // Re-reading the visit (which now says the full notice was shown)
    // leaves this page as it is.
    act(() => noticeVisit.reload())
    expect(fullHeading()).toBeVisible()
    expect(screen.queryByRole('button', { name: WORDS.line.open })).toBeNull()
    expect(noticeEvents()).toEqual([{ e: 'notice', act: 'full' }])
  })

  it('shows one line on the next page, which opens the full notice', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/press')
    await findFull()
    await act(() => router.navigate('/about'))
    await screen.findByRole('heading', { level: 1, name: 'About VoteStack' })
    const aside = notice()!
    expect(aside).toHaveTextContent(WORDS.line.text)
    expect(fullHeading()).toBeNull()
    expect(within(aside).queryByRole('textbox')).toBeNull()
    expect(closeButton()).toBeVisible()

    await user.click(
      within(aside).getByRole('button', { name: 'Sign up or support' }),
    )
    expect(fullHeading()).toHaveFocus()
    expect(fullHeading()).toHaveAttribute('tabindex', '-1')
    expect(
      within(notice()!).getByRole('textbox', { name: 'Email address' }),
    ).toBeVisible()
    expect(noticeEvents()).toEqual([
      { e: 'notice', act: 'full' },
      { e: 'notice', act: 'line' },
      { e: 'notice', act: 'opened' },
    ])

    // Back on the first page it's the line too, counted once a visit
    // however many pages show it.
    await act(() => router.navigate('/press'))
    expect(notice()).toHaveTextContent(WORDS.line.text)
    expect(fullHeading()).toBeNull()
    await act(() => router.navigate('/about'))
    expect(notice()).toHaveTextContent(WORDS.line.text)
    expect(noticeEvents().filter((e) => e.act === 'line')).toHaveLength(1)
  })

  it('Close hides it for the rest of the visit, and every new visit shows it again', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/press')
    await findFull()
    await user.click(closeButton())
    expect(notice()).toBeNull()
    // The notice is gone: focus goes to the start of the header.
    expect(screen.getByRole('link', { name: 'VoteStack home' })).toHaveFocus()
    expect(noticeEvents()).toEqual([
      { e: 'notice', act: 'full' },
      { e: 'notice', act: 'closed' },
    ])
    await act(() => router.navigate('/about'))
    await screen.findByRole('heading', { level: 1, name: 'About VoteStack' })
    expect(notice()).toBeNull()

    newVisit()
    renderAt('/press')
    expect(await findFull()).toBeVisible()

    // Closed on four visits in a row (the first above), it still comes back
    // on the fifth.
    for (let visit = 2; visit <= 4; visit++) {
      await user.click(closeButton())
      newVisit()
      renderAt('/press')
      expect(await findFull()).toBeVisible()
    }
  })

  it('Close moves focus to the first header link that isn’t hidden', async () => {
    const user = userEvent.setup()
    renderAt('/press')
    await findFull()
    // As on a phone, scrolled down a profile opened from a saved ballot: the
    // header hides the logo link and shows "Back to your ballot" instead.
    const header = screen.getByRole('banner')
    const logo = header.querySelector<HTMLElement>(
      'a[aria-label="VoteStack home"]',
    )!
    const back = header.querySelector<HTMLElement>(
      'a[aria-label="Back to your ballot"]',
    )!
    logo.setAttribute('aria-hidden', 'true')
    logo.tabIndex = -1
    back.removeAttribute('aria-hidden')
    back.tabIndex = 0
    await user.click(closeButton())
    expect(notice()).toBeNull()
    expect(back).toHaveFocus()
  })

  it('signed-up devices get the thanks and support without the form', async () => {
    localStorage.setItem(SIGNUP_KEY, JSON.stringify({ signedUp: true }))
    act(() => signupStore.reload())
    const { router } = renderAt('/press')
    await findFull()
    const aside = notice()!
    expect(
      within(aside).queryByRole('textbox', { name: 'Email address' }),
    ).toBeNull()
    expect(
      within(aside).queryByRole('heading', { name: WORDS.signup.heading }),
    ).toBeNull()
    expect(
      within(aside).getByRole('link', { name: 'Pay what you want' }),
    ).toHaveAttribute('href', WORDS.support.payUrl)

    await act(() => router.navigate('/about'))
    expect(
      within(notice()!).getByRole('button', { name: 'Support VoteStack' }),
    ).toBeVisible()
    expect(
      within(notice()!).queryByRole('button', { name: 'Sign up or support' }),
    ).toBeNull()
  })

  it('after signing up in the notice, the thank-you replaces the form and support stays', async () => {
    const { sent } = stubFetch()
    const user = userEvent.setup()
    renderAt('/press')
    await findFull()
    const aside = within(notice()!)
    await user.type(
      aside.getByRole('textbox', { name: 'Email address' }),
      'pat@example.com',
    )
    await user.type(aside.getByRole('textbox', { name: 'ZIP code' }), '60614')
    await user.click(aside.getByRole('button', { name: 'Pass check' }))
    await user.click(aside.getByRole('button', { name: 'Sign up' }))

    expect(await aside.findByText('Thanks, you’re on the list.')).toBeVisible()
    expect(
      aside.getByText('We’ll email you before your next election.'),
    ).toBeVisible()
    expect(aside.queryByRole('textbox', { name: 'Email address' })).toBeNull()
    expect(
      aside.getByRole('link', { name: 'Pay what you want' }),
    ).toHaveAttribute('href', WORDS.support.payUrl)
    expect(sent).toEqual([
      {
        email: 'pat@example.com',
        zip: '60614',
        source: 'notice',
        turnstileToken: 'tok-1',
      },
    ])
    expect(signupStore.getSnapshot().signedUp).toBe(true)
  })

  it('fills in the ZIP code typed in this visit’s lookup', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/getstarted')
    await findFull()
    await user.type(
      within(screen.getByRole('main')).getByRole('textbox', {
        name: 'ZIP code',
      }),
      '60614',
    )
    await act(() => router.navigate('/press'))
    await user.click(
      within(notice()!).getByRole('button', { name: 'Sign up or support' }),
    )
    expect(
      within(notice()!).getByRole('textbox', { name: 'ZIP code' }),
    ).toHaveValue('60614')
  })

  it('isn’t on /notify or /support, but is on Saved choices', async () => {
    ballotStore.saveBallot(ballot)
    const { client } = renderAt('/notify')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Hear from VoteStack before your next election',
    })
    await wordsSettled(client)
    expect(notice()).toBeNull()
    cleanup()

    const support = renderAt('/support')
    await wordsSettled(support.client)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Support VoteStack' }),
    ).toBeVisible()
    expect(notice()).toBeNull()
    cleanup()

    // The first page of the visit that shows it gets the full notice.
    renderAt('/saved-choices')
    await screen.findByRole('heading', { level: 1, name: 'Saved choices' })
    expect(await findFull()).toBeVisible()
  })

  it('shows nothing and throws nothing when the words file can’t be used', async () => {
    const broken: [string, () => Promise<Response>][] = [
      ['fetch rejects', () => Promise.reject(new TypeError('Failed to fetch'))],
      ['404', async () => new Response('Not found', { status: 404 })],
      ['invalid JSON', async () => new Response('{"version": 1,')],
      ['an unknown version', async () => Response.json({ version: 2 })],
    ]
    for (const [, words] of broken) {
      stubFetch(words)
      await expect(fetchNoticeWords()).resolves.toBeNull()
      const { client } = renderAt('/press')
      await screen.findByRole('heading', { level: 1, name: 'Press & media' })
      await wordsSettled(client)
      expect(notice()).toBeNull()
      cleanup()
    }
    // Nothing was shown, so nothing was counted.
    expect(noticeEvents()).toEqual([])
  })

  it('keeps its words out of search snippets', async () => {
    const { router } = renderAt('/press')
    await findFull()
    const snippetless = notice()!.querySelector('[data-nosnippet]')
    expect(snippetless).toHaveTextContent(WORDS.heading)
    expect(snippetless).toHaveTextContent(WORDS.support.body)

    await act(() => router.navigate('/about'))
    expect(notice()!.querySelector('[data-nosnippet]')).toHaveTextContent(
      WORDS.line.text,
    )
  })

  it('counts a click on the pay button', async () => {
    const user = userEvent.setup()
    renderAt('/press')
    await findFull()
    // jsdom can't follow a link to another site.
    const stay = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('click', stay, { capture: true })
    try {
      await user.click(
        within(notice()!).getByRole('link', { name: 'Pay what you want' }),
      )
    } finally {
      window.removeEventListener('click', stay, { capture: true })
    }
    expect(noticeEvents()).toEqual([
      { e: 'notice', act: 'full' },
      { e: 'notice', act: 'pay' },
    ])
  })

  it('the old banner never shows in this mode, even with a ballot', async () => {
    ballotStore.saveBallot(ballot)
    renderAt('/press')
    await findFull()
    expect(
      screen.queryByRole('complementary', { name: 'Email sign-up' }),
    ).toBeNull()
  })
})
