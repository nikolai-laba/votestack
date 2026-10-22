import { useContext, useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { BallotSessionContext } from '../../ballot/session.ts'
import { normalizeZip, type SignupSource } from '../../shared/notify.ts'
import { useSignupDevice } from '../../signup/device.ts'
import { SIGNUP_HEADING, SIGNUP_PROMISE } from './copy.ts'
import { SignupForm } from './SignupForm.tsx'

// The email sign-up at the end of a page (a profile, a race, the ballot,
// Saved choices). A device that has signed up doesn't see it; the block someone just used
// keeps its thank-you while the rest of the page's blocks go away.

export function SignupBlock({
  source,
}: {
  source: Exclude<SignupSource, 'banner' | 'page'>
}) {
  const device = useSignupDevice()
  const [usedHere, setUsedHere] = useState(false)
  const typedZip = useContext(BallotSessionContext)?.values.zip ?? ''
  const headingId = useId()
  if (device.signedUp && !usedHere) return null
  return (
    <section
      aria-labelledby={headingId}
      className="max-w-[65ch] space-y-3 border-t border-line pt-6"
    >
      <h2 id={headingId} className="text-section">
        {SIGNUP_HEADING}
      </h2>
      <p>{SIGNUP_PROMISE}</p>
      <SignupForm
        source={source}
        initialZip={normalizeZip(typedZip) ?? ''}
        // Committed at once: marking the device as signed up re-renders
        // this block straight after, and it must already know it was used.
        onSignedUp={() => flushSync(() => setUsedHere(true))}
      />
    </section>
  )
}
