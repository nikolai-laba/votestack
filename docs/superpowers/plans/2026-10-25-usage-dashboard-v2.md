# Usage dashboard v2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** count visits, unique devices, profiles read and informed voters across the ballot and reader paths, then show them in a new `report-v2.html` organized by question, while `report.html` stays unchanged.

**Architecture:** the app gets three small counting modules (visits, devices, reading), composed by the existing `createUsage`. Every new event goes through the same `add()` gate and the same Worker checks in `metrics.ts`, so the rollup and database don't change. The report computes the v2 measures in one pure, dependency-free TypeScript module. Node's `stripTypeScriptTypes` inlines that module into a second HTML template.

**Tech stack:** React 19 with react-router, Vitest with jsdom and Testing Library, a Cloudflare Worker, Analytics Engine, Supabase, and Node 25 scripts run as `.ts`.

**Spec:** `docs/superpowers/specs/2026-10-25-usage-dashboard-v2-design.md`. Read it before any task. Section numbers below refer to it.

## Global constraints

- Nothing that tells one visitor from another is ever sent. The only labels allowed are those in the fixed lists in `src/shared/metrics.ts`. The referrer, address and picks are never sent.
- Every new event goes through `createUsage`'s `add()`. Nothing is counted when counting is off (`?count=off`), on report pages (`skipPage`), for automated browsers or under tests.
- Every storage call is wrapped in try/catch. Blocked storage means counts last for the page load only.
- Storage keys: `votestack:usage:visit:v1` (sessionStorage), `votestack:usage:seen:v1` and `votestack:usage:reads:v1` (localStorage).
- Constants:
  - `VISIT_TIMEOUT_MS = 30 * 60_000`
  - `READ_RULE = { secs: 20, sourcesAfter: 10 }`
  - `READ_MARKS = [10, 20, 30, 60]`
  - `MAX_READ_PROFILES = 200`
  - `USAGE_ELECTION = '2026-11-03'`
- Rows stay `[event, a, b, c]` plus at most 8 doubles. `worker/rollup.ts` and the database are not touched.
- `scripts/lib/usage-report.html` (v1) is not edited.
- `scripts/lib/usage-measures.ts` imports nothing and uses only erasable TypeScript syntax: no enums, no namespaces, no parameter properties.
- Voter-facing copy follows `~/Projects/votestack-workspace/brand/VOICE.md`: no em dashes, plain words.
- No new dependencies.
- Commits go on `claude/usage-dashboard-v2` only, one per task, with the maintainer's go-ahead given for this plan. There's no Claude attribution line, and nothing is pushed.

## Review focus

1. **A visit in two tabs, or after a reload.** sessionStorage is per tab, so a reload in the same tab continues the visit (no second `arrived`), and a new tab starts its own visit. Owned by Task 3, tested by `a reload in the same tab continues the visit`.
2. **A profile panel beside the ballot that switches from one candidate to another.** Read time must reset per profile and never carry over. Owned by Task 7, tested by `time on one profile never counts toward the next`.
3. **Race lists still loading when a read completes.** Informed must still be counted once the candidate list arrives. Owned by Task 5 (`informed is checked again when races arrive later`) and Task 7.
4. **Area filter in v2.** The new events carry no region, so measures built on them must show all areas with a visible "all areas" note when an area is picked, never zero. Owned by Task 9 (`ignores the area filter for events without a region`) and Task 11.
5. **The first days after launch.** A measure whose range covers both history and new counts must use the stand-in before `launchedAt` and the new counts after it, never both for the same hour. Owned by Task 9, tested by `switches from history to new counts at launch without double counting`.

---

### Task 1: Event vocabulary and Worker checks

**Files:**

- Modify: `src/shared/metrics.ts`
- Test: `src/shared/metrics.test.ts`

**Interfaces:**

