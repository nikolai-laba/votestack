// What each region must have before its ballots and profiles go live: the
// files every step of the pipeline writes, where they are, and the floors
// its profiles must reach. `npm run region:check` checks a region against
// its entry, so a new area can't go live with a step skipped or a file
// quietly empty. A region in src/shared/regions.ts without an entry here
// fails the tests.

/** A file a step writes, and the command that writes it. */
export interface Artifact {
  /** Path from the repo root. */
  path: string
  /** The command that makes it, for the failure message. */
  by: string
  /** Committed to git (content/), so the site's build can read it. */
  committed?: boolean
}

export interface RegionManifest {
  /** Ballot data: contest lists, precincts and splits. */
  ballot: {
    contests: Artifact[]
    precincts: Artifact
    splits: Artifact
    /** Paper ballot order: from specimen ballots, or carried on the contests. */
    paperOrder: { from: 'file'; artifact: Artifact } | { from: 'contests' }
    /**
     * The check against an official ground truth, how its file reports
     * agreement, and the agreement it must reach: `sample-ballots` lists one
     * result per precinct (agreeing when nothing is missing or extra);
     * `address-sample` gives an `agreeRate` over sampled addresses.
     */
    audit: {
      artifact: Artifact
      kind: 'sample-ballots' | 'address-sample'
      minAgreement: number
    }
  }
  /** The public race list the race pages build from. */
  raceList: Artifact
  incumbents: { labels: Artifact; roster: Artifact }
  profiles: {
    subjects: Artifact
    dir: Artifact
    check: Artifact
    money: Artifact
    published: Artifact
    /** Bar ratings, when the region's judges are rated by bar groups. */
    barRatings?: Artifact
    /** Official legislative rosters for endorsers' parties. */
    rosters?: Artifact
    /** Published endorsement lists (one JSON per group). */
    slatesDir?: Artifact
  }
  /**
   * The least share of candidates (not retention judges) whose profiles
   * must have each part. Money counts a summary, a shared committee or a
   * link to the filings; "Not found" counts against it.
   */
  floors: {
    overview: number
    endorsements: number
    money: number
    /** Candidates with a summary from a filing (not just a link or a note). */
    moneySummaries: number
    incumbentLabels: number
  }
}

const COOK_DATE = '2026-11-03'

export const MANIFESTS: Record<string, RegionManifest> = {
  'il-cook': {
    ballot: {
      contests: [
        {
          path: 'data/build/contests/cook-clerk.json',
          by: 'npm run data:build',
        },
        {
          path: 'data/build/contests/chicago-boe.json',
          by: 'npm run data:build',
        },
      ],
      precincts: {
        path: 'data/build/precincts.json',
        by: 'npm run data:build',
      },
      splits: {
        path: 'data/build/clerk-precincts.json',
        by: 'npm run data:build',
      },
      paperOrder: {
        from: 'file',
        artifact: {
          path: 'data/build/paper-order.json',
          by: 'npm run data:build',
        },
      },
      audit: {
        artifact: {
          path: 'data/build/sample-ballot-audit.json',
          by: 'npm run data:audit',
        },
        kind: 'sample-ballots',
        minAgreement: 0.99,
      },
    },
    raceList: {
      path: `content/contests/${COOK_DATE}.json`,
      by: 'npm run contests:export -- --region=il-cook',
      committed: true,
    },
    incumbents: {
      labels: {
        path: `content/incumbents/${COOK_DATE}.json`,
        by: 'npm run data:incumbents -- --region=il-cook',
        committed: true,
      },
      roster: {
        path: 'content/incumbents/rosters.json',
        by: 'hand-checked',
        committed: true,
      },
    },
    profiles: {
      subjects: {
        path: 'data/build/profiles/subjects.json',
        by: 'npm run profiles:subjects',
      },
      dir: {
        path: `content/profiles/${COOK_DATE}`,
        by: 'npm run profiles:generate',
        committed: true,
      },
      check: {
        path: 'data/build/profiles/check.json',
        by: 'npm run profiles:check',
      },
      money: {
        path: 'data/build/profiles/money.json',
        by: 'npm run profiles:money',
      },
      published: {
        path: `content/profiles/published/${COOK_DATE}.json`,
        by: 'npm run profiles:publish',
        committed: true,
      },
      barRatings: {
        path: 'content/profiles/judges/bar-ratings.json',
        by: 'npm run profiles:judges',
        committed: true,
      },
      slatesDir: {
        path: 'content/profiles/slates',
        by: 'npm run profiles:slates',
        committed: true,
      },
    },
    floors: {
      overview: 0.98,
      endorsements: 0.85,
      money: 0.65,
      moneySummaries: 0.6,
      incumbentLabels: 0.1,
    },
  },
  'ca-la': {
    ballot: {
      contests: [
        { path: 'data/build/la/contests.json', by: 'npm run la:build' },
      ],
      precincts: {
        path: 'data/build/la/precincts.json',
        by: 'npm run la:build',
      },
      splits: {
        path: 'data/build/la/precinct-splits.json',
        by: 'npm run la:build',
      },
      paperOrder: { from: 'contests' },
      audit: {
        artifact: { path: 'data/build/la/audit.json', by: 'npm run la:audit' },
        kind: 'address-sample',
        minAgreement: 0.99,
      },
    },
    raceList: {
      path: `content/contests/ca-la/${COOK_DATE}.json`,
      by: 'npm run contests:export -- --region=ca-la',
      committed: true,
    },
    incumbents: {
      labels: {
        path: `content/incumbents/ca-la/${COOK_DATE}.json`,
        by: 'npm run data:incumbents -- --region=ca-la',
        committed: true,
      },
      roster: {
        path: 'content/incumbents/ca-la/rosters.json',
        by: 'hand-checked',
        committed: true,
      },
    },
    profiles: {
      subjects: {
        path: 'data/build/profiles/ca-la/subjects.json',
        by: 'npm run profiles:subjects -- --region=ca-la',
      },
      dir: {
        path: `content/profiles/ca-la/${COOK_DATE}`,
        by: 'npm run profiles:generate -- --region=ca-la',
        committed: true,
      },
      check: {
        path: 'data/build/profiles/ca-la/check.json',
        by: 'npm run profiles:check -- --region=ca-la',
      },
      money: {
        path: 'data/build/profiles/ca-la/money.json',
        by: 'npm run profiles:money -- --region=ca-la',
      },
      published: {
        path: `content/profiles/published/ca-la/${COOK_DATE}.json`,
        by: 'npm run profiles:publish -- --region=ca-la',
        committed: true,
      },
      barRatings: {
        path: 'content/profiles/ca-la/judges/bar-ratings.json',
        by: 'npm run profiles:judges -- --region=ca-la',
        committed: true,
      },
      rosters: {
        path: 'content/profiles/ca-la/rosters.json',
        by: 'npm run profiles:rosters -- --region=ca-la',
        committed: true,
      },
      slatesDir: {
        path: 'content/profiles/slates/ca-la',
        by: 'npm run profiles:slates -- --region=ca-la',
        committed: true,
      },
    },
    floors: {
      overview: 0.98,
      endorsements: 0.85,
      money: 0.65,
      moneySummaries: 0.6,
      incumbentLabels: 0.1,
    },
  },
}
