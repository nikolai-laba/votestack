import { longDate } from '../../format.ts'
import type { ProfileSource } from '../../shared/profile.ts'

/** The numbered sources that the superscript citations point to. */
export function SourcesList({ sources }: { sources: ProfileSource[] }) {
  const sorted = [...sources].sort((a, b) => a.id - b.id)
  return (
    <section aria-labelledby="sources-heading" className="space-y-3">
      <h2 id="sources-heading" className="text-section">
        Sources
      </h2>
      <ol className="list-decimal space-y-2 ps-6 text-small">
        {sorted.map((s) => (
          // Focusable so a citation can move focus here (see Cite).
          <li
            key={s.id}
            id={`source-${s.id}`}
            value={s.id}
            tabIndex={-1}
            className="scroll-mt-4"
          >
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
            , {s.publisher}. Viewed {longDate(s.viewedAt)}.
          </li>
        ))}
      </ol>
    </section>
  )
}
