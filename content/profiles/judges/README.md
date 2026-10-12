# Bar association evaluations of judges

`bar-ratings.json` holds the 2026 general election evaluations of every judge on the Cook County ballot: the judges in contested races and the judges up for retention (88 people). It's built by `node scripts/profiles/judges.ts` (needs `pdftotext` from poppler and the contest files from `npm run data:build`). No AI is involved: the ratings are copied from the published lists.

Shape: `{ [profileKey(name)]: { endorsements, sources } }`, with `Endorsement` and `ProfileSource` from `src/shared/profile.ts`. Every endorsement has kind `bar_evaluation`, the rating word for word, `context` (`election` or `retention`) and cites one of the judge's sources (kind `bar`).

The file keeps every organization's rating. Profiles show fewer lines: `mergeBarRatings` in `scripts/lib/profiles/assemble.ts` keeps the Chicago Bar Association, the Chicago Council of Lawyers and the Illinois State Bar Association word for word and turns the other 11 Alliance members' ratings into one counted line (`tally`).

## Sources (viewed October 6, 2026)

| Organization                                                    | Publication                                                                                                                                                                                                                | What it rates                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Chicago Bar Association                                         | [Vote Smart: CBA Judicial Voter's Guide](https://www.chicagobar.org/CBA/JEC/Judicial_Voters_Guide.aspx)                                                                                                                    | Every judge on the ballot          |
| Alliance of Bar Associations for Judicial Screening (13 groups) | [2026 General Election ratings (PDF, September 25, 2026)](https://www.voteforjudges.org/wp-content/uploads/2026/09/2026-Alliance-General-Ballot-Ratings-09252026.pdf) on voteforjudges.org                                 | Every judge, one column per member |
| Chicago Council of Lawyers                                      | [Evaluation Report, November 3, 2026 General Election (PDF, September 25, 2026)](https://www.voteforjudges.org/wp-content/uploads/2026/09/CCL-Judicial-Evaluation-Report-for-Nov-3-2026-General-Election_Ballot-Order.pdf) | Every judge on the ballot          |
| Illinois State Bar Association                                  | [2026 General Election, Cook County Judicial Evaluations](https://www.isba.org/judicial-elections/counties/cook)                                                                                                           | Every judge on the ballot          |

## How it's built

- **One entry per organization for every judge, in the same order:** the Chicago Bar Association, then the Alliance's 13 members in the Alliance's column order. The Alliance doesn't publish a combined rating, so each member's rating is its own entry. The Chicago Council of Lawyers and the Illinois State Bar Association are Alliance members that also publish their own reports, so their entries come from those reports, which state the rating in words (the retention ratings there are "Qualified" and "Yes"/"No").
- **Ratings word for word.** Where a list prints codes ("Q", "HR", "¹"), they're expanded with that list's own key ("Qualified", "Highly Recommended", "Not Evaluated Through No Fault of the Candidate"). The Alliance's retention table and the ISBA say "Yes" or "No" to retention; those are kept as "Yes" and "No".
- **Blank cells.** In the Alliance's retention table some members leave a judge's cell blank (voteforjudges.org says "All reporting bars say yes" for those judges). Those entries, and any judge a list doesn't mention, get the rating "No rating published". That wording is VoteStack's, not a rating.
- **Judges in two places.** Judith C. Rice runs for the Appellate Court and is also up for retention on the Circuit Court. She gets one full set of entries per vote, the race first, each with a `contextLabel` made from the contest's office ("For the Appellate Court election", "For retention as a circuit judge").
- **Name matching.** A published name matches a ballot name when the last names are the same, the first names agree (equal, a nickname such as Dan and Daniel, or a prefix of 3+ letters) and middle names don't conflict ("Regina A." and "Regina Ann"), and only one judge on the ballot fits. Misspellings in the lists are matched only through a reviewed alias list in the script: "Maire Aileen Dempsey" (Marie), "Rachel Marello" (Marrello), "Erin Haggerty Antoniett" and "Antoinetti" (Antonietti). Anything else is printed as unmatched, never guessed.
- **Checks the script prints:** unmatched names, ratings for a race the judge isn't in, judges with no rating at all, and where the Alliance's Council or ISBA column differs from that group's own report.

## Results of the October 6, 2026 run

- All 88 judges matched in all four publications; no unmatched names.
- Ratings published (anything other than "No rating published"), out of 88: Chicago Bar Association 88, Chicago Council of Lawyers 88, Illinois State Bar Association 88, and the other Alliance members 76 to 88 (blank retention cells: Cook County Bar Association 12, Black Men Lawyers' Association 7, Asian American Bar Association 2, Hispanic Lawyers Association 1).
- One difference between lists: for Steven Q. McKenzie the ISBA's page says "Qualified", while the ISBA column in the Alliance's table says "R" (Recommended). The ISBA's own page is used.

Rerun the script when a list is updated, and before the election. Ratings change between elections, so never reuse a past election's file.
