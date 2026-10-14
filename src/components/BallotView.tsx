import { useEffect, useState } from 'react'
import { Link, useMatch } from 'react-router'
import {
  contestsWithPerson,
  profilePath,
  raceAnchorId,
  type ProfileLinkState,
} from '../ballot/profileLinks.ts'
import { useBallotOrder } from '../ballot/orderPreference.ts'
import { sectionsFor, type Section } from '../ballot/sections.ts'
import type {
  Ballot,
  CandidateContest,
  Contest,
  Coverage,
  MeasureContest,
  RetentionContest,
} from '../shared/ballot.ts'
import { longDate, webUrl } from '../format.ts'
import { SampleModeContext, useSampleMode } from '../picks/sampleMode.ts'
import { useBallotStore, type Picks } from '../picks/store.ts'
import { choicesFor, swapText } from '../picks/summary.ts'
import { partyLine, profileKey } from '../shared/profile.ts'
import { BallotOrderToggle } from './BallotOrderToggle.tsx'
import { ChevronDownIcon, WarningIcon } from './icons.tsx'
import {
  PickBox,
  PickNotices,
  SwapAnnouncement,
  YesNo,
} from './picks/PickControls.tsx'
import { BackLink } from './profile/BackLink.tsx'

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** "26 races, 60 judges up for retention and 2 referenda" */
export function raceCountText(contests: Contest[]): string {
  const count = (kind: Contest['kind']) =>
    contests.filter((c) => c.kind === kind).length
  const parts = [
    plural(count('candidate'), 'race', 'races'),
    count('retention') &&
      `${plural(count('retention'), 'judge', 'judges')} up for retention`,
    count('measure') && plural(count('measure'), 'referendum', 'referenda'),
  ].filter((p): p is string => Boolean(p))
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
    : parts[0]
}

/** The ballot's title, focused when a lookup finishes (HomePage). */
export const BALLOT_HEADING_ID = 'ballot-heading'

