import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BallotLookupError } from '../api/ballot.ts'
import { SAMPLE_BALLOTS, type SampleBallot } from '../ballot/samples.ts'
import {
  SAMPLE_HEADING_ID,
  isFocusAddressState,
  useBallotSession,
  type AddressField,
  type AddressValues,
  type FocusHeadingState,
} from '../ballot/session.ts'
import { BALLOT_HEADING_ID } from '../components/BallotView.tsx'
import { WarningIcon } from '../components/icons.tsx'

// /getstarted: what VoteStack is, the address form and the sample ballots.
// Where new visitors land (the ballot at / sends them here when there's no
// ballot yet) and where "Search a new address" goes. It never shows a
// ballot: a lookup or a sample opens at /. The lookup, the sample and what's
// typed live in BallotSessionProvider's memory (src/ballot/session.ts), so
// they survive going between here and the ballot; the address is never in
// the URL or browser storage.

type Field = AddressField

const FIELDS: Field[] = ['street', 'city', 'zip']

const LABELS: Record<Field, string> = {
  street: 'Street address',
  city: 'City or town',
  zip: 'ZIP code',
}

function validate(field: Field, value: string): string | undefined {
  const v = value.trim()
  if (field === 'street')
    return /^\d+\S*\s+\S/.test(v)
      ? undefined
      : 'Enter your street address, starting with the house number.'
  if (field === 'city') return v ? undefined : 'Enter your city or town.'
  return /^\d{5}(-\d{4})?$/.test(v) ? undefined : 'Enter a 5-digit ZIP code.'
}

const LOOKUP_ERRORS = {
  invalid: 'Enter your full street address, starting with the house number.',
  not_found:
    'We couldn’t find that address in Cook County. Check the street, city and ZIP code, or look up your ballot on your election authority’s site.',
  unavailable:
    'Couldn’t load your ballot. Check your connection and try again.',
}

const fullAddress = (v: AddressValues) =>
  `${v.street.trim()}, ${v.city.trim()}, IL ${v.zip.trim()}`

