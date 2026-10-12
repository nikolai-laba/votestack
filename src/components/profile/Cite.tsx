import type { MouseEvent } from 'react'

/** Moves focus to a source in the list without adding a history entry. */
function jumpToSource(event: MouseEvent<HTMLAnchorElement>, id: number) {
  const target = document.getElementById(`source-${id}`)
  if (!target) return
  event.preventDefault()
  target.focus()
}

/** Superscript source numbers, each linking to the numbered Sources list. */
export function Cite({ ids }: { ids: number[] }) {
  if (ids.length === 0) return null
  return (
    <sup className="ms-0.5 text-caption">
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <a
            href={`#source-${id}`}
            aria-label={`Source ${id}`}
            onClick={(e) => jumpToSource(e, id)}
          >
            {id}
          </a>
        </span>
      ))}
    </sup>
  )
}
