import { describe, expect, it } from 'vitest'
import { parseNoticeWords } from '../../src/shared/afterElection.ts'
import {
  AI_SPENT_SO_FAR,
  CANDIDATES_COVERED,
  PAY_ONCE_URL,
} from '../../src/shared/support.ts'
import { afterElectionNotice } from './after-election-notice.ts'

describe('afterElectionNotice', () => {
  const words = afterElectionNotice()

  it('has the thank-you heading and the results line', () => {
    expect(words.version).toBe(1)
    expect(words.heading).toBe('Thank you for using VoteStack')
    expect(words.intro).toBe(
      'Voting in the 2026 U.S. midterms has ended, and election offices are counting the ballots. Each race page links to the official results.',
    )
  })

  it('has the sign-up words', () => {
    expect(words.signup).toEqual({
      heading: 'Hear from us before your next election',
      body: 'If you found VoteStack helpful or are interested in knowing when it’s available for your ballot, sign up below. We email a few times a year.',
    })
  })

  it('has the support words, built from the live figures', () => {
    const candidates = CANDIDATES_COVERED.toLocaleString('en-US')
    const spent = Math.round(AI_SPENT_SO_FAR / 10) * 10
    expect(words.support).toEqual({
      heading: 'Help fund voter education',
      body: `VoteStack is free to use, and started as a self-funded passion project. This election’s ${candidates} candidate profiles cost about $${spent} to research, and my goal is to expand to national coverage to help everyone have easy access to candidate information.`,
      payLabel: 'Pay what you want',
      payUrl: PAY_ONCE_URL,
      fine: 'VoteStack, LLC is not a 501(c)(3) organization, so payments aren’t tax-deductible. Payments are used only to run VoteStack, now and in future elections. We don’t take money from candidates, parties or campaigns.',
      linkLabel: 'How payments are used',
    })
  })

  it('formats the count with a thousands separator and rounds the spend to the nearest $10', () => {
    expect(AI_SPENT_SO_FAR).toBe(400.37)
    expect(CANDIDATES_COVERED).toBe(1176)
    expect(words.support.body).toContain('1,176 candidate profiles')
    expect(words.support.body).toContain('about $400 to research')
  })

  it('has the line that later pages of a visit show', () => {
    expect(words.line).toEqual({
      text: 'Voting has ended. Thank you for using VoteStack.',
      open: 'Sign up or support',
      openSignedUp: 'Support VoteStack',
    })
  })

  it('has no em dashes', () => {
    expect(JSON.stringify(words)).not.toContain('—')
  })

  it('reads back as the same words', () => {
    expect(parseNoticeWords(JSON.parse(JSON.stringify(words)))).toEqual(words)
    expect(parseNoticeWords(words)).toEqual(words)
  })
})
