import type { InputHTMLAttributes } from 'react'
import { WarningIcon } from './icons.tsx'

// A labelled text input with its error under it (DESIGN.md 8.1): the error
// has text and an icon, and is linked to the input by aria-describedby.

type InputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'autoComplete' | 'inputMode' | 'spellCheck'
>

export function TextField({
  id,
  label,
  value,
  error,
  hintId,
  onChange,
  onBlur,
  inputRef,
  type = 'text',
  ...input
}: InputProps & {
  /** Also the input's name. */
  id: string
  label: string
  value: string
  error?: string
  /** A hint elsewhere on the page that describes this field. */
  hintId?: string
  onChange: (value: string) => void
  onBlur: () => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const errorId = `${id}-error`
  const describedBy = [error && errorId, hintId].filter(Boolean).join(' ')
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-label font-semibold">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        {...input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`min-h-12 w-full rounded-md bg-surface px-3 text-body text-text ${
          error ? 'border-2 border-danger' : 'border border-field'
        }`}
      />
      {error && (
        <p
          id={errorId}
          className="flex items-start gap-2 text-small font-semibold text-danger"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
