import { useEffect, type ReactNode } from 'react'
import { useOutletContext } from 'react-router'
import type { BallotOutletContext } from '../ballot/profileLinks.ts'
import { BackLink } from '../components/profile/BackLink.tsx'
import { money } from '../format.ts'
import {
  OVERVIEW_PARAGRAPH_LIMITS,
  OVERVIEW_WORD_LIMITS,
  MONEY_SHARES_MIN_RAISED,
} from '../shared/profile.ts'
import { HOW_PROFILES_HEAD, useDocumentHead } from '../head.ts'

// The methods page for candidate profiles, linked from every
// profile's disclosure. It describes what the pipeline in scripts/profiles/
// actually does; when a check, a source rule or a limit changes there, change
// this page in the same commit (and the README's summary).

/** How old a source may be before it must be read again (MAX_SOURCE_AGE_DAYS in scripts/lib/profiles/race-checks.ts). */
const MAX_SOURCE_AGE_DAYS = 30

const HEADING_ID = 'methods-heading'

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

export function HowProfilesPage() {
  const { ballot } = useOutletContext<BallotOutletContext>()

  // Start keyboard and screen reader users at the top of what changed.
  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [])

  useDocumentHead(HOW_PROFILES_HEAD)

  const words = OVERVIEW_WORD_LIMITS
  const paragraphs = OVERVIEW_PARAGRAPH_LIMITS

  return (
    <article className="max-w-[65ch] space-y-8">
      <div className="space-y-4">
        <BackLink hasBallot={Boolean(ballot)} />
        <h1
          id={HEADING_ID}
          tabIndex={-1}
          className="text-title focus:outline-none lg:text-title-lg"
        >
          How we make profiles
        </h1>
        <p>
          VoteStack has a short profile for each candidate and judge on your
          ballot. This page explains how we make them and what we can&rsquo;t
          check. VoteStack doesn&rsquo;t tell you how to vote.
        </p>
      </div>

      <Section id="summary" title="In short">
        <List>
          <li>
            An AI model, the kind of AI that writes text, writes each profile
            from public sources.
          </li>
          <li>A second AI model checks each sentence against its source.</li>
          <li>
            Software checks every profile before it appears, including its
            sources, links, dates and length.
          </li>
          <li>
            Every sentence links to its source, so you can check it yourself.
          </li>
        </List>
        <p>The rest of this page explains each step in detail.</p>
      </Section>

      <Section id="contents" title="What a profile contains">
        <p>Every profile has the same four parts, in the same order.</p>
        <List>
          <li>
            The overview says who the person is, their main positions, their
            record and their main work. Judges may not announce views on issues,
            so a judge&rsquo;s overview covers their legal background and time
            on the bench instead of positions.
          </li>
          <li>
            Campaign money shows totals from official campaign finance reports.
            See &ldquo;Campaign money&rdquo; below.
          </li>
          <li>
            Endorsements lists the organizations and elected officials that
            endorsed the candidate, each with a link to a page that shows it.
            For judges, this part also shows each bar association&rsquo;s
            rating, word for word.
          </li>
          <li>
            Sources is a numbered list of every page the profile uses, with the
            date we read it. The small numbers in the text point to this list.
          </li>
        </List>
        <p>The length of the overview depends on the race:</p>
        <List>
          <li>
            Top of the ballot, such as governor or U.S. Senate: up to{' '}
            {words.top} words in {paragraphs.top} paragraphs or fewer.
          </li>
          <li>
            Legislature, county board, Board of Review, Water Reclamation
            District and school board: up to {words.mid} words in{' '}
            {paragraphs.mid} paragraphs or fewer.
          </li>
          <li>
            Judges and small local offices: up to {words.short} words in one
            paragraph.
          </li>
        </List>
        <p>
          When we find nothing for a part, it says &ldquo;Not found in public
          sources&rdquo; with the date we looked. We never hide a part.
        </p>
      </Section>

      <Section id="sources" title="Where the information comes from">
        <p>
          Profiles use news organizations, the candidate&rsquo;s own website,
          Wikipedia and Ballotpedia, official sources such as government and
          court websites, bar associations, and the endorsers&rsquo; own
          announcements. We don&rsquo;t use social media or material from a
          candidate&rsquo;s opponents.
        </p>
        <p>
          Profiles never include home addresses, phone numbers, email addresses,
          family members, birth dates or ages, or allegations that weren&rsquo;t
          proven in court. Overviews leave out polls, past races, opponents and
          trivia. When a claim comes only from the campaign, the profile says
          so, for example &ldquo;Her campaign says she supports&hellip;&rdquo;.
        </p>
      </Section>

      <Section id="writing" title="How a profile is written">
        <p>
          Two AI models write each profile in steps. No person reviews each
          profile before it appears.
        </p>
        <ol className="list-decimal space-y-2 ps-6">
          <li>
            Each kind of office has its own search plan. Everyone in the same
            race gets the same plan.
          </li>
          <li>
            One AI model, DeepSeek V4 Pro, writes a draft from those search
            results. Each sentence cites one source, and that source must say
            everything in the sentence.
          </li>
          <li>
            A second AI model, Google Gemini 3.1 Pro, opens every page the draft
            cites. It keeps or corrects each sentence, and removes anything it
            can&rsquo;t confirm. It also finds endorsements and confirms each
            one on a page it opened.
          </li>
          <li>
            Software adds campaign money and bar ratings from official lists.
            Then it checks that every paragraph and endorsement cites a source,
            every link opens without a login or paywall, no source is social
            media, every source was read in the last {MAX_SOURCE_AGE_DAYS} days,
            the wording is neutral, the length fits the limit and no personal
            details appear.
          </li>
        </ol>
      </Section>

      <Section id="limits" title="What we can’t promise">
        <p>
          AI models can still make mistakes. A model can misread a page or miss
          newer news, and software can&rsquo;t tell whether a page really says
          what the sentence says. Every sentence links to its source, so you can
          check it yourself.
        </p>
      </Section>

      <Section id="equal" title="Equal treatment">
        <p>
          Everyone in a race gets the same parts, the same research and the same
          length limit. Some candidates have less public information, so their
          profiles are shorter. We never shorten one profile to match another.
        </p>
        <p>
          A race appears only when every candidate in it passes the checks.
          Until then, every candidate in that race shows &ldquo;No profile
          yet&rdquo;. A judge up for retention has no opponents, so their
          profile appears once it passes.
        </p>
        <p>
          There are no photos, and no candidate is featured, ranked or
          recommended.
        </p>
      </Section>

      <Section id="endorsements" title="Endorsements and bar ratings">
        <p>
          Endorsements come from organizations, such as unions, advocacy groups,
          parties and newspaper editorial boards, and from people who hold or
          held elected office. Each one is for this candidate in this race and
          links to a page that shows it.
        </p>
        <p>
          Bar association ratings of judges come from the lists the groups
          publish. AI doesn&rsquo;t write them. When a group published nothing
          for a judge, the profile says &ldquo;No rating published&rdquo;.
        </p>
      </Section>

      <Section id="money" title="Campaign money">
        <p>
          Campaign money comes from official reports: the Federal Election
          Commission (FEC) for U.S. Senate and House, and the Illinois State
          Board of Elections (ISBE) for all other races. AI doesn&rsquo;t write
          this part.
        </p>
        <p>
          Each profile shows how much the campaign raised, its cash on hand and
          the kinds of sources the money came from. We never name donors. We
          show percentages only when a committee raised at least{' '}
          {money(MONEY_SHARES_MIN_RAISED)} in the period, because below that one
          or two gifts decide the shares.
        </p>
        <p>
          Each profile shows the period its numbers cover and links to the
          filings. We update the numbers when new reports come in.
        </p>
      </Section>

      <Section id="errors" title="Report an error">
        <p>
          Use the &ldquo;Report an error&rdquo; link near the top of a profile.
          The form asks what is wrong and for a link to a page that shows the
          correct information. We change a profile only when a source shows
          it&rsquo;s wrong.
        </p>
        <p>
          We read every report. If the profile is wrong, a person corrects it
          and the correction cites its own source. We can&rsquo;t reply, because
          the form doesn&rsquo;t ask how to reach you. It saves only what you
          write and which profile it&rsquo;s about. It doesn&rsquo;t save your
          name, email, IP address or street address.
        </p>
        <p>
          We research every profile again at least every {MAX_SOURCE_AGE_DAYS}{' '}
          days.
        </p>
      </Section>
    </article>
  )
}