export function BallotView({
  ballot,
  titleElsewhere = false,
}: {
  ballot: Ballot
  /**
   * Another part of the page holds the h1: a profile beside the list, or the
   * address form while the voter changes the address.
   */
  titleElsewhere?: boolean
}) {
  const [order] = useBallotOrder()
  const sections = sectionsFor(ballot.contests, order)
  const current = useCurrentSection(sections)
  const published = new Set(ballot.publishedProfiles ?? [])
  const Title = titleElsewhere ? 'h2' : 'h1'
  const { picks } = useBallotStore()
  // A sample ballot (HomePage) can't be picked on.
  const sample = useSampleMode()

  return (
    <article aria-labelledby={BALLOT_HEADING_ID} className="space-y-6">
      <header className="space-y-2">
        {/* Focused when the ballot arrives, so it isn't an interactive target. */}
        <Title
          id={BALLOT_HEADING_ID}
          tabIndex={-1}
          className={`focus:outline-none ${titleElsewhere ? 'text-title' : 'text-title lg:text-title-lg'}`}
        >
          {ballot.election.name}
        </Title>
        <ElectionDetails ballot={ballot} />
      </header>

      <p className="text-section font-heading font-semibold">
        {sample
          ? `This ballot has ${raceCountText(ballot.contests)}.`
          : `You have ${raceCountText(ballot.contests)} on your ballot.`}
      </p>

      <CoverageNotice coverage={ballot.coverage} />

      {ballot.contests.length > 0 && !sample && (
        <div className="space-y-3">
          <p className="max-w-[65ch]">
            To make a list to take with you, check the box next to a name or
            choose Yes or No. Your picks are saved only on this device.
          </p>
          <PickNotices />
        </div>
      )}

      <BallotOrderToggle contests={ballot.contests} />

      {sections.length > 1 && (
        <nav
          aria-label="Ballot sections"
          className="-mx-4 overflow-x-auto px-4"
        >
          <ul className="flex gap-2 pb-1">
            {sections.map((s) => (
              <li key={s.id} className="flex min-h-11 shrink-0 items-center">
                <a
                  href={`#section-${s.id}`}
                  aria-current={current === s.id ? 'true' : undefined}
                  className={`inline-flex min-h-10 items-center rounded-full border px-4 text-small font-semibold no-underline transition-colors duration-150 ${
                    current === s.id
                      ? // Forced colours drop the fill, so underline instead.
                        'border-transparent bg-highlight text-on-highlight forced-colors:underline'
                      : 'border-field bg-surface text-text'
                  }`}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {sections.map((section) =>
        section.id === 'retention' ? (
          <RetentionPanel
            key={section.id}
            section={section}
            published={published}
            picks={picks}
          />
        ) : (
          <section
            key={section.id}
            id={`section-${section.id}`}
            aria-labelledby={`section-${section.id}-heading`}
            className="scroll-mt-4 space-y-4"
          >
            <h2 id={`section-${section.id}-heading`} className="text-section">
              {section.title}
            </h2>
            <ul className="space-y-4">
              {section.contests.map((contest) => (
                <li key={contest.id}>
                  {contest.kind === 'candidate' && (
                    <CandidateRace
                      contest={contest}
                      published={published}
                      picks={picks}
                    />
                  )}
                  {contest.kind === 'measure' && (
                    <Measure contest={contest} picks={picks} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {ballot.contests.length === 0 && (
        <p>No races found for this address yet.</p>
      )}
    </article>
  )
}

/** Election day (and the precinct, after a lookup) under the election's name. */
function ElectionDetails({ ballot }: { ballot: Ballot }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-small">
      <dt className="text-muted">Election day</dt>
      <dd>{longDate(ballot.election.date)}</dd>
      {ballot.precinct && (
        <>
          <dt className="text-muted">Precinct</dt>
          <dd>{ballot.precinct.name}</dd>
        </>
      )}
    </dl>
  )
}

/**
 * The ballot's election block above a candidate's profile, styled as on the
 * ballot (with a profile beside it). Not a heading: the candidate's name is
 * the page's h1.
 */
export function ElectionHeader({ ballot }: { ballot: Ballot }) {
  return (
    <div className="space-y-2">
      <p className="font-heading text-title font-semibold text-balance">
        {ballot.election.name}
      </p>
      <ElectionDetails ballot={ballot} />
    </div>
  )
}

/** Element ids in the race panel start with this, so none repeat the list's. */
const PANEL_PREFIX = 'panel-'

/**
 * Beside a candidate's profile on wide screens, and at its top on narrow
 * ones: only the race(s) this person is in on the voter's ballot, with the
 * same cards, rows and pick boxes as the list, and the way back to the whole
 * ballot first.
 */
export function PersonRaces({
  ballot,
  personKey,
}: {
  ballot: Ballot
  personKey: string
}) {
  const contests = contestsWithPerson(ballot.contests, personKey)
  const published = new Set(ballot.publishedProfiles ?? [])
  const { picks } = useBallotStore()
  const sample = useSampleMode()
  return (
    <section aria-labelledby="race-panel-heading" className="space-y-4">
      <BackLink hasBallot />
      <h2 id="race-panel-heading" className="sr-only">
        {sample ? 'On this sample ballot' : 'On your ballot'}
      </h2>
      <ul className="space-y-4">
        {contests.map((contest) => (
          <li key={contest.id}>
            {contest.kind === 'candidate' && (
              <CandidateRace
                contest={contest}
                published={published}
                picks={picks}
                idPrefix={PANEL_PREFIX}
              />
            )}
            {contest.kind === 'retention' && (
              <RetentionCard
                judge={contest}
                published={published}
                picks={picks}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Element ids in a race card start with this, so none repeat a ballot's. */
const CARD_PREFIX = 'card-'

/**
 * A race on its own page, or under a profile opened without a ballot: the
 * ballot's own card and rows, in ballot order, with no pick boxes (picks
 * belong to the voter's own ballot, looked up by address).
 */
export function RaceCard({
  contest,
  published,
}: {
  contest: CandidateContest | RetentionContest
  published: Set<string>
}) {
  const picks: Picks = {}
  return (
    // Shown like a sample: no pick controls.
    <SampleModeContext.Provider value>
      {contest.kind === 'candidate' ? (
        <CandidateRace
          contest={contest}
          published={published}
          picks={picks}
          idPrefix={CARD_PREFIX}
          fromBallot={false}
        />
      ) : (
        <RetentionCard
          judge={contest}
          published={published}
          picks={picks}
          idPrefix={CARD_PREFIX}
          fromBallot={false}
        />
      )}
    </SampleModeContext.Provider>
  )
}

/** One judge up for retention, as a card of its own (the race panel). */
function RetentionCard({
  judge,
  published,
  picks,
  idPrefix = PANEL_PREFIX,
  fromBallot = true,
}: {
  judge: RetentionContest
  published: Set<string>
  picks: Picks
  idPrefix?: string
  fromBallot?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <ContestBand title="Judicial retention" />
      <p className="max-w-[65ch] border-b border-line px-4 py-3 text-small">
        Vote yes or no on keeping this judge in office.
      </p>
      <RetentionRow
        judge={judge}
        published={published}
        picks={picks}
        idPrefix={idPrefix}
        fromBallot={fromBallot}
      />
    </div>
  )
}

/** The section in view, for the switcher's aria-current. */
function useCurrentSection(sections: Section[]) {
  const [current, setCurrent] = useState(sections[0]?.id)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting)
        if (visible)
          setCurrent(visible.target.id.replace('section-', '') as Section['id'])
      },
      { rootMargin: '0px 0px -70% 0px' },
    )
    for (const s of sections) {
      const el = document.getElementById(`section-${s.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])
  // After switching order the old section may be gone: start at the first.
  return sections.some((s) => s.id === current) ? current : sections[0]?.id
}

/**
 * Shown only when something may be missing or uncertain (a project rule:
 * never hide missing ballot data). A ballot that matched every official list we
 * checked gets no notice.
 */
function CoverageNotice({ coverage }: { coverage: Coverage }) {
  if (coverage.status === 'complete') return null
  return (
    <div className="flex gap-3 rounded-sm border-2 border-warn-line bg-warn-bg p-4 text-warn-fg">
      <WarningIcon />
      <div className="space-y-2 text-small">
        <h2 className="font-sans text-label font-bold">
          Some races may be missing from this list
        </h2>
        {coverage.notes.length > 0 && (
          <ul className="list-disc space-y-1 ps-5">
            {coverage.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {coverage.officialSampleBallotUrl && (
          <p>
            {/* A link on its own line, so it gets a 44px target. */}
            <a
              className="inline-flex min-h-11 items-center text-warn-fg"
              href={webUrl(coverage.officialSampleBallotUrl)}
              target="_blank"
              rel="noreferrer"
            >
              Check your official sample ballot
            </a>
          </p>
        )}
      </div>
    </div>
  )
}

/** The paper-ballot header: office name and how many to vote for. */
function ContestBand({
  title,
  voteFor,
  anchorId,
}: {
  title: string
  voteFor?: number
  /** Focused by a race's "Show on ballot" link on Saved choices. */
  anchorId?: string
}) {
  return (
    <div className="border-b-2 border-text bg-band px-4 py-3">
      <h3 id={anchorId} tabIndex={-1} className="scroll-mt-4 text-race">
        {title}
      </h3>
      {voteFor !== undefined && (
        <p className="text-small">
          {voteFor === 1 ? 'Vote for 1' : `Vote for up to ${voteFor}`}
        </p>
      )}
    </div>
  )
}

function CandidateRace({
  contest,
  published,
  picks,
  idPrefix = '',
  fromBallot = true,
}: {
  contest: CandidateContest
  published: Set<string>
  picks: Picks
  /** Set in the race panel, so its ids don't repeat the list's. */
  idPrefix?: string
  fromBallot?: boolean
}) {
  const candidates = [...contest.candidates].sort(
    (a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0),
  )
  const chosen = choicesFor(picks, contest)
  const sample = useSampleMode()
  // A pick in a full race replaces the earliest one; screen readers hear it.
  const [swapped, setSwapped] = useState<string>()
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <ContestBand
        title={contest.title}
        voteFor={contest.voteFor}
        anchorId={idPrefix ? undefined : raceAnchorId(contest.id)}
      />
      {candidates.length > 0 && <SwapAnnouncement text={swapped} />}
      {candidates.length > 0 ? (
        <ul className="divide-y divide-line">
          {/* Every candidate gets the same row and the same pick box: never
              feature, colour or reorder one. */}
          {candidates.map((candidate) => (
            <li key={candidate.name} className="flex">
              {!sample && (
                <PickBox
                  contest={contest}
                  name={candidate.name}
                  picked={chosen.includes(profileKey(candidate.name))}
                  onResult={(result) =>
                    setSwapped(
                      result.kind === 'picked' && result.replaced
                        ? swapText(
                            contest,
                            profileKey(candidate.name),
                            result.replaced,
                          )
                        : undefined,
                    )
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <CandidateRow
                  name={candidate.name}
                  detail={partyLine(candidate.party, candidate.incumbent)}
                  rowId={`row-${contest.id}-${profileKey(candidate.name)}`}
                  idPrefix={idPrefix}
                  published={published}
                  fromBallot={fromBallot}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-muted">
          No candidates filed for this race.
        </p>
      )}
    </div>
  )
}

function Measure({
  contest,
  picks,
}: {
  contest: MeasureContest
  picks: Picks
}) {
  const sample = useSampleMode()
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <ContestBand title={contest.title} anchorId={raceAnchorId(contest.id)} />
      <div className="max-w-[65ch] space-y-1 px-4 py-3">
        <p className="text-small font-semibold text-muted">
          Official ballot text
        </p>
        <p className="whitespace-pre-line">{contest.question}</p>
      </div>
      {!sample && (
        <div className="px-4 pb-3">
          <YesNo
            contest={contest}
            subject={contest.title}
            choice={choicesFor(picks, contest)[0]}
          />
        </div>
      )}
    </div>
  )
}

function RetentionPanel({
  section,
  published,
  picks,
}: {
  section: Section
  published: Set<string>
  picks: Picks
}) {
  const judges = section.contests.filter(
    (c): c is RetentionContest => c.kind === 'retention',
  )
  return (
    <section
      id={`section-${section.id}`}
      aria-labelledby={`section-${section.id}-heading`}
      className="scroll-mt-4 space-y-4"
    >
      <h2 id={`section-${section.id}-heading`} className="text-section">
        {section.title}
      </h2>
      <details className="group rounded-md border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 text-label font-semibold [&::-webkit-details-marker]:hidden">
          <span>Judges up for retention ({judges.length})</span>
          {/* Native <details> announces expanded or collapsed; this shows it. */}
          <span className="flex shrink-0 items-center gap-1 text-small text-link">
            <span className="underline underline-offset-[3px] group-open:hidden">
              Show
            </span>
            <span className="hidden underline underline-offset-[3px] group-open:inline">
              Hide
            </span>
            <ChevronDownIcon className="size-5 shrink-0 group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-150" />
          </span>
        </summary>
        <div className="border-t border-line">
          <p className="max-w-[65ch] px-4 py-3 text-small">
            Vote yes or no on keeping each judge in office.
          </p>
          <ul className="divide-y divide-line border-t border-line">
            {judges.map((judge) => (
              <li key={judge.id}>
                <RetentionRow
                  judge={judge}
                  published={published}
                  picks={picks}
                />
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  )
}

/** A judge's row with their Yes and No, in the list and in the race panel. */
function RetentionRow({
  judge,
  published,
  picks,
  idPrefix = '',
  fromBallot = true,
}: {
  judge: RetentionContest
  published: Set<string>
  picks: Picks
  idPrefix?: string
  fromBallot?: boolean
}) {
  const sample = useSampleMode()
  return (
    <div
      // Focused by "Show on ballot"; the race panel's copy isn't a target.
      id={idPrefix ? undefined : raceAnchorId(judge.id)}
      tabIndex={idPrefix ? undefined : -1}
      className="flex scroll-mt-4 flex-wrap items-center focus-visible:-outline-offset-4"
    >
      <div className="min-w-0 flex-[1_1_12rem]">
        <CandidateRow
          name={judge.judge}
          detail={judge.office}
          rowId={`row-${judge.id}`}
          idPrefix={idPrefix}
          published={published}
          fromBallot={fromBallot}
        />
      </div>
      {/* Wraps under the name on narrow screens. */}
      {!sample && (
        <div className="px-4 py-2">
          <YesNo
            contest={judge}
            subject={`keeping ${judge.judge} in office`}
            choice={choicesFor(picks, judge)[0]}
          />
        </div>
      )}
    </div>
  )
}

/**
 * One candidate or judge. Every row is built the same way, with no prop that
 * could make one person look different from another (fair by construction):
 * with a published profile the whole row is the link, otherwise it says so.
 */
function CandidateRow({
  name,
  detail,
  rowId,
  idPrefix = '',
  published,
  fromBallot = true,
}: {
  name: string
  /** Party (and "incumbent", see partyLine) for candidates, office for judges. */
  detail?: string
  /** The row's id in the ballot list, where Back returns focus. */
  rowId: string
  /** Set in the race panel, so its ids don't repeat the list's. */
  idPrefix?: string
  published: Set<string>
  /** False on a race page: its profile links don't lead back to a ballot row. */
  fromBallot?: boolean
}) {
  const key = profileKey(name)
  const open = useMatch('/candidates/:key')
  const rowClass =
    'flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2'
  // The hidden commas keep the link's name readable ("Jane Doe, Democratic,
  // Profile") in screen readers that join block text without a pause.
  const text = (
    <span className="min-w-0">
      <span className="block text-label font-semibold">{name}</span>
      {detail && (
        <span className="block text-small text-muted">
          <span className="sr-only">, </span>
          {detail}
        </span>
      )}
    </span>
  )

  if (!published.has(key)) {
    return (
      <div id={idPrefix + rowId} className={`${rowClass} text-text`}>
        {text}
        <span className="text-small text-muted">
          <span className="sr-only">, </span>
          No profile yet
        </span>
      </div>
    )
  }
  const current = open?.params.key === key
  // Always the list's row: that's where focus goes back to.
  const state: ProfileLinkState | undefined = fromBallot ? { rowId } : undefined
  return (
    <Link
      id={idPrefix + rowId}
      to={profilePath(key)}
      state={state}
      // Switching profiles beside the list replaces the open one, so Back
      // always returns to the ballot.
      replace={open !== null}
      aria-current={current ? 'page' : undefined}
      // Inset focus ring: the race card clips anything outside the row.
      // The open profile's row looks like every other row: aria-current
      // tells screen readers, with no style of its own.
      className={`${rowClass} text-text no-underline hover:bg-bg focus-visible:-outline-offset-4`}
    >
      {text}
      <span className="text-small font-semibold underline underline-offset-[3px]">
        <span className="sr-only">, </span>
        Profile
      </span>
    </Link>
  )
}
