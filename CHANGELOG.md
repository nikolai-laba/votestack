# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Pages search engines can read.** Every candidate profile and site page is now built as its own web page, with the full profile in it, so search engines, link previews and slow connections see the content before the app starts. Each page has its own title, description and link preview image, and the site has a `sitemap.xml` and `robots.txt`.

### Changed

- Addresses that don't exist on the site now return a real "not found" (404) status, and pages that shouldn't appear in search results (Saved choices, report forms, missing profiles) ask search engines not to list them.

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

[Unreleased]: https://github.com/nikolai-laba/votestack/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/nikolai-laba/votestack/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nikolai-laba/votestack/releases/tag/v1.0.0
