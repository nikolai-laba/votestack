// NetFile as a money source module: the county offices, school, college and
// special districts that file with Los Angeles County's Registrar-Recorder
// (and the few that file in Orange or San Bernardino County or with Santa
// Monica), and the city races in cities whose clerks use NetFile. Each
// person's committee comes from the filing officer's own seat list for the
// election, or else from a committee named after them that filed this year;
// the summary is the committee's latest Form 460, read from its PDF, with
// the Form 497 late contributions filed since.

import type { MoneySummary } from '../../../src/shared/profile.ts'
import { form460Summary, lateSince, type LateContribution } from './form460.ts'
import { readForm460Pdf, readForm497Pdf } from './form460-pdf.ts'
import type {
  MoneyEntry,
  MoneyPerson,
  MoneyResult,
  MoneySourceModule,
} from './money-ca.ts'
import {
  agencyFor,
  agencyPage,
  candidateName,
  electionOn,
  filerIdOf,
  filerPage,
  filersNamedFor,
  filingPdf,
  filingsBetween,
  filingsOf,
  isoDay,
  latestFilings,
  matchSeatCandidates,
  NetFileWall,
  seatsOf,
  type Agency,
  type NfFiling,
  type NfSeat,
} from './netfile.ts'
import { formatPeriod } from './seats.ts'

/** The November general election's date: the Tuesday after the first Monday. */
export function generalElectionDay(year: number): string {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay()
  const firstMonday = 1 + ((8 - nov1) % 7)
  return `${year}-11-${String(firstMonday + 1).padStart(2, '0')}`
}

/** What the module found for one person, for the log. */
export type NetFileOutcome =
  | 'summary'
  | 'scanned'
  | 'unreadable'
  | 'no-pdf'
  | 'no-460'
  | 'form-470'
  | 'old-460'
  | 'no-committee'
  | 'unmatched'
  | 'wall'

