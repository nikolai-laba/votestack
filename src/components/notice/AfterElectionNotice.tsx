import { useContext, useEffect, useRef, useState, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation } from 'react-router'
import { NOTIFY_PATH, SUPPORT_PATH } from '../../ballot/profileLinks.ts'
import { BallotSessionContext } from '../../ballot/session.ts'
import { usage } from '../../metrics/usage.ts'
import { noticeVisit, useNoticeVisit } from '../../notice/visit.ts'
import { useNoticeWords } from '../../notice/words.ts'
import type { NoticeWords } from '../../shared/afterElection.ts'
import { normalizeZip } from '../../shared/notify.ts'
import { useSignupDevice } from '../../signup/device.ts'
import { HIGHLIGHT_BUTTON_CLASS } from '../buttonStyles.ts'
import { SignupForm } from '../signup/SignupForm.tsx'

// The thank-you notice under the site header once voting has ended: the
// email sign-up first, then a way to pay toward VoteStack. The first page of
// a visit shows it in full; later pages show one line that opens it in
// place. Closing hides it for the rest of the visit (src/notice/visit.ts),
// and the next visit shows it again. Never on the sign-up or Support pages.
// Its words load from a file crawlers are kept out of (src/notice/words.ts),
// so it is in neither the prerendered pages nor search snippets.

/** A secondary button, as on "Search a new address". */
const SECONDARY_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md border-2 border-field px-4 font-semibold text-text no-underline'

export function AfterElectionNotice({ width }: { width: string }) {
  const words = useNoticeWords()
  const visit = useNoticeVisit()
  const { signedUp } = useSignupDevice()
  const path = useLocation().pathname.replace(/\/+$/, '') || '/'
  const heading = useRef<HTMLHeadingElement>(null)
  const show =
    words !== null &&
    !visit.closed &&
    path !== NOTIFY_PATH &&
    path !== SUPPORT_PATH

  // The page the full notice is on: the first page of the visit to show it,
  // or the page where the line was opened. Kept here, because the visit
  // records the full notice as shown as soon as it appears, and moving to
  // another page shrinks it to the line.
  const [fullOn, setFullOn] = useState<string | null>(null)
  let fullPath = fullOn === path ? path : null
  if (fullPath === null && show && !visit.fullShown) fullPath = path
  if (fullPath !== fullOn) setFullOn(fullPath)
  const full = show && fullPath === path
  const line = show && !full

  useEffect(() => {
    if (!full || noticeVisit.getSnapshot().fullShown) return
    noticeVisit.markFullShown()
    usage.notice('full')
  }, [full])

  useEffect(() => {
    if (line && noticeVisit.firstLineThisVisit()) usage.notice('line')
  }, [line])

  if (!words || !show) return null

  function open() {
    // Committed at once, so the heading is there to take focus.
    flushSync(() => setFullOn(path))
    heading.current?.focus()
    usage.notice('opened')
  }

  function close() {
    noticeVisit.close()
    usage.notice('closed')
    // The notice is gone: continue from the start of the header, skipping the
    // logo link while the header has swapped it for "Back to your ballot".
    document
      .querySelector<HTMLElement>('header a:not([aria-hidden="true"])')
      ?.focus()
  }

  return (
    <aside
      aria-label="Thank you notice"
      className="border-b border-line bg-band"
    >
      {/* Kept out of search results' snippets. */}
      <div data-nosnippet="" className={`mx-auto ${width} px-4`}>
        {full ? (
          <FullNotice words={words} headingRef={heading} onClose={close} />
        ) : (
          <div className="flex items-center gap-3 py-1">
            <p className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-small">
              <span>{words.line.text}</span>
              <button type="button" onClick={open} className={SECONDARY_CLASS}>
                {signedUp ? words.line.openSignedUp : words.line.open}
              </button>
            </p>
            <CloseButton onClick={close} />
          </div>
        )}
      </div>
    </aside>
  )
}

function FullNotice({
  words,
  headingRef,
  onClose,
}: {
  words: NoticeWords
  headingRef: Ref<HTMLHeadingElement>
  onClose: () => void
}) {
  const { support } = words
  return (
    <div className="space-y-6 py-6">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="flex-1 pt-2 text-section focus:outline-none"
          >
            {words.heading}
          </h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="max-w-[65ch]">{words.intro}</p>
      </div>
      <NoticeSignup words={words.signup} />
      <div className="max-w-[65ch] space-y-3">
        <h3 className="text-label font-semibold">{support.heading}</h3>
        <p>{support.body}</p>
        <a
          href={support.payUrl}
          onClick={() => usage.notice('pay')}
          className={`${HIGHLIGHT_BUTTON_CLASS} w-full md:w-auto`}
        >
          {support.payLabel}
        </a>
        <p className="text-small text-muted">
          {support.fine} <Link to={SUPPORT_PATH}>{support.linkLabel}</Link>
        </p>
      </div>
    </div>
  )
}

/**
 * The sign-up part: the form, with this visit's ZIP code filled in. A device
 * that has signed up doesn't see it; after signing up here, the form's
 * thank-you stays until the notice leaves this page.
 */
function NoticeSignup({ words }: { words: NoticeWords['signup'] }) {
  const { signedUp } = useSignupDevice()
  const [usedHere, setUsedHere] = useState(false)
  const typedZip = useContext(BallotSessionContext)?.values.zip ?? ''
  if (signedUp && !usedHere) return null
  return (
    <div className="max-w-[65ch] space-y-3">
      <h3 className="text-label font-semibold">{words.heading}</h3>
      <p>{words.body}</p>
      <SignupForm
        source="notice"
        emphasis="highlight"
        initialZip={normalizeZip(typedZip) ?? ''}
        // Committed at once: marking the device as signed up re-renders
        // this part straight after, and it must already know it was used.
        onSignedUp={() => flushSync(() => setUsedHere(true))}
      />
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close the thank-you notice"
      onClick={onClick}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-title leading-none text-text"
    >
      <span aria-hidden="true">×</span>
    </button>
  )
}
