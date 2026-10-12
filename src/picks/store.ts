// The voter's saved ballot and picks, kept on this device only: never
// sent to the Worker, never in a URL. One versioned localStorage key holds
// the last ballot looked up (its races, never the address or precinct) and
// the picks made on it. Every storage call is wrapped, so the app still
// works when storage is blocked (some private modes): picks then last until
// the page is closed or reloaded, and `persistent` is false so the UI can say so.

import { useSyncExternalStore } from 'react'
import type { Ballot, Contest, Coverage, Election } from '../shared/ballot.ts'

export const STORAGE_KEY = 'votestack:ballot:v1'
const VERSION = 1

/** A candidate's profileKey(name), or 'yes' / 'no' for retention and referenda. */
export type Choice = string

/** The ballot as saved on the device: no precinct, nothing from the address. */
export interface SavedBallot {
  election: Election
  contests: Contest[]
  coverage: Coverage
  publishedProfiles?: string[]
}

/** electionId → contestId → the choices picked, in the order they were made. */
export type Picks = Record<string, Record<string, Choice[]>>

export interface BallotState {
  ballot: SavedBallot | null
  picks: Picks
  /** False when this browser can't store data: picks last for this page only. */
  persistent: boolean
}

interface Stored {
  version: typeof VERSION
  ballot: SavedBallot | null
  picks: Picks
}

/**
 * What a pick did. `replaced` is the candidate it took the place of, when the
 * race already had its full vote.
 */
export type PickResult =
  { kind: 'picked'; replaced?: Choice } | { kind: 'unpicked' }

type Contestish = Pick<Contest, 'id' | 'electionId' | 'kind'> & {
  voteFor?: number
}

const EMPTY: Stored = { version: VERSION, ballot: null, picks: {} }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseBallot(v: unknown): SavedBallot | null {
  if (!isRecord(v) || !isRecord(v.election) || !isRecord(v.coverage))
    return null
  if (typeof v.election.id !== 'string' || !Array.isArray(v.contests))
    return null
  return {
    election: v.election as unknown as Election,
    contests: v.contests as Contest[],
    coverage: v.coverage as unknown as Coverage,
    ...(Array.isArray(v.publishedProfiles)
      ? { publishedProfiles: v.publishedProfiles as string[] }
      : {}),
  }
}

function parsePicks(v: unknown): Picks {
  const picks: Picks = {}
  if (!isRecord(v)) return picks
  for (const [election, contests] of Object.entries(v)) {
    if (!isRecord(contests)) continue
    for (const [contest, choices] of Object.entries(contests)) {
      if (!Array.isArray(choices)) continue
      const valid = choices.filter((c): c is string => typeof c === 'string')
      if (valid.length) (picks[election] ??= {})[contest] = valid
    }
  }
  return picks
}

/** Reads stored data, dropping anything from another version or malformed. */
export function parseStored(raw: string | null): Stored {
  if (!raw) return EMPTY
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.version !== VERSION) return EMPTY
    return {
      version: VERSION,
      ballot: parseBallot(data.ballot),
      picks: parsePicks(data.picks),
    }
  } catch {
    return EMPTY
  }
}

