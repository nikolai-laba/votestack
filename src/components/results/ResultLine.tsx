import {
  resultView,
  type ChoiceView,
  type RaceResult,
  type ResultLabel,
} from '../../shared/raceResults.ts'
import { CheckIcon } from '../icons.tsx'

/** "A, B and C" */
const andList = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : (items[0] ?? '')

/** Labels for a decided race: these get a check icon as well as the word. */
export const DECIDED = new Set<ResultLabel>([
  'Elected',
  'Won',
  'Retained',
  'Not retained',
  'Passed',
  'Failed',
])

/** What a race's one-line result says: a tag, then who and how much. */
function lineOf(result: RaceResult): {
  label?: ResultLabel
  text: string
} {
  const view = resultView(result)
  const decided = view.status === 'called' || view.status === 'certified'
  if (view.status === 'too_close') return { text: 'Too close to call' }
  if (!decided && view.status !== 'counting') return { text: 'Not called yet' }

  const named = decided
    ? view.winners
    : view.choices.filter((c) => c.label).map((c) => c.name)
  const shown: ChoiceView[] = view.choices.filter((c) => named.includes(c.name))
  const label = decided ? view.outcome : shown.find((c) => c.label)?.label
  if (!label || shown.length === 0) return { text: 'Not called yet' }

  if (result.kind !== 'candidate') {
    // A judge or measure: the Yes share when decided, the leading side while counting.
    const yes = view.choices.find((c) => c.name === 'Yes')
    return decided
      ? { label, text: `${yes?.shareText ?? ''} yes` }
      : { label, text: `${shown[0].name}, ${shown[0].shareText}` }
  }
  // One name carries its share; several (vote for more than one, or a tie) don't.
  const text =
    shown.length === 1
      ? `${shown[0].name}, ${shown[0].shareText}`
      : andList(shown.map((c) => c.name))
  return { label, text }
}

/**
 * A race's result in one line, for a list row or under a pick: a small
 * filled tag (Won, Leading, Retained...), then who and how much. Without a
 * result it keeps the line's space while the results load.
 */
export function ResultLine({ result }: { result?: RaceResult }) {
  if (!result)
    return (
      <span
        aria-hidden="true"
        data-results-placeholder=""
        className="flex min-h-5.5 items-center"
      >
        <span className="h-3.5 w-40 max-w-full rounded-sm bg-band" />
      </span>
    )
  const { label, text } = lineOf(result)
  if (!label)
    return <span className="block min-h-5.5 text-small text-muted">{text}</span>
  const decided = DECIDED.has(label)
  return (
    <span className="block min-h-5.5 text-small text-text">
      <span
        data-fill={decided ? 'win' : 'lead'}
        className={`me-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 font-bold ${decided ? '' : 'text-text'}`}
      >
        {decided && <CheckIcon />}
        {label}
      </span>{' '}
      {text}
    </span>
  )
}
