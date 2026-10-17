# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Los Angeles County.** Voters in Los Angeles County, California can now look up their ballot for the November 3, 2026 General Election: every race, judge up for retention and measure for their address, in the order of their own ballot. The list comes straight from the Los Angeles County Registrar-Recorder/County Clerk's ballot styles. Every race also has its own page, listed at `/races/ca/los-angeles-county/2026-11-03`.
- **Los Angeles County candidate profiles**, written the same way as Cook County's, with campaign money from official filings (the FEC, the California Secretary of State, the county's and cities' filing systems, and the City of Los Angeles Ethics Commission). Where a filing was only available as a scan, AI read its figures twice, separately, and they're shown only when both reads agree; the profile says so. Candidates who report raising under $2,000, or who haven't filed yet, get a plain note and a link to their filings.
- Incumbent labels in Los Angeles County, from the official lists and the "Incumbent" ballot designation.
- In Los Angeles County, statewide measures are titled as propositions ("Proposition 1: Authorizes Bonds for Housing Affordability Programs") and link to the California Secretary of State's voter guide for the full text and arguments. Ballots use California's terms ("propositions and measures") where Cook County's use "referenda".
- The paper ballot order view follows each county's printed ballot, including Los Angeles County's order of city and local races first, and explains it.

### Changed

- In the list by level of government, measures are grouped under subheads by level (state, county, then city and local) and sorted by number or letter, and each area's offices follow its official order, so Governor leads the State section in Los Angeles County. In Los Angeles County, local measures are named by city or district and letter, followed by their official title where they have one.
- About, Get started and How we make profiles now cover Los Angeles County: who writes and checks its profiles, where its endorsements and campaign money come from, and why its paper ballot lists local races first. How we make profiles is shorter and sticks to the process; About describes what a profile contains.
- The site footer puts About VoteStack, GitHub and Contact on one line.
- The notice for races that may be missing is one short paragraph, with the link to your official sample ballot at its end.
- In a measure's official text, Fiscal Impact, Supporters and Opponents each start their own paragraph, with the label in bold.
- On wider screens (840px and up), a candidate's profile again shows your whole ballot beside it, scrolled to that candidate's race, so you can move between races and candidates without going back. On phones, the candidate's race stays at the top of the profile. Other pages, like About, stay full width.

## [1.2.0] - 2026-10-14

### Added

- **A page for every race.** Every race and every judge up for retention on Cook County ballots now has its own page, for example `/races/il/2026-11-03/state-representative-1st-district`. Each page shows who votes in the race, which ballots list it, and every candidate in official ballot order, linked to their profiles. The list of all races is at `/races/il/cook-county/2026-11-03`, linked from the address page. Referenda aren't listed there, because which ones you see depends on your exact address.
- **From a race or a profile to your own ballot.** Race pages, and profiles opened from a search or a shared link, show the race and everyone in it, with the address form right on the page. After a lookup, your ballot opens at that race, or says the race isn't on the ballot for that address. If you've already looked up a ballot, the page says whether the race is on it.
- **Pages search engines can read.** Every candidate profile and site page is now built as its own web page, with the full profile in it, so search engines, link previews and slow connections see the content before the app starts. Each page has its own title, description and link preview image, the site has a `sitemap.xml` and `robots.txt`, and the home page tells search engines the site’s name and logo.

### Changed

- Profile page titles now name the office and place, for example "Aaron M. Ortiz, 2026 candidate for State Representative, 1st District, Illinois", so they match what people search for.
- Pages load faster on repeat visits: browsers now keep the site's scripts, styles and fonts instead of checking for them each time. The heading font file is half the size (52 KB instead of 110 KB), with no visible change.
- Page addresses ending in `/` or `.html` now redirect permanently to the page's own address.
- Addresses that don't exist on the site now return a real "not found" (404) status, and pages that shouldn't appear in search results (Saved choices, report forms, missing profiles) ask search engines not to list them.

