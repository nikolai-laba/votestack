import { useEffect, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router'
import {
  ABOUT_PATH,
  NOTIFY_PATH,
  type BallotOutletContext,
} from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { SUPPORT_HEAD, useDocumentHead } from '../head.ts'

// How to pay toward VoteStack, what the money pays for and which money we
// refuse. Linked from the footer and the About page only: never from the
// ballot, race or profile pages, and never as a banner or prompt. Payments
// happen on Stripe's own pages, so this site never handles card details.
// VoteStack, LLC isn't a charity, so the copy says "pay" and "support", never
// "donate", and says plainly that payments aren't tax-deductible.

/** Stripe Payment Link where the payer picks the amount (one-time only). */
const PAY_ONCE_URL = 'https://buy.stripe.com/3cIeVd0otdaX6Ph7Pt9EI00'

/**
 * Stripe Payment Links for monthly payments, one fixed amount each (Stripe
 * doesn't let the payer pick the amount of a monthly payment). Listed in
 * this order with none chosen in advance.
 */
const MONTHLY: { dollars: number; url: string }[] = [
  { dollars: 5, url: '' },
  { dollars: 10, url: '' },
  { dollars: 25, url: '' },
]

/**
 * Monthly running costs, in dollars: the database and hosting ($25) plus
 * email through Google Workspace ($8.40).
 */
const HOSTING_PER_MONTH = 33.4

/** AI spent on candidate profiles so far, in dollars, across every area. */
const AI_SPENT_SO_FAR = 400.37

/**
 * Candidates with published profiles in every area (the profile lists in
 * content/profiles/published/). A test checks it against those lists, so
 * update it, and AI_SPENT_SO_FAR, when an area is added or republished.
 */
export const CANDIDATES_COVERED = 1176

const HEADING_ID = 'support-heading'

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="text-section">
        {title}
      </h2>
      {children}
    </section>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 ps-6">{children}</ul>
}

/**
 * A link to a Stripe payment page, styled as a button: the highlight fill
 * with on-highlight text, the same in both modes. The only button with the
 * highlight fill; keep it that way. The border keeps its edge
 * in forced-colors mode, where fills are dropped.
 */
function PayLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-13 items-center rounded-md border-2 border-highlight bg-highlight px-6 text-label font-semibold text-on-highlight no-underline"
    >
      {children}
    </a>
  )
}

export function SupportPage() {
  const { ballot } = useOutletContext<BallotOutletContext>()

  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  useDocumentHead(SUPPORT_HEAD)

  const monthly = MONTHLY.filter((m) => m.url)
  const open = Boolean(PAY_ONCE_URL) || monthly.length > 0

  return (
    <article className="max-w-[65ch] space-y-8">
      <div className="space-y-4">
        <BackLink hasBallot={Boolean(ballot)} />
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          Support VoteStack
        </h1>
        <p>
          VoteStack is free to use, with no ads and no paywall. If it helped
          you, you can pay what you think it&rsquo;s worth. Payments cover the
          cost of running VoteStack and of bringing it to more places.
        </p>
        {open ? (
          <ul className="flex flex-wrap gap-3">
            {PAY_ONCE_URL && (
              <li>
                <PayLink href={PAY_ONCE_URL}>Help support VoteStack</PayLink>
              </li>
            )}
            {monthly.map((m) => (
              <li key={m.dollars}>
                <PayLink href={m.url}>Pay ${m.dollars} a month</PayLink>
              </li>
            ))}
          </ul>
        ) : (
          <p>Payments aren&rsquo;t open yet.</p>
        )}
        <p className="text-small italic text-muted">
          VoteStack is published by VoteStack, LLC, a company, not a charity.
          Payments to VoteStack aren&rsquo;t tax-deductible.
        </p>
      </div>

      <Section id="costs" title="What your money pays for">
        <List>
          <li>
            Hosting, email and the database that finds your districts: $
            {HOSTING_PER_MONTH.toFixed(2)} a month.
          </li>
          <li>
            AI research and checks for candidate profiles: $
            {AI_SPENT_SO_FAR.toFixed(2)} so far for{' '}
            {CANDIDATES_COVERED.toLocaleString('en-US')} candidates, or about{' '}
            {Math.round((AI_SPENT_SO_FAR / CANDIDATES_COVERED) * 100)} cents a
            candidate.
          </li>
          <li>
            New areas. Each new county needs its own official data, maps and
            candidate profiles before it can open.
          </li>
        </List>
        <p>
          Once a year, we&rsquo;ll publish how much came in and what it paid
          for.
        </p>
      </Section>

      <Section id="rules" title="Money we don&rsquo;t take">
        <p>
          We don&rsquo;t take money from candidates, officeholders, campaigns,
          political parties, political action committees (PACs) or other
          political committees, or from any government. If we get a payment from
          one, we refund it.
        </p>
        <p>
          Paying doesn&rsquo;t change how any candidate, race or measure
          appears. People who pay don&rsquo;t see profiles early and can&rsquo;t
          review or change them. Every candidate gets the same research and the
          same rules (see{' '}
          <Link to={`${ABOUT_PATH}#fair`}>How we stay fair</Link>).
        </p>
      </Section>

      <Section id="help" title="Other ways to help">
        <List>
          <li>
            Report an error. Every candidate profile has a &ldquo;Report an
            error&rdquo; link.
          </li>
          <li>
            Tell someone in Cook County or Los Angeles County that VoteStack
            exists.
          </li>
          <li>
            If you live somewhere else,{' '}
            <Link to={NOTIFY_PATH}>
              get an email when VoteStack covers your area
            </Link>
            . It tells us where to go next.
          </li>
          <li>
            Improve the code. VoteStack is open source{' '}
            <a
              href="https://github.com/nikolai-laba/votestack"
              target="_blank"
              rel="noreferrer"
            >
              on GitHub
            </a>
            .
          </li>
        </List>
      </Section>
    </article>
  )
}
