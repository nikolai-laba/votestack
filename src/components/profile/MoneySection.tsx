import { money, percent, webUrl } from '../../format.ts'
import {
  MONEY_SOURCE_LABELS,
  showsMoneyShares,
  type MoneySectionData,
  type MoneySummary,
} from '../../shared/profile.ts'
import { ProfileSection } from './ProfileSection.tsx'

const SOURCE_NAMES: Record<MoneySummary['source'], string> = {
  ISBE: 'Illinois State Board of Elections',
  FEC: 'Federal Election Commission',
}

const NOT_REPORTED = 'Not reported'

/** "June 30, 2026" from `YYYY-MM-DD`, like the reporting period. */
const monthDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

/** Campaign money from official filings. Every field shows, filled or not. */
export function MoneySection({ section }: { section: MoneySectionData }) {
  const shared =
    section.items.length === 0 ? section.sharedCommittee : undefined
  return (
    <ProfileSection
      id="money"
      title="Campaign money"
      asOf={section.asOf}
      empty={section.items.length === 0 && !shared}
    >
      {shared ? (
        <p>
          No committee of their own. Judges up for retention campaign together
          through the{' '}
          <a href={webUrl(shared.url)} target="_blank" rel="noreferrer">
            {shared.name}
          </a>
          .
        </p>
      ) : (
        // Rules between committees (FEC and ISBE), since the name is only
        // in each one's source line.
        <div className="space-y-6 divide-y divide-line">
          {section.items.map((summary) => (
            <Committee key={summary.url} summary={summary} />
          ))}
        </div>
      )}
    </ProfileSection>
  )
}

function Committee({ summary }: { summary: MoneySummary }) {
  const orNotReported = (
    n: number | undefined,
    format: (n: number) => string,
  ) => (n === undefined ? NOT_REPORTED : format(n))
  const rows: [string, string][] = [
    ['Reporting period', summary.period],
    ['Raised', orNotReported(summary.raised, money)],
    ['Cash on hand', orNotReported(summary.cashOnHand, money)],
  ]
  // Money the candidate gave or lent their own committee, as part of "Raised".
  const own = summary.raised !== undefined ? summary.fromCandidate : undefined
  return (
    <div className="space-y-3 not-first:pt-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">
              {value}
              {label === 'Raised' && own !== undefined && (
                <span className="block">
                  Of this, {money(own)} came from the candidate.
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {summary.raised !== 0 && <Breakdown summary={summary} />}
      {summary.largeSince && (
        <LargeSince large={summary.largeSince} url={summary.url} />
      )}
      <p className="text-caption text-muted">
        Source:{' '}
        <a href={webUrl(summary.url)} target="_blank" rel="noreferrer">
          {SOURCE_NAMES[summary.source]} filings for {summary.committee}
        </a>
      </p>
    </div>
  )
}

/**
 * Where the money raised came from, by kind of source, in the same order for
 * everyone (MONEY_SOURCE_ORDER); kinds with $0 are left out, so the rows add
 * up to "Raised". Percentages show only above MONEY_SHARES_MIN_RAISED, where
 * one or two gifts no longer set them; the methods page states the rule.
 */
function Breakdown({ summary }: { summary: MoneySummary }) {
  const rows = summary.raised !== undefined ? summary.breakdown : undefined
  const raised = summary.raised ?? 0
  const shares = showsMoneyShares(summary)
  const labels = MONEY_SOURCE_LABELS[summary.source]
  return (
    <table className="w-full">
      <caption className="pb-1 text-start text-label font-semibold">
        Where the money came from
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Source</th>
          <th scope="col">Amount</th>
          {shares && <th scope="col">Share of money raised</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-line border-y border-line">
        {rows && rows.length > 0 ? (
          // Labels wrap and numbers never, so the table fits a 320px screen.
          rows.map((row) => (
            <tr key={row.kind}>
              <th scope="row" className="py-1 pe-4 text-start font-normal">
                {labels[row.kind] ?? row.kind}
              </th>
              <td className="py-1 text-end whitespace-nowrap tabular-nums">
                {money(row.amount)}
              </td>
              {shares && (
                <td className="py-1 ps-4 text-end whitespace-nowrap tabular-nums">
                  {percent(row.amount / raised)}
                </td>
              )}
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={shares ? 3 : 2} className="py-1 text-muted">
              {NOT_REPORTED}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/** Large gifts reported after the period, so a months-old report isn't the whole story. */
function LargeSince({
  large,
  url,
}: {
  large: NonNullable<MoneySummary['largeSince']>
  url: string
}) {
  const gifts = `${large.count} ${large.count === 1 ? 'gift' : 'gifts'}`
  return (
    <p>
      Large contributions reported since {monthDay(large.since)}:{' '}
      <span className="tabular-nums">{money(large.total)}</span> in {gifts}.{' '}
      {large.fromCandidate !== undefined && (
        <>
          Of this,{' '}
          <span className="tabular-nums">{money(large.fromCandidate)}</span>{' '}
          came from the candidate.{' '}
        </>
      )}
      <a href={webUrl(url)} target="_blank" rel="noreferrer">
        See the large contribution reports
      </a>
      .
    </p>
  )
}
