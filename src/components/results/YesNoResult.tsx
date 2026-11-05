import { resultView, type RaceResult } from '../../shared/raceResults.ts'
import { ResultColumn } from './ResultColumn.tsx'
import { fillOf } from './useRaceResults.ts'
import { YourPickTag } from './YourPickTag.tsx'

/**
 * A judge's or a measure's result, in place of the Yes and No buttons: a
 * Yes row and a No row, always in that order, the winning side filled.
 * With no result yet (still loading), both rows keep their space; a race
 * with no count has no results column.
 */
export function YesNoResult({
  result,
  picked,
}: {
  result?: RaceResult
  /** The voter's own saved answer. */
  picked?: 'Yes' | 'No'
}) {
  const view = result && resultView(result)
  return (
    <ul className="divide-y divide-line border-t border-line">
      {(['Yes', 'No'] as const).map((side) => {
        const choice = view?.choices.find((c) => c.name === side)
        return (
          <li
            key={side}
            data-fill={fillOf(choice)}
            className="flex min-h-14 items-center"
          >
            <span className="min-w-0 flex-1 px-4 py-2 text-label font-semibold">
              <span>{side}</span>
              {picked === side && <YourPickTag />}
            </span>
            {view?.status !== 'no_count' && (
              <ResultColumn choice={choice} pending={!result} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
