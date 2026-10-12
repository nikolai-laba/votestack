// This session's ballot lookup and sample, shared by the get-started page
// (/getstarted, the address form) and the ballot (/ and its child routes).
// Held only in memory by BallotSessionProvider (src/components/
// BallotSession.tsx), above both routes, so moving between them keeps it; a
// reload starts over. The address is never put in the URL, browser storage
// or logs, for the voter's privacy: it stays here so the voter never types it
// twice.

import type { UseMutationResult } from '@tanstack/react-query'
import { createContext, useContext } from 'react'
import type { Ballot } from '../shared/ballot.ts'
import type { SampleBallot } from './samples.ts'

export type AddressField = 'street' | 'city' | 'zip'
export type AddressValues = Record<AddressField, string>

export const EMPTY_ADDRESS: AddressValues = { street: '', city: '', zip: '' }

/** The sample notice's heading, which takes focus when a sample opens. */
export const SAMPLE_HEADING_ID = 'sample-heading'

export interface BallotSession {
  /** The voter's own lookup (saved on the device when it succeeds). */
  lookup: UseMutationResult<Ballot, Error, string>
  /** The address of the last successful lookup, for "Ballot for …". */
  address: string | null
  /** What's typed in the address form. */
  values: AddressValues
  setValues: (update: (v: AddressValues) => AddressValues) => void
  /** Looks up the voter's own address, leaving any sample. */
  lookUp: (address: string) => void
  /** The sample being shown, if any (never saved, never in the URL). */
  sample: SampleBallot | null
  sampleLookup: UseMutationResult<Ballot, Error, string>
  showSample: (sample: SampleBallot) => void
  leaveSample: () => void
}

export const BallotSessionContext = createContext<BallotSession | null>(null)

export function useBallotSession(): BallotSession {
  const session = useContext(BallotSessionContext)
  if (!session) throw new Error('useBallotSession needs BallotSessionProvider')
  return session
}

/** Router state that puts focus on a heading once the page shows. */
export interface FocusHeadingState {
  focusHeading: string
}

export function isFocusHeadingState(
  value: unknown,
): value is FocusHeadingState {
  return (
    typeof (value as Partial<FocusHeadingState> | null)?.focusHeading ===
    'string'
  )
}

/** Router state on "Search a new address": focus the street field. */
export interface FocusAddressState {
  focusAddress: true
}

export function isFocusAddressState(
  value: unknown,
): value is FocusAddressState {
  return (value as Partial<FocusAddressState> | null)?.focusAddress === true
}
