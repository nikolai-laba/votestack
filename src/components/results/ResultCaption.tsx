import { Fragment, type ReactNode } from 'react'
import { longDate, longDateTime, webUrl } from '../../format.ts'
import { useElectionCheckedAt } from '../../results/context.tsx'
import type { RaceResult, ResultSource } from '../../shared/raceResults.ts'
import { resultRegion, type Region } from '../../shared/regions.ts'
import { officialResultsUrl } from './useRaceResults.ts'

const CAPTION_CLASS =
  'border-t border-line px-4 py-2 text-caption text-muted italic'

/** A link to a source, or its plain name when its address isn't a web page. */
function SourceLink({ url, children }: { url: string; children: string }) {
  const href = webUrl(url)
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    children
  )
}

/** "the Chicago Board of Election Commissioners and the Cook County Clerk", each linked. */
function Offices({ sources }: { sources: ResultSource[] }) {
  return sources.map((source, i) => (
    <Fragment key={source.name}>
      {i === 0 ? 'the ' : i === sources.length - 1 ? ' and the ' : ', the '}
      <SourceLink url={source.url}>{source.name}</SourceLink>
    </Fragment>
  ))
}

const newest = (sources: ResultSource[]) =>
  sources.reduce((latest, s) =>
    Date.parse(s.asOf) > Date.parse(latest.asOf) ? s : latest,
  ).asOf

/**
 * The line under a race's result: who called it and when, whose count it
 * is and as of when, and when it's certified. Times are in the race's own
 * area (CT for Cook, PT for Los Angeles).
 */
export function ResultCaption({
  result,
  region,
  checkedAt,
  officialUrl,
  className = CAPTION_CLASS,
}: {
  result: RaceResult
  region: Region
  /** When the results pass ran: the time of a race with no count. */
  checkedAt?: string
  /** The official results page, for a race with no count. */
  officialUrl?: string
  /** Replaces the card caption's border and padding, for use inside another block. */
  className?: string
}) {
  const when = (iso: string) =>
    longDateTime(iso, region.timeZone, region.zoneLabel)
  // "Tuesday, November 3, 2026, at 9:41 p.m. CT"
  const at = (iso: string) =>
    when(iso).replace(/^(.+?, .+?, \d{4}), /, '$1, at ')
  const offices = result.sources.filter(
    (s, i, all) => s.official && all.findIndex((o) => o.name === s.name) === i,
  )
  // AP's district-wide count, for Illinois races that cross county lines.
  const ap = result.sources.find((s) => !s.official)
  const { call } = result

  const count = (linkAp: boolean): ReactNode => {
    if (ap)
      return (
        <>
          Count from {linkAp ? <SourceLink url={ap.url}>AP</SourceLink> : 'AP'}{' '}
          as of {when(ap.asOf)}
          {ap.counted !== undefined &&
            `; AP estimates ${Math.round(ap.counted * 100)}% of votes counted`}
          .
        </>
      )
    if (offices.length === 0) return null
    return (
      <>
        Unofficial count as of {when(newest(offices))}, from{' '}
        <Offices sources={offices} />.
      </>
    )
  }
  const seeOfficial = officialUrl && (
    <SourceLink url={officialUrl}>See official results</SourceLink>
  )

  let parts: ReactNode[]
  switch (result.status) {
    case 'called':
      parts = [
        call && (
          <>
            <SourceLink url={call.url}>AP</SourceLink> called this race on{' '}
            {at(call.at)}.
          </>
        ),
        count(!call),
        ap
          ? `Official results by ${longDate(result.certifyBy)}.`
          : `Certified by ${longDate(result.certifyBy)}.`,
      ]
      break
    case 'counting':
      parts = ['Not called yet.', count(true)]
      break
    case 'too_close':
      parts = ['Too close to call.', count(true)]
      break
    case 'certified': {
      // The office list only when an office is named; never "by ." alone.
      const certified = result.certified
        ? `, certified ${longDate(result.certified.on)}`
        : ''
      parts = [
        offices.length > 0 ? (
          <>
            Official results{certified}, by <Offices sources={offices} />.
          </>
        ) : (
          `Official results${certified}.`
        ),
      ]
      break
    }
    case 'no_count':
      parts =
        result.scope === 'beyond'
          ? [
              checkedAt && `As of ${when(checkedAt)}.`,
              `This district reaches past ${region.name}, so we show no partial count.`,
              seeOfficial,
            ]
          : ['Not called yet.', seeOfficial]
      break
  }
  const shown = parts.filter(Boolean)
  return (
    <p className={className}>
      {shown.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

/**
 * A race card's last line: its result's caption, or the caption's space
 * while the results load.
 */
export function ContestResultCaption({
  contest,
  result,
}: {
  contest: { electionId: string; id: string }
  result?: RaceResult
}) {
  const checkedAt = useElectionCheckedAt(contest.electionId)
  if (!result)
    return (
      // Four caption lines: a called race's caption at 375 px.
      <div
        aria-hidden="true"
        data-results-placeholder=""
        className={CAPTION_CLASS}
      >
        {['w-full', 'w-full', 'w-full', 'w-1/2'].map((width, i) => (
          <span key={i} className="flex h-4.5 items-center">
            <span className={`h-3 rounded-sm bg-band ${width}`} />
          </span>
        ))}
      </div>
    )
  return (
    <ResultCaption
      result={result}
      region={resultRegion(contest.electionId)}
      checkedAt={checkedAt}
      officialUrl={officialResultsUrl(contest.id, result)}
    />
  )
}
