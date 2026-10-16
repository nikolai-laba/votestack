import { useEffect } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import {
  ABOUT_PATH,
  GET_STARTED_PATH,
  NOTIFY_PATH,
  type BallotOutletContext,
} from '../ballot/profileLinks.ts'
import { LEVEL_TITLES } from '../ballot/sections.ts'
import { measureWordsFor } from '../shared/regions.ts'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'
import {
  RaceCardFor,
  RaceFacts,
  YourBallot,
} from '../components/RaceSummary.tsx'
import { longDate } from '../format.ts'
import { RACES_HEAD, raceAreaHead, raceHead, useDocumentHead } from '../head.ts'
import { coveredFullNames } from '../ballot/coverage.ts'
import {
  findRace,
  publishedFor,
  useRaces,
  type RaceData,
} from '../races/data.ts'
import {
  RACE_LEVELS,
  RACES_PATH,
  areaBallotsText,
  raceName,
  racePath,
  type Race,
  type RaceList,
} from '../shared/races.ts'
import { NotFoundPage } from './NotFoundPage.tsx'

// The race pages, for visitors without a ballot (most come from a search):
// /races (the areas VoteStack covers), /races/il/cook-county/2026-11-03
// and /races/ca/los-angeles-county/2026-11-03 (every race there) and one page per race (src/shared/races.ts has the
// addresses). They show everyone in a race the same way the ballot does, and
// lead to the voter's own ballot: only an address says which races are
// theirs, and picks are made there. Loaded lazily (see routes.tsx).

const HEADING_ID = 'races-heading'

/** Starts keyboard and screen reader users at the page's title. */
function useFocusHeading(key: string) {
  useEffect(() => {
    document.getElementById(HEADING_ID)?.focus()
  }, [key])
}

function Heading({ children }: { children: string }) {
  return (
    <h1
      id={HEADING_ID}
      tabIndex={-1}
      className="text-title text-balance focus:outline-none lg:text-title-lg"
    >
      {children}
    </h1>
  )
}

const capitalize = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1)

export default function RacesPage() {
  const rest = (useParams()['*'] ?? '').replace(/\/$/, '')
  const query = useRaces()
  if (query.isError)
    return (
      <section className="space-y-3">
        <h1 className="text-title lg:text-title-lg">
          Couldn&rsquo;t load the races
        </h1>
        <p>Check your connection and try again.</p>
      </section>
    )
  if (!query.data) return <ProfileSkeleton />
  const data = query.data
  if (!rest) return <RacesIndex lists={data.lists} />
  const area = data.lists.find((l) => l.areaPath === rest)
  if (area)
    return (
      <RaceArea list={area} withProfiles={publishedFor(data, area).size > 0} />
    )
  const found = findRace(data, rest)
  if (found)
    return (
      <RacePage
        race={found.race}
        list={found.list}
        published={publishedFor(data, found.list)}
      />
    )
  return <NotFoundPage />
}

/** /races: the areas and elections VoteStack covers. */
function RacesIndex({ lists }: { lists: RaceData['lists'] }) {
  useDocumentHead(RACES_HEAD)
  useFocusHeading('index')
  return (
    <section className="max-w-[65ch] space-y-6">
      <Heading>Races on the ballot</Heading>
      <p>
        VoteStack covers {coveredFullNames()}, for now. Choose an election to
        see every race on its ballots.
      </p>
      <ul className="space-y-3">
        {lists.map((list) => (
          <li
            key={list.areaPath}
            className="rounded-md border border-line bg-surface p-4"
          >
            <Link
              to={`${RACES_PATH}/${list.areaPath}`}
              className="inline-flex min-h-11 items-center text-label font-semibold"
            >
              {list.area}
            </Link>
            <p className="text-small">
              {list.electionName}, {longDate(list.date)}. {list.races.length}{' '}
              races and judges up for retention.
            </p>
          </li>
        ))}
      </ul>
      <p>
        Live somewhere else?{' '}
        <Link to={NOTIFY_PATH}>
          Get an email when VoteStack covers your area
        </Link>
        .
      </p>
    </section>
  )
}

