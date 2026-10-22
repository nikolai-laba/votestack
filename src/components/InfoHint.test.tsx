import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoHint } from './InfoHint.tsx'

describe('InfoHint', () => {
  it('gives the button the label as its accessible name', () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    expect(
      screen.getByRole('button', { name: 'About PACs' }),
    ).toBeInTheDocument()
  })

  it('hides the hint by default', () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('button', { name: 'About PACs' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('opens on click, showing the hint text and marking the button expanded', async () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    const button = screen.getByRole('button', { name: 'About PACs' })
    await userEvent.click(button)
    expect(screen.getByRole('tooltip')).toHaveTextContent('PAC content')
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes on Escape', async () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    const button = screen.getByRole('button', { name: 'About PACs' })
    await userEvent.click(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on hover and closes on mouse leave', async () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    const button = screen.getByRole('button', { name: 'About PACs' })
    await userEvent.hover(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.unhover(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens on focus and closes when focus moves elsewhere', async () => {
    render(
      <>
        <InfoHint label="About PACs">PAC content</InfoHint>
        <button type="button">Next</button>
      </>,
    )
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'About PACs' })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it("links the button's aria-controls to the hint's id when open", async () => {
    render(<InfoHint label="About PACs">PAC content</InfoHint>)
    const button = screen.getByRole('button', { name: 'About PACs' })
    await userEvent.click(button)
    expect(button).toHaveAttribute(
      'aria-controls',
      screen.getByRole('tooltip').id,
    )
  })
})