- Produces, all exported from `metrics.ts`:
  - `type VisitSource = 'search' | 'ai' | 'social' | 'email' | 'other' | 'direct'`
  - `type VisitStep = 'arrived' | 'browsed' | 'read' | 'informed' | 'form' | 'asked' | 'lookup' | 'returned' | 'researched' | 'picked'`
  - `type VisitPath = 'ballot' | 'reader' | 'other'`
  - `type DevicePeriod = 'day' | 'week' | 'month' | 'election'`
  - `type CtaLink = 'top' | 'mid' | 'back' | 'race' | 'form'`
  - `type ReadKind = 'candidate' | 'judicial' | 'retention'`
  - `type ReadMark = '10' | '20' | '30' | '60' | 'sources' | 'read'`
  - `type DropReason = 'bot' | 'invalid' | 'limited'`
  - The constants from Global constraints
  - `visitSource(referrer: string, host: string): VisitSource`
  - `pathOf(page: UsagePage): VisitPath`
  - `mondayOf(day: string): string`, where `day` is `YYYY-MM-DD` and the result is that week's Monday in the same format
  - `droppedPoint(reason: DropReason, rejected?: number): UsagePoint`
  - New `UsageEvent` members:
    - `{ e: 'visit'; entry: UsagePage; source: VisitSource; step: VisitStep }`
    - `{ e: 'device'; period: DevicePeriod; seen: 'new' | 'back' }`
    - `{ e: 'read'; path: VisitPath; kind: ReadKind; mark: ReadMark }`
    - `{ e: 'informed'; period: 'week' | 'election'; path: VisitPath; kind: 'single' | 'compared' }`
    - `{ e: 'cta'; link: CtaLink; page: UsagePage }`
    - `{ e: 'origin'; entry: UsagePage | 'unknown'; source: VisitSource | 'unknown'; when: 'same' | 'later' }`

- [ ] **Step 1: Write the failing tests** in `metrics.test.ts`, under a new `describe('v2 events')`:
  - `labels a visit step`: `usagePoint({e:'visit', entry:'profile', source:'search', step:'read'})` returns `{blobs:['visit','profile','search','read'], doubles:[]}`.
  - `labels device, read, informed, cta and origin`, one `expect` each, in label order:
    - `['device','week','new','']`
    - `['read','reader','retention','sources']`
    - `['informed','election','ballot','compared']`
    - `['cta','top','profile','']`
    - `['origin','unknown','unknown','later']`
  - `refuses unknown v2 values`: each of `step:'scrolled'`, `source:'google'`, `period:'year'`, `seen:'old'`, `mark:'45'`, `kind:'judicial_candidate'` (read), `link:'footer'` and `when:'soon'` returns `null`.
  - `sorts referrers into categories`, with `host = 'votestack.org'`:
    - `https://www.google.com/` → `search`
    - `https://gemini.google.com/app` → `ai`
    - `https://mail.google.com/` → `email`
    - `https://l.facebook.com/x` → `social`
    - `https://news.example.org/a` → `other`
    - `''` → `direct`
    - `https://votestack.org/races` → `direct`
    - `not a url` → `direct`
    - `https://www.bing.com/search?q=x` → `search`
    - `https://chatgpt.com/` → `ai`
  - `maps pages to paths`:
    - `pathOf('profile')` and `pathOf('races')` are `reader`
    - `pathOf('ballot')` and `pathOf('start')` are `ballot`
    - `pathOf('about')` is `other`
  - `finds the Monday of a week`:
    - `mondayOf('2026-10-25')` (a Sunday) is `'2026-10-19'`
    - `mondayOf('2026-10-26')` is `'2026-10-26'`
    - `mondayOf('2026-11-01')` is `'2026-10-26'`
  - `counts dropped batches`:
    - `droppedPoint('bot')` returns `{blobs:['dropped','bot','',''], doubles:[]}`
    - `droppedPoint('invalid', 3)` returns doubles `[3]`

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/shared/metrics.test.ts`. Expected: FAIL, because `visitSource`, `pathOf`, `mondayOf` and `droppedPoint` aren't exported yet.

- [ ] **Step 3: Implement it in `metrics.ts`.**
  - Add host lists as arrays of suffixes, matched on `hostname === s || hostname.endsWith('.' + s)`. `google.*` and `yandex.*` match the label `google.` or `yandex.` at any position. Check in order: ai, email, search, social, then other.
  - `visitSource` parses with `new URL` inside try/catch.
  - Add the six `usagePoint` cases using the existing `isOneOf` and `point`.
  - `mondayOf` uses UTC date arithmetic on the parsed day, so it works the same in any time zone.
  - Update the file's header comment so it names visits, devices and reads.

- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run src/shared/metrics.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/shared/metrics.ts src/shared/metrics.test.ts && git commit -m "feat(metrics): v2 event vocabulary and checks"`

### Task 2: Worker drop counts

**Files:**

- Modify: `worker/events.ts`
- Create: `worker/events.test.ts`

**Interfaces:**

- Consumes: `droppedPoint` (Task 1).
- Produces: no new exports. `eventResponse` writes `dropped` rows.

