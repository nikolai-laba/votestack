import { Fragment } from 'react'
import {
  resultView,
  type ChoiceView,
  type RaceResult,
  type ResultLabel,
} from '../../shared/raceResults.ts'
import { andList } from '../../format.ts'
import { CheckIcon } from '../icons.tsx'

/** Labels for a decided race: these get a check icon as well as the word. */
export const DECIDED = new Set<ResultLabel>([
  'Elected',
  'Won',
  'Retained',
  'Not retained',
  'Passed',
  'Failed',
])

/** One tagged part of a line: a tag, then who and how much. */
interface Part {
  label?: ResultLabel
  text: string
}

const NOT_CALLED: Part[] = [{ text: 'Not called yet' }]

/** The order of a count's tags in a line: leaders first, then those tied. */
const COUNTING: ResultLabel[] = ['Leading', 'Unopposed', 'Tied']

/**
 * What a race's one-line result says: one part, or two when a count is tied
 * at the last seat below its leaders, the leaders' and then the tied
 * candidates' ("[Leading] A; [Tied] B and C").
 */
function lineOf(result: RaceResult): Part[] {
  const view = resultView(result)
  const decided = view.status === 'called' || view.status === 'certified'
  if (view.status === 'too_close') return [{ text: 'Too close to call' }]
  if (!decided && view.status !== 'counting') return NOT_CALLED

  if (result.kind !== 'candidate') {
    // A judge or measure: the Yes share when decided, the leading side while counting.
    if (decided) {
      const yes = view.choices.find((c) => c.name === 'Yes')
      return view.outcome
        ? [{ label: view.outcome, text: `${yes?.shareText ?? ''} yes` }]
        : NOT_CALLED
    }
    const side = view.choices.find((c) => c.label)
    return side
      ? [{ label: side.label, text: `${side.name}, ${side.shareText}` }]
      : NOT_CALLED
  }

  const groups: { label?: ResultLabel; choices: ChoiceView[] }[] = decided
    ? [
        {
          label: view.outcome,
          choices: view.choices.filter((c) => view.winners.includes(c.name)),
        },
      ]
    : COUNTING.map((label) => ({
        label,
        choices: view.choices.filter((c) => c.label === label),
      }))
  const shown = groups.filter((g) => g.label && g.choices.length > 0)
  if (shown.length === 0) return NOT_CALLED
  // One name carries its share; several (vote for more than one, or a tie) don't.
  const single = shown.length === 1 && shown[0].choices.length === 1
  return shown.map(({ label, choices }) => ({
    label,
    text: single
      ? `${choices[0].name}, ${choices[0].shareText}`
      : andList(choices.map((c) => c.name)),
  }))
}

/** A part's small filled tag: decided ones get a check icon as well as the word. */
function Tag({ label }: { label: ResultLabel }) {
  const decided = DECIDED.has(label)
  return (
    <span
      data-fill={decided ? 'win' : 'lead'}
      className={`me-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 font-bold ${decided ? '' : 'text-text'}`}
    >
      {decided && <CheckIcon />}
      {label}
    </span>
  )
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
  const parts = lineOf(result)
  if (!parts[0].label)
    return (
      <span className="block min-h-5.5 text-small text-muted">
        {parts[0].text}
      </span>
    )
  return (
    <span className="block min-h-5.5 text-small text-text">
      {parts.map((part, i) => (
        <Fragment key={part.label}>
          {i > 0 && '; '}
          {part.label && <Tag label={part.label} />} {part.text}
        </Fragment>
      ))}
    </span>
  )
}
