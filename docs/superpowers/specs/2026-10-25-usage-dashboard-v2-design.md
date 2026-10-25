# Usage dashboard v2: two paths, informed voters, and a report by question

Date: 2026-10-25. Status: draft for review (revision 3).

## Goal

VoteStack succeeds when more voters are informed. This work measures that across the two ways people use VoteStack:

- **Ballot path:** a visit that starts on Home or Get Started, looks up a ballot and works through it.
- **Reader path:** a visit that starts on a candidate profile or race page, usually from search. It reads about one race and may go on to look up a full ballot, in the same visit or a later one.

It also answers the questions the current report can't (how many people, where visits come from, how far they get) and gives the numbers funders and investors ask for. It uses only VoteStack's own counter, Worker, Analytics Engine and Supabase. Nothing is added from a third party.

Most of the cycle's useful data comes in over the next 9 days, so the report fills in every measure it can from data already collected and marks the rest "counted from <date>".

## Decisions already made

- **Informed on a race:** in a race with 2 or more candidates, the voter read at least two of them. In a race with one candidate (unopposed seats and retention judges), the voter read that one. Measures have no profiles and are left out.
- **Read a profile:** the profile was on screen for 20 seconds (time the tab is visible), or its Sources list came into view after at least 10 seconds on screen. Profiles have a median of 225 words (176 in the overview), so 20 seconds sits between a skim and a careful read of the overview. Time milestones (10, 20, 30, 60 seconds and Sources) are recorded too, so "profiles read" can be re-cut at another threshold later without losing data.
- **Profiles read:** each profile read counts once per device, on both paths. This is the measure of how much voters learn overall.
- **Informed voter:** a device informed on at least one race. The North Star is **informed voters this election**: unique devices from both paths, each counted once per election, split by path. The weekly view shows **newly informed voters per week**, which add up to the election total. Devices informed again in a later week are a smaller measure of repeat use. "Researched ballot" stays as a deeper ballot-path measure.
- **Visit steps:** the ladder in 1.1, with picks as the last step.
- **Unique devices:** per day, week, month and election.
- **Sources:** site categories only. No `?ref=` or `utm_` tags.
- **Conversion across visits:** the device remembers how it first arrived (categories only), so a later lookup can be credited to that first arrival.
- **Which link was used:** clicks on each route from a profile or race page toward a ballot are counted.
- **Cost per informed voter and per researched ballot:** running costs only (hosting and services), from a local gitignored file.
- **Change markers:** read from CHANGELOG.md release headings.
- **v2 page:** rebuilt around questions. v1 stays exactly as it is and is still written on every run.
- **Measures:** they live in a tested TypeScript module, compiled into the v2 page so date and area filters still work.

## 1. New counts from the app

All of these follow the existing rules in `src/shared/metrics.ts`: totals only, no identifier, nothing a visitor typed, and labels the Worker checks against fixed lists. Every row still fits `[event, a, b, c]` labels plus up to 8 numbers, so the rollup and `usage_hourly` don't change. Nothing is sent when counting is off, on report pages, for automated browsers or under tests, as today.

**Path** is worked out from a visit's entry page by `pathOf(entry)` in `metrics.ts`:

- `ballot` for `ballot` and `start`
- `reader` for `profile` and `races`
- `other` for any other page

### 1.1 `visit`: steps a visit reaches

`{ e: 'visit', entry: UsagePage, source: VisitSource, step: VisitStep }` is stored as `visit / entry / source / step`, with `n` = 1.

Each step is sent at most once per visit, when it is first reached, so the count at each step is the number of visits that reached it. Steps can happen in any order. The report lays out each path's ladder in its natural order.

A **visit** is one browser tab, starting with the first page counted and ending after 30 minutes with no page shown and no event sent. Its state lives in `sessionStorage` (`votestack:usage:visit:v1`): when it started, when it was last active, the entry page, the source and the steps sent. It holds no ID and is never sent. If storage is blocked, the visit lasts for the page load only.