- [ ] **Step 1: Write the failing tests.** Use a fake dataset `{ writeDataPoint: vi.fn() }` and a limiter `{ limit: async () => ({ success }) }`. Look at `worker/index.test.ts` for how requests are built.
  - `counts a batch dropped as a bot`: a POST with User-Agent `Googlebot/2.1` writes exactly one point, with blobs `['dropped','bot','','']`.
  - `counts a rate-limited batch`: a 429 response writes one point with blobs `['dropped','limited','','']`.
  - `counts rejected events in a batch`: `{events:[validView, {e:'nope'}, {e:'visit',step:'x'}]}` writes the view plus one `['dropped','invalid','','']` with doubles `[2]`.
  - `writes no drop row for a clean batch`: a batch with only valid events writes no `dropped` point.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run worker/events.test.ts`. Expected: FAIL, since no `dropped` points are written.
- [ ] **Step 3: Implement it in `eventResponse`.** Call `write(deps.dataset, droppedPoint(...))` at the bot return, at the 429 return, and after the loop when the rejected count is greater than 0. Leave the responses unchanged.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run worker/` and confirm every worker test passes.
- [ ] **Step 5: Commit.** `git commit -m "feat(metrics): Worker counts the batches it drops"`

### Task 3: Visits module

**Files:**

- Create: `src/metrics/visits.ts`, `src/metrics/visits.test.ts`

**Interfaces:**

- Consumes: the types from Task 1, plus `VISIT_TIMEOUT_MS`, `visitSource` and `pathOf`.
- Produces: `createVisits(deps: VisitDeps): Visits`
  - `VisitDeps = { session: () => Storage | null; now: () => number /* ms */; referrer: () => string; host: () => string; add: (e: UsageEvent) => void }`
  - `Visits`:
    - `shown(page: UsagePage): void`: call once per counted page view
    - `step(step: VisitStep): void`
    - `current(): { started: number; entry: UsagePage; source: VisitSource; path: VisitPath } | null`
    - `isNew(): boolean`: true when the current visit began on this page load

- [ ] **Step 1: Write the failing tests.** Use `MemoryStorage` from `src/test/memoryStorage.ts` and a mutable `now`.
  - `starts a visit on the first page`: `shown('profile')`, with referrer google, sends `{e:'visit', entry:'profile', source:'search', step:'arrived'}`.
  - `counts a second page as browsed, once`: three `shown` calls send `arrived` and `browsed` once each.
  - `sends each step once per visit`: `step('form')` twice sends one event.
  - `starts a new visit after 30 idle minutes`: after `now += 30*60_000 + 1`, `shown('ballot')` sends `arrived` with entry `ballot`.
  - `a reload in the same tab continues the visit`: a second `createVisits` on the same session storage, within the timeout, makes `shown('about')` send `browsed`, not `arrived`.
  - `ignores steps before any page`: `step('asked')` before `shown` sends nothing.
  - `lasts for the page load when session storage is blocked`: with `session: () => null`, it behaves the same within one instance.
  - `keeps the visit alive with activity`: a `step` at minute 25 and a `shown` at minute 50 continue the same visit.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run src/metrics/visits.test.ts`. Expected: FAIL, since the module doesn't exist.
- [ ] **Step 3: Implement it in `src/metrics/visits.ts`.** The stored JSON is `{ started, last, entry, source, steps: VisitStep[] }`. The module keeps its own in-memory copy and uses it whenever a read or write fails. `last` updates on every `shown` and every `step`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(metrics): count the steps a visit reaches"`

### Task 4: Devices and origin module

**Files:**

- Create: `src/metrics/devices.ts`, `src/metrics/devices.test.ts`

**Interfaces:**

- Consumes: `mondayOf`, `USAGE_ELECTION` and the event types from Task 1.
- Produces: `createDevices(deps: DeviceDeps): Devices`
  - `DeviceDeps = { storage: () => Storage | null; today: () => string; add: (e: UsageEvent) => void; hadOlderNotes: () => boolean }`
  - `Devices`:
    - `counted(visit: { started: number; entry: UsagePage; source: VisitSource }): void`: call on the first counted page of each page load
    - `origin(visitStarted: number): void`: call on a device's first own-ballot lookup