export function netfileModule(
  log?: (key: string, outcome: NetFileOutcome) => void,
): MoneySourceModule {
  return {
    id: 'netfile',
    handles: (p) => agencyFor(p) !== null,
    async collect(people, ctx): Promise<MoneyResult> {
      const result: MoneyResult = { byKey: {}, unmatched: [] }
      const note = (p: MoneyPerson, outcome: NetFileOutcome) =>
        log?.(p.key, outcome)
      const miss = (
        p: MoneyPerson,
        reason: string,
        outcome: NetFileOutcome,
      ) => {
        result.unmatched.push({
          key: p.key,
          name: p.name,
          office: p.office,
          reason,
        })
        note(p, outcome)
      }
      const electionDay = generalElectionDay(ctx.year)
      const byAgency = new Map<
        string,
        { agency: Agency; people: MoneyPerson[] }
      >()
      for (const p of people) {
        const agency = agencyFor(p)!
        const group = byAgency.get(agency.aid) ?? { agency, people: [] }
        group.people.push(p)
        byAgency.set(agency.aid, group)
      }

      let wall: string | undefined
      // The committee each person was matched to, to catch two people sharing one.
      const committeeOf = new Map<string, string>()
      for (const { agency, people: group } of byAgency.values()) {
        const { aid } = agency
        let seats: NfSeat[] = []
        let yearFilings: NfFiling[] | undefined
        for (const p of group) {
          if (wall) {
            miss(p, `NetFile stopped answering: ${wall}`, 'wall')
            continue
          }
          try {
            if (seats.length === 0 && !yearFilings) {
              const election = await electionOn(
                aid,
                electionDay,
                ctx.maxAgeHours,
              )
              seats = election
                ? await seatsOf(aid, election.id, ctx.maxAgeHours)
                : []
              yearFilings = await filingsBetween(
                aid,
                `${ctx.year}-01-01`,
                ctx.today,
                ctx.maxAgeHours,
              )
            }
            const entry = await collectOne(p, agency, seats, yearFilings!)
            if ('reason' in entry) {
              miss(p, entry.reason, 'unmatched')
              continue
            }
            if (entry.committeeKey) committeeOf.set(p.key, entry.committeeKey)
            result.byKey[p.key] = entry.entry
            note(p, entry.outcome)
          } catch (e) {
            if (!(e instanceof NetFileWall)) throw e
            wall = e.message
            miss(p, `NetFile stopped answering: ${wall}`, 'wall')
          }
        }
      }

      // Two people on one committee: neither is a sure match.
      const holders = new Map<string, string[]>()
      for (const [key, c] of committeeOf)
        holders.set(c, [...(holders.get(c) ?? []), key])
      for (const [c, keys] of holders) {
        if (keys.length < 2) continue
        for (const key of keys) {
          const p = people.find((x) => x.key === key)!
          delete result.byKey[key]
          result.unmatched.push({
            key,
            name: p.name,
            office: p.office,
            reason: `NetFile committee ${c} is matched to several people: ${keys.join(', ')}`,
          })
        }
      }
      return result

      async function collectOne(
        p: MoneyPerson,
        agency: Agency,
        seats: NfSeat[],
        yearFilings: NfFiling[],
      ): Promise<
        | { reason: string }
        | { entry: MoneyEntry; outcome: NetFileOutcome; committeeKey?: string }
      > {
        const { aid, filedWith } = agency
        const atAgency = { name: filedWith, url: agencyPage(aid) }
        const matches = matchSeatCandidates(p, seats)
        const committeeIds = [
          ...new Set(matches.flatMap((m) => m.candidate.committeeId ?? [])),
        ]
        if (committeeIds.length > 1)
          return {
            reason: `Several NetFile (${aid}) committees match: ${committeeIds.join(', ')}`,
          }
        let filerId: string | undefined = committeeIds[0]
        let filings: NfFiling[] = []
        const official = matches[0]
          ? candidateName(matches[0].candidate.fullName)
          : undefined
        if (filerId) {
          filings = await filingsOf(aid, filerId, ctx.maxAgeHours)
          // The seat sometimes links the candidate's own filer (Form 470s
          // and 501s) while a committee named for them files the 460s.
          if (!filings.some((f) => /\b460\b/.test(f.formName))) {
            const own = new Set(filings.map((f) => f.filerName))
            const named = filersNamedFor(
              p,
              ctx.year,
              yearFilings,
            ).committees.filter((n) => !own.has(n))
            const theirs = yearFilings.filter(
              (f) => named.length === 1 && f.filerName === named[0],
            )
            if (theirs.some((f) => /\b460\b/.test(f.formName))) {
              const id = await filerIdOf(aid, theirs[0].id)
              if (id) {
                filerId = id
                filings = await filingsOf(aid, id, ctx.maxAgeHours)
              }
            }
          }
        } else if (matches.length > 0) {
          return {
            entry: {
              summaries: [],
              filingsAt: atAgency,
              note: `${filedWith} lists this candidate with no campaign committee on NetFile (${aid}).`,
            },
            outcome: 'no-committee',
          }
        } else {
          // Not on the seat list: a committee named after them that filed this year.
          const found = filersNamedFor(p, ctx.year, yearFilings)
          // A committee if there's one; else the candidate's own filings (Form 470s).
          const names = found.committees.length ? found.committees : found.self
          if (names.length > 1)
            return {
              reason: `Several NetFile (${aid}) filers are named for this person: ${names.join('; ')}`,
            }
          if (names.length === 0)
            return {
              entry: {
                summaries: [],
                filingsAt: atAgency,
                note: `No campaign committee or filings for this candidate on NetFile (${aid}) in ${ctx.year}.`,
              },
              outcome: 'no-committee',
            }
          const named = yearFilings.filter((f) => f.filerName === names[0])
          filerId = await filerIdOf(aid, named[0].id)
          filings = filerId
            ? await filingsOf(aid, filerId, ctx.maxAgeHours)
            : named
        }
        const committee = filings[0]?.filerName ?? ''
        const url = filerId ? filerPage(aid, filerId, committee) : atAgency.url
        const atFiler = { name: filedWith, url }
        const committeeKey = `${aid}:${filerId ?? committee}`
        if (filings.length === 0)
          return {
            entry: {
              summaries: [],
              filingsAt: atFiler,
              note: `This candidate's committee has no filings on NetFile (${aid}) yet.`,
            },
            outcome: 'no-460',
            committeeKey,
          }
        const { f460, f497, f470 } = latestFilings(filings)
        if (!f460) {
          return {
            entry: {
              summaries: [],
              filingsAt:
                f470.length > 0
                  ? { ...atFiler, underThreshold: true }
                  : atFiler,
              note:
                f470.length > 0
                  ? `This candidate's only campaign statements are Form 470s (for candidates who raise and spend under $2,000).`
                  : `${committee} hasn't filed a Form 460 yet.`,
            },
            outcome: f470.length > 0 ? 'form-470' : 'no-460',
            committeeKey,
          }
        }
        const periodEnd = isoDay(f460.periodEnd)
        if (periodEnd < `${ctx.year - 1}-01-01`)
          return {
            entry: {
              summaries: [],
              filingsAt: atFiler,
              note: `${committee}'s latest Form 460 covers ${formatPeriod(isoDay(f460.periodStart), periodEnd)}, before this election.`,
            },
            outcome: 'old-460',
            committeeKey,
          }
        const who = official ?? {
          first: p.ballot.given[0] ?? '',
          last: p.ballot.words.at(-1) ?? '',
        }
        const pdf = await filingPdf(aid, f460)
        if (!pdf)
          return {
            entry: {
              summaries: [],
              filingsAt: atFiler,
              note: `${committee}'s latest Form 460 (${formatPeriod(isoDay(f460.periodStart), periodEnd)}) has no copy on NetFile to read.`,
            },
            outcome: 'no-pdf',
            committeeKey,
          }
        const read = await readForm460Pdf(pdf, who, {
          name: committee,
          id: filerId,
        })
        if (!read.ok) {
          const period = formatPeriod(isoDay(f460.periodStart), periodEnd)
          return {
            entry: {
              summaries: [],
              filingsAt: atFiler,
              note:
                read.reason === 'scanned'
                  ? `${committee}'s latest Form 460 (${period}) is a scanned paper filing, so its figures can't be read automatically.`
                  : `${committee}'s latest Form 460 (${period}, filing ${f460.id}) couldn't be read: ${read.reason}${read.detail ? `, ${read.detail}` : ''}.`,
            },
            outcome: read.reason === 'scanned' ? 'scanned' : 'unreadable',
            committeeKey,
          }
        }
        const report = read.value
        const summary: MoneySummary = form460Summary(report, { filedWith, url })
        const late: LateContribution[] = []
        let unread497 = 0
        for (const f of f497) {
          const pdf = await filingPdf(aid, f)
          const r = pdf
            ? await readForm497Pdf(pdf, who, { name: committee, id: filerId })
            : null
          if (r?.ok) late.push(...r.value.contributions)
          else unread497++
        }
        const since = lateSince(report.through, late)
        if (since) summary.largeSince = since
        return {
          entry: {
            summaries: [summary],
            matchedCommittee: report.committeeId ?? filerId,
            ...(unread497 > 0 && {
              note: `${unread497} late contribution report${unread497 > 1 ? 's' : ''} (Form 497) filed since couldn't be read.`,
            }),
          },
          outcome: 'summary',
          committeeKey,
        }
      }
    },
  }
}
