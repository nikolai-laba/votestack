# Contributing to VoteStack

Thanks for helping. VoteStack shows voters every race on their ballot and a sourced profile of every candidate. Voters need to be able to trust it, so this guide is mostly about the rules that protect that trust.

## Ways to help

- **A mistake in a candidate profile:** use the "Report an error" link on the profile, with a link to a source that shows the correct information. Please don't open an issue for profile content.
- **A missing, extra or wrong race on a ballot:** open a "Ballot data problem" issue with the ward and precinct and a link to the official sample ballot. Never post your home address.
- **A bug or an idea:** open an issue.
- **A security problem or an exposed key:** report it privately (see [SECURITY.md](SECURITY.md)).
- **Code:** open an issue first for anything larger than a small fix, so we can agree on the approach.

## Set up

Requirements: Node.js 24+ and [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`).

```sh
npm install        # also installs the git hooks
npm run dev        # web app only, at http://localhost:5173
npm run dev:full   # build, then serve the app and API Worker at http://localhost:8787
```

The ballot lookup and profiles need a Supabase database loaded with the official data (see [data/README.md](data/README.md) and [content/profiles/README.md](content/profiles/README.md)). Most UI work only needs `npm run dev` and the tests, which mock the API.

## Before you open a pull request

- Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run format:check`. CI runs the same checks.
- Add or update tests for what you changed.
- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`).
- Add a line to `CHANGELOG.md` under `[Unreleased]` for anything a voter would notice.

## Rules we don't bend

**Neutrality**

- Treat every candidate in a race the same way: the same parts, the same research and the same length limit. Never feature, rank or recommend anyone.
- Keep candidates in official ballot order.
- Show party as plain text, never as a color, an icon or a style that differs by party.
- Use plain, neutral words. Describe what people did and said; don't judge it.

**Privacy**

- A voter's address is used only to look up their ballot. Never log it, store it, cache it, send it to anyone else or put it in a URL.
- No third-party trackers, session replay or ads.
- Never build anything that encourages photographing or sharing a marked ballot. It's a felony in Illinois (10 ILCS 5/29-9).

**Completeness and sources**

- Never hide missing ballot data. Show every race, and flag possible gaps with a link to the official sample ballot.
- Ballot data comes from official sources and is checked against the official sample ballots.
- Every sentence in a profile links to its source. Profiles never include home addresses, contact details, family members, birth dates or unproven allegations.

**Security**

- API keys live only in server-side code (`worker/`, `scripts/`). Never put a secret in a `VITE_*` variable or anywhere under `src/`; those ship to every visitor.
- Never commit real keys. The `*.example` files list every variable name.

**Accessibility**

- Meet WCAG 2.2 AA: keyboard access, visible focus, 4.5:1 text contrast, 44 by 44 pixel touch targets, and labels for every control.
- Check UI changes at phone width (320px), at 200% zoom and in light and dark mode.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your code is licensed under the [Apache License 2.0](LICENSE) and your content changes under [CC BY 4.0](content/LICENSE), as described in [NOTICE](NOTICE).
