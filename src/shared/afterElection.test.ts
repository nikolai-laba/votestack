import { describe, expect, it } from 'vitest'
import {
  NOTICE_WORDS_PATH,
  parseNoticeWords,
  type NoticeWords,
} from './afterElection.ts'

const valid: NoticeWords = {
  version: 1,
  heading: 'Heading',
  intro: 'Intro',
  signup: { heading: 'Sign up', body: 'Body' },
  support: {
    heading: 'Support',
    body: 'Body',
    payLabel: 'Pay',
    payUrl: 'https://buy.stripe.com/abc123',
    fine: 'Fine print',
    linkLabel: 'How payments are used',
  },
  line: { text: 'Line', open: 'Open', openSignedUp: 'Open again' },
}

describe('NOTICE_WORDS_PATH', () => {
  it('is the file the build writes, under the path robots.txt skips', () => {
    expect(NOTICE_WORDS_PATH).toBe('/notice/after-election.json')
  })
})

describe('parseNoticeWords', () => {
  it('returns words that are complete', () => {
    expect(parseNoticeWords(valid)).toEqual(valid)
    expect(parseNoticeWords(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
  })

  it.each([
    ['null', null],
    ['a string', 'words'],
    ['an empty object', {}],
    ['another version', { ...valid, version: 2 }],
    ['no version', { ...valid, version: undefined }],
    ['a missing line', { ...valid, line: undefined }],
    ['a missing signup', { ...valid, signup: undefined }],
    ['an empty heading', { ...valid, heading: '' }],
    ['a number in intro', { ...valid, intro: 42 }],
    [
      'an empty signup body',
      { ...valid, signup: { ...valid.signup, body: '' } },
    ],
    [
      'a missing support field',
      { ...valid, support: { ...valid.support, fine: undefined } },
    ],
    ['an empty line text', { ...valid, line: { ...valid.line, text: '' } }],
    [
      'a pay link that runs script',
      {
        ...valid,
        support: { ...valid.support, payUrl: 'javascript:alert(1)' },
      },
    ],
    [
      'a pay link without https',
      {
        ...valid,
        support: { ...valid.support, payUrl: 'http://buy.stripe.com/x' },
      },
    ],
    [
      'a pay link to another site',
      {
        ...valid,
        support: { ...valid.support, payUrl: 'https://example.com/x' },
      },
    ],
  ])('returns null for %s', (_name, raw) => {
    expect(parseNoticeWords(raw)).toBeNull()
  })
})