- [ ] **Step 1: Write the failing tests.**
  - `counts a brand-new device in every period`: the first `counted` sends four `device` events (`day`, `week`, `month` and `election`), each `seen:'new'`.
  - `counts nothing more the same day`: a second `counted` the same day, on a new instance, sends nothing.
  - `counts only the day on the next day of the same week`: Mon `2026-10-19`, then Tue `2026-10-20`, sends only `day`, `back`.
  - `counts a new week and a new month`: `2026-10-31`, then `2026-11-02`, sends `day`, `week` and `month`, all `back`.
  - `treats a device with older VoteStack notes as back`: with `hadOlderNotes: () => true`, the first `counted` sends all four with `seen:'back'`.
  - `keeps the first arrival and credits the lookup`:
    - `counted({started: 1, entry:'profile', source:'search'})`, then `origin(1)`, sends `{e:'origin', entry:'profile', source:'search', when:'same'}`.
    - On a later visit, `origin(2)` sends `when:'later'`.
  - `marks the first arrival unknown for older devices`: with `hadOlderNotes` true, `origin(5)` sends entry and source `unknown`, `when:'later'`.
  - `counts as new for the page load when storage is blocked`: with `storage: () => null`, it sends four `new` events and doesn't throw.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement it in `src/metrics/devices.ts`.** The note at `votestack:usage:seen:v1` is `{ day, week, month, election, first: { started, entry, source } | 'unknown' }`. Month is `day.slice(0, 7)`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(metrics): count unique devices and first arrivals"`

### Task 5: Reading and informed module

**Files:**

- Create: `src/metrics/reading.ts`, `src/metrics/reading.test.ts`

**Interfaces:**

- Consumes: `READ_RULE`, `READ_MARKS`, `MAX_READ_PROFILES`, `mondayOf`, `USAGE_ELECTION` and the event types from Task 1.
- Produces: `createReading(deps: ReadingDeps): Reading`
  - `ReadingDeps = { storage: () => Storage | null; today: () => string; add: (e: UsageEvent) => void; path: () => VisitPath; step: (s: VisitStep) => void }`
  - `ReadProfile = { key: string; kind: 'candidate' | 'judicial_candidate' | 'retention' }`
  - `Reading`: `progress(profile: ReadProfile, secs: number, sourcesSeen: boolean, races: string[][] | undefined): void`. Each inner array lists every candidate's profile key in one race the profile belongs to, this profile included.

- [ ] **Step 1: Write the failing tests.**
  - `sends each time mark once per profile`: `progress(p, 12, false)` sends mark `10`. `progress(p, 25, false)` sends `20` and `read`. A repeat of `progress(p, 25, false)` sends nothing.
  - `counts a read at Sources only after 10 seconds`: `progress(p, 5, true)` sends `sources` but not `read`. `progress(p, 10, true)` sends `10` and `read`.
  - `sends judicial candidates as judicial`: a profile with kind `judicial_candidate` sends `kind:'judicial'`.
  - `informs a single-candidate race with one read`: a read with `races [[p.key]]` sends a `visit` step `informed`, plus `informed` with periods `election` and `week`, `kind:'single'`, and `path` from deps.
  - `needs two reads in a contested race`:
    - Reading `a`, with races `[[a,b]]`, sends no informed.
    - Reading `b` then sends `informed` with `kind:'compared'`.
  - `counts informed once per election and once per week`:
    - A second informed race the same week sends only the visit step.
    - In the next week, it sends `week` only.
  - `informed is checked again when races arrive later`:
    - A read with `races: undefined` sends no informed.
    - The next `progress` with `[[p.key]]` sends it.
  - `keeps at most 200 profiles`: after 201 reads, the first profile's marks are forgotten, and reading it again sends `10` again.
  - `shows an informed race again as a visit step`: a new instance (a new visit), on a race already informed, makes `progress` call `step('informed')` without sending `informed` events.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement it in `src/metrics/reading.ts`.**
  - The note at `votestack:usage:reads:v1` is `{ profiles: Record<string, ReadMark[]>, order: string[], week?: string, election?: string }`.
  - The `read` step goes through `deps.step('read')`. The `informed` step goes through `deps.step('informed')` whenever any race passed in is informed.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(metrics): count profiles read and informed voters"`

### Task 6: Wire the modules into `createUsage`

**Files:**

- Modify: `src/metrics/usage.ts`
- Test: `src/metrics/usage.test.ts`

**Interfaces:**

- Consumes: Tasks 3–5.
- Produces:
  - `UsageDeps` gains `session`, `now`, `referrer` and `host`, all optional, with browser defaults.
  - `Usage` gains:
    - `step(step: VisitStep): void`
    - `cta(link: CtaLink, page: UsagePage): void`
    - `reading(profile: ReadProfile, secs: number, sourcesSeen: boolean, races: string[][] | undefined): void`

