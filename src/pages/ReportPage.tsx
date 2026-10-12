import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { fetchProfile, ProfileLoadError } from '../api/profile.ts'
import { ReportSendError, sendReport } from '../api/report.ts'
import { WarningIcon } from '../components/icons.tsx'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'
import {
  Turnstile,
  type TurnstileHandle,
} from '../components/report/Turnstile.tsx'
import { profilePath } from '../ballot/profileLinks.ts'
import type { CandidateProfile } from '../shared/profile.ts'
import {
  charCount,
  REPORT_MESSAGE_MAX,
  validateMessage,
  validateSection,
  validateSourceUrl,
  type ReportField,
  type ReportSection,
} from '../shared/report.ts'

// "Report an error" on a candidate profile, a child route of the home
// page like the profile itself, so the ballot stays in memory. Loaded lazily:
// the Turnstile script is only fetched on this page. Without a Turnstile site
// key the page says reporting isn't available instead of showing a form that
// can't work.

const HEADING_ID = 'report-heading'
const DONE_ID = 'report-done'

type Values = {
  section: ReportSection | ''
  message: string
  sourceUrl: string
}
type Errors = Partial<Record<ReportField, string>>

const FIELDS: ReportField[] = ['section', 'message', 'sourceUrl']

const VALIDATORS: Record<ReportField, (v: string) => string | undefined> = {
  section: validateSection,
  message: validateMessage,
  sourceUrl: validateSourceUrl,
}

const SEND_ERRORS: Record<ReportSendError['kind'], string> = {
  invalid: 'Check the fields marked above, then send again.',
  verification:
    'The spam check didn’t go through. Wait for the check to finish, then send again.',
  rate_limited:
    'Several reports were sent from your connection in the last minute. Wait a minute, then send again.',
  not_found:
    'This profile is no longer published, so it can’t take reports right now.',
  unavailable:
    'Couldn’t send your report. Check your connection and try again.',
}

function sectionOptions(
  profile: CandidateProfile | undefined,
): { value: ReportSection; label: string }[] {
  const judicial = profile !== undefined && profile.kind !== 'candidate'
  return [
    { value: 'overview', label: 'Overview' },
    { value: 'money', label: 'Campaign money' },
    {
      value: 'endorsements',
      label: judicial ? 'Endorsements and bar evaluations' : 'Endorsements',
    },
    { value: 'sources', label: 'Sources' },
    { value: 'other', label: 'Something else, or something missing' },
  ]
}

export default function ReportPage() {
  const { key = '' } = useParams()
  // Usually already cached from the profile the reader came from.
  const query = useQuery({
    queryKey: ['profile', key],
    queryFn: () => fetchProfile(key),
    staleTime: 5 * 60 * 1000,
    retry: (count, error) =>
      !(error instanceof ProfileLoadError && error.kind === 'not_found') &&
      count < 2,
  })
  const profile = query.data
  const siteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    const previous = document.title
    document.title = profile
      ? `Report an error in ${profile.name}’s profile | VoteStack`
      : 'Report an error | VoteStack'
    return () => {
      document.title = previous
    }
  }, [profile])

  // Start keyboard and screen reader users at the top of what changed.
  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  const notFound =
    query.error instanceof ProfileLoadError && query.error.kind === 'not_found'

  return (
    <div className="max-w-[65ch] space-y-6">
      <Link to={profilePath(key)} className="inline-flex min-h-11 items-center">
        {profile ? `Back to ${profile.name}` : 'Back to the profile'}
      </Link>

      <div className="space-y-3">
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          Report an error
        </h1>
        {profile && (
          <p>
            In the profile of{' '}
            <span className="font-semibold">{profile.name}</span>,{' '}
            {profile.office}.
          </p>
        )}
      </div>

      {!siteKey ? (
        <div className="space-y-3">
          <p className="font-semibold">
            Reporting errors isn&rsquo;t available yet.
          </p>
          <p>
            You can check each fact in a profile against the sources listed at
            the end of it.{' '}
            <Link to="/how-profiles-are-made">How we make profiles</Link>
          </p>
        </div>
      ) : query.isPending ? (
        <ProfileSkeleton />
      ) : notFound ? (
        <p>
          There is no published profile for this candidate, so there is nothing
          to report yet.
        </p>
      ) : (
        <ReportForm profileKey={key} profile={profile} siteKey={siteKey} />
      )}
    </div>
  )
}

