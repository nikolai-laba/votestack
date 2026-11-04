import type { ResultView } from '../../shared/raceResults.ts'

/**
 * The results column's header, at the end of a race's band: "Share of
 * votes", or the race's state when no row can say it ("Not called yet",
 * "Too close to call"). Null while the results load: the space stays.
 */
export function ColumnHeader({ text }: { text: ResultView['header'] | null }) {
  const state = text === 'Not called yet' || text === 'Too close to call'
  return (
    <p
      aria-hidden={text === null || undefined}
      className={`w-28 shrink-0 text-end ${state ? 'text-small font-bold' : 'text-caption text-muted'}`}
    >
      {text}
    </p>
  )
}

/** The threshold line in a band ("Needs 60% yes to stay."); null keeps its line while the results load. */
export function ThresholdNote({ text }: { text: string | null }) {
  return text === null ? (
    <p aria-hidden="true" className="flex h-5.5 items-center">
      <span className="h-3 w-40 rounded-sm bg-line" />
    </p>
  ) : (
    <p className="text-small">{text}</p>
  )
}

/**
 * A judge's threshold and column header in the ballot's retention list,
 * where judges share one panel and have no band of their own.
 */
export function ResultsSubhead({
  note,
  header,
}: {
  note: string | null | undefined
  header: ResultView['header'] | null | undefined
}) {
  return (
    <div className="flex items-end gap-3 px-4 pb-2">
      <div className="min-w-0 flex-1">
        {note !== undefined && <ThresholdNote text={note} />}
      </div>
      {header !== undefined && <ColumnHeader text={header} />}
    </div>
  )
}
