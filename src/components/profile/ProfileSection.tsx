import type { ReactNode } from 'react'
import { longDate } from '../../format.ts'

/**
 * A profile section with its heading. Empty sections stay on the page and say
 * so, because a missing section can look like bias.
 */
export function ProfileSection({
  id,
  title,
  asOf,
  empty,
  children,
}: {
  id: string
  title: string
  asOf: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="text-section">
        {title}
      </h2>
      {empty ? (
        <p className="text-muted">
          Not found in public sources as of {longDate(asOf)}.
        </p>
      ) : (
        children
      )}
    </section>
  )
}
