import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { OverviewParagraph } from '../../shared/profile.ts'
import { Overview } from './Overview.tsx'

function renderOverview(items: OverviewParagraph[]) {
  render(<Overview section={{ asOf: '2026-10-06', items }} />)
  return screen.getByRole('region', { name: 'Overview' })
}

describe('Overview', () => {
  it('cites each sentence where it ends', () => {
    const region = renderOverview([
      {
        text: 'She chairs the board. She ran a clinic.',
        cites: [1, 2],
        sentences: [
          { text: 'She chairs the board.', cites: [2] },
          { text: 'She ran a clinic.', cites: [1] },
        ],
      },
    ])
    const paragraph = region.querySelector('p')
    expect(paragraph).toHaveTextContent(
      'She chairs the board.2 She ran a clinic.1',
    )
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Source 2',
      'Source 1',
    ])
  })

  it('cites the whole paragraph when it has no sentences', () => {
    const region = renderOverview([
      { text: 'She chairs the board. She ran a clinic.', cites: [1, 2] },
      { text: 'Second paragraph.', cites: [3], sentences: [] },
    ])
    const paragraphs = region.querySelectorAll('p')
    expect(paragraphs[0]).toHaveTextContent(
      'She chairs the board. She ran a clinic.1, 2',
    )
    expect(paragraphs[1]).toHaveTextContent('Second paragraph.3')
  })
})
