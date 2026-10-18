import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { fetchBallot } from '../api/ballot.ts'
import { isRaceLinkState } from '../ballot/profileLinks.ts'
import type { SampleBallot } from '../ballot/samples.ts'
import {
  BallotSessionContext,
  EMPTY_ADDRESS,
  type AddressValues,
  type BallotSession,
} from '../ballot/session.ts'
import { ballotStore } from '../picks/store.ts'

/**
 * Holds this session's lookup and sample in memory (src/ballot/session.ts)
 * for the get-started page and the ballot, which are its child routes.
 */
export function BallotSessionProvider() {
  const [address, setAddress] = useState<string | null>(null)
  const [values, setValues] = useState<AddressValues>(EMPTY_ADDRESS)
  const lookup = useMutation({
    mutationFn: (searched: string) => fetchBallot(searched),
    onSuccess: (data, searched) => {
      ballotStore.saveBallot(data)
      setAddress(searched)
    },
  })
  // Never saved: a sample stays in memory only.
  const sampleLookup = useMutation({
    mutationFn: (sampleAddress: string) =>
      fetchBallot(sampleAddress, { sample: true }),
  })
  const [sample, setSample] = useState<SampleBallot | null>(null)

  // Saved choices is about the voter's own ballot, so its "Show on ballot"
  // links leave a sample (set while rendering, before the race is focused).
  const location = useLocation()
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (location.key !== seenLocation) {
    setSeenLocation(location.key)
    if (sample && isRaceLinkState(location.state)) setSample(null)
  }

  function leaveSample() {
    setSample(null)
    sampleLookup.reset()
  }

  const session: BallotSession = {
    lookup,
    address,
    values,
    setValues,
    lookUp(next) {
      leaveSample()
      lookup.mutate(next)
    },
    sample,
    sampleLookup,
    showSample(next) {
      // A failed lookup's message would come back with the form afterwards.
      if (lookup.isError) lookup.reset()
      setSample(next)
      sampleLookup.mutate(next.address)
    },
    leaveSample,
  }

  return (
    <BallotSessionContext.Provider value={session}>
      <Outlet />
    </BallotSessionContext.Provider>
  )
}
