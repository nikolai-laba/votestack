import { useContext, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { coveredFullNames } from '../ballot/coverage.ts'
import { GET_STARTED_PATH, isSignupLinkState } from '../ballot/profileLinks.ts'
import { BallotSessionContext } from '../ballot/session.ts'
import { SIGNUP_HEADING, SIGNUP_PROMISE } from '../components/signup/copy.ts'
import { SignupForm } from '../components/signup/SignupForm.tsx'
import { NOTIFY_HEAD, useDocumentHead } from '../head.ts'
import { normalizeZip } from '../shared/notify.ts'

// /notify: the sign-up page for VoteStack's email list, for anyone, in the
// areas VoteStack covers or elsewhere. Linked from the footer, the sign-up
// banner, About, the race list and the "couldn't find that address" notice.
// It always shows the form, even on a device that has signed up (someone
// may sign up another address). Loaded lazily: the Turnstile script is only
// fetched once someone starts filling in the form.

const HEADING_ID = 'notify-heading'

export default function NotifyPage() {
  const location = useLocation()
  // The ZIP typed in this visit's address form, if any (memory only).
  const typedZip = useContext(BallotSessionContext)?.values.zip ?? ''
  useDocumentHead(NOTIFY_HEAD)

  // Start keyboard and screen reader users at the top of what changed.
  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  return (
    <div className="max-w-[65ch] space-y-6">
      <Link to={GET_STARTED_PATH} className="inline-flex min-h-11 items-center">
        Find your ballot
      </Link>

      <div className="space-y-3">
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          {SIGNUP_HEADING}
        </h1>
        <p>{SIGNUP_PROMISE}</p>
        <p>
          Your ZIP code tells us which elections to write to you about. Right
          now, VoteStack covers {coveredFullNames()}. If you live somewhere
          else, we&rsquo;ll tell you when VoteStack reaches your area.
        </p>
      </div>

      <SignupForm
        source={isSignupLinkState(location.state) ? 'banner' : 'page'}
        initialZip={normalizeZip(typedZip) ?? ''}
        deletionNote
      />
    </div>
  )
}