- [ ] **Step 1: Write the failing tests.** Extend the `setup()` helper with `session`, `now`, `referrer` and `host`.
  - `starts a visit and counts the device on the first page`: `view('profile','landing','x')` queues the view, `visit/arrived`, and four `device` events.
  - `counts nothing new when counting is off or the page is skipped`: after `setCounting(false)`, and separately after `skipPage()`, a `view` queues nothing, and the session and local storage gain no v2 keys.
  - `counts a lookup and its origin`: `view('start','landing')`, then `voter(ballot, 30)`, queues steps `lookup` and `origin` (`when:'same'`).
  - `counts a returning ballot`: when an election record already exists, `voter(ballot)` queues step `returned` and no `origin`.
  - `counts a ballot restored from before counting as returned`: with no record, `voter(ballot)` with no time queues `returned` instead of `lookup`, plus `origin`.
  - `counts researched and picked steps`:
    - The `open` calls that reach `RESEARCHED` queue the step `researched`.
    - A first pick queues the step `picked`.
    - `catchUp` on an already researched ballot queues `researched`.
  - `hands reading to the reading module with the visit's path`: on a visit entered on `profile`, `reading(p, 21, false, [[p.key]])` queues `read` events with `path:'reader'`.
  - `counts a link click`: `cta('top','profile')` queues `{e:'cta', link:'top', page:'profile'}`.
  - `treats a device with a saved ballot as back`: with `STORAGE_KEY` present in storage before the first view, the device events say `back`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement it in `usage.ts`.**
  - Build `visits`, `devices` and `reading` inside `createUsage`, each with `add` as its sink.
  - `view()` calls `visits.shown`, then `devices.counted(visits.current())` once per page load.
  - Every new public method returns early on `skipped || off()`, before touching storage.
  - `hadOlderNotes` checks `USAGE_KEY`, `SAMPLE_KEY` and `STORAGE_KEY` (imported from `../picks/store.ts`).
  - Update the header comment to describe the visit, seen and reads notes.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `npx vitest run src/metrics/` and confirm every existing usage test still passes.
- [ ] **Step 5: Commit.** `git commit -m "feat(metrics): visits, devices and reading in the app's counter"`

### Task 7: Hook the pages up

**Files:**

- Create: `src/metrics/useReading.ts`, `src/metrics/reading.test.tsx`
- Modify:
  - `src/pages/ProfilePage.tsx`: TopStrip link, reading hook, race keys
  - `src/components/profile/ProfileArticle.tsx`: mid link, `sourcesRef` prop around `SourcesList`
  - `src/components/profile/BackLink.tsx`: the "Find your ballot" link
  - `src/components/RaceSummary.tsx`: the `ProfileRaces` "On the ballot" link
  - `src/components/AddressForm.tsx`: `form`, `asked`, cta `form`
- Test: `src/metrics/views.test.tsx` (new cases), `src/metrics/reading.test.tsx`

**Interfaces:**

- Consumes: `usage.step`, `usage.cta` and `usage.reading` (Task 6), and `useOpponents` and `contestsWithPerson` (existing).
- Produces: `useProfileReading(profile: CandidateProfile | undefined, races: string[][] | undefined, counter?: Usage): (el: HTMLElement | null) => void`, a ref callback for the Sources wrapper.

- [ ] **Step 1: Write the failing hook tests** in `reading.test.tsx`. Use fake timers, a stub counter recording `reading` calls, and a stubbed `IntersectionObserver` that the test can trigger.
  - `reports visible seconds while the tab is shown`: after 21 s of `vi.advanceTimersByTime`, the last call has `secs >= 20`.
  - `stops the clock while the tab is hidden`: with `document.visibilityState` set to `hidden` for 30 s, secs don't grow.
  - `reports Sources in view`: triggering the observer makes the next call pass `sourcesSeen: true`.
  - `time on one profile never counts toward the next`: rerendering with another profile restarts `secs` at 0.
- [ ] **Step 2: Write the failing route tests** in `views.test.tsx`, following its `views()` helper:
  - `a visit landing on a profile starts on the reader path`: `/candidates/<key>`, using the profile fixture and fetch stub that `src/pages/ProfilePage.test.tsx` already uses, queues `visit/arrived` with entry `profile`.
  - `a visit to / without a ballot shows the form`: it queues steps `arrived` and `form` with entry `start`. `IntersectionObserver` is stubbed to report it in view.
  - `clicking the top strip counts the link`: on a search-arrival profile, clicking "Explore your full ballot" queues `cta/top/profile`.
