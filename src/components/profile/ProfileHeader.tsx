import { partyLine, type CandidateProfile } from '../../shared/profile.ts'

/**
 * Name, party (with "incumbent" when an official list confirms it) and office
 * as text. No photo or portrait slot, so every candidate is shown the same way.
 */
export function ProfileHeader({
  profile,
  headingId,
}: {
  profile: CandidateProfile
  headingId: string
}) {
  // Judges up for retention hold the seat by definition: no label.
  const detail = partyLine(
    profile.party,
    profile.kind !== 'retention' && profile.incumbent,
  )
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
    </header>
  )
}
