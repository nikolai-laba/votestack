import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { SignupSendError, sendSignup } from '../api/notify.ts'
import { coveredFullNames } from '../ballot/coverage.ts'
import { GET_STARTED_PATH } from '../ballot/profileLinks.ts'
import { WarningIcon } from '../components/icons.tsx'
import {
  Turnstile,
  type TurnstileHandle,
} from '../components/report/Turnstile.tsx'
import { TextField } from '../components/TextField.tsx'
import {
  normalizeEmail,
  normalizeZip,
  validateEmail,
  validateZip,
  type SignupField,
} from '../shared/notify.ts'
import { NOTIFY_HEAD, useDocumentHead } from '../head.ts'

// /notify: people outside the area VoteStack covers leave an email address
// and a ZIP code to hear when it reaches them. Linked from the address form
// (its intro and the "couldn't find that address" notice) and the About
// page. Loaded lazily: the Turnstile script is only fetched on this page.
// Without a Turnstile site key the page says sign-up isn't available instead
// of showing a form that can't work.

const HEADING_ID = 'notify-heading'
const DONE_ID = 'notify-done'

type Values = Record<SignupField, string>
type Errors = Partial<Record<SignupField, string>>

const FIELDS: SignupField[] = ['email', 'zip']

const VALIDATORS: Record<SignupField, (v: string) => string | undefined> = {
  email: validateEmail,
  zip: validateZip,
}

const SEND_ERRORS: Record<SignupSendError['kind'], string> = {
  invalid: 'Check the fields marked above, then sign up again.',
  verification:
    'The spam check didn’t go through. Wait for the check to finish, then sign up again.',
  rate_limited:
    'Several sign-ups were sent from your connection in the last minute. Wait a minute, then try again.',
  unavailable: 'Couldn’t sign you up. Check your connection and try again.',
}

export default function NotifyPage() {
  const siteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useDocumentHead(NOTIFY_HEAD)

  // Start keyboard and screen reader users at the top of what changed.
  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  return (
    <div className="max-w-[65ch] space-y-6">
      <Link to={GET_STARTED_PATH} className="inline-flex min-h-11 items-center">
        Find your ballot
      </Link>

      <div className="space-y-3">
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          Get an email when VoteStack covers your area
        </h1>
        <p>
          VoteStack covers {coveredFullNames()}, for the election on Tuesday,
          November 3, 2026. We plan to add more areas over time.
        </p>
        <p>
          Leave your email address and ZIP code, and we&rsquo;ll email you when
          VoteStack covers your area. Your ZIP code also helps us choose which
          areas to add next.
        </p>
      </div>

      {siteKey ? (
        <SignupForm siteKey={siteKey} />
      ) : (
        <p className="font-semibold">Sign-up isn&rsquo;t available yet.</p>
      )}
    </div>
  )
}

function SignupForm({ siteKey }: { siteKey: string }) {
  const send = useMutation({ mutationFn: sendSignup })
  const [values, setValues] = useState<Values>({ email: '', zip: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [token, setToken] = useState<string | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  const [waitingForCheck, setWaitingForCheck] = useState(false)
  const turnstile = useRef<TurnstileHandle>(null)
  const inputs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>(
    {},
  )

  useEffect(() => {
    if (send.isSuccess) document.getElementById(DONE_ID)?.focus()
  }, [send.isSuccess])

  function change(field: SignupField, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    // Clear the error as soon as the visitor edits.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function blur(field: SignupField) {
    // Validate on blur once something has been typed, never while typing.
    if (values[field].trim())
      setErrors((e) => ({ ...e, [field]: VALIDATORS[field](values[field]) }))
  }

  function showErrors(found: Errors) {
    setErrors(found)
    const first = FIELDS.find((f) => found[f])
    if (first) inputs.current[first]?.focus()
    return Boolean(first)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the fields themselves: autofill can fill them without the input
    // event React listens for.
    const form = event.currentTarget.elements
    const current = { ...values }
    for (const f of FIELDS) {
      const input = form.namedItem(f)
      if (input instanceof HTMLInputElement) current[f] = input.value
    }
    setValues(current)
    const found: Errors = {}
    for (const f of FIELDS) found[f] = VALIDATORS[f](current[f])
    if (showErrors(found)) return
    if (!token) {
      setWaitingForCheck(true)
      return
    }
    setWaitingForCheck(false)
    send.mutate(
      {
        email: normalizeEmail(current.email),
        zip: normalizeZip(current.zip) ?? '',
        turnstileToken: token,
      },
      {
        onError(error) {
          // A token works once, so get a new one for the next try.
          turnstile.current?.reset()
          if (error instanceof SignupSendError && error.kind === 'invalid')
            showErrors(error.fields)
        },
      },
    )
  }

  if (send.isSuccess) {
    return (
      <div className="space-y-4">
        <div
          id={DONE_ID}
          tabIndex={-1}
          role="status"
          className="space-y-2 rounded-sm border border-line bg-surface p-4"
        >
          <p className="font-semibold">Thanks. You&rsquo;re signed up.</p>
          <p>
            We&rsquo;ll email you when VoteStack covers your area. We
            won&rsquo;t email you before then.
          </p>
        </div>
      </div>
    )
  }

  const sendError =
    send.error instanceof SignupSendError ? send.error.kind : 'unavailable'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <TextField
        id="email"
        label="Email address"
        type="email"
        autoComplete="email"
        spellCheck={false}
        value={values.email}
        error={errors.email}
        onChange={(v) => change('email', v)}
        onBlur={() => blur('email')}
        inputRef={(el) => {
          inputs.current.email = el
        }}
      />
      <div className="md:w-40">
        <TextField
          id="zip"
          label="ZIP code"
          autoComplete="postal-code"
          inputMode="numeric"
          value={values.zip}
          error={errors.zip}
          onChange={(v) => change('zip', v)}
          onBlur={() => blur('zip')}
          inputRef={(el) => {
            inputs.current.zip = el
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-small text-muted">
          Cloudflare Turnstile checks that a person is signing up.
        </p>
        <Turnstile
          ref={turnstile}
          siteKey={siteKey}
          action="notify"
          onToken={(t) => {
            setToken(t)
            if (t) {
              setCheckFailed(false)
              setWaitingForCheck(false)
            }
          }}
          onError={() => setCheckFailed(true)}
        />
      </div>

      {/* Announces problems with sending to screen readers. */}
      <div role="status" aria-live="polite">
        {(send.isError || waitingForCheck || checkFailed) && (
          <div className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg">
            <WarningIcon />
            <p className="font-semibold">
              {send.isError
                ? SEND_ERRORS[sendError]
                : checkFailed
                  ? 'The spam check couldn’t load. Reload the page to try again.'
                  : 'Wait for the spam check to finish, then sign up again.'}
            </p>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={send.isPending}
        className="h-13 w-full rounded-md bg-primary px-6 text-label font-semibold text-on-primary transition-opacity duration-150 disabled:opacity-60 md:w-auto"
      >
        Sign up
      </button>
      <p className="text-small text-muted">
        We save only your email address and ZIP code. We use them only to email
        you when VoteStack covers your area and to count where people are asking
        from. We never share them. To have them deleted, email{' '}
        <a href="mailto:nikolai@votestack.org">nikolai@votestack.org</a>.
      </p>
    </form>
  )
}
