import { useId, useRef, useState, type ReactNode } from 'react'
import { InfoIcon } from './icons.tsx'

/**
 * A small "i" button that reveals a short plain-text explanation on hover,
 * keyboard focus or tap. Content stays as inline text; keep it to a sentence
 * or two. The popover closes on mouse leave, Escape, or when focus moves off.
 */
export function InfoHint({
  label,
  className = '',
  children,
}: {
  /** The button's accessible name, e.g. "About PACs and other committees". */
  label: string
  /** Extra classes on the outer wrapper, for callers that need spacing. */
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false)
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        className="inline-flex items-center p-1 text-muted hover:text-ink focus-visible:text-ink"
      >
        <InfoIcon />
      </button>
      {open && (
        <div
          id={id}
          role="tooltip"
          className="absolute top-full left-[50%] z-10 mt-1 w-max max-w-[min(16rem,calc(100vw-2rem))] -translate-x-[50%] rounded-sm border border-line bg-surface p-3 text-small font-normal text-ink shadow-sm"
        >
          {children}
        </div>
      )}
    </span>
  )
}
