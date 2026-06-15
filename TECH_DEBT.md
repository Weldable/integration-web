# Tech Debt — integration-web

## [2026-06-14] src/index.ts — response size guards buffer the full body before the cap
`web.api`, `web.scrape`, and `web.fetch` read the entire response into memory (`response.text()` / `arrayBuffer()`) before checking `MAX_BYTES`. A chunked response (no `content-length`) or a compressed payload that undici auto-decompresses can exceed the 10 MB cap in memory before the check fires (a decompression-bomb / OOM risk, bounded only by the 30s timeout). Surfaced during WEL-18 review. Fix: stream the body and abort once cumulative bytes exceed `MAX_BYTES`.

## [2026-06-14] src/index.ts — returned response headers can mismatch the decoded body
undici auto-decompresses gzip/deflate/br before `.text()`/`.arrayBuffer()`, but `web.api` returns the original response headers, so `content-encoding` and the original (compressed) `content-length` are reported alongside an already-decoded `body`. An author who trusts the returned `content-length` gets a wrong value. Low priority; consider stripping `content-encoding`/`content-length` from the returned headers.

## [2026-06-14] integration-core (cross-repo) — checkIntegrationContract does not assert mock == real
`@weldable/integration-core`'s `checkIntegrationContract` (src/testing.ts) only checks mock-covers-declared + determinism; it never asserts `mockExecute` output keys equal the real `execute()` output keys, nor that declared `outputFields` match the real return. That gap let all three web actions ship a three-way output-contract mismatch (WEL-18). WEL-18 adds a local mock-vs-real key-parity test in `src/web.test.ts`, but the durable fix is to upstream a real-vs-mock (and real-vs-declared) output key-parity check into `checkIntegrationContract` so all 12 integrations inherit it. Route via release-train; note the harness itself is currently staged-unpublished in integration-core.
