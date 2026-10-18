import { useEffect, type ReactNode } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router'
import {
  BALLOT_ORDER_ID,
  NOTIFY_PATH,
  SAVED_CHOICES_PATH,
  type BallotOutletContext,
} from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { LAST_CHECKED } from '../data/lastChecked.ts'
import { longDate } from '../format.ts'
import type { Ballot } from '../shared/ballot.ts'
import { ABOUT_HEAD, useDocumentHead } from '../head.ts'

// What VoteStack is, where its information comes from and when it was
// checked. The site footer links here, including to the ballot order
// explainer (#ballot-order). Keep the data sources for each area VoteStack
// covers in step with data/README.md and the methods summary in step with HowProfilesPage.

const HEADING_ID = 'about-heading'

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
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-4 space-y-3"
    >
      {/* Focused when a link opens the page at this section. */}
      <h2
        id={`${id}-heading`}
        tabIndex={-1}
        className="text-section focus:outline-none"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

/** The newest date a race on this ballot was checked, if any. */
function racesCheckedOn(ballot: Ballot | undefined): string | undefined {
  const dates = (ballot?.contests ?? [])
    .map((c) => c.lastVerified)
    .filter(Boolean)
    .sort()
  return dates.at(-1)
}

export default function AboutPage() {
  const { ballot } = useOutletContext<BallotOutletContext>()
  const location = useLocation()

  // Start at the section the link named, or at the title.
  useEffect(() => {
    const target = location.hash
      ? document.getElementById(`${location.hash.slice(1)}-heading`)
      : null
    ;(target ?? document.getElementById(HEADING_ID))?.focus()
  }, [location.hash, location.key])

  useDocumentHead(ABOUT_HEAD)

  const racesChecked = racesCheckedOn(ballot)

  return (
    <article className="max-w-[65ch] space-y-8">
      <div className="space-y-4">
        <BackLink hasBallot={Boolean(ballot)} />
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          About VoteStack
        </h1>
      </div>

      <Section id="what" title="What is VoteStack?">
        <p>
          VoteStack shows you every race on your ballot and helps you understand
          the people running. It covers Chicago and suburban Cook County,
          Illinois, and Los Angeles County, California. Over time, VoteStack is
          meant to cover every upcoming election. If you live somewhere else,{' '}
          <Link to={NOTIFY_PATH}>
            get an email when VoteStack covers your area
          </Link>
          .
        </p>
        <p>
          Seeing what&rsquo;s on your ballot is the easy part. Knowing who the
          candidates are is harder, especially for judges and local offices. So
          every candidate and judge covered has a short profile with the same
          three parts:
        </p>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            <strong>Overview:</strong> who they are, their record and their
            positions. Judges aren&rsquo;t allowed to state positions on issues,
            so theirs cover their experience and work on the bench.
          </li>
          <li>
            <strong>Campaign money:</strong> how much they raised and where it
            came from, from official filings.
          </li>
          <li>
            <strong>Endorsements:</strong> groups and officials that back them,
            and bar association ratings for judges.
          </li>
        </ul>
        <p>Every sentence links to its source, so you can check it.</p>
        <p>
          VoteStack doesn&rsquo;t support or oppose any candidate, party,
          referendum or measure. It isn&rsquo;t a government site. We
          don&rsquo;t tell you how to vote.
        </p>
      </Section>

      <Section id="who" title="Who makes VoteStack">
        <p>
          I&rsquo;m Nikolai Laba, a voter living in Oak Park (Cook County), IL,
          trying to build a way to help voters understand their ballot. I wanted
          one place to see everything on my ballot, explained plainly, with a
          source for every fact. VoteStack is the tool I wanted.
        </p>
        <p>
          VoteStack is paid for by its maintainer. It takes no money from
          candidates, parties or campaigns.
        </p>
        <p>
          If you&rsquo;d like to get in touch regarding the project, please
          reach out to{' '}
          <a href="mailto:nikolai@votestack.org">Nikolai@VoteStack.org</a>.
        </p>
      </Section>

      <Section id="fair" title="How we stay fair">
        <p>We follow the same rules for every candidate and every race.</p>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            Candidates are listed in{' '}
            <Link to={`#${BALLOT_ORDER_ID}`}>official ballot order</Link>. We
            never change it.
          </li>
          <li>
            Every candidate in a race gets the same research, the same parts and
            the same length limit.
          </li>
          <li>
            Profiles for a race appear only when every candidate in it passes
            our checks.
          </li>
          <li>We never feature, rank or recommend a candidate.</li>
          <li>Party is shown as text, never as a color.</li>
          <li>We take no money from candidates, parties or campaigns.</li>
        </ul>
        <p>
          <Link to="/how-profiles-are-made">How we make profiles</Link> explains
          the research and the checks in detail.
        </p>
      </Section>

      <Section id="sources" title="Where ballot information comes from">
        <p>
          Election officials decide what is on your ballot. We use the lists
          they publish.
        </p>
        <h3 className="text-label font-semibold">Cook County, Illinois</h3>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            For suburban Cook County, the Cook County Clerk&rsquo;s lists of
            races, candidates and referenda. The Clerk&rsquo;s sample ballots
            tell us which races each precinct gets.
          </li>
          <li>
            For Chicago, the Chicago Board of Election Commissioners&rsquo; list
            of candidates and referenda. The Board doesn&rsquo;t publish a
            sample ballot for each precinct, so we check Chicago districts
            against the Board&rsquo;s precinct lists.
          </li>
          <li>
            To find your districts, we match your address to Cook County&rsquo;s
            address records and to official maps from Cook County, the City of
            Chicago and the State of Illinois.
          </li>
        </ul>
        <p>
          We compare our ballots with the Clerk&rsquo;s sample ballots to find
          mistakes. When a race may be missing or may not be on your ballot,
          your ballot says so and links to your official sample ballot.
        </p>
        <h3 className="text-label font-semibold">
          Los Angeles County, California
        </h3>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            The Los Angeles County Registrar-Recorder/County Clerk&rsquo;s
            Interactive Sample Ballot data, from{' '}
            <a href="https://isb.lavote.gov/" target="_blank" rel="noreferrer">
              isb.lavote.gov
            </a>
            . It lists the races, candidates and measures on each ballot style,
            in ballot order, and which ballot style each precinct gets. Your
            ballot shows every race on your precinct&rsquo;s ballot style.
          </li>
          <li>
            To find your precinct, we match your address to Los Angeles
            County&rsquo;s address points (CAMS, from the County&rsquo;s
            Enterprise GIS program) and to the Registrar&rsquo;s map of
            precincts with district names. The County&rsquo;s terms let anyone
            copy and adapt its address data. The County doesn&rsquo;t endorse
            VoteStack.
          </li>
        </ul>
        <p>
          We check the precinct we find for an address against the street lists
          in the Registrar&rsquo;s sample ballot data.
        </p>
        <p>
          We mark a candidate as the incumbent only when an official list
          confirms they hold the seat.
        </p>
      </Section>

      <Section id="last-checked" title="When we last checked">
        <p>
          We last checked candidate information on{' '}
          <span className="font-semibold">{longDate(LAST_CHECKED)}</span>. Each
          profile shows the date it was updated.
        </p>
        {racesChecked && (
          <p>
            The races on your ballot were last checked against the official
            lists on {longDate(racesChecked)}.
          </p>
        )}
        <p>
          Races and candidates can change before Election Day. Always confirm
          your ballot with your election authority.
        </p>
      </Section>

      <Section id="profiles" title="How we make profiles">
        <p>
          An AI model writes each profile from public sources, such as news
          stories and official records. A second AI model checks every sentence
          against its source, and software checks every profile before it
          appears. Every sentence links to its source, so you can check it.
        </p>
        <p>
          <Link
            to="/how-profiles-are-made"
            className="inline-flex min-h-11 items-center"
          >
            How we make profiles
          </Link>
        </p>
      </Section>

      <Section id={BALLOT_ORDER_ID} title="Official ballot order">
        <p>
          Candidates are listed in the order they appear on your official
          ballot. Illinois election law sets that order. Election authorities
          hold public lotteries to decide which party&rsquo;s candidates are
          listed first. Candidates who file at the same time are also ordered by
          lottery. VoteStack never changes the order.
        </p>
        <p>
          For Los Angeles County ballots, California law sets the order. The
          California Secretary of State draws a random order of the letters of
          the alphabet, and names are listed in that order. For some offices,
          the order changes from one Assembly district to the next. We show the
          order from the Registrar&rsquo;s sample ballot for your ballot style.
        </p>
        <p>
          The Los Angeles County ballot lists city and local races first and
          state races last. California law allows this order only in Los Angeles
          County. Your ballot on VoteStack starts out grouped by level of
          government. You can switch it to the paper ballot order.
        </p>
      </Section>

      <Section id="privacy" title="Your privacy">
        <p>
          We use your address once to find your districts. It isn&rsquo;t saved,
          logged or added to the page link.
        </p>
        <p>
          The names you pick, listed under{' '}
          <Link to={SAVED_CHOICES_PATH}>Saved choices</Link>, stay on this
          device. We never see them.
        </p>
        <p>
          To learn what helps voters, we count how VoteStack is used: which
          pages are opened, how many ballots are looked up, how many races get a
          pick and how long the site is open. We keep only totals, by page,
          level of government and county. We never count your address, your IP
          address or the names you pick, and nothing tells one visitor apart
          from another. Your device keeps a short note so it&rsquo;s counted
          once per election. Cloudflare, which hosts VoteStack, also counts
          visits without cookies.
        </p>
        <p>
          If you sign up for an email when VoteStack covers your area, we save
          your email address and ZIP code. We use them only for that email and
          to count where people are asking from, and we never share them. To
          have them deleted, email{' '}
          <a href="mailto:nikolai@votestack.org">nikolai@votestack.org</a>.
        </p>
      </Section>

      <Section id="open-source" title="Open source">
        <p>
          VoteStack&rsquo;s code is open source under the{' '}
          <a
            href="https://www.apache.org/licenses/LICENSE-2.0"
            target="_blank"
            rel="noreferrer"
          >
            Apache License 2.0
          </a>
          . You can read it{' '}
          <a
            href="https://github.com/nikolai-laba/votestack"
            target="_blank"
            rel="noreferrer"
          >
            on GitHub
          </a>
          . The election data we use keeps its publishers&rsquo; own terms.
        </p>
      </Section>

      <Section id="report" title="Report an error">
        <p>
          Every candidate profile has a &ldquo;Report an error&rdquo; link. Use
          it to tell us what is wrong, with a link to a page that shows the
          correct information.
        </p>
        <p>
          We check every report against the profile&rsquo;s sources and official
          records. If the profile is wrong, we correct it. We can&rsquo;t reply
          to you, because the form doesn&rsquo;t ask how to reach you.
        </p>
      </Section>
    </article>
  )
}
