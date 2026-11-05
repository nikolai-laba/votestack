# Showing results after an election

This guide covers what happens after Election Day, when VoteStack shows who won each race. It applies to any election. Nothing on the site changes for an election until its results file exists.

VoteStack never calls a race itself. A winner comes from an official certified result, or from the Associated Press (AP) call on its public results page. Counts come from the election offices' own files. Until an office certifies, every number is labeled unofficial.

## What a pass does

A pass is one run through the steps below. It reads the latest sources, writes the results file, checks it, and ends in a commit that a person approves before it goes out.

Source order, from most to least trusted:

1. The certified official result.
2. AP's public call.
3. The election office's unofficial count.

Races that cross county lines are the exception for counts. Illinois publishes no live district-wide count, so for those races the shares and votes come from AP's public page, which is read twice by separate readers and used only when both reads match exactly. In California, district-wide totals come from the Secretary of State's results service. A race with no district-wide count shows no partial count and links to the official results.

## The files

- `content/results/<electionId>.json`: the results for one election, named by its id (for example `il-2026-11-03-general.json`). The site reads these files. An election with no file here looks the same as before.
- `content/results-inputs/<area>/`: what the build reads for each area.
  - `match.json`: which official contests count each of our races, how official names map to ours, whether the official count covers the whole district, the certification date, and where AP has a public page for the race.
  - `ap-calls.json`: AP's calls, with the time and page.
  - `ap-counts-a.json` and `ap-counts-b.json`: the two separate reads of AP's counts, for races that cross county lines.
  - `certifications.json`: each office's certification date and document, with confirmation that every winner matches it.
- `data/raw/results/<timestamp>/`: every download, kept so any pass can be audited. It isn't committed.

## The commands

- `npm run results:fetch` downloads the official files and saves them under `data/raw/results/`.
- `npm run results:build` combines the downloads, the match files, AP's calls and counts and the certifications into the results files. It stops on a name it can't map or an AP winner that isn't on the ballot.
- `npm run results:check` checks the results files before they ship.
- `npm run results:pass` runs all three in order.

The AP and certification files are written by hand or by a reviewed read of the source page before the build runs. They are committed with the results.

## What the checker stops

`results:check` prints each failure and warning and exits with an error on any failure. It stops a pass when:

- a race or measure has no result, or no reason it can't have one;
- a name isn't on our lists;
- a race has more winners than seats, or a write-in is named the winner;
- AP's winner isn't leading in our count;
- a count is lower than in the last committed pass, or an "as of" time is earlier;
- a certified result has no certification record, or a certified winner isn't in the count;
- the two reads of AP's counts differ, or AP's leader isn't its called winner;
- a candidate entry has no seats to fill, a judge or measure has no threshold, or its choices aren't Yes and No.

It warns, without stopping, when a counting race hasn't updated in more than three days, and when a race was regrouped (its contest ids changed, so it can't be compared with the last pass).

Read each failure before changing anything. Fix the source file or the match entry, not the check.

## Matching, once per election

The first time an election runs, every official contest has to be matched to one of our races. Matching is done in slices of about a hundred races, each read by a separate reviewer with the same instructions, and each slice is checked by a script before it is merged. Every race has to match once, and every official contest has to be used or set aside. Doubtful matches (a threshold, a district that may cross a county line, a race missing from the official files) are listed and decided by a person.

## Calls and certification

AP calls go into `ap-calls.json` with the time AP gave. A race AP calls "too close" is recorded as such.

A race becomes `certified` only after its office has certified and a reviewer has checked every winner against the certified document: the election board's proclamation, the clerk's certified summary, a statement of votes, or a state canvass. Until then it shows as called or counting. Races that cross county lines wait for the state's canvass, and stay on AP's numbers until a reader for that canvass exists.

## When to run

Run a pass every weekday for the first two weeks after the election, then on each certification date and after each certification, until every office has certified. Each office's certification date is in its own calendar and is stored with its races in the match file.

Each pass ends in a commit named `chore(results): <date> count`. It changes data only, so it doesn't change the version and doesn't take the site down.

An election with results gets no more profile or campaign money updates. Its profiles stay as they were on Election Day, and say so.