export function GetStartedPage() {
  const { lookup, values, setValues, lookUp, sample, leaveSample, showSample } =
    useBallotSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  // Set on submit: once the lookup finishes, a ballot opens at / with focus
  // on its heading, or focus goes back to the street field on an error.
  const awaitingResult = useRef(false)

  // Coming here leaves a sample, so My Ballot and Back show the voter's own
  // ballot (or come back here). Not on a click: the ballot would then send
  // the visitor here itself before the link's own navigation.
  // Only the sample open when the page opens; one chosen here opens at /.
  const sampleOnOpen = useRef(sample !== null)
  useEffect(() => {
    if (!sampleOnOpen.current) return
    sampleOnOpen.current = false
    leaveSample()
  }, [leaveSample])

  // From "Search a new address": straight to the street field.
  useEffect(() => {
    if (isFocusAddressState(location.state)) inputs.current.street?.focus()
  }, [location.state])

  useEffect(() => {
    if (!awaitingResult.current || lookup.isPending || lookup.isIdle) return
    awaitingResult.current = false
    if (lookup.isSuccess) {
      const state: FocusHeadingState = { focusHeading: BALLOT_HEADING_ID }
      navigate('/', { state })
    } else inputs.current.street?.focus()
  }, [lookup.isPending, lookup.isIdle, lookup.isSuccess, navigate])

  function change(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    // Clear the error as soon as the voter edits.
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function blur(field: Field) {
    // Validate on blur once something has been typed, never while typing.
    if (values[field].trim())
      setErrors((e) => ({ ...e, [field]: validate(field, values[field]) }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the fields themselves: some autofill, password managers and
    // assistive tools fill them without the input event React listens for,
    // and the state alone would then submit (and re-render) empty fields.
    const form = event.currentTarget.elements
    const current = { ...values }
    for (const f of FIELDS) {
      const input = form.namedItem(f)
      if (input instanceof HTMLInputElement) current[f] = input.value
    }
    setValues(() => current)
    const found: Partial<Record<Field, string>> = {}
    for (const f of FIELDS) found[f] = validate(f, current[f])
    setErrors(found)
    const firstInvalid = FIELDS.find((f) => found[f])
    if (firstInvalid) {
      inputs.current[firstInvalid]?.focus()
      return
    }
    awaitingResult.current = true
    lookUp(fullAddress(current))
  }

  function openSample(next: SampleBallot) {
    showSample(next)
    const state: FocusHeadingState = { focusHeading: SAMPLE_HEADING_ID }
    navigate('/', { state })
  }

  const errorKind =
    lookup.error instanceof BallotLookupError
      ? lookup.error.kind
      : 'unavailable'

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-title lg:text-title-lg">
          What&apos;s on your ballot?
        </h1>
        <p className="max-w-[65ch]">
          Enter your home address to see every race on your ballot, with a short
          profile of every candidate and judge. Starting with Chicago and
          suburban Cook County, Illinois.
        </p>
        <div className="max-w-[65ch] space-y-2">
          <p>Each profile shows:</p>
          <ul className="list-disc space-y-1 ps-6">
            <li>
              Who they are, their record and their positions, with a source for
              every sentence
            </li>
            <li>Where their campaign money came from, from official filings</li>
            <li>Who endorses them, and bar association ratings for judges</li>
          </ul>
        </div>
        <p className="max-w-[65ch] text-small text-muted">
          Independent, nonpartisan, open source. Not a government site.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <fieldset className="space-y-4">
          <legend className="text-label font-semibold">Home address</legend>
          <p id="address-hint" className="text-small text-muted">
            Use the address where you&apos;re registered to vote.
          </p>
          {FIELDS.slice(0, 1).map((f) => (
            <TextField
              key={f}
              field={f}
              value={values[f]}
              error={errors[f]}
              onChange={change}
              onBlur={blur}
              inputRef={(el) => {
                inputs.current[f] = el
              }}
            />
          ))}
          <div className="flex flex-col gap-4 md:flex-row">
            {FIELDS.slice(1).map((f) => (
              <div key={f} className={f === 'zip' ? 'md:w-40' : 'flex-1'}>
                <TextField
                  field={f}
                  value={values[f]}
                  error={errors[f]}
                  onChange={change}
                  onBlur={blur}
                  inputRef={(el) => {
                    inputs.current[f] = el
                  }}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={lookup.isPending}
          className="h-13 w-full rounded-md bg-primary px-6 text-label font-semibold text-on-primary transition-opacity duration-150 disabled:opacity-60 md:w-auto"
        >
          Find my ballot
        </button>
        <p className="max-w-[65ch] text-small text-muted">
          We use your address once to find your districts. It isn&apos;t saved,
          logged or added to the page link.
        </p>
      </form>

      <div role="group" aria-labelledby="samples-intro" className="space-y-3">
        <p id="samples-intro" className="max-w-[65ch]">
          Or see a sample ballot:
        </p>
        <ul className="flex flex-wrap gap-2">
          {SAMPLE_BALLOTS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => openSample(s)}
                className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Announces progress and errors to screen readers. */}
      <div role="status" aria-live="polite">
        {lookup.isPending && (
          <p className="text-muted">Finding your districts…</p>
        )}
        {lookup.isError && (
          <div className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg">
            <WarningIcon />
            <div className="space-y-2">
              <p className="font-semibold">{LOOKUP_ERRORS[errorKind]}</p>
              {errorKind === 'not_found' && (
                <ul className="space-y-1 text-small">
                  <li>
                    <a
                      className="text-warn-fg"
                      href="https://www.chicagoelections.gov/voting/your-voter-information"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Chicago voters
                    </a>
                  </li>
                  <li>
                    <a
                      className="text-warn-fg"
                      href="https://www.cookcountyclerkil.gov/elections/your-voter-information"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Suburban Cook County voters
                    </a>
                  </li>
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

const AUTOCOMPLETE: Record<Field, string> = {
  street: 'address-line1',
  city: 'address-level2',
  zip: 'postal-code',
}

function TextField({
  field,
  value,
  error,
  onChange,
  onBlur,
  inputRef,
}: {
  field: Field
  value: string
  error?: string
  onChange: (field: Field, value: string) => void
  onBlur: (field: Field) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const errorId = `${field}-error`
  const describedBy = [error && errorId, field === 'street' && 'address-hint']
    .filter(Boolean)
    .join(' ')
  return (
    <div className="space-y-1">
      <label htmlFor={field} className="block text-label font-semibold">
        {LABELS[field]}
      </label>
      <input
        ref={inputRef}
        id={field}
        name={field}
        type="text"
        autoComplete={AUTOCOMPLETE[field]}
        inputMode={field === 'zip' ? 'numeric' : undefined}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        onBlur={() => onBlur(field)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-12 w-full rounded-md bg-surface px-3 text-body text-text ${
          error ? 'border-2 border-danger' : 'border border-field'
        }`}
      />
      {error && (
        <p
          id={errorId}
          className="flex items-start gap-2 text-small font-semibold text-danger"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
