import { useEffect, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router'
import { ABOUT_PATH, type BallotOutletContext } from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { CANDIDATES_COVERED } from './SupportPage.tsx'
import { PRESS_HEAD, useDocumentHead } from '../head.ts'

// A public press kit: a fact sheet, reporter FAQ, ready-to-paste blurbs,
// logos and contact for interviews. Mirrors the private media-kit.md
// (workspace repo) so reporters can read the same content without a
// relationship. Linked from the footer and from the email signature on
// newsroom outreach.

const HEADING_ID = 'press-heading'

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

function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="font-semibold text-text">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Question({
  question,
  children,
}: {
  question: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-label font-semibold">{question}</h3>
      {children}
    </div>
  )
}

function Blurb({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-s-4 border-line ps-4">{children}</blockquote>
  )
}

export function PressPage() {
  const { ballot } = useOutletContext<BallotOutletContext>()

  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  useDocumentHead(PRESS_HEAD)

  return (
    <article className="max-w-[65ch] space-y-8">
      <div className="space-y-4">
        <BackLink hasBallot={Boolean(ballot)} />
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          Press &amp; media
        </h1>
        <p>
          VoteStack is a free, nonpartisan guide to every race on a
          voter&rsquo;s ballot in Chicago and suburban Cook County, Illinois,
          and Los Angeles County, California, for the Tuesday, November 3, 2026
          general election. This page is for reporters and editors: a fact
          sheet, a reporter FAQ, ready-to-use blurbs, logos and contact for
          interviews.
        </p>
        <p>
          For general information about the project, see{' '}
          <Link to={ABOUT_PATH}>About VoteStack</Link>.
        </p>
      </div>

      <Section id="facts" title="Fact sheet">
        <dl className="border-b border-line">
          <FactRow label="What">
            A free website that shows every race on a voter&rsquo;s ballot, with
            a short profile of each candidate and judge.
          </FactRow>
          <FactRow label="Where">
            Chicago and suburban Cook County, Illinois, and Los Angeles County,
            California.
          </FactRow>
          <FactRow label="Election">Tuesday, November 3, 2026.</FactRow>
          <FactRow label="Candidates profiled">
            {CANDIDATES_COVERED.toLocaleString('en-US')} across the counties
            VoteStack covers, including judges and small local offices.
          </FactRow>
          <FactRow label="Coverage launched">
            Chicago and suburban Cook County, Illinois (338 candidates) on
            October 11, 2026; Los Angeles County, California (838 candidates) on
            October 17, 2026.
          </FactRow>
          <FactRow label="Each profile">
            Overview, endorsements (bar association ratings for judges),
            campaign money where official filings are available, and numbered
            sources with the date read.
          </FactRow>
          <FactRow label="AI models">
            DeepSeek V4 Pro drafts each profile from public sources. Google
            Gemini 3.1 Pro checks every sentence against its cited source.
          </FactRow>
          <FactRow label="Human review">
            Not per profile, so VoteStack can cover every race. Every sentence
            links to its source instead, and anyone can report an error from a
            profile.
          </FactRow>
          <FactRow label="Ballot data">
            The Cook County Clerk, the Chicago Board of Election Commissioners,
            and the Los Angeles County Registrar-Recorder/County Clerk, checked
            against each authority&rsquo;s sample ballot data.
          </FactRow>
          <FactRow label="Cost to voters">
            Free. No sign-up, no ads, no paywall.
          </FactRow>
          <FactRow label="Funding">
            Paid for by its maintainer and by voters who choose to pay toward
            it. No money from candidates, parties, campaigns, political action
            committees or governments.
          </FactRow>
          <FactRow label="Code">
            Open source under the Apache License 2.0.{' '}
            <a
              href="https://github.com/nikolai-laba/votestack"
              target="_blank"
              rel="noreferrer"
            >
              github.com/nikolai-laba/votestack
            </a>
          </FactRow>
          <FactRow label="Publisher">
            VoteStack, LLC (a company, not a charity or a government agency).
          </FactRow>
          <FactRow label="Who">
            Nikolai Laba, Oak Park, Illinois.{' '}
            <a href="mailto:nikolai@votestack.org">nikolai@votestack.org</a>
          </FactRow>
          <FactRow label="Email updates">
            Voters can sign up for email about new elections and areas at{' '}
            <Link to="/notify">votestack.org/notify</Link>.
          </FactRow>
        </dl>
      </Section>

      <Section id="faq" title="Reporter FAQ">
        <Question question="Why build this?">
          <p>
            When I researched my own ballot, I had a dozen tabs open and still
            wasn&rsquo;t sure about half the races. Judges and local offices are
            the hardest part. I wanted one place with all of it, explained
            plainly, with a source for every fact.
          </p>
        </Question>
        <Question question="Doesn&rsquo;t AI make things up?">
          <p>
            It can, which is why the method is built around sources. The writing
            model has to cite one source for each sentence, and that source has
            to say everything in the sentence. A second model opens every cited
            page and keeps, corrects or removes each sentence. Software then
            checks links, dates and length before a profile appears. Mistakes
            can still get through, so every sentence links to its source, and
            anyone can report an error from the profile.
          </p>
          <p>
            <Link to="/how-profiles-are-made">How we make profiles</Link>{' '}
            explains the research and the checks in detail.
          </p>
        </Question>
        <Question question="Did a person read every profile?">
          <p>
            Not one by one. Reviewing every profile by hand would limit
            VoteStack to a few races in a few places. Instead, it&rsquo;s built
            to be checked: every sentence links to its source, software checks
            every link and date, and anyone can report an error from the
            profile. Each profile says plainly that a person didn&rsquo;t review
            it.
          </p>
        </Question>
        <Question question="How is this different from asking a chatbot?">
          <p>
            Nothing is generated when you ask. Profiles are written once,
            checked, and published with their sources. The list of races comes
            from the election authorities and is compared with each
            authority&rsquo;s sample ballot data, not from a model.
          </p>
        </Question>
        <Question question="Is it partisan?">
          <p>
            VoteStack doesn&rsquo;t support or oppose any candidate, party or
            referendum, and the rules make that checkable:
          </p>
          <ul className="list-disc space-y-2 ps-6">
            <li>Candidates appear in official ballot order.</li>
            <li>
              Everyone in a race gets the same research and the same length
              limit.
            </li>
            <li>No candidate is featured or ranked.</li>
            <li>Party is shown as text, not color.</li>
            <li>VoteStack takes no campaign money.</li>
          </ul>
        </Question>
        <Question question="Who pays for it?">
          <p>
            Its maintainer, and voters who choose to pay toward it. It takes no
            money from candidates, parties or campaigns.
          </p>
        </Question>
        <Question question="What about the energy and cost of AI?">
          <p>
            Each profile is written once per election, not each time someone
            visits.
          </p>
        </Question>
        <Question question="What do you collect about visitors?">
          <p>
            VoteStack uses your address once to find your districts. It
            isn&rsquo;t saved, logged or added to the page link. The names you
            pick under Saved choices stay on your device. Sign-ups for new areas
            store only an email address and ZIP code.
          </p>
        </Question>
        <Question question="How does Los Angeles County coverage differ from Cook County?">
          <p>
            Methodology is identical. Los Angeles County has 838 candidates
            profiled across every race on the ballot; Cook County has 338. Cook
            includes a judicial-retention block (voters say yes or no to keep
            sitting judges); Los Angeles doesn&rsquo;t have that structure.
            Everything else (ballot data sourced from the election authorities,
            per-sentence citations, bar association ratings for judges, campaign
            money from official filings) works the same way in both counties.
          </p>
        </Question>
        <Question question="Is a Spanish version available?">
          <p>
            Not yet. VoteStack is English-only through the November 3, 2026
            election. Spanish support is in development and will be a priority
            for upcoming elections.
          </p>
        </Question>
        <Question question="What&rsquo;s next?">
          <p>
            Covering more places. People elsewhere can sign up at{' '}
            <Link to="/notify">votestack.org/notify</Link>.
          </p>
        </Question>
      </Section>

      <Section id="blurbs" title="Ready-to-use copy">
        <p>
          Paste any of these into a story, newsletter or resource page. No
          attribution required.
        </p>
        <h3 className="text-label font-semibold">One line</h3>
        <Blurb>
          VoteStack (votestack.org): a short, sourced profile of every candidate
          on your Chicago, suburban Cook County, or Los Angeles County ballot,
          including the judges, school board seats and other local races that
          get little coverage anywhere else. Free, nonpartisan and open source.
        </Blurb>
        <h3 className="text-label font-semibold">50 words</h3>
        <Blurb>
          Local races (judges, school board, state legislature) often come with
          little for a careful voter to go on. VoteStack is a free site that
          gives every candidate on your Chicago, suburban Cook County, or Los
          Angeles County ballot a short, sourced profile: their record,
          endorsements and, where filings are available, campaign money. Enter
          your address for Tuesday, November 3. votestack.org
        </Blurb>
        <h3 className="text-label font-semibold">100 words</h3>
        <Blurb>
          Judges. School board. State legislature. Water reclamation. The races
          below the top of the ballot are where even careful voters often find
          little to go on. VoteStack is a free site that gives every candidate
          on your Chicago, suburban Cook County, or Los Angeles County ballot a
          short, sourced profile: their record and endorsements, with bar
          association ratings for judges and campaign money where filings are
          available. AI drafts each profile from public sources and a second AI
          checks every sentence against its source, so you can click through and
          read it yourself. VoteStack takes no money from candidates, parties or
          campaigns. For Tuesday, November 3. votestack.org
        </Blurb>
        <h3 className="text-label font-semibold">Social post</h3>
        <Blurb>
          Who&rsquo;s running for your school board, judgeships and the other
          local races on your ballot? VoteStack gives every candidate on your
          Chicago, suburban Cook County or Los Angeles County ballot a short,
          sourced profile. Free and nonpartisan: votestack.org
        </Blurb>
      </Section>

      <Section id="logos" title="Logos">
        <p>
          Right-click or long-press each image to save, or copy the URL. Please
          don&rsquo;t alter the logos.
        </p>
        <ul className="list-disc space-y-2 ps-6">
          <li>
            <a
              href="/brand/votestack-wordmark.png"
              target="_blank"
              rel="noreferrer"
            >
              Wordmark, light background (PNG, 506&times;84)
            </a>
          </li>
          <li>
            <a
              href="/brand/votestack-wordmark-dark.png"
              target="_blank"
              rel="noreferrer"
            >
              Wordmark, dark background (PNG, 506&times;84)
            </a>
          </li>
          <li>
            <a
              href="/brand/votestack-mark-512.png"
              target="_blank"
              rel="noreferrer"
            >
              Mark only (PNG, 512&times;512)
            </a>
          </li>
          <li>
            <a
              href="/brand/votestack-share.png"
              target="_blank"
              rel="noreferrer"
            >
              Share image (PNG, 1200&times;630)
            </a>
          </li>
        </ul>
      </Section>

      <Section id="contact" title="Contact and interviews">
        <p>
          Nikolai Laba, VoteStack&rsquo;s maintainer, is available for
          interviews and can walk through a profile from source to published
          page. Email{' '}
          <a href="mailto:nikolai@votestack.org">nikolai@votestack.org</a>.
        </p>
      </Section>
    </article>
  )
}
