import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { SignupSendError, sendSignup } from '../../api/notify.ts'
import {
  normalizeEmail,
  normalizeZip,
  validateEmail,
  validateZip,
  type SignupField,
  type SignupSource,
} from '../../shared/notify.ts'
import { signupStore } from '../../signup/device.ts'
import { useAppRunning } from '../appRunning.ts'
import { WarningIcon } from '../icons.tsx'
import { Turnstile, type TurnstileHandle } from '../report/Turnstile.tsx'
import { TextField } from '../TextField.tsx'

// The email sign-up form: an email address and a ZIP code, checked by
// Cloudflare Turnstile. Used by the sign-up page and the block at the end of
// pages, so it may appear more than once on a page: field ids come from
// useId. Turnstile's script loads only once someone starts filling in the
// form. Without a Turnstile site key it says sign-up isn't available instead
// of showing a form that can't work.

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

export function SignupForm({
  source,
  initialZip = '',
  onSignedUp,
  deletionNote = false,
}: {
  /** Where on the site the form is, sent with the sign-up. */
  source: SignupSource
  /** A ZIP code to start with (the one typed in this visit's lookup). */
  initialZip?: string
  /** Called before the device is marked as signed up. */
  onSignedUp?: () => void
  /** Adds how to have a sign-up deleted (the sign-up page). */
  deletionNote?: boolean
}) {
  const siteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const id = useId()
  const send = useMutation({ mutationFn: sendSignup })
  const [values, setValues] = useState<Values>({ email: '', zip: initialZip })
  const [errors, setErrors] = useState<Errors>({})
  const [token, setToken] = useState<string | null>(null)
  // The spam check loads once someone starts filling in the form.
  const [engaged, setEngaged] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const [waitingForCheck, setWaitingForCheck] = useState(false)
  const running = useAppRunning()
  const turnstile = useRef<TurnstileHandle>(null)
  const done = useRef<HTMLDivElement>(null)
  const inputs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>(
    {},
  )

  useEffect(() => {
    if (send.isSuccess) done.current?.focus()
  }, [send.isSuccess])

  if (!siteKey)
    return <p className="font-semibold">Sign-up isn&rsquo;t available yet.</p>

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
    setEngaged(true)
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
        source,
        turnstileToken: token,
      },
      {
        onSuccess() {
          onSignedUp?.()
          signupStore.markSignedUp()
        },
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
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        className="space-y-2 rounded-sm border border-line bg-surface p-4"
      >
        <p className="font-semibold">Thanks, you&rsquo;re on the list.</p>
        <p>We&rsquo;ll send the first email after the November 3 election.</p>
      </div>
    )
  }

  const sendError =
    send.error instanceof SignupSendError ? send.error.kind : 'unavailable'
  const hasMessage = send.isError || waitingForCheck || checkFailed

  return (
    // POST, so a form sent before the app runs never puts the email in the
    // page address (the button stays disabled until then anyway).
    <form
      method="post"
      onSubmit={handleSubmit}
      onFocus={() => setEngaged(true)}
      noValidate
      className="space-y-4"
    >
      {/* Email and ZIP code on one line, at every width. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <TextField
            id={`${id}-email`}
            name="email"
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
        </div>
        <div className="w-28 shrink-0">
          <TextField
            id={`${id}-zip`}
            name="zip"
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
      </div>

      {/* Cloudflare's check, once someone starts filling in the form. */}
      {engaged && (
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
      )}

      {/* Announces problems with sending to screen readers; takes no room
          until it has something to say. */}
      <div
        role="status"
        aria-live="polite"
        className={hasMessage ? undefined : 'sr-only'}
      >
        {hasMessage && (
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
        disabled={!running || send.isPending}
        className="h-13 w-full rounded-md bg-primary px-6 text-label font-semibold text-on-primary transition-opacity duration-150 disabled:opacity-60 md:w-auto"
      >
        Sign up
      </button>
      <p className="text-small text-muted">
        We save your email address and ZIP code, use them only for these emails,
        and never share them. You can leave the list anytime.
        {deletionNote && (
          <>
            {' '}
            To have your sign-up deleted, email{' '}
            <a href="mailto:nikolai@votestack.org">nikolai@votestack.org</a>.
          </>
        )}
      </p>
    </form>
  )
}
