import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, type ReactNode, type Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BallotSessionContext,
  type BallotSession,
} from '../../ballot/session.ts'
import { signupStore } from '../../signup/device.ts'
import type { TurnstileHandle } from '../report/Turnstile.tsx'
import { SignupBlock } from './SignupBlock.tsx'

// The real widget loads Cloudflare's script; this stand-in hands out a token
// when its button is pressed.
const actions = vi.fn()
vi.mock('../report/Turnstile.tsx', () => ({
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
    useImperativeHandle(ref, () => ({ reset: () => onToken(null) }))
    return (
      <button type="button" onClick={() => onToken('tok-1')}>
        Pass check
      </button>
    )
  },
}))

const HEADING = 'Hear from VoteStack before your next election'

function stubApi() {
  const sent: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== '/api/notify') throw new Error(`unexpected ${url}`)
      sent.push(JSON.parse(String(init?.body)))
      return Response.json({ ok: true }, { status: 201 })
    }),
  )
  return sent
}

function renderBlocks(children: ReactNode, typedZip?: string) {
  const tree = (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
  return render(
    typedZip === undefined ? (
      tree
    ) : (
      <BallotSessionContext.Provider
        value={
          {
            values: { street: '', city: '', zip: typedZip },
          } as unknown as BallotSession
        }
      >
        {tree}
      </BallotSessionContext.Provider>
    ),
  )
}

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  actions.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('SignupBlock', () => {
  it('shows the heading, the promise and what is saved, with no election dates', () => {
    renderBlocks(<SignupBlock source="profile" />)
    const block = screen.getByRole('region', { name: HEADING })
    expect(
      screen.getByRole('heading', { level: 2, name: HEADING }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'We’ll email you a few times a year about new elections and areas VoteStack covers, and big changes to the site.',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        'We save your email address and ZIP code, use them only for these emails, and never share them. You can leave the list anytime.',
      ),
    ).toBeVisible()
    expect(block).not.toHaveTextContent(/votes (again|next)/)
    // Cloudflare's own widget says what it is; no extra line about it.
    expect(block).not.toHaveTextContent(/Turnstile/)
  })

  it('puts the email and ZIP fields on one line, with no gap held for messages', () => {
    renderBlocks(<SignupBlock source="profile" />)
    const email = screen.getByRole('textbox', { name: 'Email address' })
    const zip = screen.getByRole('textbox', { name: 'ZIP code' })
    expect(email.closest('.flex')).toContainElement(zip)
    // The message area takes no room until it has something to say.
    const messages = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-live') === 'polite')!
    expect(messages).toBeEmptyDOMElement()
    expect(messages).toHaveClass('sr-only')
  })

  it('fills in the ZIP code typed in this visit’s lookup', () => {
    const { unmount } = renderBlocks(
      <SignupBlock source="ballot" />,
      '60614-1234',
    )
    expect(screen.getByRole('textbox', { name: 'ZIP code' })).toHaveValue(
      '60614',
    )
    unmount()
    renderBlocks(<SignupBlock source="ballot" />, '6061')
    expect(screen.getByRole('textbox', { name: 'ZIP code' })).toHaveValue('')
  })

  it('loads the spam check only once someone starts filling it in', async () => {
    const user = userEvent.setup()
    renderBlocks(<SignupBlock source="profile" />)
    expect(screen.queryByRole('button', { name: 'Pass check' })).toBeNull()
    expect(actions).not.toHaveBeenCalled()

    await user.click(screen.getByRole('textbox', { name: 'Email address' }))
    expect(screen.getByRole('button', { name: 'Pass check' })).toBeVisible()
    expect(actions).toHaveBeenCalledWith('notify')
  })

  it('gives each form its own field ids', () => {
    renderBlocks(
      <>
        <SignupBlock source="profile" />
        <SignupBlock source="ballot" />
      </>,
    )
    const emails = screen.getAllByRole('textbox', { name: 'Email address' })
    const zips = screen.getAllByRole('textbox', { name: 'ZIP code' })
    expect(emails).toHaveLength(2)
    expect(zips).toHaveLength(2)
    expect(emails[0].id).not.toBe(emails[1].id)
    expect(zips[0].id).not.toBe(zips[1].id)
  })

  it('sends the source, thanks the visitor and hides the other blocks', async () => {
    const sent = stubApi()
    const user = userEvent.setup()
    renderBlocks(
      <>
        <SignupBlock source="profile" />
        <SignupBlock source="about" />
      </>,
    )
    const first = within(screen.getAllByRole('region')[0])
    await user.type(
      first.getByRole('textbox', { name: 'Email address' }),
      'pat@example.com',
    )
    await user.type(first.getByRole('textbox', { name: 'ZIP code' }), '60614')
    await user.click(first.getByRole('button', { name: 'Pass check' }))
    await user.click(first.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByText('Thanks, you’re on the list.')).toBeVisible()
    expect(
      screen.getByText(
        'We’ll send the first email after the November 3 election.',
      ),
    ).toBeVisible()
    expect(sent).toEqual([
      {
        email: 'pat@example.com',
        zip: '60614',
        source: 'profile',
        turnstileToken: 'tok-1',
      },
    ])
    expect(screen.getAllByRole('heading', { name: HEADING })).toHaveLength(1)
    expect(signupStore.getSnapshot().signedUp).toBe(true)
  })

  it('shows nothing on a device that already signed up', () => {
    signupStore.markSignedUp()
    const { container } = renderBlocks(<SignupBlock source="profile" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never sends a sign-up through the page address', () => {
    renderBlocks(<SignupBlock source="profile" />)
    // Pressed before the app runs, a GET would put the email in the URL.
    const button = screen.getByRole('button', { name: 'Sign up' })
    expect(button.closest('form')).toHaveAttribute('method', 'post')
    // Once the app runs, the button works.
    expect(button).toBeEnabled()
  })
})
