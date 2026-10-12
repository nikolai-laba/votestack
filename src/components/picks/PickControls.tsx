// The controls for picking on the ballot and on profiles. Every
// candidate gets the same control: picking only checks it, never reorders
// or restyles the row, the same for every candidate.

import {
  ballotStore,
  useBallotStore,
  type PickResult,
} from '../../picks/store.ts'
import { hiddenPickCount } from '../../picks/summary.ts'
import type {
  CandidateContest,
  MeasureContest,
  RetentionContest,
} from '../../shared/ballot.ts'
import { profileKey } from '../../shared/profile.ts'
import { CheckIcon } from '../icons.tsx'

/**
 * A polite, screen-reader-only line for a pick that took another's place in a
 * full race ("Picked Jane Doe instead of John Roe."). The region is always in
 * the page so the message is announced when it appears; nothing shows.
 */
export function SwapAnnouncement({ text }: { text?: string }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {text}
    </div>
  )
}

/** A checkbox beside a candidate's row: "Pick Jane Doe for Governor". */
export function PickBox({
  contest,
  name,
  picked,
  onResult,
}: {
  contest: CandidateContest
  name: string
  picked: boolean
  onResult: (result: PickResult) => void
}) {
  return (
    <label className="flex min-h-14 w-14 shrink-0 cursor-pointer items-center justify-center border-e border-line">
      <input
        type="checkbox"
        checked={picked}
        onChange={() => onResult(ballotStore.toggle(contest, profileKey(name)))}
        className="size-6 cursor-pointer accent-primary"
      />
      <span className="sr-only">
        Pick {name} for {contest.title}
      </span>
    </label>
  )
}

/**
 * Yes and No for a judge up for retention or a referendum. Two toggle
 * buttons: picking one answer replaces the other, and pressing the picked
 * answer again clears it.
 */
export function YesNo({
  contest,
  subject,
  choice,
}: {
  contest: RetentionContest | MeasureContest
  /** Finishes "Yes on …", e.g. "keeping John Roe in office". */
  subject: string
  choice?: string
}) {
  return (
    <div
      role="group"
      aria-label={`Your pick on ${subject}`}
      className="flex gap-2"
    >
      {(['yes', 'no'] as const).map((value) => {
        const pressed = choice === value
        const label = value === 'yes' ? 'Yes' : 'No'
        return (
          <button
            key={value}
            type="button"
            aria-pressed={pressed}
            // Starts with the visible word, so voice control still finds it.
            aria-label={`${label} on ${subject}`}
            onClick={() => ballotStore.toggle(contest, value)}
            className={`inline-flex min-h-11 min-w-16 items-center justify-center gap-1 rounded-md border-2 px-3 font-semibold transition-colors duration-150 ${
              pressed
                ? 'border-primary bg-primary text-on-primary forced-colors:underline'
                : 'border-field bg-surface text-text'
            }`}
          >
            {pressed && <CheckIcon />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Notes that go with picks wherever they show: when this browser can't save
 * them, and when picks from another ballot are hidden.
 */
export function PickNotices() {
  const { ballot, picks, persistent } = useBallotStore()
  const hidden = hiddenPickCount(ballot, picks)
  if (persistent && hidden === 0) return null
  return (
    <div className="space-y-3">
      {!persistent && (
        <p className="max-w-[65ch] rounded-sm border border-line bg-surface p-3 text-small">
          This browser can&rsquo;t save your picks on this device. They&rsquo;ll
          be gone when you close or reload this page.
        </p>
      )}
      {hidden > 0 && (
        <div className="max-w-[65ch] space-y-2 rounded-sm border border-line bg-surface p-3 text-small">
          <p>
            {hidden === 1
              ? '1 pick is for a race that isn’t on this ballot.'
              : `${hidden} picks are for races that aren’t on this ballot.`}{' '}
            They may be from another address or an earlier ballot, so they are
            hidden and not counted.
          </p>
          <button
            type="button"
            onClick={() => ballotStore.removeHiddenPicks()}
            className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
          >
            {hidden === 1 ? 'Remove that pick' : 'Remove those picks'}
          </button>
        </div>
      )}
    </div>
  )
}
