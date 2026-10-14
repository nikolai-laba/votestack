import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useOutletContext, useParams } from 'react-router'
import { fetchProfile, ProfileLoadError } from '../api/profile.ts'
import {
  contestsWithPerson,
  type BallotOutletContext,
} from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { ProfileArticle } from '../components/profile/ProfileArticle.tsx'
import { sampleNoticeId } from '../components/profile/ids.ts'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'
import { ProfileRaces } from '../components/RaceSummary.tsx'
import { MISSING_PROFILE_HEAD, profileHead, useDocumentHead } from '../head.ts'

// A candidate profile, under the election's name and date, with the
// candidate's race(s) beside it on wide screens and above it on narrow ones
// (HomePage). Loaded lazily (see routes.tsx). Every profile has the same
// parts in the same order, whatever is filled in.

const HEADING_ID = 'profile-heading'

export default function ProfilePage() {
  const { key = '' } = useParams()
  const { ballot } = useOutletContext<BallotOutletContext>()
  const query = useQuery({
    queryKey: ['profile', key],
    queryFn: () => fetchProfile(key),
    staleTime: 5 * 60 * 1000,
    retry: (count, error) =>
      !(error instanceof ProfileLoadError && error.kind === 'not_found') &&
      count < 2,
  })
  const profile = query.data

  // Move focus to the name when a profile opens, so keyboard and screen
  // reader users start at the top of what changed. A sample profile starts
  // at the notice above the name, so no one takes it for this candidate's.
  const focused = useRef<string | null>(null)
  useEffect(() => {
    // Keyed by the route: a sample can carry the key of the profile it borrows.
    if (!profile || focused.current === key) return
    focused.current = key
    document
      .getElementById(profile.sample ? sampleNoticeId(HEADING_ID) : HEADING_ID)
      ?.focus()
  }, [profile, key])

  // A profile that can't load says so in its own h1; start there too.
  useEffect(() => {
    if (query.isError) document.getElementById(HEADING_ID)?.focus()
  }, [query.isError])

  // The race panel (beside the profile from 840px, at its top below that)
  // holds "Back to your full ballot" and the pick boxes.
  const panelBeside =
    ballot !== undefined && contestsWithPerson(ballot.contests, key).length > 0

  const notFound =
    query.error instanceof ProfileLoadError && query.error.kind === 'not_found'

  useDocumentHead(
    profile ? profileHead(profile) : notFound ? MISSING_PROFILE_HEAD : null,
  )

  return (
    <div className="max-w-[65ch] space-y-6">
      {!panelBeside && (
        <div>
          <BackLink hasBallot={Boolean(ballot)} />
        </div>
      )}

      <div role="status" aria-live="polite">
        {query.isPending && <p className="sr-only">Loading profile…</p>}
      </div>
      {query.isPending && <ProfileSkeleton />}

      {query.isError &&
        (notFound ? (
          <section className="space-y-3">
            <h1
              id={HEADING_ID}
              tabIndex={-1}
              className="text-title focus:outline-none lg:text-title-lg"
            >
              No profile yet
            </h1>
            <p>There is no published profile for this candidate yet.</p>
          </section>
        ) : (
          <section className="space-y-3">
            <h1
              id={HEADING_ID}
              tabIndex={-1}
              className="text-title focus:outline-none lg:text-title-lg"
            >
              Couldn&rsquo;t load this profile
            </h1>
            <p>Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="min-h-11 rounded-md border-2 border-field px-4 font-semibold text-text"
            >
              Try again
            </button>
          </section>
        ))}

      {profile && <ProfileArticle profile={profile} headingId={HEADING_ID} />}

      {/* Opened without this person on a ballot (from a search or a shared
          link): their race and the way to the voter's own ballot. */}
      {profile && !profile.sample && !panelBeside && (
        <ProfileRaces profile={profile} ballot={ballot} />
      )}
    </div>
  )
}
