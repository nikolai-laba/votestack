# Adding a new area

This guide lists every step that takes a new county or city from nothing to live ballots and candidate profiles, in order. Cook County and Los Angeles County were both built this way, and their code is the worked example for each step.

Every step writes a file that a later step reads. `scripts/lib/regions/manifest.ts` lists those files for each area, and `npm run region:check -- --region=<id>` fails if any is missing, empty, uncommitted or older than what it was built from. It also fails if profiles fall below the area's floors. Run it after each stage below, and before anything goes live.

## 0. Before you start

- Pick an id for the area: the state's two-letter code and a short name, such as `il-cook`, `ca-la` or `ny-nyc`. It tags the area's rows in the database and names its folders.
- Find the official sources and read their terms before writing code. Each step below needs a source from a government body, or a published list from the group itself (endorsements, bar ratings). Record each one, with its terms, in `data/README.md`.
- Find a ground truth for the ballot: something official that says which contests appear at an address or precinct. Cook has the Clerk's per-ballot-style sample ballots; Los Angeles has the Registrar's street segments. Without one, ballots can't be audited, and the area shouldn't go live.

## 1. Region config

- Add the area to `src/shared/regions.ts`: names, state, ZIP prefixes, the election, the districts everyone is in, `placeWords` (names that already place an office in the area, for page titles), `measureWords` (what local ballots call yes/no questions: "referenda" in Illinois, "measures" and "propositions" in California), the election authority and how districts are found.
- Add its entry to `scripts/lib/regions/manifest.ts`. The tests fail until every area in `regions.ts` has one.
- Add its money source modules to `scripts/lib/profiles/money-sources.ts`. `profiles:money` stops for an area that has none.

## 2. Addresses, districts and precincts

- Fetch the official address points and boundaries (Cook: `npm run data:fetch`; Los Angeles: `npm run la:fetch`). Select addresses by location, never by their city label.
- Build precincts and each precinct's districts or ballot styles (Cook: `npm run data:build`; Los Angeles: `npm run la:build`). Districts come from the address point, not the precinct, because precincts can cross district lines.
- If you change address parsing in `src/shared/address.ts`, compare old and new parsing over every address point of every area first. Stored street keys depend on it. Prefer normalizing in the area's own code, as `scripts/la/segments.ts` does.

## 3. Contests and the paper ballot order

- Import every contest and candidate from the election authority's official list. Contests that can't be placed in a district go to the unplaced list, which the ballot shows as a possible gap.
- Record the order of the printed ballot, from specimen ballots (Cook) or from the authority's ballot styles (Los Angeles). `region:check` fails if contests have no paper order.

## 4. Audit against the ground truth

- Compare the lookup with the ground truth (Cook: `npm run data:audit`; Los Angeles: `npm run la:audit`). The manifest sets the agreement the audit must reach (99% for both current areas).
- Look at every disagreement by hand before going on. Fix the data, not the audit.

## 5. Load the lookup data

- `npm run data:load -- --region=<id>` empties and reloads only that area's rows. It requires `--region`, and runs on its own, never chained with other commands.
- Deploy any Worker changes the new data needs before loading it.

## 6. Incumbents and the race list

- Build incumbent labels from official lists only: FEC records for Congress, the legislature's own member pages, and a hand-checked roster (`content/incumbents/<id>/rosters.json`) copied from each body's own page, with the page and the date. A source that is missing or unclear means no label, never a guess. In California, a ballot designation of "Incumbent" counts too.
- `npm run data:incumbents -- --region=<id>`, then `npm run contests:export -- --region=<id>`. Commit both files.

## 7. Profiles

1. `npm run profiles:subjects -- --region=<id>`: everyone on the ballot once, with their tier.
2. Campaign money: `npm run profiles:money -- --region=<id>`. Every person ends up with a summary from an official filing, a link to where their filings are, or an "unmatched" entry with the reason. Nobody is left out silently.
3. Bar ratings for judges (`profiles:judges`), published endorsement lists (`profiles:slates`) and legislative rosters for endorsers' parties (`profiles:rosters`), where they exist for the area.
4. Research and write the profiles (`profiles:drafts`, then `profiles:generate`). Probe each paid provider first, run one or two people, have someone read the first 50, and keep the run resumable.
5. `npm run profiles:check -- --region=<id>` and `npm run profiles:report -- --region=<id>`. Fix flagged profiles with override files, not by editing the profile.
6. `npm run profiles:publish -- --region=<id>`, then commit the area's published list with the profiles.

## 8. The site

- Page titles and descriptions take the area from the profile's election. Check a few built pages in `dist/` for the right state and county.
- Update the pages that name the areas: Get started, About (sources and "when we last checked"), How we make profiles (money and endorsement sources), and the home and race page descriptions.
- Run the site locally (`npm run dev:full`), walk every flow with public addresses in the new area and in the existing ones, and run `npm test`.

## 9. Go live

- `npm run region:check -- --region=<id>` passes for the new area and for every existing one.
- Add the change to `CHANGELOG.md`, and add the area's sources and terms to `data/README.md`.
- Plan the refreshes: new campaign filings, contest changes and source pages that go out of date.
