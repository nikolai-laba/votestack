import { Link } from 'react-router'
import { reportPath } from '../../ballot/profileLinks.ts'
import { longDate } from '../../format.ts'

/**
 * How the profile was made, in the same place on every profile. The methods
 * page and error-report links sit inline in the prose (not as standalone
 * tap targets) to keep the box short on mobile, where this is one of the
 * first things a search arrival sees.
 */
export function Disclosure({
  updated,
  profileKey,
}: {
  updated: string
  profileKey: string
}) {
  return (
    <div className="space-y-1 rounded-sm border border-line bg-surface p-4 text-small">
      <p>
        AI wrote this from the sources listed below. A second AI checked each
        sentence against its source, and software checked the links and dates. A
        person didn&rsquo;t review it, so every sentence links to its source for
        you to check.{' '}
        <span className="italic">Updated {longDate(updated)}.</span>
      </p>
      <p>
        <Link to="/how-profiles-are-made">How we make profiles</Link>
        {' · '}
        <Link to={reportPath(profileKey)}>Report an error</Link>
      </p>
    </div>
  )
}
