import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BallotLookupError } from '../api/ballot.ts'
import { NOTIFY_PATH } from '../ballot/profileLinks.ts'
import {
  isFocusAddressState,
  useBallotSession,
  type AddressField,
  type FocusHeadingState,
} from '../ballot/session.ts'
import type { RaceHandoffState } from '../races/data.ts'
import { REGIONS, coveredAreas } from '../shared/regions.ts'
import { BALLOT_HEADING_ID } from './BallotView.tsx'
import { useAppRunning } from './appRunning.ts'
import { WarningIcon } from './icons.tsx'
import { TextField } from './TextField.tsx'

// The address form (DESIGN.md 8.1), on /getstarted and on the race pages and
// profiles opened without a ballot. A lookup opens the ballot at / with focus
// on its heading, or, from a race, on that race. What's typed and the lookup
// live in BallotSessionProvider's memory (src/ballot/session.ts); the address
// is never in the URL or browser storage.

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

const NOT_FOUND = `We couldn’t find that address in ${coveredAreas()}. Check the street, city and ZIP code`

const LOOKUP_ERRORS = {
  invalid: 'Enter your full street address, starting with the house number.',
  not_found: `${NOT_FOUND}.`,
  rate_limited:
    'There were too many lookups from your connection. Wait a minute and try again.',
  unavailable:
    'Couldn’t load your ballot. Check your connection and try again.',
}

/** With the sample ballots under the form (/getstarted). */
const NOT_FOUND_WITH_SAMPLES = `${NOT_FOUND}, or look through the sample ballots to get an idea of how VoteStack works.`

/** The state a ZIP code is in, among the areas VoteStack covers. */
const stateForZip = (zip: string) =>
  REGIONS.find((r) => r.zipPrefixes.includes(zip.slice(0, 2)))?.state

const fullAddress = (v: Record<Field, string>) => {
  const zip = v.zip.trim()
  const state = stateForZip(zip)
  return `${v.street.trim()}, ${v.city.trim()}, ${state ? `${state} ` : ''}${zip}`
}

export function AddressForm({
  race,
  samplesBelow = false,
}: {
  /** The race the form sits under: the ballot opens at it. */
  race?: RaceHandoffState['focusRace']
  /** The sample ballots follow the form, so "not found" points to them. */
  samplesBelow?: boolean
}) {
  const { lookup, values, setValues, lookUp } = useBallotSession()
  const running = useAppRunning()
  const navigate = useNavigate()
  const location = useLocation()
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  // Set on submit: once the lookup finishes, a ballot opens at / with focus
  // on its heading (or the race), or focus goes back to the street field on
  // an error.
  const awaitingResult = useRef(false)

  // From "Search a new address": straight to the street field.
  useEffect(() => {
    if (isFocusAddressState(location.state)) inputs.current.street?.focus()
  }, [location.state])

  useEffect(() => {
    if (!awaitingResult.current || lookup.isPending || lookup.isIdle) return
    awaitingResult.current = false
    if (lookup.isSuccess) {
      const state: FocusHeadingState | RaceHandoffState = race
        ? { focusRace: race }
        : { focusHeading: BALLOT_HEADING_ID }
      navigate('/', { state })
    } else inputs.current.street?.focus()
  }, [lookup.isPending, lookup.isIdle, lookup.isSuccess, navigate, race])

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

  const errorKind =
    lookup.error instanceof BallotLookupError
      ? lookup.error.kind
      : 'unavailable'
  const field = (f: Field) => (
    <AddressInput
      field={f}
      value={values[f]}
      error={errors[f]}
      onChange={change}
      onBlur={blur}
      inputRef={(el) => {
        inputs.current[f] = el
      }}
    />
  )

  return (
    // POST, so an address sent before the app runs never goes in the page
    // address (the button stays disabled until then anyway).
    <form
      method="post"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5"
    >
      <fieldset className="space-y-4">
        <legend className="text-label font-semibold">
          Registered voting address
        </legend>
        {field('street')}
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="flex-1">{field('city')}</div>
          <div className="md:w-40">{field('zip')}</div>
        </div>
      </fieldset>

      <div className="space-y-3">
        <button
          type="submit"
          disabled={!running || lookup.isPending}
          className="h-13 w-full rounded-md bg-primary px-6 text-label font-semibold text-on-primary transition-opacity duration-150 disabled:opacity-60 md:w-auto"
        >
          Find my ballot
        </button>

        {/* Announces progress and errors to screen readers, right under the
            button. Takes no space while empty. */}
        <div role="status" aria-live="polite" className="empty:-mt-3">
          {lookup.isPending && (
            <p className="text-muted">Finding your districts…</p>
          )}
          {lookup.isError && (
            <div className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg">
              <WarningIcon />
              <div className="space-y-2">
                <p className="font-semibold">
                  {errorKind === 'not_found' && samplesBelow
                    ? NOT_FOUND_WITH_SAMPLES
                    : LOOKUP_ERRORS[errorKind]}
                </p>
                {errorKind === 'not_found' && (
                  <p>
                    Live outside {coveredAreas()}?{' '}
                    <Link className="text-warn-fg" to={NOTIFY_PATH}>
                      Get an email when VoteStack covers your area
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="max-w-[65ch] text-small text-muted">
        We use your address once to find your districts. It isn&apos;t saved,
        logged or added to the page link.
      </p>
    </form>
  )
}

const AUTOCOMPLETE: Record<Field, string> = {
  street: 'address-line1',
  city: 'address-level2',
  zip: 'postal-code',
}

function AddressInput({
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
  return (
    <TextField
      id={field}
      label={LABELS[field]}
      value={value}
      error={error}
      autoComplete={AUTOCOMPLETE[field]}
      inputMode={field === 'zip' ? 'numeric' : undefined}
      onChange={(v) => onChange(field, v)}
      onBlur={() => onBlur(field)}
      inputRef={inputRef}
    />
  )
}
