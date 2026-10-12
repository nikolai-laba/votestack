# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting instead: open the repository's **Security** tab and choose **Report a vulnerability**. We aim to respond within 7 days.

Please include a description of the issue, steps to reproduce it, and its likely impact.

## Exposed secrets

If you find an API key, token, or credential in this repository or its history, report it privately in the same way. We will revoke and rotate the credential and then clean the history.

## Our practices

- API keys are only used in server-side code (`worker/`, `scripts/`) and are never shipped in the website or app bundle.
- Every commit is scanned for secrets with [gitleaks](https://github.com/gitleaks/gitleaks), both locally (pre-commit hook) and in CI.
- Voter addresses are used only to look up a ballot. They are not logged or stored.