/** Every race in an area, by level of government, linking to each race. */
function RaceArea({
  list,
  withProfiles,
}: {
  list: RaceList
  withProfiles: boolean
}) {
  useDocumentHead(raceAreaHead(list, withProfiles))
  useFocusHeading(list.areaPath)
  const sections = RACE_LEVELS.map((level) => ({
    level,
    races: list.races.filter((r) => r.level === level),
  })).filter((s) => s.races.length > 0)
  return (
    <div className="max-w-[65ch] space-y-8">
      <section className="space-y-3">
        <Heading>{`Races in ${list.area}`}</Heading>
        <p className="text-small">
          {list.electionName}, {longDate(list.date)}
        </p>
        <p>
          This list has every race and every judge up for retention on any
          ballot in {areaBallotsText(list)}. Your own ballot has only some of
          them. {capitalize(measureWordsFor(list.electionId).many)} aren&apos;t
          listed here, because which ones you see depends on your exact address.
        </p>
        <p>
          <Link to={ABOUT_PATH}>Where the race lists come from</Link>
        </p>
      </section>

      <AreaBallotLink />

      {sections.map(({ level, races }) => (
        <section
          key={level}
          aria-labelledby={`level-${level}`}
          className="space-y-3"
        >
          <h2 id={`level-${level}`} className="text-section">
            {LEVEL_TITLES[level]}
          </h2>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {races.map((race) => (
              <li key={race.path}>
                <RaceLink race={race} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** On the area list: the address form is one page away, on any race. */
function AreaBallotLink() {
  const { ballot } = useOutletContext<BallotOutletContext>()
  if (ballot)
    return (
      <p>
        <Link to="/" className="inline-flex min-h-11 items-center">
          Back to your full ballot
        </Link>
      </p>
    )
  return (
    <p>
      <Link to={GET_STARTED_PATH} className="inline-flex min-h-11 items-center">
        Find the races on your ballot
      </Link>
    </p>
  )
}

/** One race in the area list: its name and how many candidates. */
function RaceLink({ race }: { race: Race }) {
  const count = race.candidates?.length ?? 0
  const detail =
    race.kind === 'retention'
      ? race.title
      : count === 0
        ? 'No candidates filed'
        : count === 1
          ? '1 candidate'
          : `${count} candidates`
  return (
    <Link
      to={racePath(race)}
      className="flex min-h-14 flex-col justify-center px-4 py-2 no-underline hover:bg-bg focus-visible:-outline-offset-4"
    >
      <span className="font-semibold text-link underline underline-offset-[3px]">
        {race.kind === 'retention' ? race.judge : race.title}
      </span>
      <span className="text-small text-muted">{detail}</span>
    </Link>
  )
}

/** One race: who votes, everyone in it, and the way to the voter's ballot. */
function RacePage({
  race,
  list,
  published,
}: {
  race: Race
  list: RaceList
  published: Set<string>
}) {
  const { ballot } = useOutletContext<BallotOutletContext>()
  useDocumentHead(raceHead(race, published.size > 0))
  useFocusHeading(race.path)
  return (
    <article className="max-w-[65ch] space-y-6">
      <p>
        <Link
          to={`${RACES_PATH}/${list.areaPath}`}
          className="inline-flex min-h-11 items-center"
        >
          All races in {list.area}
        </Link>
      </p>
      <header className="space-y-3">
        <Heading>{raceName(race)}</Heading>
        <RaceFacts race={race} list={list} />
      </header>
      <RaceCardFor race={race} list={list} published={published} />
      <YourBallot race={race} ballot={ballot} headingId="your-ballot" />
      <p className="text-small text-muted">
        <Link to={ABOUT_PATH}>Where the race lists come from</Link>
      </p>
    </article>
  )
}
