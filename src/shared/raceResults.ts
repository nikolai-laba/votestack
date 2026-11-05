// Election results: the data model, and the rules that turn a count into
// labels, row fills, vote shares and outcomes. Dependency-free so scripts,
// the site and tests all read a result the same way.

import type { IsoDate, SourceRef } from './ballot.ts'

export type ResultStatus =
  'certified' | 'called' | 'too_close' | 'counting' | 'no_count'
export type ResultLabel =
  | 'Elected'
  | 'Won'
  | 'Leading'
  | 'Tied'
  | 'Unopposed'
  | 'Retained'
  | 'Not retained'
  | 'Passed'
  | 'Failed'
export type RowFill = 'win' | 'lead' | 'none'
export interface ResultChoice {
  name: string
  votes: number
}
export type ResultSource = SourceRef & { asOf: string; counted?: number }

export interface RaceResult {
  contestIds: string[]
  kind: 'candidate' | 'retention' | 'measure'
  status: ResultStatus
  voteFor?: number
  threshold?: number
  choices: ResultChoice[]
  winners?: string[]
  call?: { by: 'AP'; at: string; url: string }
  certified?: { on: IsoDate; url: string }
  /** The race's own certification date: the county's, or the state's for statewide and cross-county races. */
  certifyBy: IsoDate
  scope: 'within' | 'beyond'
  sources: ResultSource[]
  changedAt: string
}

export interface ResultsFile {
  version: 1
  electionId: string
  checkedAt: string
  results: RaceResult[]
}

const STATUSES: ResultStatus[] = [
  'certified',
  'called',
  'too_close',
  'counting',
  'no_count',
]
const KINDS = ['candidate', 'retention', 'measure']

function fail(path: string, why: string): never {
  throw new Error(`Results file: ${path} ${why}`)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '')
    fail(path, 'must be a non-empty string')
  return v
}

function strings(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) return fail(path, 'must be an array')
  v.forEach((s, i) => str(s, `${path}[${i}]`))
  return v as string[]
}

function parseResult(raw: unknown, path: string): RaceResult {
  if (!isObject(raw)) fail(path, 'must be an object')
  strings(raw.contestIds, `${path}.contestIds`)
  if (!KINDS.includes(raw.kind as string)) fail(`${path}.kind`, 'is not valid')
  if (!STATUSES.includes(raw.status as ResultStatus)) {
    fail(`${path}.status`, 'is not valid')
  }
  if (!Array.isArray(raw.choices)) fail(`${path}.choices`, 'must be an array')
  raw.choices.forEach((c: unknown, i: number) => {
    const p = `${path}.choices[${i}]`
    if (!isObject(c)) fail(p, 'must be an object')
    str(c.name, `${p}.name`)
    if (!Number.isInteger(c.votes) || (c.votes as number) < 0) {
      fail(`${p}.votes`, 'must be a non-negative integer')
    }
  })
  if (raw.status === 'called' || raw.status === 'certified') {
    strings(raw.winners, `${path}.winners`)
  } else if (raw.winners !== undefined) {
    strings(raw.winners, `${path}.winners`)
  }
  str(raw.certifyBy, `${path}.certifyBy`)
  if (raw.scope !== 'within' && raw.scope !== 'beyond') {
    fail(`${path}.scope`, 'is not valid')
  }
  if (!Array.isArray(raw.sources)) fail(`${path}.sources`, 'must be an array')
  str(raw.changedAt, `${path}.changedAt`)
  return raw as unknown as RaceResult
}

/** Checks a parsed results file and returns it typed. Throws an Error naming the first bad field. */
export function parseResultsFile(raw: unknown): ResultsFile {
  if (!isObject(raw)) fail('file', 'must be an object')
  if (raw.version !== 1) fail('version', 'must be 1')
  str(raw.electionId, 'electionId')
  str(raw.checkedAt, 'checkedAt')
  if (!Array.isArray(raw.results)) fail('results', 'must be an array')
  raw.results.forEach((r: unknown, i: number) =>
    parseResult(r, `results[${i}]`),
  )
  return raw as unknown as ResultsFile
}

export interface ChoiceView {
  name: string
  votes: number
  share: number
  shareText: string
  label?: ResultLabel
  fill: RowFill
}

export interface ResultView {
  status: ResultStatus
  header: 'Share of votes' | 'Not called yet' | 'Too close to call'
  choices: ChoiceView[]
  outcome?: ResultLabel
  winners: string[]
  leaders: string[]
}

/** Whether a yes share carries a question: a majority needs more than half, any other threshold needs to be met. */
export function passes(yesShare: number, threshold: number): boolean {
  return threshold === 0.5 ? yesShare > 0.5 : yesShare >= threshold
}

/**
 * "59.96%": a share as shown to voters, to one decimal ("66.0%"). Exactly all
 * is "100%" and nothing is "0.0%"; a share that would round to 0.0% or
 * 100.0% without being so reads "Under 0.1%" or "Over 99.9%". Just under a
 * threshold, where one decimal would round up to it, the share keeps two
 * decimals, cut rather than rounded ("59.96%" for a 60% threshold), so it
 * never reads as meeting a threshold it misses.
 */
export function shareText(share: number, threshold?: number): string {
  if (share >= 1) return '100%'
  if (share <= 0) return '0.0%'
  if (share < 0.0005) return 'Under 0.1%'
  const one = (share * 100).toFixed(1)
  if (one === '100.0') return 'Over 99.9%'
  if (
    threshold !== undefined &&
    share < threshold &&
    Number(one) >= Number((threshold * 100).toFixed(1))
  ) {
    return `${(Math.floor(share * 10000) / 100).toFixed(2)}%`
  }
  return `${one}%`
}