- [ ] **Step 3: Run the tests and confirm they fail.** Run `npx vitest run src/metrics/`.
- [ ] **Step 4: Implement it.**
  - `useProfileReading` ticks every second with `setInterval` while `document.visibilityState === 'visible'`, and resets on `profile.key` change.
  - ProfilePage computes `races`:
    - With a ballot listing the person, from `contestsWithPerson(ballot.contests, key)`, mapping candidates (or the retention `judge`) through `profileKey`.
    - Otherwise from `useOpponents(profile)` as `[[profile.key, ...opponents.map(o => o.key)]]`.
    - It passes `undefined` while either is loading.
  - Call `useOpponents` with the real profile whenever there's no ballot race for it, not only on search arrivals.
  - AddressForm observes its own `<form>` at a threshold of 0.5 and calls `usage.step('form')`. After validation passes, it calls `usage.step('asked')`, plus `usage.cta('form', usagePage(location.pathname).page)` when `race` is set.
  - Each link gets `onClick={() => usage.cta(link, page)}`.
- [ ] **Step 5: Run the tests and confirm they pass.** Run `npm test`. Expected: PASS for the whole suite, including the existing ProfilePage, RacesPage and HomePage tests.
- [ ] **Step 6: Commit.** `git commit -m "feat(metrics): count reading, the address form and links toward a ballot"`

### Task 8: About page counting paragraph

**Files:**

- Modify: `src/pages/AboutPage.tsx:315-323`, `src/pages/AboutPage.test.tsx`

- [ ] **Step 1: Write the failing test.** Assert that the privacy section contains `the kind of site a visit came from` and `counted once a day, week, month and election`.
- [ ] **Step 2: Run it and confirm it fails.** Run `npx vitest run src/pages/AboutPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Replace the paragraph** with the exact text in spec section 5. Keep `&rsquo;` for apostrophes, as the file already does.
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Commit.** `git commit -m "docs(about): say what the new counts keep"`

### Task 9: Measures module

**Files:**

- Create: `scripts/lib/usage-measures.ts`, `scripts/lib/usage-measures.test.ts`

**Interfaces:**

- Produces. Every function is pure, with no imports. `Row = [hour: number, event: string, a: string, b: string, c: string, n: number, d1: number, d2: number, d3: number, d4: number, d5: number, d6: number, d7: number, d8: number, live: number]`.
  - `Range = { start: number; end: number; area: 'all' | 'il-cook' | 'ca-la'; tz: string }`
  - `Measured<T> = { value: T; estimate: boolean; allAreas: boolean; countedFrom: number | null }`
  - Functions:
    - `launchedAt(rows, event): number | null`
    - `weekOf(ts, tz): string`, the Monday's date
    - `northStar(rows, r): Measured<{ total: number; byPath: Record<VisitPath, number>; byKind: Record<'single' | 'compared', number>; perWeek: { week: string; ballot: number; reader: number; other: number; estimate: boolean }[] }>`
    - `informedWeekly(rows, r): Measured<{ week: string; n: number }[]>`
    - `profilesRead(rows, r): Measured<{ total: number; byPath: Record<VisitPath, number>; byKind: Record<ReadKind, number> }>`
    - `readingSpread(rows, r): Measured<Record<'10' | '20' | '30' | '60' | 'sources' | 'read', number>>`
    - `visits(rows, r): Measured<{ total: number; byEntry: Record<string, number>; byPath: Record<VisitPath, number>; bySource: Record<string, number> | null }>`
    - `ladder(rows, r, path: 'reader' | 'ballot', split?: 'entry' | 'source'): Measured<Record<string, Record<VisitStep, number>>>`
    - `readersWithoutBallot(rows, r): Measured<{ read: number; notRead: number }>`
    - `ctaRates(rows, r): Measured<Record<CtaLink, number>>`, per 100 reader-path visits
    - `origins(rows, r): Measured<{ entry: string; source: string; same: number; later: number }[]>`
    - `uniques(rows, r): Measured<{ day: { day: string; new: number; back: number }[]; week: …; month: …; election: { new: number; back: number }; stickiness: number | null }>`
    - `ballotDevicesPerDay(rows, r): { day: string; n: number }[]`
    - `inputs(rows, r): { searchToForm: Measured<number | null>; lookupSuccess: number | null; profilesPerBallot: number | null }`
    - `activation(rows, r): Measured<number | null>`
    - `informedPicksShare(rows, r): number | null`
    - `costPer(costs: Costs | null, r, counts: { informed: number; researched: number }): { usd: number; perInformed: number | null; perResearched: number | null } | null`, where `Costs = { monthly: { name: string; usd: number; from: string; to?: string }[] }`
    - `dataHealth(rows, r): { bot: number; invalid: number; limited: number; missingHours: number; liveHours: number }`

  The history stand-ins are exactly those in spec section 2. The area filter uses the region label where an event has one (`voter`, `learn`, `lookup`, `fill`, `sample`) and sets `allAreas: true` otherwise.

- [ ] **Step 1: Write the failing tests**, one `it` per function, using small hand-built row fixtures. Each `it` checks the value and the `estimate` and `countedFrom` flags. Also include:
  - `switches from history to new counts at launch without double counting`:
    - Fixtures: a `view/landing` at hour H, plus a `visit/arrived` and a `view/landing` at H+2h (so `launchedAt('visit') = H+2h`).
    - Expected: `visits.total` is 2, and `estimate` is true because the range starts before launch.
  - `ignores the area filter for events without a region`: `visits` with `area:'ca-la'` returns every visit and `allAreas: true`.
  - `uses opened-not-read for the North Star before launch`: with only `learn/compared/1` rows, `northStar.value.byPath.ballot` is their sum and `estimate` is true.
  - `weeks start on Monday in the chosen time zone`: 2026-10-26T04:00Z is `'2026-10-25'` week `'2026-10-19'` in `America/Los_Angeles`, and week `'2026-10-26'` in `UTC`.
  - `prorates monthly costs by day`: $31 a month over 10 days of a 31-day month comes to 10.
  - `returns null instead of dividing by zero`: `activation` with no lookups is `value: null`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx vitest run scripts/lib/usage-measures.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it in `scripts/lib/usage-measures.ts`.** Event and label names match Task 1 exactly. Add a one-paragraph header comment: what it computes, and that it's inlined into the v2 page, which is why it has no imports.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(usage-report): v2 measures with history stand-ins"`

