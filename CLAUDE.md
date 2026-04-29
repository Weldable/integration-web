# @weldable/integration-web

This is one integration in the Weldable integrations family. Conventions, action authoring patterns, error classes, and the release process are documented canonically in **[integration-core's CLAUDE.md](https://github.com/weldable/integration-core/blob/main/CLAUDE.md)** — read that first for any non-trivial change.

## Local quirks

- Auth type is `none` (no credentials required — this integration fetches public web content).
- Uses `cheerio` for HTML parsing and `turndown` for HTML-to-markdown conversion.

## Releasing

Use the `/commit` skill — it handles the version bump, build check, and push to trigger the automated npm publish.
