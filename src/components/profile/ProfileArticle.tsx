import { Link } from 'react-router'
import { GET_STARTED_PATH } from '../../ballot/profileLinks.ts'
import { usage } from '../../metrics/usage.ts'
import type { CandidateProfile } from '../../shared/profile.ts'
import { Disclosure } from './Disclosure.tsx'
import { Endorsements } from './Endorsements.tsx'
import { MoneySection } from './MoneySection.tsx'
import { Overview } from './Overview.tsx'
import { ProfileHeader, type Opponent } from './ProfileHeader.tsx'
import { SampleNotice } from './SampleNotice.tsx'
import { SourcesList } from './SourcesList.tsx'

/**
 * A loaded profile: every part in the same order for every person. Shared
 * by the profile page and the dev-only preview, so previews look exactly
 * like what voters see.
 *
 * `opponents` and `midPivot` are only passed for search arrivals (no ballot
 * in memory): the chip under the header and the one-line nudge between
 * endorsements and sources carry the search visitor from this one profile
 * toward their whole ballot. `sourcesRef` is given the element around the
 * Sources list, so the reading counts know when it comes into view.
 */
export function ProfileArticle({
  profile,
  headingId,
  opponents,
  midPivot = false,
  sourcesRef,
}: {
  profile: CandidateProfile
  headingId: string
  opponents?: Opponent[]
  midPivot?: boolean
  sourcesRef?: (el: HTMLElement | null) => void
}) {
  return (
    <article aria-labelledby={headingId} className="space-y-8">
      <div className="space-y-4">
        {profile.sample && (
          <SampleNotice
            sample={profile.sample}
            name={profile.name}
            headingId={headingId}
          />
        )}
        <ProfileHeader
          profile={profile}
          headingId={headingId}
          opponents={opponents}
        />
        <Disclosure
          updated={profile.meta.generatedAt}
          profileKey={profile.key}
        />
      </div>
      <Overview section={profile.overview} />
      <MoneySection section={profile.money} />
      <Endorsements
        section={profile.endorsements}
        kind={profile.kind}
        sources={profile.sources}
      />
      {midPivot && (
        <p className="border-t border-line pt-6 text-small">
          Done reading about {profile.name}?{' '}
          <Link
            to={GET_STARTED_PATH}
            className="font-semibold"
            onClick={() => usage.cta('mid', 'profile')}
          >
            See every race
          </Link>{' '}
          on your November 3 ballot, written the same way.
        </p>
      )}
      <div ref={sourcesRef}>
        <SourcesList sources={profile.sources} />
      </div>
    </article>
  )
}
