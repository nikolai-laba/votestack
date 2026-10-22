import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import {
  NOTIFY_PATH,
  SAVED_CHOICES_PATH,
  type SignupLinkState,
} from '../../ballot/profileLinks.ts'
import { usage } from '../../metrics/usage.ts'
import { useBallotStore } from '../../picks/store.ts'
import {
  bannerAllowed,
  signupStore,
  useSignupDevice,
} from '../../signup/device.ts'

// One line above the site header for devices with a ballot of their own: a
// link to the email sign-up page and a Close button. Closing hides it for the
// rest of the visit; it stops for good after a few closes or a sign-up on
// this device (src/signup/device.ts). Never on Saved choices, the page people
// use in the booth, or on the sign-up page itself. It depends on the device,
// so it isn't in the prerendered HTML.

export function SignupBanner({ width }: { width: string }) {
  const hasBallot = useBallotStore().ballot !== null
  const device = useSignupDevice()
  const path = useLocation().pathname.replace(/\/+$/, '') || '/'
  const show =
    hasBallot &&
    bannerAllowed(device) &&
    path !== SAVED_CHOICES_PATH &&
    path !== NOTIFY_PATH

  useEffect(() => {
    if (show && signupStore.firstShowThisVisit()) usage.banner('shown')
  }, [show])

  if (!show) return null

  function close() {
    signupStore.closeBanner()
    usage.banner('closed')
    // The banner is gone: continue from the start of the header.
    document.querySelector<HTMLElement>('header a')?.focus()
  }

  return (
    <aside aria-label="Email sign-up" className="border-b border-line bg-band">
      <div className={`mx-auto flex ${width} items-center gap-3 px-4`}>
        <p className="flex-1 text-small">
          Get an email before your next election.{' '}
          <Link
            to={NOTIFY_PATH}
            state={{ from: 'banner' } satisfies SignupLinkState}
            className="inline-flex min-h-11 items-center font-semibold"
          >
            Sign up
          </Link>
        </p>
        <button
          type="button"
          aria-label="Close the email sign-up banner"
          onClick={close}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-title leading-none text-text"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </aside>
  )
}