### Security

- Ballot lookups are limited to 30 a minute per visitor, so automated requests can't slow the site for everyone. The limit never uses the address you typed.
- Every page now tells browsers not to show it inside another site's frame, not to guess file types, to share only "votestack.org" with other sites, and to always use HTTPS.
- Links in profile and ballot data appear only when they are ordinary web addresses (`http` or `https`).

### Fixed

- Six candidate profiles that were empty were researched again. Four now have an overview with sources. Two still say "Not found in public sources", because there's little public information about those candidates.

## [1.1.0] - 2026-10-12

### Added

- **Get an email when VoteStack covers your area.** People outside Chicago and Cook County can leave an email address and ZIP code at `/notify`, linked from the address form, the "couldn't find that address" message and the About page. Only the email address and ZIP code are saved, they're used only for that email and to count where people are asking from, and they're deleted on request. The About page's privacy section says so.

### Changed

- New VoteStack logo: a stacked-layers mark beside the name, in the header (with a version for dark mode), as the browser tab icon and as the home-screen icon on phones.
- Refreshed colors: the highlight for the current page and your picks is now a brighter green, links in light mode are a lighter green so they stand out from the text, and in dark mode links and buttons are a soft sage green instead of lime.
- The address page is shorter, so the form comes sooner: a two-line introduction, two points on what each profile shows, and the form labelled "Registered voting address". A lookup message now appears right under the Find my ballot button. The menu uses sentence case ("My ballot", "Saved choices").
- When an address can't be found, the message now says VoteStack is only available in Chicago and Cook County for its initial release, and points to the sample ballots.
- The browser tab icon uses VoteStack's green instead of blue.

### Security

- Updated the developer tool wrangler (4.149.0), which brings in the patched image library sharp 0.35.5 (CVE-2026-96889). It's only used on developers' machines; the website was never affected.

## [1.0.0] - 2026-10-11

The first public release, for the November 3, 2026 general election in Chicago and suburban Cook County, Illinois.

### Added

- **Your ballot from your address.** Enter your home address to see every race, judge and referendum on your ballot, grouped by level, from official Cook County Clerk and Chicago Board of Election Commissioners data. Ballots are checked against the Clerk's sample ballots, and the app flags possible gaps (for example, a precinct split between districts) with a link to your official sample ballot. Addresses are never logged, stored or put in a URL.
- **Paper ballot order.** Candidates are listed in official ballot order, with a switch to see races in the order they're printed on the paper ballot.
- **Candidate profiles** for every candidate and judge on the ballot: an overview of who they are, their record and their positions, campaign money from official FEC and Illinois State Board of Elections filings, endorsements and, for judges, bar association ratings. Every sentence links to its source. Profiles are written by AI from public sources, checked by a second AI against those sources and by software, and every candidate in a race gets the same research and length limit.
- **Incumbent labels** from official lists ("Democratic, incumbent").
- **Saved choices.** Pick candidates and Yes or No on judges and referenda while you read; picks stay on your device only. No printing, downloading or sharing of a marked ballot.
- **Sample ballots** for three public places, to see how VoteStack works without entering an address.
- **Report an error** on any profile, with a source link, protected by Cloudflare Turnstile.
- **About** and **How we make profiles** pages, a site menu, and light and dark mode.
- Chicago's Expanded Mental Health Services Program questions are placed by community area, with precincts on the edge of an area flagged as possibly on the ballot.

### Changed

- The site is open to everyone and can be found by search engines.

## Before 1.0.0

VoteStack was developed privately before its first public release. 0.1.0 (2026-10-04) set up the web app, hosting on Cloudflare Workers, CI and secret scanning. 0.2.0 (2026-10-04) added the Cook County ballot lookup, the address form and the site's look.

[Unreleased]: https://github.com/nikolai-laba/votestack/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/nikolai-laba/votestack/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nikolai-laba/votestack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nikolai-laba/votestack/releases/tag/v1.0.0