| Step         | Reached when                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrived`    | The visit's first page is counted (after a redirect, the page actually shown, as in PR #10).                                                          |
| `browsed`    | A second page is counted in the same visit.                                                                                                           |
| `read`       | A profile is read (see the Decisions).                                                                                                                |
| `informed`   | The visitor becomes informed on a race in this visit, or a race they were already informed on is shown again.                                         |
| `form`       | An address form is on screen: the Get Started page, or the form on a race page scrolled at least half into view.                                      |
| `asked`      | The address form is submitted.                                                                                                                        |
| `lookup`     | The visitor's own ballot is shown after a lookup made in this visit (the `voter` `new` case with a time to the ballot).                               |
| `returned`   | The visitor's own ballot is shown, and it was already on the device before this visit. A ballot restored from before counting began also counts here. |
| `researched` | During this visit, the visitor's own ballot meets the researched rule (`RESEARCHED`), whether it already did or reaches it now.                       |
| `picked`     | A first pick in a race is made during this visit.                                                                                                     |

The ladders as the report shows them:

- **Reader path:** arrived → read → informed → form → asked → lookup → researched → picked.
- **Ballot path:** arrived → form → asked → lookup → informed → researched → picked, with `returned` shown beside `lookup`.

**Entry** is the `UsagePage` of the visit's first page, the same page `view` counts with `from: 'landing'`.

**Source** is worked out once, at the visit's first page, from `document.referrer`. The browser reduces it to a category, and the referrer itself is never sent:

| Source   | Referrer host (subdomains included)                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search` | google._, bing.com, duckduckgo.com, search.yahoo.com, yahoo.com, ecosia.org, search.brave.com, startpage.com, yandex._, baidu.com, kagi.com                                     |
| `ai`     | chatgpt.com, chat.openai.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, you.com, meta.ai                                                              |
| `social` | facebook.com, fb.com, instagram.com, t.co, x.com, twitter.com, reddit.com, linkedin.com, lnkd.in, threads.net, bsky.app, tiktok.com, youtube.com, nextdoor.com, mastodon.social |
| `email`  | mail.google.com, outlook.live.com, outlook.office.com, mail.yahoo.com, mail.proton.me                                                                                           |
| `other`  | Any other site                                                                                                                                                                  |
| `direct` | No referrer, or VoteStack itself                                                                                                                                                |

`gemini.google.com` and `mail.google.com` are checked before `google.*`. The lists live in `metrics.ts` beside `isAutomatedAgent`.

### 1.2 Reading and informed races

A profile can be read on its own page, or in the profile panel beside the voter's ballot. The read rule (20 visible seconds on that profile, or its Sources list in view after at least 10 visible seconds) applies to both. Time only runs while the tab is visible and that profile is the one shown.

The device keeps the profiles it has read in its usage note in `localStorage`: each profile key with the milestones already counted, capped at the 200 most recent profiles. These are public names only, kept the same way `opened` already keeps profile keys per contest. They never leave the device.

