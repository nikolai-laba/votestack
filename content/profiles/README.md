# Candidate profiles

The profiles VoteStack shows for every person on the ballot. They are licensed under [CC BY 4.0](../LICENSE): reuse them freely, with credit to "VoteStack (votestack.org)". Git is the source of truth: generated profiles and hand corrections are committed here, and `npm run profiles:publish` copies checked profiles to Supabase, which the Worker serves at `GET /api/profile/:key`.

| Path                      | What it holds                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-11-03/{key}.json`   | One generated profile per person for the November 3, 2026 election, a `CandidateProfile` (`src/shared/profile.ts`). Written by `profiles:generate`; don't edit. |
| `overrides/{key}.json`    | Hand corrections, applied on every generate run (see below).                                                                                                    |
| `judges/bar-ratings.json` | Bar association evaluations of every judge, copied from the published lists by `scripts/profiles/judges.ts` (see `judges/README.md`).                           |
| `slates/{slug}.json`      | Published general-election endorsement lists (unions, PACs), each entry matched to a person by `profiles:slates` (see "Endorsement rules" below).               |

`{key}` is `profileKey(name)`, the name as printed on the ballot in lowercase with dashes: "Deborah 'Debby' Pope" is `deborah-debby-pope`.

## Pipeline

Run in this order after `npm run data:build`. Commands that call a model or Supabase read keys from `.env`; none of them print keys.

```sh
npm run profiles:subjects              # who gets a profile → data/build/profiles/subjects.json
npm run profiles:money                 # campaign money from FEC and ISBE filings → money.json
npm run profiles:slates                # published endorsement lists → content/profiles/slates/
npm run profiles:generate -- --model deepseek-gemini --max-cost 150
npm run profiles:check                 # checks and link checks → data/build/profiles/check.json
npm run profiles:report                # flagged profiles by race → data/build/profiles/review-queue.md
npm run profiles:publish -- --dry-run  # what would change in Supabase
npm run profiles:publish
```

- **Subjects.** Everyone in the contest files once, with their office as voters see it, the race's tier (top, mid or short, which sets the overview's length) and a race key that groups opponents across the Clerk's and the Board's lists. It stops with an error when one key is in two races; a person confirmed to run twice is listed by hand in `scripts/profiles/subjects.ts`.
- **Generate.** Researches each person with the chosen model. `deepseek-gemini` (its prompt version is `PROMPT_VERSION` in `scripts/lib/profiles/prompt.ts`) runs in stages: the research brief for the office type (`scripts/lib/profiles/briefs.ts`) drives Perplexity searches; DeepSeek V4 Pro drafts the overview from the results with one source per sentence; Gemini 3.1 Pro opens every cited page and keeps, corrects, re-sources or removes each sentence, and separately researches endorsements (`scripts/lib/profiles/staged.ts`). It needs `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY` and `GEMINI_API_KEY`. Generate then adds what no model writes: money from `money.json`, the judges' bar ratings (which replace any rating the model found), the incumbent label from `content/incumbents/` (`npm run data:incumbents`; never for retention judges) and overrides. A profile is researched again only when it's new, the person's ballot listing changed, or the model or prompt changed; `--refresh` forces it. Other runs only refresh money, ratings, slates, the endorsement rules and overrides, for free; `--no-research` makes every run like that, even for profiles made with an older model or prompt (people without a profile are skipped). A file is rewritten only when its content changes, and `meta.version` goes up each time. Options: `--only key,key`, `--race raceKey`, `--max-cost` (USD; stops starting new research before passing it, default 25), `--concurrency`, and `--dry-run`, which needs no keys and writes placeholder profiles to `data/build/profiles/dry-run/` instead of this folder.
- **Endorsement rules.** Every generate run applies three deterministic rules (no model), to old research as well as new, and prints what each one did (also in `data/build/profiles/endorsement-changes.json`):
  1. _Sources_ (`scripts/lib/profiles/endorsement-sources.ts`): an endorsement a model found is dropped when every page it cites is one that can't show a November 3, 2026 general-election endorsement: an iVoterGuide page for another election (its `/election/{id}` isn't 1443) or a candidate page without an election; a Ballotpedia or Wikipedia page that isn't about the 2026 election (a person's page mixes primaries and past races); a bare homepage; a staging host or proxy copy; or, for editorials, a page dated before March 18, 2026 or about a primary. Bar ratings and endorsements an override replaces or adds are never dropped.
  2. _Slates_ (`scripts/lib/profiles/slates.ts`): each list in `slates/` that names the person adds the endorsement, cited to the list, unless the profile already names that endorser under any spelling ("CFL", "Chicago Federation of Labor"). `npm run profiles:slates` downloads the lists again and matches every entry by name (ignoring case, punctuation, middle names, quoted nicknames and Jr/III) and office (type, district, vacancy). Entries that fit no one or more than one person are printed for review and never merged; a list that's neutral in a race simply doesn't name anyone there.
  3. _Same endorser for opponents_ (`scripts/lib/profiles/endorsers.ts`): after every profile is assembled, an endorser credited to more people in a race than it has seats (one, or three for the Water Reclamation District's full terms) is dropped from each of them, unless a slate or an override confirms it for that person.
- **Check.** Every profile gets the text checks (citations, allowed sources, tone, length, privacy, no positions for judges), date checks (no future dates; every source viewed within 30 days, so profiles are regenerated at least monthly) and an equal-coverage check within each race (a candidate with 2 or more fewer filled sections, or under half the overview words, of an opponent gets a warning, not an error: challengers often have far less public coverage, so it doesn't hold the race back, and reviewers confirm the gap comes from what's public). Every cited link is opened, a few at a time and one per site, and must return 2xx after redirects without landing on a login page, a paywall or social media. Results are cached for 72 hours. `--no-links` skips links (offline), but publish then treats every profile as unchecked. `--support` is the plug point for a second model that confirms each source supports its sentence; it isn't wired to a model yet.
- **Publish.** A race goes live only when every candidate in it has a profile whose current content passed; otherwise its rows are stored as `flagged` and not served. A judge up for retention stands alone. People no longer on the ballot become `withdrawn`. Rows are upserted, never truncated, and unchanged rows aren't sent.

## Overrides

To correct a profile, add `overrides/{key}.json` and run `profiles:generate` (it applies overrides without new research). Each edit brings its own sources, and every edit is idempotent, so it survives later runs. An edit that matches nothing after new research is printed as stale.

```json
{
  "reason": "The overview named the wrong committee (error report, 2026-10-12)",
  "overview": [
    { "action": "remove", "match": "chairs the budget committee" },
    {
      "action": "replace",
      "match": "was first elected",
      "text": "Was first elected to the board in 2020.",
      "sources": [
        {
          "title": "2020 general election results",
          "publisher": "Cook County Clerk",
          "url": "https://www.cookcountyclerkil.gov/elections/results",
          "viewedAt": "2026-10-12",
          "kind": "official"
        }
      ]
    },
    { "action": "add", "text": "…", "sources": [] }
  ],
  "endorsements": [
    { "action": "remove", "organization": "Example Group" },
    {
      "action": "add",
      "endorsement": { "organization": "Example Union", "kind": "union" },
      "sources": []
    }
  ]
}
```

- `match` is any piece of the paragraph's text; organizations match ignoring case.
- `sources` must not be empty in a real override: an uncited paragraph or endorsement fails the checks.
- `"replace"` for endorsements takes `"organization"` (the one to replace), `"endorsement"` and `"sources"`.
- `"lock": true` keeps the profile's current research and never regenerates it (money, bar ratings and the other edits still apply). Use it sparingly: a locked profile's sources still expire after 30 days.
- Sources nothing cites any more are dropped and the rest renumbered.

## Error reports

Readers send reports with the "Report an error" form on each profile. The Worker (`POST /api/report`) checks Cloudflare Turnstile and a rate limit, then stores the report in Supabase `public.profile_reports`: the profile key, which part of the profile, the reader's message, a link to a source and the profile version it was about. Nothing about the reader is stored. The source link is required; reports sent before it was required may have none.

Review them with:

```sh
npm run reports                          # every report, newest first
npm run reports -- --since 2026-10-01    # only reports sent on or after a day (UTC)
npm run reports -- --json                # the same as JSON
npm run reports -- --delete 42           # delete report 42 and print what was deleted
```

The script reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env` and never prints the key. `--delete` doesn't ask first, so check the id.

To act on a report, open the source it cites and the profile's own sources. If the profile is wrong, write an override (above) whose edit cites that source, and put the report date in its `reason`. Then run `profiles:generate`, `profiles:check` and `profiles:publish`. Reports that are spam, or that no source supports, can be deleted.
