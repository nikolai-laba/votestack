import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import { fetchProfile, ProfileLoadError } from '../api/profile.ts'
import {
  GET_STARTED_PATH,
  contestsWithPerson,
  type BallotOutletContext,
} from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { ProfileArticle } from '../components/profile/ProfileArticle.tsx'
import { sampleNoticeId } from '../components/profile/ids.ts'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'
import { ProfileRaces, useOpponents } from '../components/RaceSummary.tsx'
import { SignupBlock } from '../components/signup/SignupBlock.tsx'
import { MISSING_PROFILE_HEAD, profileHead, useDocumentHead } from '../head.ts'
import { usage } from '../metrics/usage.ts'
import { useProfileReading } from '../metrics/useReading.ts'
import { profileKey, type CandidateProfile } from '../shared/profile.ts'
import { COOK, regionForElection } from '../shared/regions.ts'

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

  // With a ballot, "Back to your full ballot" is first in the ballot list
  // beside the profile from 840px, and below that in the race panel at the
  // profile's top (with the pick boxes), when the person is on the ballot.
  const onBallot = useMemo(
    () => (ballot ? contestsWithPerson(ballot.contests, key) : []),
    [ballot, key],
  )
  const panelAbove = onBallot.length > 0

  const notFound =
    query.error instanceof ProfileLoadError && query.error.kind === 'not_found'

  useDocumentHead(
    profile ? profileHead(profile) : notFound ? MISSING_PROFILE_HEAD : null,
  )

  // A search arrival: no ballot in memory, and the profile isn't a sample.
  // These visitors are the ones the top strip, sidebar, "Also running" chip
  // and mid-article pivot are for; everyone else gets the layout unchanged.
  const fromSearch =
    ballot === undefined && Boolean(profile) && !profile?.sample
  // The race list is also what tells a read profile's races apart, so it's
  // looked up whenever the ballot doesn't list this person.
  const opponents = useOpponents(
    profile && !panelAbove ? profile : EMPTY_PROFILE,
  )

  // Every candidate in each race this person is in, for the reading counts:
  // from the voter's ballot when it lists them, otherwise from the race list
  // (undefined while it loads).
  const races = useMemo(() => {
    if (!profile) return undefined
    if (panelAbove)
      return onBallot.map((c) =>
        c.kind === 'candidate'
          ? c.candidates.map((p) => profileKey(p.name))
          : c.kind === 'retention'
            ? [profileKey(c.judge)]
            : [],
      )
    return opponents && [[profile.key, ...opponents.map((o) => o.key)]]
  }, [profile, panelAbove, onBallot, opponents])
  const sourcesRef = useProfileReading(profile, races)

  const article = (
    <div className="max-w-[65ch] min-w-0">
      {/* Screen-reader live region. Kept out of the article's `space-y-6`
          so the empty, 0-height div doesn't push the first visible child
          (`mt-6`) below the top of the sidebar beside it. */}
      <div role="status" aria-live="polite" className="sr-only">
        {query.isPending && 'Loading profile…'}
      </div>
      <div className="space-y-6">
        {/* Only ballot visitors see the back link ("Back to your full
            ballot"): on a search arrival the top strip above the article
            already offers "Explore your full ballot", so a second one here
            would be noise. */}
        {!panelAbove && !fromSearch && (
          <div className={ballot ? 'lg:hidden' : undefined}>
            <BackLink hasBallot={Boolean(ballot)} />
          </div>
        )}

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

        {profile && (
          <ProfileArticle
            profile={profile}
            headingId={HEADING_ID}
            opponents={fromSearch ? opponents : undefined}
            midPivot={fromSearch}
            sourcesRef={sourcesRef}
          />
        )}
      </div>
    </div>
  )

  // Visitors with a ballot (opened from their own list, or from a shared link
  // with a saved ballot): no top strip, no sidebar, no bottom race card.
  if (!fromSearch || !profile)
    return (
      <>
        {article}
        {profile && !profile.sample && !panelAbove && (
          <div className="mt-6 border-t border-line pt-6">
            <ProfileRaces profile={profile} ballot={ballot} />
          </div>
        )}
        {profile && (
          <div className="mt-10">
            <SignupBlock source="profile" />
          </div>
        )}
      </>
    )

  // Search arrivals: top strip spans both columns, the article sits in the
  // right column on `lg+`, and ProfileRaces (one instance) is placed below
  // the article on mobile and in a sticky left sidebar on `lg+` via grid
  // ordering, so it answers "who else is in this race?" without duplicating
  // the content.
  return (
    <div className="space-y-6">
      <TopStrip profile={profile} />
      <div className="flex flex-col lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start lg:gap-x-10">
        <aside
          aria-label="This race and your ballot"
          className="order-last mt-6 border-t border-line pt-6 lg:order-none lg:mt-0 lg:border-t-0 lg:pt-0 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-x-hidden lg:overflow-y-auto lg:pr-2 lg:pb-2"
        >
          <ProfileRaces profile={profile} ballot={ballot} />
        </aside>
        {article}
        {/* Last on phones, after the race card (both order-last); under the
            article on wide screens. */}
        <div className="order-last mt-10 lg:order-none lg:col-start-2">
          <SignupBlock source="profile" />
        </div>
      </div>
    </div>
  )
}

/** A placeholder for `useOpponents` while there is no profile loaded yet. */
const EMPTY_PROFILE = {
  key: '',
  electionId: '',
  contestIds: [],
} as unknown as CandidateProfile

/**
 * One line above the profile for search arrivals: what VoteStack is (every
 * candidate on the region's ballot, written the same way) and a link to the
 * address form. Hidden for ballot visitors, who already know the product.
 */
function TopStrip({ profile }: { profile: CandidateProfile }) {
  const region = regionForElection(profile.electionId) ?? COOK
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 text-small">
      VoteStack has a profile for every candidate on the {region.name} ballot,
      written the same way.{' '}
      <Link
        to={GET_STARTED_PATH}
        className="font-semibold"
        onClick={() => usage.cta('top', 'profile')}
      >
        Explore your full ballot
      </Link>
      .
    </div>
  )
}