Whenever a profile is read, the app checks the race or races it belongs to, using the candidate lists the page already has (`useOpponents` on a profile page, the ballot's contests beside a ballot). A race with one candidate is informed by one read. A race with two or more is informed when at least two of its candidates have been read.

### 1.3 `read`: profiles read, with time milestones

`{ e: 'read', path: 'ballot' | 'reader' | 'other', kind: 'candidate' | 'judicial' | 'retention', mark: '10' | '20' | '30' | '60' | 'sources' | 'read' }` is stored as `read / path / kind / mark`, with `n` = 1.

Each mark is sent once per device per profile, when it is first reached. `10` to `60` are visible seconds on that profile. `sources` means the Sources list came into view. `read` means the read rule was met. `path` is the path of the current visit, and `kind` comes from the profile's own kind (`judicial_candidate` is sent as `judicial`).

- **Profiles read** is the count of `read`.
- The other marks give the spread of reading time, so the threshold can be checked against real behavior.

### 1.4 `informed`: informed voters per election and per week

`{ e: 'informed', period: 'week' | 'election', path: 'ballot' | 'reader' | 'other', kind: 'single' | 'compared' }` is stored as `informed / period / path / kind`, with `n` = 1.

The first time a device is informed on any race in the election, it sends `election`. This is the North Star, and grouping these by the week they arrive gives newly informed voters per week. It also sends `week` the first time it is informed in each week, its first week included, so `week` counts informed devices per week and the gap between `week` and newly informed shows repeat use. `path` is the path of the visit where that happened. `kind` says whether the race that did it had one candidate (`single`) or two or more (`compared`). The usage note records the last week and the election it was counted in. Week and election are defined as in 1.5.

### 1.5 `device`: unique devices per period

`{ e: 'device', period: 'day' | 'week' | 'month' | 'election', seen: 'new' | 'back' }` is stored as `device / period / seen`, with `n` = 1.

On the first counted page of a page load, the device compares today with its note in `localStorage` (`votestack:usage:seen:v1`: the last day, week, month and election it was counted in, and its first arrival from 1.7). It sends one `device` event for each period it hasn't been counted in yet, then saves the note.

- Day is local `YYYY-MM-DD`, as `today()` already uses.
- Week is the local date of that week's Monday.
- Month is `YYYY-MM`.
- Election is `USAGE_ELECTION` in `metrics.ts`, set to `2026-11-03`, the cycle's general election date. It changes once per cycle.
- `seen` is `new` only the first time this device is ever counted. A device with no note but with VoteStack's other notes (the usage record `votestack:usage:v1`, the samples key, or a saved ballot) counts as `back`, so voters from before this change aren't counted as new.
- If storage is blocked, nothing can be remembered, so the device is counted for that page load only, as `new`. Over-counting from blocked storage is a known limit, the same as today's ballot counts.

### 1.6 `cta`: which link moved a reader

`{ e: 'cta', link: CtaLink, page: UsagePage }` is stored as `cta / link / page`, with `n` = 1, one per click or submit.

| Link   | What it is                                                            |
| ------ | --------------------------------------------------------------------- |
| `top`  | The profile's top strip, "Explore your full ballot" (search arrivals) |
| `mid`  | The mid-profile "See every race" link                                 |
| `back` | The back link to Get Started on a profile                             |
| `race` | A profile's "On the ballot" link to its race page                     |
| `form` | The address form submitted on a race page                             |

The list is fixed in `metrics.ts`. A new link means adding it there.

### 1.7 `origin`: conversion across visits

The first time a device is ever counted, its `seen` note also keeps that visit's entry page type and source category. These are categories only, such as "profile, from search". They never change afterward and never leave the device except as the count below. Devices counted before this change have no first arrival, which is stored as `unknown`.

When the device's own ballot is first looked up (the `voter` `new` case), the app sends `{ e: 'origin', entry: UsagePage | 'unknown', source: VisitSource | 'unknown', when: 'same' | 'later' }`, stored as `origin / entry / source / when`. `when` says whether the lookup happened in the first-arrival visit or a later one.

### 1.8 Worker drop counts (data health)

The Worker adds rows of its own. None carries anything from the request.

- `dropped / bot`: one per batch dropped as automated (the user agent check or Cloudflare's verified-bot flag), counted before anything is read.
- `dropped / invalid`, with d1 = events rejected: one per batch in which `usagePoint` rejected at least one event.
- `dropped / limited`: one per batch refused by the rate limiter.

Risk: a bot flood writes one Analytics Engine point per dropped batch. The Cloudflare challenge rule on report pages already blocks the one flood seen so far. If writes ever near the plan's limit, `bot` can be sampled with a weight in d1.

## 2. Measures, and what history fills in

`scripts/lib/usage-measures.ts` holds pure functions over the report rows (`[hour, event, a, b, c, n, d1..d8, live]`) for a date range and area. `launchedAt(event)` is the first hour with any row of that event. Before it, each measure uses the history stand-in below, or shows "counted from <date>". Figures from stand-ins carry an "estimate" or "from history" tag.

| Measure                                                                                  | From launch                                                        | Before launch (history)                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **North Star: informed voters this election**, by path and kind                          | `informed/election`                                                | Ballot path only: `learn/compared` n=1. Opening two profiles, not reading them, so tagged "estimate: opened, not read"                    |
| Newly informed voters per week                                                           | `informed/election` grouped by week                                | Same stand-in, by week                                                                                                                    |
| Informed again in a later week                                                           | `informed/week`                                                    | Not available                                                                                                                             |
| **Profiles read**, by path and kind                                                      | `read/read`                                                        | Ballot path only: `open` (first and second profile per race), tagged "estimate: opened, not read"                                         |
| Reading time spread                                                                      | `read` marks 10, 20, 30, 60, sources                               | Not available                                                                                                                             |
| Visits                                                                                   | `visit/arrived`                                                    | `view` with `from = landing` (same definition)                                                                                            |
| Visits by path and entry page                                                            | `visit/arrived`                                                    | `view/landing` by page                                                                                                                    |
| Visits by source                                                                         | `visit/arrived` by source                                          | Not available                                                                                                                             |
| Reader ladder, ballot ladder (overall, by entry, by source)                              | `visit` counts per step                                            | Overall only: arrived (landings), lookup (`voter/new` timed), researched (`learn/researched`); tagged "estimate"                          |
| Informed readers: reader-path visits that reach `informed`                               | `visit/informed`                                                   | Not available                                                                                                                             |
| Readers who leave without a ballot: reader-path visits with no `form`, split read or not | `visit`                                                            | Not available                                                                                                                             |
| Reader-to-form rate                                                                      | `visit/form` ÷ `visit/arrived`, reader path                        | Get Started views with `from = app` ÷ profile and race landings: an upper bound, since ballot-path visits are mixed in. Tagged "estimate" |
| Which link moved readers                                                                 | `cta` by link, per 100 reader-path visits                          | Not available                                                                                                                             |
| Ballots by first arrival, same visit or later                                            | `origin`                                                           | Not available                                                                                                                             |
| Unique devices per day, week, month, election                                            | `device` by period, new and back                                   | Not available. Ballot devices per day stands in                                                                                           |
| Stickiness                                                                               | Average daily uniques in a month ÷ that month's uniques            | Not available                                                                                                                             |
| Ballot devices per day                                                                   | `voter` new + return per day                                       | Same (already collected)                                                                                                                  |
| Researched ballots per week                                                              | `learn/researched`                                                 | Same, from Oct 20                                                                                                                         |
| Input: search visits reaching the form                                                   | `visit/form` with source `search`                                  | Not available                                                                                                                             |
| Input: address-to-ballot success                                                         | `lookup` outcomes `ok` + `gaps` ÷ all non-sample lookups           | Same                                                                                                                                      |
| Input: profiles per ballot                                                               | `open` ÷ `voter/new`                                               | Same                                                                                                                                      |
| Activation: new ballots that become informed                                             | `visit/informed` ÷ `visit/lookup` (ballot path)                    | `learn/researched` ÷ `voter/new`, tagged "estimate"                                                                                       |
| Informed picks share                                                                     | `pick` informed ÷ all picks                                        | Same                                                                                                                                      |
| Coverage                                                                                 | Candidates, races and areas from `content/contests`                | Same                                                                                                                                      |
| Cost per informed voter, per researched ballot                                           | Monthly costs, prorated over the range, ÷ the count                | Same, on the stand-in counts                                                                                                              |
| Data health                                                                              | `dropped` rows, scraper exclusions, hours with no rows, live hours | Scraper exclusions and missing hours only                                                                                                 |

Weeks run Monday to Sunday in the time zone picked on the page (Chicago by default), as v1's date handling already does.

## 3. The v2 page

`scripts/lib/usage-report-v2.html` is a new template. v1's `usage-report.html` isn't edited. v2 starts from a copy of v1's styles, filters, chart helpers and tables, and is organized by question:

1. **This week:** the North Star (informed voters this election, by path, with newly informed voters per week), profiles read, the inputs, activation, and a one-line data health strip.
2. **How many people?** Unique devices per period (new and back), stickiness, ballot devices per day, visits per day.
3. **Where do visits come from?** Visits by source, path and entry page, and how many of each become informed or reach a ballot.
4. **The two paths, side by side.**
   - The reader ladder and the ballot ladder.
   - Informed readers.
   - Readers who leave without a ballot (read or not).
   - Which link moved readers.
   - Ballots by first arrival, in the same visit or later.
   - Lookup outcomes by area.
5. **How deep do voters go?** v1's learning sections, informed picks, fill milestones, time on screen, page views by how visitors got there, and top pages.
6. **Outcomes, for funders:**
   - informed voters this election, profiles read, ballots looked up, researched ballots and informed picks
   - coverage
   - cost per informed voter and per researched ballot
   - a short list of what isn't measured: people rather than devices, what voters do after the visit, and turnout
7. **Demand and guardrails:** sign-ups, error reports, links out, when people come, and data health in detail.
8. **Explore the counts** (as in v1).

Every time chart has a marker at each CHANGELOG.md release date, labeled with the version, plus its first bullet on hover.

## 4. Build

- `scripts/usage-report.ts` builds its data once and writes both `data/build/usage/report.html` (as today) and `data/build/usage/report-v2.html`. The v2 data adds `releases` (parsed from CHANGELOG.md), `coverage` and `costs`.
- Costs are read from `.private/usage-costs.json` (gitignored), shaped like `{ "monthly": [{ "name": "Cloudflare Workers", "usd": 5, "from": "2026-10" }] }`. If the file is missing or invalid, the v2 page says "Add running costs to .private/usage-costs.json to see this" and the run still succeeds.
- The measures module imports nothing and uses only erasable TypeScript, so Node's built-in `module.stripTypeScriptTypes` turns it into plain JavaScript that is inlined into the v2 page. No new dependency.
- `npm run usage:report` stays the one command, and the console line names both files.

## 5. Privacy copy

The About page's counting paragraph (`src/pages/AboutPage.tsx`) is updated, following brand/VOICE.md, and kept at the level of commitments rather than mechanics:

> To learn what helps voters, we count how VoteStack is used: which pages are opened and read, how many ballots are looked up, how many races get a pick and how long the site is open. We keep only totals, by page, level of government and county, and by the kind of site a visit came from (a search engine, for example) and how far the visit got. We never count your address, your IP address, the names you pick or the page you came from, and nothing tells one visitor apart from another. Your device keeps a short note that never leaves it, so it's counted once a day, week, month and election, and so we know how a visit first found VoteStack. Cloudflare, which hosts VoteStack, also counts visits without cookies.

`AboutPage.test.tsx` is updated in the same change. The comment headers in `metrics.ts` and `usage.ts` are updated to describe the visit, device and read notes.

## 6. Testing

Tests are written before the code they cover (superpowers TDD: watch each fail, then pass).

- `src/shared/metrics.test.ts`:
  - `usagePoint` accepts and labels `visit`, `device`, `read`, `informed`, `cta` and `origin`, and rejects unknown values in every label.
  - `visitSource(referrer, host)` maps each list, subdomains, `gemini.google.com` and `mail.google.com`, empty, same-host and malformed referrers.
  - `pathOf` maps every page.
- `src/metrics/usage.test.ts`:
  - **Visits:** start, the 30-minute timeout, each step sent once, steps never sent on skipped or off pages, and blocked session storage.
  - **Devices:** first ever (all `new`), the same day (nothing), the next day (day only), a new week and month, and `back` for a device with an older usage record or saved ballot.
  - **Informed:** a single-candidate race informed by one read; a two-candidate race needing two reads; measures ignored; `informed` election and week sent once each with the right path and kind; read notes capped at 200 profiles.
  - **Read:** each mark sent once per device per profile; `read` at 20 seconds, or at Sources after 10 seconds but not before; `judicial_candidate` sent as `judicial`.
  - **Origin:** the first arrival saved once; `same` versus `later`; `unknown` for older devices.
- `src/metrics/read.test.tsx` (or beside the profile components): visible-time milestones, time not counted while the tab is hidden or another profile is shown, Sources in view before and after 10 seconds, and both the profile page and the ballot's profile panel.
- `src/metrics/views.test.tsx` (real routes):
  - A visit landing on a profile sends `arrived` with entry `profile`.
  - Landing on `/` with no ballot sends entry `start` and `form`.
  - A lookup sends `asked`, `lookup` and `origin`.
  - A saved ballot sends `returned`.
  - Clicking the top strip sends `cta/top`.
- A new `worker/events.test.ts`: dropped bot batches, invalid events and rate-limited batches each write their `dropped` row. Valid batches write none.
- `scripts/lib/usage-measures.test.ts`: every measure in section 2, including the switch from history stand-ins to new counts at each `launchedAt`, Monday weeks in the chosen time zone, cost proration and division by zero.
- `scripts/lib/usage-report-build.test.ts`:
  - The v1 page is the v1 template with only the data placeholder replaced, and its data object has exactly today's keys.
  - CHANGELOG parsing.
  - The costs file, whether present, missing or invalid.

## 7. Release

A PATCH bump in package.json and CHANGELOG.md, plus the workspace STATUS notes, with no tag. Counting and internal reporting add no new value for voters. Nothing is committed or pushed without the maintainer's go-ahead.

## Out of scope

Cohort retention by days since first visit, speed and error counts, Google Search Console, `?ref=` tags, satisfaction prompts, and any change to the rollup or database.