function ReportForm({
  profileKey,
  profile,
  siteKey,
}: {
  profileKey: string
  profile: CandidateProfile | undefined
  siteKey: string
}) {
  const send = useMutation({ mutationFn: sendReport })
  const [values, setValues] = useState<Values>({
    section: '',
    message: '',
    sourceUrl: '',
  })
  const [errors, setErrors] = useState<Errors>({})
  const [token, setToken] = useState<string | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  const [waitingForCheck, setWaitingForCheck] = useState(false)
  const turnstile = useRef<TurnstileHandle>(null)
  const focusTargets = useRef<Partial<Record<ReportField, HTMLElement | null>>>(
    {},
  )

  useEffect(() => {
    if (send.isSuccess) document.getElementById(DONE_ID)?.focus()
  }, [send.isSuccess])

  function change(field: ReportField, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    // Clear the error as soon as the reader edits.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function blur(field: ReportField) {
    // Validate on blur once something has been typed, never while typing.
    if (values[field].trim())
      setErrors((e) => ({ ...e, [field]: VALIDATORS[field](values[field]) }))
  }

  function showErrors(found: Errors) {
    setErrors(found)
    const first = FIELDS.find((f) => found[f])
    if (first) focusTargets.current[first]?.focus()
    return Boolean(first)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found: Errors = {}
    for (const f of FIELDS) found[f] = VALIDATORS[f](values[f])
    if (showErrors(found)) return
    if (!token) {
      setWaitingForCheck(true)
      return
    }
    setWaitingForCheck(false)
    send.mutate(
      {
        key: profileKey,
        section: values.section as ReportSection,
        message: values.message.trim(),
        sourceUrl: values.sourceUrl.trim(),
        turnstileToken: token,
      },
      {
        onError(error) {
          // A token works once, so get a new one for the next try.
          turnstile.current?.reset()
          if (error instanceof ReportSendError && error.kind === 'invalid')
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
          <p className="font-semibold">
            Thanks. We&rsquo;ll check this against the sources.
          </p>
          <p>If the profile is wrong, we correct it.</p>
        </div>
        <p>
          <Link
            to={profilePath(profileKey)}
            className="inline-flex min-h-11 items-center"
          >
            {profile ? `Back to ${profile.name}` : 'Back to the profile'}
          </Link>
        </p>
      </div>
    )
  }

  const sendError =
    send.error instanceof ReportSendError ? send.error.kind : 'unavailable'
  const used = charCount(values.message.trim())
  const left = REPORT_MESSAGE_MAX - used

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <p>
        Tell us what is wrong or missing. We check every report against the
        profile&rsquo;s sources and official records.
      </p>

      <fieldset
        className="space-y-2"
        aria-describedby={errors.section ? 'section-error' : undefined}
      >
        <legend className="mb-2 text-label font-semibold">
          Which part of the profile?
        </legend>
        {errors.section && (
          <FieldError id="section-error">{errors.section}</FieldError>
        )}
        {sectionOptions(profile).map((option, i) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-3"
          >
            <input
              ref={
                i === 0
                  ? (el) => {
                      focusTargets.current.section = el
                    }
                  : undefined
              }
              type="radio"
              name="section"
              value={option.value}
              checked={values.section === option.value}
              onChange={() => change('section', option.value)}
              aria-invalid={errors.section ? true : undefined}
              className="size-5 shrink-0 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label
          htmlFor="report-message"
          className="block text-label font-semibold"
        >
          What&rsquo;s wrong?
        </label>
        <p id="report-message-hint" className="text-small text-muted">
          Say what the profile says and what is correct. Leave out your name,
          email and address.
        </p>
        <textarea
          ref={(el) => {
            focusTargets.current.message = el
          }}
          id="report-message"
          name="message"
          required
          rows={6}
          value={values.message}
          onChange={(e) => change('message', e.target.value)}
          onBlur={() => blur('message')}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={[
            errors.message && 'report-message-error',
            'report-message-hint',
            'report-message-count',
          ]
            .filter(Boolean)
            .join(' ')}
          className={`block w-full rounded-md bg-surface px-3 py-2 text-body text-text ${
            errors.message ? 'border-2 border-danger' : 'border border-field'
          }`}
        />
        <p
          id="report-message-count"
          className={`text-small ${left < 0 ? 'font-semibold text-danger' : 'text-muted'}`}
        >
          {left >= 0
            ? `${left.toLocaleString('en-US')} characters left`
            : `${(-left).toLocaleString('en-US')} characters too many`}
        </p>
        {errors.message && (
          <FieldError id="report-message-error">{errors.message}</FieldError>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="report-url" className="block text-label font-semibold">
          Link to a source
        </label>
        <p id="report-url-hint" className="text-small text-muted">
          A web page that shows the correct information. We change a profile
          only when a source shows it&rsquo;s wrong.
        </p>
        <input
          ref={(el) => {
            focusTargets.current.sourceUrl = el
          }}
          id="report-url"
          name="sourceUrl"
          type="url"
          required
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={values.sourceUrl}
          onChange={(e) => change('sourceUrl', e.target.value)}
          onBlur={() => blur('sourceUrl')}
          aria-invalid={errors.sourceUrl ? true : undefined}
          aria-describedby={[
            errors.sourceUrl && 'report-url-error',
            'report-url-hint',
          ]
            .filter(Boolean)
            .join(' ')}
          className={`min-h-12 w-full rounded-md bg-surface px-3 text-body text-text ${
            errors.sourceUrl ? 'border-2 border-danger' : 'border border-field'
          }`}
        />
        {errors.sourceUrl && (
          <FieldError id="report-url-error">{errors.sourceUrl}</FieldError>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-small text-muted">
          Cloudflare Turnstile checks that a person is sending this report.
        </p>
        <Turnstile
          ref={turnstile}
          siteKey={siteKey}
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
                  : 'Wait for the spam check to finish, then send again.'}
            </p>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={send.isPending}
        className="h-13 w-full rounded-md bg-primary px-6 text-label font-semibold text-on-primary transition-opacity duration-150 disabled:opacity-60 md:w-auto"
      >
        Send report
      </button>
      <p className="text-small text-muted">
        We save only what you write here and which profile it&rsquo;s about. We
        don&rsquo;t save your name, email, IP address or street address.
      </p>
    </form>
  )
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p
      id={id}
      className="flex items-start gap-2 text-small font-semibold text-danger"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  )
}
