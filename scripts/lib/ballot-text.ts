// Text matching for the sample ballot audit. Ballot PDFs are printed
// in two or three columns, and pdftotext interleaves them: a referendum's
// lines alternate with lines of its neighbours, and long questions can be
// split across columns. So contests are found by evidence that survives
// that: candidates and judges by their name words in order (names are short
// and rarely split), referenda by how many of the word pairs that only their
// question has appear anywhere on the ballot.

/**
 * Lowercase words without accents or punctuation, joined by single spaces.
 * Line-end hyphenation ("proposi-\ntion") is undone, and digit groups are
 * kept whole ("$10,018,587" → "10018587", "0.590000%" → "0590000") so that
 * amounts and rates stay distinctive.
 */
export function normalize(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // accents
      // Hyphenated line breaks, but not names like "Smith-\nJones".
      .replace(/([a-z])[-\u00ad][ \t]*\n\s*([a-z])/g, '$1$2')
      .toLowerCase()
      .replace(/(\d)[,.](?=\d)/g, '$1') // 10,018,587 and 0.59
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  )
}

/**
 * True if the marker's words appear in order, each within `gap` words of the
 * previous one. Ballot layouts sometimes break a name across text blocks
 * ("caroline kate retention in office moreland").
 */
export function appears(words: string[], marker: string, gap = 6): boolean {
  return findMarker(words, marker, gap) !== -1
}

/**
 * Where the marker's words first appear in order (as in `appears`), at or
 * after `from`: the index of its first word, or -1.
 */
export function findMarker(
  words: string[],
  marker: string,
  gap = 6,
  from = 0,
): number {
  if (!marker) return -1
  const [first, ...rest] = marker.split(' ')
  for (
    let i = words.indexOf(first, from);
    i !== -1;
    i = words.indexOf(first, i + 1)
  ) {
    let at = i
    const found = rest.every((w) => {
      const next = words.indexOf(w, at + 1)
      if (next === -1 || next - at > gap) return false
      at = next
      return true
    })
    if (found) return i
  }
  return -1
}

const pairs = (words: string[]): string[] =>
  words.slice(1).map((w, i) => `${words[i]} ${w}`)

/** One ballot style's text, read in one or more pdftotext modes. */
export interface BallotText {
  /** Words of the first reading, in order (for names). */
  words: string[]
  /** Every adjacent word pair in any reading. */
  pairs: Set<string>
}

/**
 * Indexes a ballot from several readings of the same PDF (pdftotext's
 * default and `-layout` modes break columns in different places, so a pair
 * split in one is often intact in the other).
 */
export function ballotText(readings: string[]): BallotText {
  const all = readings.map((r) => normalize(r).split(' ').filter(Boolean))
  return { words: all[0] ?? [], pairs: new Set(all.flatMap(pairs)) }
}

/**
 * Scores referendum questions against ballots by their distinctive word
 * pairs: the pairs no other question has (usually the district's name, the
 * rate and the dollar amounts). Pairs shared with other questions ("the
 * limiting rate", "taxes extendable at") say nothing about which of them is
 * on the ballot. A question with no pair of its own (identical to another)
 * falls back to its rarest pairs.
 */
export class QuestionMatcher {
  private readonly distinctive = new Map<string, string[]>()

  /** `questions`: every question that could be on a ballot. */
  constructor(questions: string[]) {
    const docs = questions.map((q) => [
      ...new Set(pairs(normalize(q).split(' '))),
    ])
    const df = new Map<string, number>()
    for (const doc of docs) for (const p of doc) df.set(p, (df.get(p) ?? 0) + 1)
    questions.forEach((q, i) => {
      const rarest = Math.min(...docs[i].map((p) => df.get(p)!))
      this.distinctive.set(
        q,
        docs[i].filter((p) => df.get(p) === rarest),
      )
    })
  }

  /** The word pairs only this question has (or its rarest, if none). */
  distinctivePairs(question: string): string[] {
    const own = this.distinctive.get(question)
    if (!own) throw new Error(`Unknown question: ${question.slice(0, 60)}…`)
    return own
  }

  /** Share (0–1) of the question's distinctive word pairs found on the ballot. */
  score(question: string, ballot: BallotText): number {
    const own = this.distinctivePairs(question)
    if (!own.length) return 0
    return own.filter((p) => ballot.pairs.has(p)).length / own.length
  }
}

/**
 * Thresholds for `QuestionMatcher.score`. Over 599 cached suburban ballot
 * styles and all 43 suburban questions, questions on the ballot scored 0.71 or more and the rest 0.09 or
 * less. Anything in between is reported for a manual check, not guessed.
 */
export const MATCH = 0.5
export const UNSURE = 0.2
