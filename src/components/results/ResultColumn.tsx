import type { ChoiceView, ResultLabel } from '../../shared/raceResults.ts'
import { CheckIcon } from '../icons.tsx'

/** Labels for a decided race: these get a check icon as well as the word. */
const DECIDED = new Set<ResultLabel>([
  'Elected',
  'Won',
  'Retained',
  'Not retained',
  'Passed',
  'Failed',
])

/** "873,455" */
const votesText = (votes: number) => votes.toLocaleString('en-US')

/**
 * A row's result at its end, the same fixed width on every row: the label
 * (Won, Leading and so on), the share and the votes. Empty for a choice with
 * no count; a reserved block of the same size while the results load.
 */
export function ResultColumn({
  choice,
  pending = false,
}: {
  choice?: ChoiceView
  pending?: boolean
}) {
  return (
    <div className="box-content w-28 shrink-0 self-center py-2 pe-4 text-end tabular-nums">
      {pending ? (
        // The label, share and votes lines of a labeled row, on every row,
        // so no row grows when the results arrive.
        <span aria-hidden="true" data-results-placeholder="" className="block">
          <span className="flex h-5.5 items-center justify-end">
            <span className="h-3 w-12 rounded-sm bg-band" />
          </span>
          <span className="flex h-6.5 items-center justify-end">
            <span className="h-4 w-14 rounded-sm bg-band" />
          </span>
          <span className="flex h-4.5 items-center justify-end">
            <span className="h-3 w-16 rounded-sm bg-band" />
          </span>
        </span>
      ) : (
        choice && (
          <>
            {choice.label && (
              <>
                <span className="flex items-center justify-end gap-1 text-small font-bold">
                  {DECIDED.has(choice.label) && <CheckIcon />}
                  {choice.label}
                </span>
                <span className="sr-only">, </span>
              </>
            )}
            <span className="block text-race font-bold">
              {choice.shareText}
            </span>
            <span className="sr-only">, </span>
            <span className="block text-caption text-muted">
              {votesText(choice.votes)}
            </span>
            <span className="sr-only"> votes</span>
          </>
        )
      )}
    </div>
  )
}
