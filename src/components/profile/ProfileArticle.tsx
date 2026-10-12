import type { CandidateProfile } from '../../shared/profile.ts'
import { Disclosure } from './Disclosure.tsx'
import { Endorsements } from './Endorsements.tsx'
import { MoneySection } from './MoneySection.tsx'
import { Overview } from './Overview.tsx'
import { ProfileHeader } from './ProfileHeader.tsx'
import { SampleNotice } from './SampleNotice.tsx'
import { SourcesList } from './SourcesList.tsx'

/**
 * A loaded profile: every part in the same order for every person. Shared
 * by the profile page and the dev-only preview, so previews look exactly
 * like what voters see.
 */
export function ProfileArticle({
  profile,
  headingId,
}: {
  profile: CandidateProfile
  headingId: string
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
        <ProfileHeader profile={profile} headingId={headingId} />
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
      <SourcesList sources={profile.sources} />
    </article>
  )
}
