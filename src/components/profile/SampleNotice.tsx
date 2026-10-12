import type { CandidateProfile } from '../../shared/profile.ts'
import { WarningIcon } from '../icons.tsx'
import { sampleNoticeId } from './ids.ts'

/**
 * Pre-launch only: says this is another candidate's profile, standing in for
 * one that isn't written yet. Amber caution styling, like the coverage notice, a
 * labelled region rather than a heading, since it sits above the page's h1.
 */
export function SampleNotice({
  sample,
  name,
  headingId,
}: {
  sample: NonNullable<CandidateProfile['sample']>
  name: string
  headingId: string
}) {
  const titleId = sampleNoticeId(headingId)
  return (
    <section
      aria-labelledby={titleId}
      className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg"
    >
      <WarningIcon />
      <div className="space-y-1 text-small">
        {/* Focused when the profile opens, so it isn't an interactive target. */}
        <p
          id={titleId}
          tabIndex={-1}
          className="font-sans text-label font-bold focus:outline-none"
        >
          Sample profile
        </p>
        <p>
          {sample.forName}&rsquo;s profile isn&rsquo;t ready yet. To show how
          profiles will look, this is the profile of {name}, another candidate.
        </p>
      </div>
    </section>
  )
}
