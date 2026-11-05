export type OfficialSource = 'chicago' | 'cook' | 'la' | 'ca-sos'

export interface OfficialContest {
  title: string
  choices: { name: string; votes: number }[]
  voteFor?: number
  passRate?: string
  /** LA: "Los Angeles County Results Only". */
  countyOnly?: boolean
}

export interface OfficialFile {
  source: OfficialSource
  url: string
  retrievedAt: string
  asOf: string
  contests: OfficialContest[]
}

export const OFFICIAL_URLS: Record<'chicago' | 'cook' | 'la', string> = {
  chicago: 'https://results.chicagoelections.gov/results/SummaryExport.txt',
  cook: 'https://electionnight.cookcountyclerkil.gov/',
  la: 'https://results.lavote.gov/electionresults/json?electionid=4348',
}

/** Parses a vote count that must be digits (commas allowed). */
export function parseVotes(source: string, raw: string): number {
  const digits = raw.trim().replace(/,/g, '')
  if (!/^\d+$/.test(digits)) {
    throw new Error(`${source}: votes field is not digits: "${raw.trim()}"`)
  }
  return Number(digits)
}