### Task 10: Report build writes v1 and v2

**Files:**

- Create: `scripts/lib/usage-report-build.ts`, `scripts/lib/usage-report-build.test.ts`
- Modify: `scripts/usage-report.ts`

**Interfaces:**

- Consumes: `scripts/lib/usage-measures.ts` (its source text), and the `excludeScraper` result already in the script.
- Produces:
  - `parseReleases(changelog: string): { version: string; date: string; note: string }[]`, newest first, with `note` as the first bullet's text
  - `readCosts(path: string): Promise<Costs | null>`, which returns null for a missing file or invalid JSON or shape, and never throws
  - `coverage(contestFiles): { candidates: number; races: number; areas: number }`
  - `fillTemplate(template: string, data: unknown, measuresJs?: string): string`, which replaces `'__USAGE_DATA__'` (either quote style, `<` escaped, as today) and, for v2, `'__USAGE_MEASURES__'`
  - `measuresScript(tsSource: string): string`, using `stripTypeScriptTypes` from `node:module` and then removing the `export ` keywords so the functions become globals in a classic script

- [ ] **Step 1: Write the failing tests.**
  - `keeps the v1 page exactly as the template with data filled in`: `fillTemplate(v1Template, data)` equals `v1Template.replace(placeholder, JSON.stringify(data).replace(/</g,'\\u003c'))`.
  - `throws when a placeholder is missing`.
  - `reads release dates and first notes`: given the CHANGELOG head from the repo, the first entry is `{version:'1.5.1', date:'2026-10-23', note: starts with 'Profiles for offices'}`, and `[Unreleased]` is skipped.
  - `returns null costs for a missing, unreadable or wrong-shaped file`, using a temp file under `os.tmpdir()`.
  - `compiles the measures module into a plain script`: `new Function(measuresScript(src) + '; return typeof northStar')()` is `'function'`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement it.** In `usage-report.ts`:
  - Move the placeholder replacement into `fillTemplate`.
  - Keep the v1 `data` object's keys exactly as they are: `generatedAt`, `rolledUpTo`, `liveNote`, `excludedNote`, `rows`, `reports`, `signups`, `candidates`, `races`.
  - Build `dataV2 = { ...data, releases, coverage, costs }`.
  - Write `report.html` from `usage-report.html`, and `report-v2.html` from `usage-report-v2.html`, next to `--out` (`dirname(out)/report-v2.html`).
  - The console line names both files.
  - The costs path is `.private/usage-costs.json`, relative to the working directory.
