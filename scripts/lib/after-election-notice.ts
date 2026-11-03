// The words of the thank-you notice shown after an election. Only the build
// imports this file (scripts/prerender.ts writes it out as
// /notice/after-election.json), so the words stay out of the app's code and
// the prerendered pages. Numbers come from src/shared/support.ts so they
// match the Support page.

import type { NoticeWords } from '../../src/shared/afterElection.ts'
import {
  AI_SPENT_SO_FAR,
  CANDIDATES_COVERED,
  PAY_ONCE_URL,
} from '../../src/shared/support.ts'

/** The notice's words, with the figures filled in. */
export function afterElectionNotice(): NoticeWords {
  const candidates = CANDIDATES_COVERED.toLocaleString('en-US')
  // "About $400": the spend rounded to the nearest $10, without cents.
  const spent = Math.round(AI_SPENT_SO_FAR / 10) * 10
  return {
    version: 1,
    heading: 'Thank you for using VoteStack',
    intro:
      'Voting in the 2026 U.S. midterms has ended, and election offices are counting the ballots. Each race page links to the official results.',
    signup: {
      heading: 'Hear from us before your next election',
      body: 'If you found VoteStack helpful or are interested in knowing when it’s available for your ballot, sign up below. We email a few times a year. Chicago votes again on Tuesday, February 23, 2027, and the rest of Cook County on Tuesday, April 6, 2027. Most of LA County votes next in March 2028.',
    },
    support: {
      heading: 'Help fund voter education',
      body: `VoteStack is free to use, and started as a self-funded passion project. This election’s ${candidates} candidate profiles cost about $${spent} to research, and my goal is to expand to national coverage to help everyone have easy access to candidate information.`,
      payLabel: 'Pay what you want',
      payUrl: PAY_ONCE_URL,
      fine: 'VoteStack, LLC is not a 501(c)(3) organization, so payments aren’t tax-deductible. Payments are used only to run VoteStack, now and in future elections. We don’t take money from candidates, parties or campaigns.',
      linkLabel: 'How payments are used',
    },
    line: {
      text: 'Voting has ended. Thank you for using VoteStack.',
      open: 'Sign up or support',
      openSignedUp: 'Support VoteStack',
    },
  }
}
