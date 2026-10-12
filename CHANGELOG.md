# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- When an address can't be found, the message now says VoteStack is only available in Chicago and Cook County for its initial release, and points to the sample ballots.
- The browser tab icon uses VoteStack's green instead of blue.

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

[Unreleased]: https://github.com/nikolai-laba/votestack/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nikolai-laba/votestack/releases/tag/v1.0.0