- [ ] **Step 4: Run the tests and confirm they pass.** Then run `npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit.** `git commit -m "feat(usage-report): build v2 beside v1 from one data pass"`

### Task 11: v2 page, sections 1–4

**Files:**

- Create: `scripts/lib/usage-report-v2.html`, `scripts/lib/usage-report-v2.test.ts`

**Interfaces:**

- Consumes: the globals from `measuresScript`, `DATA` with the v2 keys.
- Produces: a page with section ids `h-week`, `h-people`, `h-sources` and `h-paths`.

- [ ] **Step 1: Write the failing smoke test.**
  - Build the page with `fillTemplate` from a fixture data object that holds rows for every event, both before and after launch.
  - Load it in a `JSDOM` with `runScripts: 'dangerously'`, and collect `window.onerror` and `console.error`.
  - Assertions:
    - There are no errors.
    - Each of `#h-week`, `#h-people`, `#h-sources` and `#h-paths` has at least one rendered number tile or chart.
    - The North Star tile shows the fixture's expected total.
    - With the area set to `ca-la`, the visits tile carries the "all areas" note.
    - Estimates carry the text `estimate`.
    - A release marker for `1.5.1` is present on the trend chart.
- [ ] **Step 2: Run it and confirm it fails.** Run `npx vitest run scripts/lib/usage-report-v2.test.ts`. Expected: FAIL, since the template doesn't exist.
- [ ] **Step 3: Build the template.**
  - Copy v1's `<style>`, header, filters (`f-area`, `f-tz`, range) and the helpers `h`, `s`, `parts`, `zonedMidnight`, `table`, `hbars`, `tile`, `change`, `buckets`, `stackedBars`, `showTip` and `legend`. Keep v1's look.
  - Add `<script>const DATA = '__USAGE_DATA__'</script>` and `<script>'__USAGE_MEASURES__'</script>`.
  - Render:
    - **Section 1, This week:** the North Star, newly informed per week, profiles read, the three inputs, activation, and the data health strip.
    - **Section 2, How many people?:** uniques, stickiness, ballot devices per day, visits per day.
    - **Section 3, Where do visits come from?:** visits by source, path and entry, and informed or ballot share for each.
    - **Section 4, The two paths:** both ladders, informed readers, readers without a ballot, cta rates, origins, and lookup outcomes by area (v1's `renderLookups` logic).
  - Tag every `Measured` value according to `estimate`, `allAreas` and `countedFrom`.
  - Draw release markers on the time charts from `DATA.releases`.
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(usage-report): v2 page, week view, people, sources and the two paths"`

### Task 12: v2 page, sections 5–8

**Files:**

- Modify: `scripts/lib/usage-report-v2.html`, `scripts/lib/usage-report-v2.test.ts`

- [ ] **Step 1: Extend the smoke test.**
  - `#h-depth`, `#h-funders`, `#h-guard` and `#h-explore` render without errors.
  - With fixture costs present, the funder section shows cost per informed voter. With `costs: null`, it shows `Add running costs to .private/usage-costs.json to see this`.
  - The "what isn't measured" list names people rather than devices, what voters do after the visit, and turnout.
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Build the sections.**
  - **Sections 5, 7 and 8:** port v1's `renderLearning`, `renderPages`, `renderHeat`, `renderGuardrails` and `renderExplore` into the v2 sections, unchanged in logic.
  - **Section 6, for funders:** informed voters this election, profiles read, ballots looked up, researched, informed picks, coverage from `DATA.coverage`, `costPer`, and the "what isn't measured" list.
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Commit.** `git commit -m "feat(usage-report): v2 depth, funders, guardrails and explore"`

### Task 13: Release and full check

**Files:**

- Modify: `package.json` and `package-lock.json` (PATCH), `CHANGELOG.md`, `~/Projects/votestack-workspace/status/` (the current status note)

- [ ] **Step 1: Bump the version.** Run `npm version patch --no-git-tag-version`. If npm rewrites the lockfile, use `--os=linux --cpu=x64 --include=optional`.
- [ ] **Step 2: Write the CHANGELOG entry** under the new version. Under `Changed`: one plain line on the new counts and the About page wording. Under `Added`: one line on the v2 usage report, as internal tooling.
- [ ] **Step 3: Run the full check.** Run `npm run typecheck && npm run lint && npm test && npm run format:check && npm run build:site`. Expected: everything passes.
- [ ] **Step 4: Build both reports from real data.** From the main checkout (`~/Projects/votestack`, where `.env` lives), run `node --env-file=.env <worktree>/scripts/usage-report.ts --out data/build/usage/report.html`. Expected: both files are written, and `report.html` differs from the previous build only in `generatedAt` and data. Check this with a diff of the template portion.
- [ ] **Step 5: Update the workspace status note** with the version and what shipped.
- [ ] **Step 6: Commit** `chore: release <version>`, then stop. Pushing waits for the maintainer.
