# Profiles for the November 3, 2026 general election

One JSON file per person on the ballot, named `{profileKey(name)}.json`, each a `CandidateProfile` (`src/shared/profile.ts`). They're written by `npm run profiles:generate`: the overview, endorsements and sources come from an AI model's research, campaign money from FEC and ISBE filings, and judges' bar ratings from `../judges/bar-ratings.json`.

Don't edit these files by hand; the next run would overwrite the change. Correct a profile with an override file in `../overrides/` instead. See `../README.md` for the pipeline.