/** Only what a saved ballot needs: the precinct comes from the address. */
export function toSavedBallot(ballot: Ballot | SavedBallot): SavedBallot {
  return {
    election: ballot.election,
    contests: ballot.contests,
    coverage: ballot.coverage,
    ...(ballot.publishedProfiles
      ? { publishedProfiles: ballot.publishedProfiles }
      : {}),
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function createBallotStore(
  getStorage: () => Storage | null = defaultStorage,
) {
  let state: BallotState = { ...EMPTY, persistent: false }
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  function load() {
    const storage = getStorage()
    let raw: string | null = null
    let persistent = false
    try {
      if (storage) {
        raw = storage.getItem(STORAGE_KEY)
        // Some browsers read fine but refuse writes; check once.
        const probe = `${STORAGE_KEY}:probe`
        storage.setItem(probe, '1')
        storage.removeItem(probe)
        persistent = true
      }
    } catch {
      persistent = false
    }
    const stored = parseStored(raw)
    state = { ballot: stored.ballot, picks: stored.picks, persistent }
  }

  function commit(next: Omit<BallotState, 'persistent'>) {
    let persistent = state.persistent
    if (persistent) {
      try {
        const stored: Stored = {
          version: VERSION,
          ballot: next.ballot,
          picks: next.picks,
        }
        getStorage()?.setItem(STORAGE_KEY, JSON.stringify(stored))
      } catch {
        // Full or blocked: keep going in memory and say so.
        persistent = false
      }
    }
    state = { ...next, persistent }
    emit()
  }

  function setChoices(contest: Contestish, choices: Choice[]) {
    const forElection = { ...state.picks[contest.electionId] }
    if (choices.length) forElection[contest.id] = choices
    else delete forElection[contest.id]
    const picks = { ...state.picks }
    if (Object.keys(forElection).length) picks[contest.electionId] = forElection
    else delete picks[contest.electionId]
    commit({ ballot: state.ballot, picks })
  }

  // Another tab changed the picks or the ballot: follow it.
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== STORAGE_KEY) return
    load()
    emit()
  }

  load()

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1 && typeof window !== 'undefined')
        window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && typeof window !== 'undefined')
          window.removeEventListener('storage', onStorage)
      }
    },

    /** Re-reads storage, e.g. between tests. */
    reload() {
      load()
      emit()
    },

    /**
     * Keeps this ballot as the one saved ballot. Picks for races that
     * aren't on it stay stored but hidden until the voter removes them.
     */
    saveBallot(ballot: Ballot | SavedBallot) {
      commit({ ballot: toSavedBallot(ballot), picks: state.picks })
    },

    /**
     * Picks or un-picks a candidate (checkbox behaviour), never going past
     * the race's vote-for limit: a pick in a full race replaces the earliest
     * pick still there. For yes/no votes, picking one answer replaces the
     * other and picking it again clears it.
     */
    toggle(contest: Contestish, choice: Choice): PickResult {
      const current = state.picks[contest.electionId]?.[contest.id] ?? []
      if (current.includes(choice)) {
        setChoices(
          contest,
          current.filter((c) => c !== choice),
        )
        return { kind: 'unpicked' }
      }
      if (contest.kind !== 'candidate') {
        setChoices(contest, [choice])
        return { kind: 'picked' }
      }
      // Picks are kept in the order they were made, so the first is the oldest.
      const full = current.length >= (contest.voteFor ?? 1)
      const kept = full ? current.slice(1) : current
      setChoices(contest, [...kept, choice])
      return full
        ? { kind: 'picked', replaced: current[0] }
        : { kind: 'picked' }
    },

    /** Removes every pick on this device. The saved ballot stays. */
    clearPicks() {
      commit({ ballot: state.ballot, picks: {} })
    },

    /** Removes the picks for races that aren't on the saved ballot. */
    removeHiddenPicks() {
      const onBallot = new Set(
        state.ballot?.contests.map((c) => `${c.electionId}\u0000${c.id}`),
      )
      const picks: Picks = {}
      for (const [election, contests] of Object.entries(state.picks))
        for (const [id, choices] of Object.entries(contests))
          if (onBallot.has(`${election}\u0000${id}`))
            (picks[election] ??= {})[id] = choices
      commit({ ballot: state.ballot, picks })
    },
  }
}

export type BallotStore = ReturnType<typeof createBallotStore>

/** The app's one store, shared by the ballot list, profiles and Saved choices. */
export const ballotStore = createBallotStore()

export function useBallotStore(): BallotState {
  return useSyncExternalStore(
    ballotStore.subscribe,
    ballotStore.getSnapshot,
    ballotStore.getSnapshot,
  )
}
