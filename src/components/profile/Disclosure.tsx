import { Link } from 'react-router'
import { reportPath } from '../../ballot/profileLinks.ts'
import { longDate } from '../../format.ts'

/**
 * How the profile was made, in the same place on every profile, with the
 * methods and error-report links beside it (WCAG 3.2.6).
 */
export function Disclosure({
  updated,
  profileKey,
}: {
  updated: string
  profileKey: string
}) {
  return (
    <div className="space-y-2 rounded-sm border border-line bg-surface p-4 text-small">
      <p>
        AI wrote this from the sources listed below. A second AI checked each
        sentence against its source, and software checked the links and dates. A
        person didn&rsquo;t review it, so every sentence links to its source for
        you to check. Updated {longDate(updated)}.
      </p>
      {/* Standalone links, so each is a 44px target (our minimum touch target). */}
      <p className="flex flex-wrap gap-x-6">
        <Link
          to="/how-profiles-are-made"
          className="inline-flex min-h-11 items-center"
        >
          How we make profiles
        </Link>
        <Link
          to={reportPath(profileKey)}
          className="inline-flex min-h-11 items-center"
        >
          Report an error
        </Link>
      </p>
    </div>
  )
}
