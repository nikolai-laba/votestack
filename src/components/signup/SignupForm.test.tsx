import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupForm } from './SignupForm.tsx'

// Only the look of the Sign up button is checked here; the form's behavior
// is covered with the blocks that hold it.

function renderForm(emphasis?: 'primary' | 'highlight') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignupForm source="page" emphasis={emphasis} />
    </QueryClientProvider>,
  )
  return screen.getByRole('button', { name: 'Sign up' })
}

beforeEach(() => vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key'))
afterEach(() => vi.unstubAllEnvs())

describe('the Sign up button', () => {
  it('has the muted primary fill by default', () => {
    const button = renderForm()
    expect(button).toHaveClass('bg-primary', 'text-on-primary')
    expect(button).not.toHaveClass('bg-highlight')
    expect(button).not.toHaveClass('border-highlight')
  })

  it('has the neon highlight fill when asked for', () => {
    const button = renderForm('highlight')
    expect(button).toHaveClass(
      'border-2',
      'border-highlight',
      'bg-highlight',
      'text-on-highlight',
    )
    expect(button).not.toHaveClass('bg-primary')
    expect(button).not.toHaveClass('text-on-primary')
    // The size and width behavior stay the same.
    expect(button).toHaveClass('h-13', 'w-full', 'md:w-auto')
  })
})
