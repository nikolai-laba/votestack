import type {
  BarContext,
  Endorsement,
  ProfileKind,
  ProfileSource,
  Section,
} from '../../shared/profile.ts'
import { useId, useState } from 'react'
import { ChevronDownIcon } from '../icons.tsx'
import { barSummary } from './barSummary.ts'
import { Cite } from './Cite.tsx'
import { ProfileSection } from './ProfileSection.tsx'

/** Shown above a judge's ratings for a retention vote. */
export const RETENTION_NOTE =
  'Yes means the group recommends keeping the judge in office.'

/** Our wording for a group that published nothing for this judge. */
export const NO_RATING_TEXT = 'No rating published'

/** Endorsements shown before "Show all"; the same for every candidate. */
export const ENDORSEMENTS_SHOWN = 6

type ListedKind = Exclude<Endorsement['kind'], 'bar_evaluation'>

/** Group order in the list; organizations and unions share the first. */
const KIND_GROUP: Record<ListedKind, number> = {
  organization: 0,
  union: 0,
  elected_official: 1,
  party: 2,
  editorial_board: 3,
}

/** Shown under a name; plain organizations get none. */
const KIND_LABEL: Partial<Record<ListedKind, string>> = {
  union: 'Union',
  elected_official: 'Elected official',
  party: 'Party',
  editorial_board: 'Editorial board',
}

/** Groups endorsements by kind, keeping the given order within each. */
function orderEndorsements(items: Endorsement[]): Endorsement[] {
  const group = (e: Endorsement) => KIND_GROUP[e.kind as ListedKind] ?? 4
  // Array.prototype.sort is stable, so ties keep their order.
  return [...items].sort((a, b) => group(a) - group(b))
}

interface RatingSet {
  context: BarContext
  label?: string
  items: Endorsement[]
}

/** Bar evaluations grouped by the vote they're for, in their order. */
function ratingSets(items: Endorsement[], kind: ProfileKind): RatingSet[] {
  const sets: RatingSet[] = []
  for (const e of items) {
    const context =
      e.context ?? (kind === 'retention' ? 'retention' : 'election')
    let set = sets.find((s) => s.context === context)
    if (!set) {
      set = { context, label: e.contextLabel, items: [] }
      sets.push(set)
    }
    set.items.push(e)
  }
  return sets
}

/**
 * Endorsing organizations, and for judges the bar associations' evaluations:
 * the same four lines for every judge (three groups' ratings word for word
 * and one line counting the Alliance's other members), per vote.
 */
export function Endorsements({
  section,
  kind,
  sources,
}: {
  section: Section<Endorsement>
  /** Same for everyone in a race, so the heading never differs within one. */
  kind: ProfileKind
  sources: ProfileSource[]
}) {
  const judicial = kind !== 'candidate'
  const endorsements = section.items.filter((e) => e.kind !== 'bar_evaluation')
  const sets = ratingSets(
    section.items.filter((e) => e.kind === 'bar_evaluation'),
    kind,
  )
  return (
    <ProfileSection
      id="endorsements"
      title={judicial ? 'Endorsements and bar evaluations' : 'Endorsements'}
      asOf={section.asOf}
      empty={section.items.length === 0}
    >
      <div className="space-y-4">
        {endorsements.length > 0 && (
          <EndorsementList items={orderEndorsements(endorsements)} />
        )}
        {sets.map((set) => (
          <div key={set.context} className="space-y-2">
            {sets.length > 1 && set.label && (
              <h3 className="text-label font-semibold">{set.label}</h3>
            )}
            {set.context === 'retention' && <p>{RETENTION_NOTE}</p>}
            <ul className="list-disc space-y-2 ps-6">
              {set.items.map((e) => (
                <BarRating key={e.organization} e={e} sources={sources} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </ProfileSection>
  )
}

/** The first few endorsements, and a button that shows the rest. */
function EndorsementList({ items }: { items: Endorsement[] }) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const more = items.length > ENDORSEMENTS_SHOWN
  const shown = expanded || !more ? items : items.slice(0, ENDORSEMENTS_SHOWN)
  return (
    <div className="space-y-2">
      <ul id={listId} className="list-disc space-y-2 ps-6">
        {shown.map((e) => {
          // "Democratic elected official" when a source gives the party.
          const label =
            e.kind === 'elected_official' && e.party
              ? `${e.party} elected official`
              : KIND_LABEL[e.kind as ListedKind]
          return (
            <li key={`${e.organization}|${e.rating ?? ''}`}>
              {e.organization}
              {e.rating && <>: &ldquo;{e.rating}&rdquo;</>}
              <Cite ids={e.cites} />
              {label && (
                <span className="block text-small text-muted">{label}</span>
              )}
            </li>
          )
        })}
      </ul>
      {more && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((x) => !x)}
          className="group flex min-h-11 cursor-pointer items-center gap-1 text-small text-link"
        >
          <span className="underline underline-offset-[3px]">
            {expanded ? 'Show fewer' : `Show all ${items.length} endorsements`}
          </span>
          <ChevronDownIcon className="size-5 shrink-0 group-aria-expanded:rotate-180 motion-safe:transition-transform motion-safe:duration-150" />
        </button>
      )}
    </div>
  )
}

function BarRating({
  e,
  sources,
}: {
  e: Endorsement
  sources: ProfileSource[]
}) {
  const none = <span className="text-muted">{NO_RATING_TEXT}</span>
  if (e.tally) {
    const summary = barSummary(e.tally, e.context ?? 'election')
    const table = sources.find((s) => s.id === e.cites[0])
    return (
      <li>
        {e.organization}: {summary.text ?? none}
        <Cite ids={e.cites} />
        {summary.notes.length > 0 && (
          <>
            {' '}
            <span className="text-muted">{summary.notes.join(' ')}</span>
          </>
        )}
        {table && (
          <>
            {' '}
            <a href={table.url} target="_blank" rel="noreferrer">
              Each group&rsquo;s rating
              {/\.pdf$/i.test(table.url) && ' (PDF)'}
            </a>
          </>
        )}
      </li>
    )
  }
  return (
    <li>
      {e.organization}: {e.rating ? <>&ldquo;{e.rating}&rdquo;</> : none}
      <Cite ids={e.cites} />
    </li>
  )
}
