import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resultsOffices } from '../shared/results.ts'
import { VotingEndedLine } from './VotingEndedLine.tsx'

const mode = vi.hoisted(() => ({ on: false }))
vi.mock('../shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('../shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

afterEach(() => {
  mode.on = false
})

describe('VotingEndedLine', () => {
  it('says voting ended and links the one office that counts the ballot', () => {
    mode.on = true
    const { container } = render(
      <VotingEndedLine offices={resultsOffices(['chicago'])} />,
    )
    expect(container.querySelector('p')?.textContent).toBe(
      'Voting ended on Tuesday, November 3, 2026. See official results from the Chicago Board of Election Commissioners.',
    )
    expect(
      screen.getByRole('link', {
        name: 'Chicago Board of Election Commissioners',
      }),
    ).toHaveAttribute('href', 'https://chicagoelections.gov/elections/results')
  })

  it('names both Cook offices with their places', () => {
    mode.on = true
    const { container } = render(
      <VotingEndedLine
        offices={resultsOffices(['chicago', 'suburban-cook'])}
      />,
    )
    expect(container.querySelector('p')?.textContent).toBe(
      'Voting ended on Tuesday, November 3, 2026. See official results from the Chicago Board of Election Commissioners (Chicago) and the Cook County Clerk (suburban Cook County).',
    )
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('renders nothing when there is no office to name', () => {
    mode.on = true
    const { container } = render(<VotingEndedLine offices={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the switch is off', () => {
    const { container } = render(
      <VotingEndedLine offices={resultsOffices(['chicago'])} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
