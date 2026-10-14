# VoteStack

See every election, race, and candidate on your ballot, then plan your picks before you vote. VoteStack is starting with **Chicago and suburban Cook County, Illinois**, and is meant to cover every upcoming election over time.

> **VoteStack is not an official election source.** Always confirm your ballot with the [Chicago Board of Election Commissioners](https://chicagoelections.gov) or the [Cook County Clerk](https://www.cookcountyclerkil.gov/elections).

## Why VoteStack exists

I'm Nikolai Laba, a voter living in Oak Park (Cook County), IL, trying to build a way to help voters understand their ballot. I wanted one place to see everything on my ballot, explained plainly, with a source for every fact. VoteStack is the tool I wanted.

VoteStack is paid for by its maintainer. It takes no money from candidates, parties or campaigns.

## How VoteStack stays neutral

VoteStack doesn't support or oppose any candidate, party or referendum, and it doesn't tell you how to vote. It follows the same rules for everyone:

- Candidates are listed in official ballot order. VoteStack never changes it.
- Every candidate in a race gets the same research, the same parts and the same length limit.
- Profiles for a race appear only when every candidate in it passes the checks.
- No candidate is featured, ranked or recommended.
- Party is shown as text, never as a color.

The site's How we make profiles page (https://votestack.org/how-profiles-are-made) explains the method step by step.

## How to use it

Open the site at [votestack.org](https://votestack.org), enter your home address and see your ballot. You can also try a sample ballot without entering an address.

## How to help

- To report a mistake in a profile, use the "Report an error" link on that profile.
- To report a bug or suggest an idea, [open an issue](https://github.com/nikolai-laba/votestack/issues).
- To contribute code, read [CONTRIBUTING.md](CONTRIBUTING.md).

See [CHANGELOG.md](CHANGELOG.md) for what's changed.

---

The rest of this file is for developers.

## Open code, pluggable data

The code is open source under Apache-2.0. Some of the data it can use is not:

- Ballot data comes through **provider adapters** (`src/shared/provider.ts`). Each one converts a data source into one internal schema (election → contest → candidate/retention/measure). The current adapter (`worker/ballot.ts`) reads official data from the Cook County Clerk and the Chicago Board of Election Commissioners, loaded into Supabase. Others, such as Ballotpedia, BallotReady, or a dataset you curate yourself, can be added without changing the app.
- Proprietary sources need your own API keys and are subject to their own terms. You can fork VoteStack, plug in your own provider, and run your own ballot tracker.

## Tech stack

- **Web app:** React, Vite, TypeScript, React Router, TanStack Query, Tailwind CSS
- **API + hosting:** a Cloudflare Worker (`worker/`) serves the API and the built site as static assets. The Worker is the only place API keys are used.
- **Database:** Supabase Postgres with PostGIS (`supabase/migrations/`), read only by the Worker
- **Mobile (planned):** Capacitor wrapper for iOS and Android

## Getting started

Requirements: Node.js 24+ and [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`), which the pre-commit hook uses to block committed secrets.

```sh
npm install        # also installs the git hooks
npm run dev        # web app only, at http://localhost:5173
npm run dev:full   # build, then serve the app and API Worker at http://localhost:8787
```

| Command                                   | What it does                                          |
| ----------------------------------------- | ----------------------------------------------------- |
| `npm run lint`                            | Lint with oxlint                                      |
| `npm run format`                          | Format with Prettier                                  |
| `npm test`                                | Run all tests once (Vitest)                           |
| `npm test -- src/pages/HomePage.test.tsx` | Run one test file                                     |
| `npm run typecheck`                       | Type-check the app and Worker                         |
| `npm run build`                           | Type-check, build to `dist/` and prerender every page |

The pre-commit hooks (lefthook) run gitleaks, oxlint and Prettier on staged files. CI (`.github/workflows/ci.yml`) runs lint, the format check, tests, the build and a gitleaks scan.

## Architecture

- `src/`: the React single-page app. Routes are defined in `src/routes.tsx` and shared by the app (`main.tsx`) and the tests. The build must keep working as plain static files in `dist/` (no server at request time), so it can be wrapped for iOS and Android with Capacitor later. After `vite build`, `scripts/prerender.ts` writes every page as its own HTML file (`about.html`, `candidates/{key}.html`), rendered with the app's own components (`src/prerender.tsx`), plus `robots.txt`, `sitemap.xml` and `404.html`. Each page's title, description and canonical address come from `src/head.ts`. Candidate pages are built for the profiles in `content/profiles/published/`, which `npm run profiles:publish` writes. Race pages (`races/…`) are built from `content/contests/`, which `npm run contests:export` writes from the official race lists.
- `worker/`: the Cloudflare Worker (`worker/index.ts`), the only server-side code and the only place API keys are read. `wrangler.toml` serves `dist/` as static assets; an address with no file gets `404.html` with a 404 status. Only `/api/*` runs the Worker. `POST /api/ballot` (`worker/ballot.ts`) runs the lookup; the address is only ever in the request body and is never logged or cached.
- `src/shared/`: the internal ballot schema (`ballot.ts`: Election → Contest → Candidate, Retention or Measure, keyed by OCD-IDs in `ocd.ts`), the `BallotProvider` and `Geocoder` interfaces (`provider.ts`), address parsing and point-in-polygon. Shared by the app, the Worker and the scripts; keep it dependency-free.
- `scripts/`: Node scripts (plain `.ts`, so only erasable TypeScript syntax) that import official data and build profiles. Downloaded and generated data goes to the gitignored `data/raw/` and `data/build/`. Districts come from the voter's address point, not the precinct, because precincts can cross district lines.
- `supabase/migrations/`: the Postgres and PostGIS schema. Row-level security is on for every table with no policies; only the Worker reads it, with the secret key, through SQL functions.
- `content/`: candidate profiles, hand corrections, endorsement lists and the public race list, committed so every change is a reviewable diff (see [content/profiles/README.md](content/profiles/README.md)).

Ballot completeness is a core rule: ballots are checked against the official contest lists and sample ballots, and the app shows possible gaps instead of hiding them.

## Configuration and secrets

Never commit real keys. Copy the example files and fill in your own values. The copies are gitignored:

- `.dev.vars.example` → `.dev.vars`: server-only keys for the API Worker during local development. In production, set them as encrypted secrets on the Worker in the Cloudflare dashboard.
- `.env.example` → `.env`: variables for scripts, plus `VITE_*` client variables.

Anything prefixed `VITE_` is bundled into the public website. Only put public values there, such as the Supabase URL and its publishable key.

## Data sources and attribution

Ballots are built from official sources only: the Cook County Clerk's and the Chicago Board of Election Commissioners' lists of races, candidates and referenda, Cook County address points, and official district maps from Cook County, the City of Chicago and the State of Illinois. Campaign money comes from Illinois State Board of Elections and FEC filings. [data/README.md](data/README.md) lists every source, its terms and the commands that download and build the data (`npm run data:fetch`, `npm run data:build`, `npm run data:audit`, `npm run data:load`). This data is not covered by the Apache-2.0 license, and the City of Chicago's terms require the data notice shown in the site footer.

## How candidate profiles are made

Voters can read the full method on the site at [/how-profiles-are-made](src/pages/HowProfilesPage.tsx). In short:

- **Same parts for everyone:** Overview, Campaign money, Endorsements (for judges, also bar association ratings) and a numbered list of Sources, in that order. Overview length is set by the race (`OVERVIEW_WORD_LIMITS` in `src/shared/profile.ts`), never by the candidate. An empty part says "Not found in public sources" with the date.
- **Sources:** news organizations, candidates' own sites, Wikipedia, Ballotpedia, official sources, bar associations and endorsing organizations. No social media and no opponents' material. Profiles never include home addresses, contact details, family, birth dates or unproven allegations.
- **Written by AI, checked by AI and software.** DeepSeek V4 Pro drafts each overview from search results, and Gemini 3.1 Pro opens every cited page and keeps, corrects or removes each sentence. The checks in `scripts/lib/profiles/` cover citations, allowed sources, links that open (no login or paywall pages), source dates, tone, length, privacy patterns and equal coverage within a race. A race publishes only when every candidate in it passes.
- **Not written by AI:** campaign money comes from FEC and ISBE filings (`scripts/profiles/money.ts`; ISBE's published bulk data files only, never its search pages). Judges' bar ratings are copied word for word from the published lists (`scripts/profiles/judges.ts`, `content/profiles/judges/`).
- **No ranking or recommendations.** Endorsements and ratings are reported as published.

When you change a check, a source rule or a limit, update the methods page and this summary in the same commit.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, test and propose changes. To report a vulnerability or an exposed key, see [SECURITY.md](SECURITY.md).

## License

- **Code:** [Apache License 2.0](LICENSE).
- **Candidate profiles and other content in `content/`:** [Creative Commons Attribution 4.0](content/LICENSE) (CC BY 4.0). Credit "VoteStack (votestack.org)" when you reuse it.
- **Election data:** not covered by either license. Each source keeps its own terms; see [data/README.md](data/README.md).

See [NOTICE](NOTICE) for details.
