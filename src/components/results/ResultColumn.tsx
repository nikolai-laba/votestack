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
 * The column's three lines: the label, the share and the votes. Every row
 * keeps all three, labeled or not, loaded or loading, so every row in a card
 * is the same size and none changes size when the results arrive.
 */
const LINE = {
  label: 'flex min-h-5.5 items-center justify-end gap-1 text-small font-bold',
  share: 'block min-h-6.5 text-race font-bold',
  votes: 'block min-h-4.5 text-caption text-muted',
}

/** A loading line's grey bar. */
const Bar = ({ className }: { className: string }) => (
  <span
    className={`inline-block rounded-sm bg-band align-middle ${className}`}
  />
)

/**
 * A row's result at its end, the same fixed width and the same three lines
 * on every row: the label (Won, Leading and so on; an empty line on a row
 * without one), the share and the votes. Empty lines for a choice with no
 * count; grey bars in the same lines while the results load.
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
      {pending || !choice ? (
        <span
          aria-hidden="true"
          data-results-placeholder={pending ? '' : undefined}
          className="block"
        >
          <span data-line="label" className={LINE.label}>
            {pending && <Bar className="h-3 w-12" />}
          </span>
          <span data-line="share" className={LINE.share}>
            {pending && <Bar className="h-4 w-14" />}
          </span>
          <span data-line="votes" className={LINE.votes}>
            {pending && <Bar className="h-3 w-16" />}
          </span>
        </span>
      ) : (
        <>
          <span
            data-line="label"
            aria-hidden={choice.label ? undefined : 'true'}
            className={LINE.label}
          >
            {choice.label && (
              <>
                {DECIDED.has(choice.label) && <CheckIcon />}
                {choice.label}
              </>
            )}
          </span>
          {choice.label && <span className="sr-only">, </span>}
          <span data-line="share" className={LINE.share}>
            {choice.shareText}
          </span>
          <span className="sr-only">, </span>
          <span data-line="votes" className={LINE.votes}>
            {votesText(choice.votes)}
          </span>
          <span className="sr-only"> votes</span>
        </>
      )}
    </div>
  )
}
