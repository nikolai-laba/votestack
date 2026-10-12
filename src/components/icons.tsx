// Inline icons. They always sit next to text that says the same thing, so
// they're hidden from screen readers.

export function WarningIcon({
  className = 'mt-0.5 size-5 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M8.5 2.9a1.7 1.7 0 0 1 3 0l6.3 11.4A1.7 1.7 0 0 1 16.3 17H3.7a1.7 1.7 0 0 1-1.5-2.6L8.5 2.9ZM10 7a.9.9 0 0 0-.9.9v3.4a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function CheckIcon({
  className = 'size-4 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function ChevronDownIcon({
  className = 'size-5 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M5.2 7.2a.9.9 0 0 1 1.3 0L10 10.7l3.5-3.5a.9.9 0 1 1 1.3 1.3l-4.2 4.1a.9.9 0 0 1-1.2 0L5.2 8.5a.9.9 0 0 1 0-1.3Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function SunIcon({
  className = 'size-5 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <circle cx="10" cy="10" r="3.75" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M10 1.75v1.5M10 16.75v1.5M1.75 10h1.5M16.75 10h1.5M4.2 4.2l1.06 1.06M14.74 14.74l1.06 1.06M15.8 4.2l-1.06 1.06M5.26 14.74 4.2 15.8"
      />
    </svg>
  )
}

export function MoonIcon({
  className = 'size-5 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path d="M8.5 2.5a7.5 7.5 0 1 0 9 9 6.5 6.5 0 0 1-9-9Z" />
    </svg>
  )
}
