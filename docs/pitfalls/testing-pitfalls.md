# Testing Pitfalls (project-specific, Cloudflare)

## Do not weaken assertions to fix flakes
If a timing/DB/concurrency test races or flakes, the fix is deterministic synchronization (await a
real signal, seed D1 deterministically, control the clock) — NOT deleting or loosening the
assertion. If you cannot make it deterministic, STOP and raise it. A commit that touches assertions
MUST say in its subject what happened to them (add/strengthen/preserve, or explicitly "weaken" +
why). "test stabilization" as a subject is banned.

## Tests run INSIDE workerd — use cloudflare:test, not Node shims
`@cloudflare/vitest-pool-workers` runs every test in the Workers runtime: `env` (bindings incl. a
real local D1 with migrations applied in setup) and `SELF` (the whole Worker, for request-level
tests) come from `cloudflare:test`. There is no `process.env`, no `node:fs`. Do NOT mock D1 —
the local D1 IS the real SQLite engine; DB-backed tests always run.

## Test the security invariants, not just the happy path
For every gate/auth feature, the negative test is the important one: expired code denied, revoked
code denied on the NEXT load, wrong TOTP denied, DB-down denied (inject a throwing DB wrapper),
unknown-slug and bad-code responses byte-identical. A feature without its negative tests is not done.

## Prove the SQL-level invariants against real D1
Cover: (a) redemption is one conditional UPDATE — a code revoked before redeem is denied with no
dangling `use_count` increment; (b) sequential redemptions never lose `use_count`; (c) a random-slug
spray does NOT create unbounded `rate_limits` rows (bucketed); (d) the 90-day default comes from
the DB column default (insert without expires_at, read back ≈ unixepoch()+7776000); (e) a replayed
TOTP step yields meta.changes === 0.

## Assert the security PROPERTIES, not just behavior
Explicit tests for: **no plaintext code column** (PRAGMA table_info(codes) has code_hash, no code);
**wrong password + valid TOTP does NOT consume the step**; **argon2id** (stored hash starts
`$argon2id$`; verify rejects a fast-hash string); **key-ring rotation** — previous kid verifies
during the window, retired kid rejected, unknown-v / extra-field payloads rejected.

## Assert the full header/cookie contract on EVERY response class via SELF
One suite hits the redemption 302, the asset 200, the failure page, and an admin response through
`SELF.fetch` and asserts EVERY header (`Cache-Control: no-store`, `Pragma`, `Referrer-Policy:
no-referrer`, `X-Robots-Tag`, `X-Content-Type-Options: nosniff`, full CSP incl. `frame-ancestors
'none'`/`object-src`/`frame-src`/`worker-src 'none'`, HSTS), the asset-cookie attributes
(`HttpOnly`/`Secure`/`SameSite=Lax`/`Path=/a/<slug>`), and that the post-redirect URL carries no
`?code=`. Also assert `/assets/manifest.json`, `/a/manifest.json`, `/a/<slug>/manifest.json` return
the generic non-served behavior.

## Cover the request-level compositions (not just lib functions)
Via `SELF.fetch`: `?code=` overrides an existing cookie (precedence); traversal/malformed slug
rejected before any DB/map access; expired-cookie load returns the generic page then re-opening the
link re-redeems; `/a/*` and `/admin/*` inert when ENVIRONMENT is "preview" (byte-identical generic
page); login rejects wrong password OR wrong TOTP; a mutation with a bad/absent Origin is rejected;
a valid-cookie load is limiter-exempt but still DB-rechecked.

## Control time; never sleep
Expiry, TOTP steps, and limiter windows are time-dependent. In unit-style tests pass explicit `now`
values / seed rows with explicit epochs (e.g. `expires_at = unixepoch() - 1` for expired); rely on
DB `unixepoch()` for integration tests. Never `setTimeout`-sleep to "wait for" a state change.

## Enumeration parity is about failure-vs-failure only
Assert unknown-slug and bad-code return identical body+status+headers. Do NOT assert
success-vs-failure indistinguishability — success is a 302 and is meant to differ (spec §3).

## Test bindings live in vitest.config.ts, not .env files
Secrets/vars for tests are miniflare `bindings` in `vitest.config.ts` (dummy key rings, a REAL
argon2id hash of the literal test password "test-password" — generated once in Task 4.1; a
placeholder hash makes login tests verify garbage). A fresh clone must run `npm test` green with
no extra setup.
