import { useId } from 'react'
import { hasPaperOrder } from '../ballot/sections.ts'
import { useBallotOrder, type BallotOrder } from '../ballot/orderPreference.ts'
import type { Contest } from '../shared/ballot.ts'
import { CHICAGO } from '../shared/ocd.ts'

// The switch between sections by level of government and paper ballot order
// on the ballot and on Saved choices. Two native radio buttons, so the
// arrow keys move between them and screen readers say which one is chosen;
// the visible radio dot marks the choice without relying on colour.

const OPTIONS: { value: BallotOrder; label: string }[] = [
  { value: 'level', label: 'By level of government' },
  { value: 'paper', label: 'Paper ballot order' },
]

/** Shown only when every race on the ballot has its paper position. */
export function BallotOrderToggle({ contests }: { contests: Contest[] }) {
  const [order, setOrder] = useBallotOrder()
  const name = useId()
  if (!hasPaperOrder(contests)) return null
  const chicago = contests[0].authorityId === CHICAGO

  return (
    <div className="space-y-2">
      <fieldset>
        <legend className="text-label font-semibold">Order of races</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 border-field bg-surface px-3 py-1 text-text has-checked:border-selected-line has-checked:bg-selected has-checked:text-on-selected has-checked:[--focus:var(--on-selected)]"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={order === option.value}
                onChange={() => setOrder(option.value)}
                className="size-5 shrink-0 cursor-pointer accent-primary checked:accent-selected-line"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {order === 'paper' && (
        <p className="max-w-[65ch] text-small text-muted">
          {chicago
            ? "This follows the order of the Chicago Board of Election Commissioners' official list and the order of offices in Illinois law. It hasn't been checked against a printed Chicago ballot yet."
            : "This follows the Cook County Clerk's sample ballot for your ballot style."}
        </p>
      )}
    </div>
  )
}