/** "Needs 60% yes to stay." */
export function thresholdText(
  kind: 'retention' | 'measure',
  threshold: number,
): string {
  const verb = kind === 'retention' ? 'stay' : 'pass'
  let amount: string
  if (threshold === 0.5) amount = 'a majority'
  else if (Math.abs(threshold - 2 / 3) < 1e-9) amount = 'two-thirds'
  else amount = `${Math.round(threshold * 1000) / 10}%`
  return `Needs ${amount} yes to ${verb}.`
}

function decidedLabel(
  result: RaceResult,
  name: string,
): ResultLabel | undefined {
  if (result.kind === 'candidate') {
    return result.status === 'certified' ? 'Elected' : 'Won'
  }
  const yes = name === 'Yes'
  if (result.kind === 'retention') return yes ? 'Retained' : 'Not retained'
  return yes ? 'Passed' : 'Failed'
}

/** The labels of a count still in progress, by choice index. */
function leadingLabels(
  result: RaceResult,
  total: number,
): (ResultLabel | undefined)[] {
  const { choices } = result
  const labels: (ResultLabel | undefined)[] = choices.map(() => undefined)
  if (total === 0) return labels
  if (result.kind !== 'candidate') {
    const yes = choices.find((c) => c.name === 'Yes')
    if (!yes) return labels
    const side = passes(yes.votes / total, result.threshold ?? 0.5)
      ? 'Yes'
      : 'No'
    choices.forEach((c, i) => {
      if (c.name === side) labels[i] = 'Leading'
    })
    return labels
  }
  const seats = result.voteFor ?? 1
  // No more candidates than seats: every one of them is unopposed.
  if (choices.length <= seats) {
    choices.forEach((_, i) => {
      labels[i] = 'Unopposed'
    })
    return labels
  }
  const sorted = [...choices].sort((a, b) => b.votes - a.votes)
  const cutoff = sorted[Math.min(seats, sorted.length) - 1].votes
  if (cutoff === 0) {
    // Fewer candidates with votes than seats: those with votes lead.
    choices.forEach((c, i) => {
      if (c.votes > 0) labels[i] = 'Leading'
    })
    return labels
  }
  const above = choices.filter((c) => c.votes > cutoff).length
  const atCutoff = choices.filter((c) => c.votes === cutoff).length
  const fits = atCutoff <= seats - above
  choices.forEach((c, i) => {
    if (c.votes > cutoff) labels[i] = 'Leading'
    else if (c.votes === cutoff) labels[i] = fits ? 'Leading' : 'Tied'
  })
  return labels
}

export function resultView(result: RaceResult): ResultView {
  const { status } = result
  if (status === 'no_count') {
    return {
      status,
      header: 'Not called yet',
      choices: [],
      winners: [],
      leaders: [],
    }
  }
  const total = result.choices.reduce((sum, c) => sum + c.votes, 0)
  const decided = status === 'called' || status === 'certified'
  const winners = decided ? (result.winners ?? []) : []
  const counting = status === 'counting' ? leadingLabels(result, total) : []

  const choices: ChoiceView[] = result.choices.map((c, i) => {
    const share = total === 0 ? 0 : c.votes / total
    let label: ResultLabel | undefined
    let fill: RowFill = 'none'
    if (decided && winners.includes(c.name)) {
      label = decidedLabel(result, c.name)
      fill = 'win'
    } else if (status === 'counting' && counting[i]) {
      label = counting[i]
      fill = 'lead'
    }
    const text = shareText(share, result.threshold)
    return label
      ? { name: c.name, votes: c.votes, share, shareText: text, label, fill }
      : { name: c.name, votes: c.votes, share, shareText: text, fill }
  })

  const labeled = choices.filter((c) => c.label)
  return {
    status,
    header: status === 'too_close' ? 'Too close to call' : 'Share of votes',
    choices,
    outcome: decided
      ? labeled[0]?.label
      : status === 'counting' && labeled.length > 0
        ? 'Leading'
        : undefined,
    winners,
    leaders:
      status === 'counting'
        ? labeled
            .filter((c) => ['Leading', 'Tied', 'Unopposed'].includes(c.label!))
            .map((c) => c.name)
        : [],
  }
}

export interface PersonOutcome {
  outcome:
    | 'won'
    | 'elected'
    | 'not_elected'
    | 'leading'
    | 'trailing'
    | 'retained'
    | 'not_retained'
    | 'uncalled'
  share?: number
  winners: string[]
}

/** How one person fares in a race: a candidate by name, or a judge (whose own name is not a choice) by the Yes count. */
export function personOutcome(result: RaceResult, name: string): PersonOutcome {
  const view = resultView(result)
  const { winners } = view
  if (result.kind !== 'candidate') {
    const yes = view.choices.find((c) => c.name === 'Yes')
    const share = yes?.share
    if (view.status === 'called' || view.status === 'certified') {
      return {
        outcome: winners.includes('Yes') ? 'retained' : 'not_retained',
        share,
        winners,
      }
    }
    if (view.status === 'counting') {
      return {
        outcome: yes?.label === 'Leading' ? 'leading' : 'trailing',
        share,
        winners,
      }
    }
    return { outcome: 'uncalled', share, winners }
  }
  const choice = view.choices.find((c) => c.name === name)
  const share = choice?.share
  if (!choice) return { outcome: 'uncalled', winners }
  if (view.status === 'called' || view.status === 'certified') {
    if (!winners.includes(name))
      return { outcome: 'not_elected', share, winners }
    return {
      outcome: view.status === 'certified' ? 'elected' : 'won',
      share,
      winners,
    }
  }
  if (view.status === 'counting') {
    return {
      outcome: view.leaders.includes(name) ? 'leading' : 'trailing',
      share,
      winners,
    }
  }
  return { outcome: 'uncalled', share, winners }
}
