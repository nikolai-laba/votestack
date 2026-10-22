import { Fragment } from 'react'
import { Link } from 'react-router'
import { profilePath } from '../../ballot/profileLinks.ts'
import { partyLine, type CandidateProfile } from '../../shared/profile.ts'

/** An opponent in the same candidate race, for the mobile peers chip. */
export interface Opponent {
  name: string
  key: string
  published: boolean
}

/**
 * Name, party (with "incumbent" when an official list confirms it) and office
 * as text. No photo or portrait slot, so every candidate is shown the same way.
 *
 * When opened without a ballot (a search arrival) and the person is in a
 * candidate race with others, a compact "Also running" chip under the office
 * line answers the natural next question before the article pushes it off
 * screen. Hidden on `lg`, where the sidebar lists everyone in the race.
 */
export function ProfileHeader({
  profile,
  headingId,
  opponents,
}: {
  profile: CandidateProfile
  headingId: string
  opponents?: Opponent[]
}) {
  // Judges up for retention hold the seat by definition: no label.
  const detail = partyLine(
    profile.party,
    profile.kind !== 'retention' && profile.incumbent,
  )
  const showChip = profile.kind === 'candidate' && (opponents?.length ?? 0) > 0
  return (
    <header className="space-y-1">
      {/* Focused when the profile opens, so it isn't an interactive target. */}
      <h1
        id={headingId}
        tabIndex={-1}
        className="text-title focus:outline-none lg:text-title-lg"
      >
        {profile.name}
      </h1>
      {detail && <p className="text-muted">{detail}</p>}
      <p>{profile.office}</p>
      {showChip && opponents && (
        <p className="pt-1 text-small text-muted lg:hidden">
          Also running:{' '}
          {opponents.map((o, i) => (
            <Fragment key={o.key}>
              {i > 0 && ' · '}
              {o.published ? (
                <Link to={profilePath(o.key)} className="text-text">
                  {o.name}
                </Link>
              ) : (
                o.name
              )}
            </Fragment>
          ))}
        </p>
      )}
    </header>
  )
}
