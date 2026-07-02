# Gated Asset Sharing Site — Implementation Plan (Cloudflare)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-admin Cloudflare Worker (Hono) that serves self-contained interactive HTML "assets" gated behind admin-generated access codes (per-recipient, expiring, revocable), published git-natively — codes in D1, assets bundled into the Worker.

> **Derived from** [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](../design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md) (the authoritative Cloudflare port of the security-hardened REVISED design). Owner-resolved: **D1** (spec §15 Q4), **Workers Paid** (spec §15 Q9). Sibling plan: [`2026-07-02-gated-asset-sharing-site-plan.md`](2026-07-02-gated-asset-sharing-site-plan.md) implements the same security model on **Vercel/Next.js/Neon** for the Vercel deployment — a different deliverable for a different deployer, NOT superseded by this plan. Its platform-neutral security logic is ported here; keep security-relevant fixes in sync across the pair.

**Architecture:** One purpose-built Worker (Hono router, TypeScript). `GET /a/:slug` validates `?code=` via a **single atomic `UPDATE … RETURNING`** on D1 (validate + record usage + compute the DB-time cookie expiry in one statement), sets a signed HttpOnly asset cookie, and 302-redirects to a clean URL; subsequent loads re-check the code-id in D1 (**fail closed**) so revocation is instant. **Codes are stored only as `SHA-256(code)`** — the raw code is never persisted (shown once at generation). A password+TOTP-gated `/admin` mints/revokes codes. Asset HTML is **compiled into the Worker bundle** as Text modules via a build step that also emits a **confidential, non-routable manifest module** and enforces a **generator registry** for slug provenance. There is **no `assets` config in wrangler.jsonc — ever** (spec §4/§7: the platform must never serve a byte of this site; the Worker is the only door). Every response renders per-request.

**Tech Stack:** Cloudflare Workers (Paid plan), Hono, TypeScript, Wrangler (environments: top-level=dev, `preview`, `production`), D1 (SQLite; `wrangler d1 migrations`), `jose` (versioned `{v,kid}` tokens over a **key ring**, HMAC-SHA256 via WebCrypto), `otpauth` (TOTP), `hash-wasm` (**argon2id in WASM** — no native addons on Workers), WebCrypto (`crypto.getRandomValues`, `crypto.subtle.digest` for SHA-256), Vitest + `@cloudflare/vitest-pool-workers` (tests run **inside workerd** against a real local D1 with migrations applied — full request-level integration via `SELF.fetch`).

---

## Living Document Contract

This plan is a living document. Every executing agent MUST update it as
execution progresses, not only at completion.

- **On phase claim:** the executor MUST flip the banner to 🚧 IN PROGRESS
  with a claim timestamp (ISO 8601 UTC) and the active branch name. The
  banner MUST NOT include an expected-completion estimate — agents cannot
  reliably estimate their own wall-clock, and a fabricated duration
  becomes a stale anchor that misleads future readers. Followers
  encountering a 🚧 banner determine liveness by observable signals (PR
  existence, recent branch commits), not by arithmetic on expected times.
  See Step 5's stale-claim reclaim protocol.
- **On phase ship:** the executor MUST update that phase's **Execution
  Status** banner with the shipped commit SHA(s) and date. If a PR is
  open, the PR number and URL MUST appear in the top-of-plan Execution
  Status table.
- **On phase defer:** the executor MUST update the banner with ⏸ status
  AND a prose description of the unblock condition + a link to the
  likely-unblocker artifact (plan page, task, or PR whose own Execution
  Status banner will signal completion). Prose + link is durable across
  paraphrases and scope edits; exact-string coordination between agents
  is not.
- **On PR merge:** the executor MUST record the merge SHA in the banner
  + the top-of-plan Execution Status table.
- **On deviation from the written plan** (scope edits, structural
  refactors, dropped tasks, reordered phases): the executor MUST
  inline-document the deviation in the affected task AND summarize it
  in the top-of-plan Execution Status as a "Deviations" subsection.
  Deviation state MUST NOT live only in PR notes or status reports.
- **On discovery** (pre-existing drift surfaced during execution, new
  bugs found, architectural issues noted): the executor MUST add a
  "Discoveries" subsection at the top of the plan with pointers to the
  files/lines affected. Follow-up dispatches read this subsection to
  avoid duplicate discovery work.

The plan SHOULD reflect reality at the end of every session that touches
it. Anything worth putting in a status report to the user is worth
putting in the plan.

Rationale: `/writing-plans-enhanced` Step 5. Writing at ship time is
cheap; reconstruction by downstream readers is expensive, compounds
across dispatches, and fails silently when state is split across PR
notes and commit messages.

---

## Execution Status

**Overall:** In progress — subagent-driven execution started 2026-07-02 on branch `dev`.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 0 — Foundation & pitfalls docs | ✅ Shipped 2026-07-02 | 0ec129d, 279f6b5, fee8995, f5c1aa0, 7484368 | gate review: 3/3 rounds clean; Task 0.3 deviation recorded |
| 1 — D1 dialect spike (risk-first) | ✅ Shipped 2026-07-02 | 385e0e1 | both remote proofs ✓ (expression DEFAULT; atomic UPDATE…RETURNING) — Phase 3 unblocked |
| 2 — Schema, codes & signed tokens | ✅ Shipped 2026-07-02 | 83ecbbf, 1bd08ae, 009c435, 608d5ca | gate review: 3/3 rounds clean (incl. 30-probe adversarial token review) |
| 3 — Gate route, cookie, headers, limiter | ✅ Shipped 2026-07-02 | 2e8cc00, e1c3444, 5b272cd, 85df3c2 | gate review 3/3 clean (adversarial: no revocation bypass, fail-closed/open split verified; §6 step→test mapped; Phase 4–6 dry-compiled) |
| 4 — Admin auth (WASM argon2id + TOTP) | ✅ Shipped 2026-07-02 | 3baf7bd, 7c2fa78, 03712d1, 7c18222 | gate 3/3 clean (adversarial auth boundary; §8 mapped; Phase 5 dry-compiled). KDF swapped hash-wasm→@noble/hashes (Deviations) |
| 5 — Admin panel UI | 🚧 In progress | — | claimed 2026-07-02T19:47:04Z, branch `dev` |
| 6 — Asset pipeline (generator + module map) | ⬜ Not started | — | — |
| 7 — Environments, deploy pipeline & isolation | ⬜ Not started | — | — |

### Deviations
- **Task 0.3 (2026-07-02, forced by toolchain):** the plan's literal `vitest.config.ts`/`src/test/env.d.ts` target the pre-0.13 pool-workers API. As installed (`@cloudflare/vitest-pool-workers` 0.17.0 / vitest 4.1.9): (a) config uses the current `cloudflareTest()` Vite-plugin API instead of `defineWorkersConfig` (all plan bindings/values preserved verbatim); (b) `env.d.ts` augments the global `Cloudflare.Env` instead of the removed `ProvidedEnv`, with a `/// <reference types="@cloudflare/vitest-pool-workers/types" />`; (c) per-test `isolatedStorage` no longer exists, so the per-test-fresh-D1 semantics the plan's later test suites assume are reconstructed in `src/test/apply-migrations.ts` (a `beforeEach` drops all user tables/views incl. `d1_migrations` — as one FK-safe `env.DB.batch()` led by `PRAGMA defer_foreign_keys = ON`, with identifier escaping and diagnosable wrapped errors, commit 7484368 — then re-applies migrations) and pinned by a permanent probe `src/test/isolation.test.ts` (added beyond the plan's file list to guard this load-bearing property). Downgrading to pool-workers 0.12.x (last `defineWorkersConfig` line) was rejected: its older bundled workerd would predate and reject `compatibility_date: 2026-06-25`. No later task's prescribed test code needs to change.
- **Task 3.1 (2026-07-02, type-only):** the plan's withTimeout types the timer as `| undefined`, but @cloudflare/workers-types 4.20260702.1 declares `clearTimeout(timeoutId: number | null)` — shipped as `| null = null`. No behavior change; all 10 prescribed tests green unmodified.
- **Task 4.3 (2026-07-02, syntax fix — behavior-identical):** the plan's login-throttle line `await new Promise((r) => setTimeout(r, await loginThrottleMs(c.env.DB)))` is a JS parse error (`await` inside a non-async Promise executor). Shipped as two lines — `const throttleMs = await loginThrottleMs(c.env.DB); await new Promise((r) => setTimeout(r, throttleMs));` — same behavior, valid syntax, with an inline NOTE. `src/routes/admin.ts` is otherwise verbatim; all 8 admin + 4 csrf prescribed tests pass unmodified.
- **Task 4.1 (2026-07-02, KDF library swap — security decision preserved, OWNER-VISIBLE):** the plan/spec §8 name **`hash-wasm`** for argon2id. hash-wasm decodes its WASM from base64 and calls `WebAssembly.compile(bytes)` at first use; **workerd forbids runtime WASM codegen** ("Wasm code generation disallowed by embedder"), so it throws in both the test runtime and production. Spec §8's *security decision* — memory-hard **argon2id at OWASP params (m=19456, t=2, p=1, 32-byte output), Workers Paid** — is UNCHANGED; only the library changes to **`@noble/hashes` argon2id (pure JS, runs on Workers)**. Verified byte-for-byte identical to hash-wasm at these params (same PHC `$argon2id$v=19$m=19456,t=2,p=1$…` output; a Node-side hash still verifies in-Worker), so the "byte-compatible bootstrap ↔ verifier" invariant holds — both sides now use noble. This is strictly stronger than the spec's own documented fallback (PBKDF2, which is NOT memory-hard). `verifyPassword` reads params+salt from the stored PHC string and constant-time-compares. `hash-wasm` removed from deps; `@noble/hashes` promoted to a direct dependency. The one affected pitfall entry (`docs/pitfalls/implementation-pitfalls.md` → "Bootstrap hash must be byte-compatible…") is updated to name noble. Prescribed Task 4.1 tests pass verbatim (PHC prefix, pinned-params string, round-trip, reject-fast-hash/argon2i); byte-compat and PHC-parse-hardening tests added beyond the plan.

### Discoveries
- **2026-07-02 — pool-workers ≥0.13.0 rearchitecture:** `@cloudflare/vitest-pool-workers` 0.13.0+ requires vitest ^4.1, removes the `/config` subpath export (`defineWorkersConfig` gone; `readD1Migrations` now exported from the package root), and removes per-test `isolatedStorage` (storage isolation is per test FILE). Verified against the installed package's `exports`/`peerDependencies` and npm registry metadata (cutover confirmed at 0.13.0). See the Task 0.3 deviation for how the plan's semantics are preserved.
- **2026-07-02 — Phase 6 anticipation (from the Phase 0 gate review):** Task 6.2's prescribed `src/lib/build/manifest-lib.test.ts` imports `../../../scripts/manifest-lib.mjs`; with the current tsconfig (`include: ["src", ".generated"]`, no `allowJs`) this passes `npm test` but fails `npx tsc --noEmit` with TS7016 (no declaration file). No script currently runs tsc, so nothing breaks as written — but Task 6.2's executor should consciously either add `"allowJs": true` or accept the editor-only gap. Decide then; recorded here so it's anticipated, not discovered.
- **2026-07-02 — `.nvmrc` is 26.3.0** (plan Task 0.2 Step 2 records the local `node -v` by design) while Conventions/CI say Node 24. All installed deps' `engines` accept both. Align or document the split when Task 7.2 authors the CI workflow.
- **2026-07-02 — remote D1 dialect spike (Task 1.1) verified:** expression DEFAULT ✓ (delta=7776000 exactly at insert), UPDATE…RETURNING with min()/unixepoch() ✓ (cookie_exp = iat+86400 exactly; zero rows + use_count unchanged on wrong slug). Spike DB artifact-share-spike created and deleted the same session.
- **2026-07-02 — hash-wasm is incompatible with Cloudflare Workers (Task 4.1):** `hash-wasm` 4.12.0 (all its algorithms) base64-embeds its WASM and calls `WebAssembly.compile()` at runtime; workerd disallows dynamic WASM codegen, so it throws `CompileError: Wasm code generation disallowed by embedder` in workerd (test + prod). Spec §8's premise "hash-wasm — the ONLY viable Workers KDF / WASM runs first-class on Workers" is FALSE as written. The Workers-viable memory-hard KDF is **pure-JS argon2id via `@noble/hashes/argon2.js`** (empirically: runs in workerd; byte-identical to hash-wasm at m=19456,t=2,p=1). Any future WASM dependency on this Worker must be a build-time module import (Wrangler Wasm rule), never `WebAssembly.compile(bytes)`. See the Task 4.1 deviation.
- **2026-07-02 — key-ring operational footguns (Phase 2 gate, adversarial round; non-exploitable, no code change):** `parseKeyRing` accepts arbitrarily short secrets (jose imposes no HMAC key-length floor) and a comma INSIDE a secret silently splits the ring into bogus entries. Both are operator-side hazards only — the prescribed `openssl rand -base64 32` emits no commas and is long. Task 7.3's runbook MUST state: secrets are generated with `openssl rand -base64 32`, must never contain commas, and never hand-typed short strings. (The spec §6 duplicate-JSON-key MUST is consciously not met by the jose implementation — already covered by the Task 2.4 documented deviation; verified non-exploitable: single parser, HMAC over exact bytes.)

---

## Conventions (read before any task)

- **Spec:** [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](../design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md) — the **authoritative Cloudflare** design. Every "spec §N" reference below points there (NOT the Vercel docs). When in doubt, the Cloudflare spec wins; it mirrors the REVISED Vercel design section-for-section if you need the deeper rationale.
- **Package manager:** `npm` (Node 24). **Test runner:** Vitest via `@cloudflare/vitest-pool-workers` — `npm test` runs `vitest run` **inside workerd** with a real local D1 (migrations auto-applied in setup) and the full Worker reachable via `SELF.fetch` from `cloudflare:test`. There is no "skipped DB integration" tier — DB-backed tests always run locally.
- **File layout:**
  - `wrangler.jsonc` — Worker config. **MUST NEVER contain an `assets` key** (spec §4/§7 — platform-served assets would bypass the gate; the build lints this, Task 6.2). `workers_dev: false`, `preview_urls: false` pinned at top level.
  - `migrations/*.sql` — D1 migrations (raw SQL, `wrangler d1 migrations`; forward-only).
  - `src/index.ts` — Hono app: routes `/`, `/robots.txt`, `/a/:slug`, `/admin/*`; header middleware.
  - `src/env.ts` — the `Env` bindings interface (single source of truth for bindings).
  - `src/lib/codes.ts` — 128-bit CSPRNG code/slug generation + async `SHA-256` hashing (WebCrypto).
  - `src/lib/crypto/tokens.ts` — versioned `{v,kid}` signed tokens over a **key ring** (jose, HS256 pinned).
  - `src/lib/gate.ts` — atomic redeem (`UPDATE … RETURNING`; awaits its real outcome — never app-timed) + fail-closed recheck (short app-side timeout).
  - `src/lib/ratelimit.ts`, `src/lib/db/rateStore.ts` — bucketed limiter over the `rate_limits` table.
  - `src/lib/auth/{password.ts,totp.ts,session.ts}` — hash-wasm argon2id; TOTP-after-password; key-ring session.
  - `src/lib/db/totpStore.ts` — TOTP replay rejection via `totp_used_steps` (`meta.changes === 0` ⇒ replay).
  - `src/lib/http/{headers.ts,csrf.ts}` — the ONE security-header set; pinned-origin CSRF.
  - `src/lib/{assets.ts,manifest.ts}` — lookups over the **generated modules** (no filesystem at runtime).
  - `src/routes/{gate.ts,admin.ts}` — route handlers, mounted by `src/index.ts`.
  - `scripts/{new-asset.mjs,build-manifest.mjs,manifest-lib.mjs,hash-password.mjs,totp-setup.mjs}` — Node-side CLI + build.
  - `assets/<slug>/index.html` — asset bodies (compiled into the bundle; NEVER served by the platform).
  - `.generated/assets-manifest.ts`, `.generated/assets-modules.ts` — **generated, confidential, non-routable** manifest + slug→HTML module map COMMITTED (the repo already holds the asset HTML, so these derived modules add no exposure) and regenerated by `npm run build-manifest`; CI regenerates before every deploy. `.generated/slugs.json` — **committed** slug provenance registry.
- **Bindings & secrets** (spec §10): binding `DB` (D1); vars `ENVIRONMENT` (`"development"` top-level / `"preview"` / `"production"` — the app's ONLY environment oracle) and `PUBLIC_ORIGIN` (canonical origin per env, for CSRF + link minting); secrets `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `ASSET_COOKIE_SECRET` (the latter two are **key rings** — `<kid>:<secret>` entries, comma-separated, current kid first). There is NO database credential — D1 is a binding. Local dev secrets live in `.dev.vars` (gitignored); tests get theirs from `vitest.config.ts` miniflare bindings.
- **Environment gate semantics (spec §8/§10 — fail closed):** the ONLY serving environment is `production`. `preview`, `development`, unset, or anything else ⇒ both `/a/*` and `/admin/*` return the generic failure page. Local QA opts in explicitly: set `ENVIRONMENT=production` in `.dev.vars` (safe — local `wrangler dev` bindings hit the local D1 file, never remote; codes minted locally never reach production). This means a mis-deployed non-prod Worker can never serve confidential content regardless of which DB it is bound to; the D1 `meta` marker is the operator's binding-verification signal (Tasks 7.1/7.4), not a runtime branch.
- **Time:** all AUTHORIZATION time logic — code validity/expiry, limiter windows, TOTP replay state — is SQL on `unixepoch()` (D1 clock — spec §5). All time columns are INTEGER epoch seconds. JS `Date` is display-only for that state. **Scoped exception (spec §6 step 4/§8, deliberate):** token TTLs — the asset cookie's `exp` (= DB-computed `cookie_exp`) and the admin session's 7-day `exp` — are enforced by jose on the runtime clock; they are TTLs, NOT authorization (the authoritative check is always the per-load DB recheck / the login itself), so runtime-clock skew cannot extend access to a revoked or expired code. Do not "fix" token verification to query D1 for the current time. **D1 read replication stays OFF** on every database of this app — standing invariant (spec §5).
- **Never log** the raw `?code=`, full request URLs on `/a/*`, or cookie values (spec §3 D4). Log slug + outcome + `code_id` only.
- **Every task is TDD.** BEFORE starting any task: (1) invoke `superpowers:test-driven-development` (if the skill is unavailable in your harness, apply its discipline manually: failing test first, minimal implementation, green, then refactor); (2) read `docs/pitfalls/testing-pitfalls.md`. Write the failing test → implement → verify green. BEFORE marking any task complete: review its tests against `docs/pitfalls/testing-pitfalls.md`; verify error paths + edge cases are covered; run `npm test` green. **Exemptions:** Tasks 0.1 and 0.2 (docs + scaffold — they CREATE the pitfalls docs and the harness; there is nothing to test-first) and the human-assisted config steps in Phases 1/7 (verified by their explicit expected-output checks instead).
- **Phase-completion review (every phase's "BEFORE marking … complete" gate):** review the phase's batch from multiple perspectives across a **minimum of 3 review rounds**; if round 3 still finds substantive issues, keep going until a round is clean. At minimum cover: security invariants (negative paths, fail-closed vs fail-open split), spec conformance, and cross-task type/name consistency.
- **Plan-file staging:** any step that records something in THIS plan (banner flips, Execution Status, Discoveries — e.g. Task 1.1's spike proof, Task 7.4's verification results) MUST stage the plan in that same commit: `git add docs/plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md`. Gating evidence that lives only in a terminal scrollback is lost to every future session.
- **Assertion rigor (all timing/DB/concurrency tests — esp. Phases 3–4):** if a test races or flakes, the fix is deterministic synchronization or a controlled clock/fake — **never** assertion removal or weakening. If it can't be made deterministic, STOP and raise. Prefer mechanism assertions ("revoked ⇒ next load denied") over symptom assertions. Commit subjects touching assertions MUST say add/strengthen/preserve (or explicitly "weaken" + why); "stabilization" is banned. See `docs/pitfalls/testing-pitfalls.md`.

---

## Open owner decisions (spec §15) — surfaced, not silently foreclosed

Spec §15 Q4 (D1) and Q9 (Workers Paid) are **owner-resolved** and hardcoded here. The rest get a
**default** with a localized seam; confirm or change each before shipping:

- **§15 Q1 — reusable code in the URL.** Default: the query-string model (`/a/<slug>?code=…`), read in
  ONE place (Task 3.2's route) and minted in ONE place (Task 5.2's create action). The alternatives
  (one-time redemption token; fragment + same-origin POST) would change only those two sites + limiter
  keying. Recommend at least the fragment approach if platform-log leakage is a real concern (spec §3 D4).
- **§15 Q2 — sandboxed-iframe rendering.** Default: asset HTML rendered directly in the top frame
  (Task 3.2). The spec promotes the sandboxed iframe (no `allow-top-navigation`) to a **recommended
  reconsideration** — CSP cannot stop top-nav exfiltration. If adopted, keep the access cookie scoped
  to the parent route. Conscious owner decision, NOT settled scope.
- **§15 Q3 — non-prod gating.** Default implemented: the app-level `ENVIRONMENT` gate makes `/a/*` AND
  `/admin/*` inert on preview (Tasks 3.2/4.3), **plus** Cloudflare Access on every non-prod hostname
  (Task 7.3 — adopted pending owner ratification per the spec). QA the real flow in `wrangler dev`.
- **§15 Q5 — bundled modules vs private R2.** Default: bundled Text modules (Task 6.2), with the build
  emitting a **bundle-size report** and failing above 70% of the 10 MB-gzip ceiling. Crossing the
  threshold (or adding sidecar assets) triggers the pre-committed R2 mechanism (spec §7) — a new plan
  phase, not an ad-hoc hack.
- **§15 Q6 — Cloudflare Access in front of production `/admin`.** Default: **not enabled** by this plan
  (app-level password+TOTP is the boundary); the runbook (Task 7.3) documents the one-click enable if
  the owner ratifies Q6. Never a replacement for app auth.
- **§15 Q7 (Turnstile) / Q8 (zone WAF rules).** Default: **neither enabled.** The runbook records the
  constraints (never a challenge on `/a/*`; no cache rules / HTML-rewriting features on this hostname)
  so a future yes is done safely.

---

## Execution strategy (recommendation)

**Recommended: Subagent-Driven Development** (`superpowers:subagent-driven-development`) — a fresh
subagent per task with review between tasks. Rationale: every task above is self-contained (exact
files, full code, exact commands — a fresh subagent needs no conversation history); phases are
mostly SEQUENTIAL (each builds on the previous phase's modules, and Tasks 3.2→3.4 and 4.3→5.2 edit
the same files), so parallel worktree agents would conflict; and the security-critical tasks
(1.1, 3.1, 3.2, 4.3) deserve the per-task review gate. Inline execution
(`superpowers:executing-plans`) is the fallback for a low-supervision batch run. Do NOT dispatch
phases in parallel; the only safe intra-phase parallelism is Task 6.1 alongside Phase 5 (disjoint
files) — not worth the coordination overhead. Tasks 1.1 and everything in Phase 7 need Cloudflare
credentials (`wrangler login` / API token) — human-assisted; if credentials are unavailable mid-run,
mark those phases ⏸ DEFERRED per the Living Document Contract and continue with the local-only
phases (2–6 run entirely against local D1).

---

## Phase 0 — Foundation & pitfalls docs

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits 0ec129d (0.1), 279f6b5 (0.2), fee8995 + f5c1aa0 + 7484368 (0.3, see Deviations). Gate review: 3 rounds (security, spec conformance, cross-task consistency), all clean.

> Why this phase first: establishes the toolchain, the workerd test harness every later task depends
> on, and the project-specific pitfalls docs the TDD blocks reference. Pitfalls are seeded from the
> Cloudflare spec (§3–§11), which itself carries the 6-round security review of the Vercel original.

### Task 0.1: Seed the pitfalls docs

**Files:**
- Create: `docs/pitfalls/implementation-pitfalls.md`
- Create: `docs/pitfalls/testing-pitfalls.md`

- [x] **Step 1: Create `docs/pitfalls/implementation-pitfalls.md`** with this content:

```markdown
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
`scripts/hash-password.mjs` (Node) and the Worker verifier BOTH use `hash-wasm` argon2id with the
same pinned params; the PHC-encoded string embeds params+salt so verify reads them back. Never
substitute a different argon2 library on one side only, or the admin's correct password is
rejected with no obvious cause. `@node-rs/argon2` does NOT run on Workers (native addon).

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
```

- [x] **Step 2: Create `docs/pitfalls/testing-pitfalls.md`** with this content:

```markdown
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
```

- [x] **Step 3: Commit**

```bash
git add docs/pitfalls/
git commit -m "docs: seed Cloudflare project pitfalls docs from the ported design"
```

### Task 0.2: Scaffold the Worker (manual — deterministic, no CLI prompts)

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `.nvmrc`
- Create: `src/index.ts`, `src/env.ts`, `src/types/html.d.ts`
- Create: `.generated/assets-manifest.ts`, `.generated/assets-modules.ts` (committed stubs — the build overwrites them)
- Create: `.dev.vars.example`
- Modify: `.gitignore`

- [x] **Step 1: Create `package.json`** (exact content; versions resolve at install):

```json
{
  "name": "artifact-share",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "npm run build-manifest && wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "new-asset": "node scripts/new-asset.mjs",
    "build-manifest": "node scripts/build-manifest.mjs",
    "hash-password": "node scripts/hash-password.mjs",
    "totp-setup": "node scripts/totp-setup.mjs"
  }
}
```

- [x] **Step 2: Install deps**

```bash
npm i hono jose otpauth hash-wasm
npm i -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
node -v | sed 's/^v//' > .nvmrc
```

> `hash-wasm` is the WASM argon2id (spec §8) — `@node-rs/argon2` is a native addon and does NOT run
> on Workers. `jose` and `otpauth` are WebCrypto-based and Workers-compatible (spec §8).

- [x] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", ".generated"]
}
```

- [x] **Step 4: Create `wrangler.jsonc`** (top level = local dev; `preview`/`production` env blocks land in Task 7.1):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  // Top-level name is LOCAL-DEV ONLY and deliberately differs from the production Worker
  // ("artifact-share") so a bare `wrangler deploy` (no --env) can never clobber production.
  "name": "artifact-share-dev",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-25",
  // Spec §10: no accidental public hostnames. Both pinned explicitly, never defaulted.
  "workers_dev": false,
  "preview_urls": false,
  // Lets generated code import asset HTML as string modules (spec §7 bundled-module mechanism).
  "rules": [{ "type": "Text", "globs": ["**/*.html"], "fallthrough": true }],
  "vars": { "ENVIRONMENT": "development", "PUBLIC_ORIGIN": "http://localhost:8787" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "artifact-share-dev",
      // Placeholder UUID: local dev + tests never contact remote D1. Real per-env IDs in Task 7.1.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
  // INVARIANT (spec §4/§7): this file MUST NEVER gain an "assets" key. The build lints this (Task 6.2).
}
```

- [x] **Step 5: Create `src/env.ts`** (single source of truth for bindings):

```ts
export interface Env {
  DB: D1Database;
  /** "development" | "preview" | "production" — the ONLY environment oracle (spec §10). */
  ENVIRONMENT: string;
  /** Canonical origin for this environment — CSRF pin + link minting (spec §8). */
  PUBLIC_ORIGIN: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_TOTP_SECRET: string;
  /** Key rings: "<kid>:<secret>[,<kid>:<secret>…]", current kid first (spec §10). */
  SESSION_SECRET: string;
  ASSET_COOKIE_SECRET: string;
}
```

- [x] **Step 6: Create `src/index.ts`** (hello skeleton; real routes land in Phases 3–5):

```ts
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

// Spec §9: "/" is deliberately neutral/blank — nothing to enumerate.
app.get("/", (c) => c.body(null, 200));

export default app;
```

- [x] **Step 7: Create the committed generated-module stubs** (so a fresh clone compiles before the
  first `npm run build-manifest`; the build overwrites them and the results are COMMITTED — the repo
  already contains the asset HTML itself, so these derived modules add no new confidentiality
  exposure, and committing them keeps deploys reproducible from a checkout):

`.generated/assets-manifest.ts`:

```ts
// GENERATED by scripts/build-manifest.mjs — do not edit by hand. Confidential (slug→title = client
// identities, spec §7); compiled into the Worker, NEVER routable.
export const manifest: Record<string, { title: string }> = {};
```

`.generated/assets-modules.ts`:

```ts
// GENERATED by scripts/build-manifest.mjs — do not edit by hand. Slug → asset HTML (Text modules).
export const assetModules: Record<string, string> = {};
```

- [x] **Step 8: Create `src/types/html.d.ts`** (TypeScript needs a module shape for the Text-module
  HTML imports the generated code uses; Wrangler's `rules` covers the runtime, this covers tsc/IDE/tests):

```ts
declare module "*.html" {
  const content: string;
  export default content;
}
```

- [x] **Step 8b: Create `.dev.vars.example`** (committed template; copy to `.dev.vars` for local
  admin QA — `.dev.vars` itself stays gitignored). The hash below is for the password
  `local-password`; regenerate with `npm run hash-password -- <pw>` after Task 4.1 lands, or use the
  gate-only flows (which need no admin secrets) until then:

```
# cp .dev.vars.example .dev.vars   (never commit .dev.vars)
# ENVIRONMENT=production is the EXPLICIT local-QA opt-in (spec §10): serving is production-only,
# and this is safe locally because wrangler dev binds the local D1 file, never remote. Do NOT use
# this override together with remote bindings.
ENVIRONMENT=production
ADMIN_PASSWORD_HASH=REPLACE-ME-run-npm-run-hash-password
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP
SESSION_SECRET=k1:local-session-secret-not-for-prod-000000000000
ASSET_COOKIE_SECRET=k1:local-asset-secret-not-for-prod-0000000000000
```

- [x] **Step 9: Append to `.gitignore`**

```
node_modules/
.wrangler/
.dev.vars
.dev.vars.*
!.dev.vars.example
```

- [x] **Step 10: Verify dev server boots**

Run: `npx wrangler dev` then in another shell `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8787/`
Expected: `200`. Stop the dev server (Ctrl-C).

- [x] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Hono Worker (wrangler, TS, generated-module stubs; no assets key)"
```

### Task 0.3: Wire the workerd test harness

> **DEVIATION (executed 2026-07-02):** implemented against pool-workers 0.17.0 / vitest 4.1.9 — the
> Step 1/Step 3 file contents below are the plan-time API and do NOT match what shipped. Shipped:
> `cloudflareTest()` plugin config (same bindings verbatim), global `Cloudflare.Env` augmentation,
> and per-test-fresh-D1 reconstructed in `apply-migrations.ts` (beforeEach drop+reapply) + pinned by
> `src/test/isolation.test.ts`. See top-of-plan Deviations. Commits fee8995 + f5c1aa0.

**Files:**
- Create: `vitest.config.ts`, `src/test/apply-migrations.ts`, `src/test/env.d.ts`, `src/test/smoke.test.ts`
- Create: `migrations/.gitkeep` (dir exists before Phase 1 fills it)

- [x] **Step 1: Create `vitest.config.ts`** (runs tests inside workerd; real local D1; bindings for tests):

```ts
import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  // ESM config ("type": "module") — __dirname does not exist here; derive from import.meta.url.
  const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));
  return {
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          // Per-TEST storage isolation (explicit, load-bearing: tests seed fixed hashes/rows and
          // assume a fresh D1 each test; migrations re-apply via the setup file).
          isolatedStorage: true,
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Tests exercise the PRODUCTION code paths by default (gate+admin serve). Env-variant
              // behavior (preview-inert) is tested via app.request(path, init, envOverride).
              ENVIRONMENT: "production",
              PUBLIC_ORIGIN: "https://share.test",
              SESSION_SECRET: "k1:test-session-secret-do-not-use-in-prod-0000000000",
              ASSET_COOKIE_SECRET: "k1:test-asset-secret-do-not-use-in-prod-00000000000",
              ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
              // Placeholder until Task 4.1 Step 6 replaces it with a REAL hash-wasm argon2id hash of
              // the literal test password "test-password". Login-flow tests verify against this value;
              // do not ship the placeholder — see docs/pitfalls/testing-pitfalls.md.
              ADMIN_PASSWORD_HASH: "PLACEHOLDER-REPLACED-IN-TASK-4.1"
            }
          }
        }
      }
    }
  };
});
```

- [x] **Step 2: Create `src/test/apply-migrations.ts`**

```ts
import { applyD1Migrations, env } from "cloudflare:test";

// Applies all migrations/*.sql to the isolated per-test local D1 before each test file runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [x] **Step 3: Create `src/test/env.d.ts`**

```ts
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "../env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [x] **Step 4: Create `src/test/smoke.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("worker boots and root is a blank 200", async () => {
  const res = await SELF.fetch("https://share.test/");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
});

test("test bindings are wired", () => {
  expect(env.ENVIRONMENT).toBe("production");
  expect(env.SESSION_SECRET.startsWith("k1:")).toBe(true);
});
```

- [x] **Step 5: Run tests**

Run: `mkdir -p migrations && touch migrations/.gitkeep && npm test`
Expected: PASS (2 tests). If `readD1Migrations` errors on the empty dir, keep `.gitkeep` and confirm the dir exists — an empty migrations list is valid.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: workerd vitest harness (pool-workers, local D1 migrations, SELF smoke test)"
```

**BEFORE marking Phase 0 complete:** run the ≥3-round phase review (Conventions). Confirm: no `assets` key in `wrangler.jsonc`; `workers_dev`/`preview_urls` pinned false; stubs compile; `npm test` green. Update banner + table.

---

## Phase 1 — D1 dialect spike (RISK-FIRST)

**Execution Status:** ✅ SHIPPED 2026-07-02 — commit 385e0e1. Both remote-D1 proofs produced the expected rows (see Discoveries); spec §12 gate passed — Phase 3 unblocked. Migration additionally verified through `wrangler d1 migrations apply --local` and the test harness.

> Why now: spec §12 replaces the Vercel bundling spike with a **dialect spike** — the two load-bearing
> SQLite mechanisms (the atomic `UPDATE … RETURNING` with `min()`/`unixepoch()`, and the expression
> column DEFAULT) must be proven on a **real remote D1 database**, not only Miniflare, before the gate
> is built on them. The migration written here IS the real 0001 migration. **Do NOT proceed to
> Phase 3 until this phase is ✅ with the remote outputs recorded in Discoveries.**
> Requires `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`) — human-assisted if credentials are absent.

### Task 1.1: Write migration 0001 and prove the dialect on remote D1

**Files:**
- Create: `migrations/0001_init.sql`

- [x] **Step 1: Create `migrations/0001_init.sql`** (spec §5 — INTEGER epoch seconds; DB-side defaults; no plaintext code column):

```sql
-- codes: the entire access-control state. NO plaintext code column — code_hash only (spec §3 D3).
CREATE TABLE codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code_hash TEXT NOT NULL UNIQUE,
  asset_slug TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Single trusted time source: 90-day default computed BY THE DB (spec §5). 7776000 = 90 days.
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 7776000),
  revoked_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

-- TOTP replay rejection (spec §5/§8): PK conflict = replay. Pruned lazily.
CREATE TABLE totp_used_steps (
  step INTEGER PRIMARY KEY,
  used_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Rate limiter windows (spec §5/§9): atomic upserts; window compared on unixepoch().
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX rate_limits_window_start_idx ON rate_limits(window_start);

-- Environment marker (spec §10/§13): the mis-pointed-database_id guard reads this. Seeded
-- 'development'; the Task 7.1 runbook UPDATEs it per environment after the first remote apply.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('environment', 'development');
```

- [x] **Step 2: Create a throwaway remote spike DB and apply the migration file to it**

```bash
npx wrangler d1 create artifact-share-spike
npx wrangler d1 execute artifact-share-spike --remote --file=migrations/0001_init.sql
```

Expected: both succeed (execute reports the statements run).

- [x] **Step 3: Prove the expression DEFAULT on remote D1**

```bash
npx wrangler d1 execute artifact-share-spike --remote --command \
  "INSERT INTO codes (code_hash, asset_slug) VALUES ('spikehash1','spikeslugAAAAAAAAAAAAA'); \
   SELECT id, expires_at - unixepoch() AS delta, use_count FROM codes;"
```

Expected: one row; `delta` within a few seconds of `7776000`; `use_count` 0; `id` a 32-hex string.
**If the INSERT fails on the DEFAULT:** STOP — the schema needs app-side expiry writes instead; raise before proceeding (this changes spec §5's mechanism, an owner-visible deviation).

- [x] **Step 4: Prove the atomic redeem statement on remote D1** (the exact production SQL — spec §6 step 4):

```bash
npx wrangler d1 execute artifact-share-spike --remote --command \
  "UPDATE codes SET use_count = use_count + 1, last_used_at = unixepoch() \
   WHERE code_hash = 'spikehash1' AND revoked_at IS NULL AND expires_at > unixepoch() \
   AND asset_slug = 'spikeslugAAAAAAAAAAAAA' \
   RETURNING id, unixepoch() AS iat, min(unixepoch() + 86400, expires_at) AS cookie_exp;"
```

Expected: ONE row with `id`, `iat` ≈ now, `cookie_exp` = `iat + 86400` (24h < 90d). Then the negative case:

```bash
npx wrangler d1 execute artifact-share-spike --remote --command \
  "UPDATE codes SET use_count = use_count + 1, last_used_at = unixepoch() \
   WHERE code_hash = 'spikehash1' AND revoked_at IS NULL AND expires_at > unixepoch() \
   AND asset_slug = 'WRONG' RETURNING id; \
   SELECT use_count FROM codes;"
```

Expected: the UPDATE returns ZERO rows and `use_count` is still `1` (no usage recorded without access — spec §6 step 4).

- [x] **Step 5: Delete the spike DB and record the outcome**

```bash
npx wrangler d1 delete artifact-share-spike -y
```

(`-y` skips the interactive confirmation — required for a non-interactive executor.)

Record in the top-of-plan **Discoveries**: "remote D1 verified 2026-MM-DD — expression DEFAULT ✓, UPDATE…RETURNING with min()/unixepoch() ✓ (cookie_exp correct, zero-row on wrong slug)".

- [x] **Step 6: Commit**

```bash
git add migrations/0001_init.sql docs/plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md
git commit -m "feat: D1 schema migration 0001 (codes/totp_used_steps/rate_limits/meta), spike-verified on remote D1"
```

**BEFORE marking Phase 1 complete:** the two remote-D1 proofs in Steps 3–4 MUST have produced the expected rows, recorded in Discoveries. If either failed, STOP and raise (spec §12 gate). Update banner + table.

---

## Phase 2 — Schema properties, codes & signed tokens

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits 83ecbbf (2.1), 1bd08ae (2.2), 009c435 (2.3), 608d5ca (2.4). Gate review 3 rounds clean: adversarial security (30 empirical probes, no exploitable findings), spec conformance (all gate items mapped to named tests), cross-task consistency (Phase 3–5 interfaces dry-compiled against shipped exports).

> Read `docs/pitfalls/testing-pitfalls.md` → "Prove the SQL-level invariants against real D1",
> "Control time". The migration exists (Phase 1); this phase pins its security properties with tests
> and builds the pure crypto/token layers.

### Task 2.1: Schema security-property tests

**Files:**
- Create: `src/lib/db/schema.test.ts`

- [x] **Step 1: Write the tests** `src/lib/db/schema.test.ts` (they run against the real local D1 with 0001 applied):

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";

test("codes table has code_hash and NO plaintext code column (spec §3 D3, §13)", async () => {
  const { results } = await env.DB.prepare("PRAGMA table_info(codes)").all<{ name: string }>();
  const cols = results.map((r) => r.name);
  expect(cols).toContain("code_hash");
  expect(cols).not.toContain("code");
});

test("expires_at defaults to unixepoch()+7776000 DB-side (spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind("h-default-test", "sluggggggggggggggggggA").run();
  const row = await env.DB.prepare(
    "SELECT expires_at - unixepoch() AS delta FROM codes WHERE code_hash = ?1",
  ).bind("h-default-test").first<{ delta: number }>();
  expect(row!.delta).toBeGreaterThan(7776000 - 60);
  expect(row!.delta).toBeLessThanOrEqual(7776000);
});

test("code_hash is UNIQUE (collision retry path is reachable, spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('dup', 's')").run();
  await expect(
    env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('dup', 's2')").run(),
  ).rejects.toThrow(/UNIQUE/i);
});

test("id is minted DB-side as 32-hex (spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('h-id', 's')").run();
  const row = await env.DB.prepare("SELECT id FROM codes WHERE code_hash = 'h-id'").first<{ id: string }>();
  expect(row!.id).toMatch(/^[0-9a-f]{32}$/);
});
```

- [x] **Step 2: Run** — `npm test -- schema` → PASS (migrations applied by the setup file).

- [x] **Step 3: Commit**

```bash
git add src/lib/db/schema.test.ts
git commit -m "test: pin schema security properties (no plaintext code, DB-side default, unique hash)"
```

### Task 2.2: Code generation + hashing (WebCrypto)

**Files:**
- Create: `src/lib/codes.ts`, `src/lib/codes.test.ts`

- [x] **Step 1: Write the failing test** `src/lib/codes.test.ts`:

```ts
import { expect, test } from "vitest";
import { generateCode, generateSlug, hashCode } from "./codes";

test("generateCode is 22 base64url chars (128-bit)", () => {
  expect(generateCode()).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("generateCode is unique across calls", () => {
  const set = new Set(Array.from({ length: 1000 }, () => generateCode()));
  expect(set.size).toBe(1000);
});

test("generateSlug is 22 base64url chars", () => {
  expect(generateSlug()).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("hashCode is deterministic 64-hex SHA-256 and differs per code", async () => {
  const h = await hashCode("abc");
  // Known SHA-256("abc") — pins the algorithm, not just the shape.
  expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(await hashCode("abd")).not.toBe(h);
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- codes` → FAIL (module not found).

- [x] **Step 3: Implement** `src/lib/codes.ts` (WebCrypto — no `node:crypto` on Workers):

```ts
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 16 CSPRNG bytes → base64url → 22 chars, 128-bit (spec §5, §7). */
function token128(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export const generateCode = token128;
export const generateSlug = token128;

/** SHA-256(code) hex. Only the HASH is ever stored/looked-up — never the raw code (spec §3 D3, §5). */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- codes` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: 128-bit CSPRNG code/slug generation + async SHA-256 hashing (WebCrypto)"
```

### Task 2.3: `CodeRow` type + display-status helper

> There is NO JS validity predicate and NO JS default-expiry: authorization/validity is SQL on
> `unixepoch()` (Tasks 1.1/3.1) and the 90-day default is the DB column default. This task provides
> the row TYPE (snake_case — D1 returns raw column names) and a **display-only** status helper for
> the admin panel. `codeStatus` is NOT an authorization check.

**Files:**
- Modify: `src/lib/codes.ts`, `src/lib/codes.test.ts`

- [x] **Step 1: Add failing tests** to `src/lib/codes.test.ts`:

```ts
import { codeStatus, type CodeRow } from "./codes";

const base: CodeRow = {
  id: "x", code_hash: "h", asset_slug: "s", label: "",
  created_at: 1_760_000_000, expires_at: 1_770_000_000,
  revoked_at: null, last_used_at: null, use_count: 0,
};

test("codeStatus is 'active' when not revoked and not past expiry", () => {
  expect(codeStatus(base, 1_765_000_000)).toBe("active");
});
test("codeStatus is 'expired' at/after expiry", () => {
  expect(codeStatus(base, 1_770_000_000)).toBe("expired");
});
test("codeStatus is 'revoked' regardless of expiry", () => {
  expect(codeStatus({ ...base, revoked_at: 1_761_000_000 }, 1_765_000_000)).toBe("revoked");
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- codes` → FAIL (`codeStatus` not defined).

- [x] **Step 3: Implement** — append to `src/lib/codes.ts`:

```ts
/** Row shape of the `codes` table as D1 returns it (snake_case, INTEGER epoch seconds).
 *  Has `code_hash`, NEVER a raw `code` (spec §3 D3). */
export interface CodeRow {
  id: string;
  code_hash: string;
  asset_slug: string;
  label: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  use_count: number;
}

/** DISPLAY status for the admin panel ONLY — NOT an authorization check. Real validity is enforced
 *  in SQL on unixepoch() (spec §5/§6; Tasks 1.1/3.1). Reused by the admin page (Task 5.2). */
export function codeStatus(
  row: Pick<CodeRow, "revoked_at" | "expires_at">,
  nowSec: number,
): "active" | "expired" | "revoked" {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at <= nowSec) return "expired";
  return "active";
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- codes` → PASS (all).

- [x] **Step 5: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: CodeRow type (code_hash, no plaintext) + display-status helper"
```

### Task 2.4: Signed tokens — versioned, canonical, key-ring (asset cookie + session)

> Spec §6 step 4 / §8 / §10: tokens carry a schema version `v` and key id `kid`; secrets are **key
> rings** (`<kid>:<secret>` entries, current first). Verify selects the key by `kid`, PINS the alg
> to HS256, enforces `v`, strict-validates claims (reject unknown/extra fields), and enforces exp.
> Rotation: sign with current, verify current+previous, reject retired. The asset payload binds
> `{slug, codeId, cookieExp}`; `cookieExp` (absolute unix seconds) is the DB-computed expiry passed
> in by the gate (Task 3.2) — tokens do NOT invent their own TTL, and the asset token's `iat` is
> the DB-returned redeem time, not Worker wall-clock. `jose` is WebCrypto-backed and runs on
> Workers unchanged.
>
> **Documented deviation (owner-visible, carried over from the reviewed Vercel sibling plan):** the
> spec's "canonical encoding — prefer a fixed binary layout" is implemented as a **JWT via jose**
> rather than a hand-rolled binary format: `kid` lives in the signed protected header (equivalent
> binding), `v` in the payload, alg pinned to HS256, exp enforced, and strict key-set validation
> rejects unknown/extra fields. The spec's duplicate-JSON-key concern is unreachable here: only
> payloads signed by OUR signer verify, the signer never emits duplicate keys, and an attacker
> cannot get a duplicate-key payload signed without the secret. Executors MUST NOT "upgrade" this
> to a custom binary codec (hand-rolled crypto encoding is a worse risk than the deviation); if the
> owner wants the literal binary layout, that is a spec-level change, not an executor call.

**Files:**
- Create: `src/lib/crypto/tokens.ts`, `src/lib/crypto/tokens.test.ts`

- [x] **Step 1: Write failing tests** `src/lib/crypto/tokens.test.ts`:

```ts
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { parseKeyRing, signAssetToken, verifyAssetToken, signSession, verifySession } from "./tokens";

const ringA = parseKeyRing("k1:secret-alpha-000000000000000000000000000000");
const soon = () => Math.floor(Date.now() / 1000) + 3600;

test("asset token round-trips {slug, codeId, cookieExp}", async () => {
  const exp = soon();
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: exp }, ringA);
  expect(await verifyAssetToken(tok, "s", ringA)).toEqual({ slug: "s", codeId: "id1", cookieExp: exp });
});

test("asset-token iat is the caller-supplied DB time, not wall-clock (spec §6 step 4)", async () => {
  const exp = soon();
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: exp }, ringA, exp - 86400);
  expect(decodeJwt(tok).iat).toBe(exp - 86400);
});

test("rejects a token for a different slug (no cross-asset replay)", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA);
  expect(await verifyAssetToken(tok, "other", ringA)).toBeNull();
});

test("rejects an expired token", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: Math.floor(Date.now() / 1000) - 1 }, ringA);
  expect(await verifyAssetToken(tok, "s", ringA)).toBeNull();
});

test("key ring: previous kid still verifies during rotation; retired kid is rejected", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA); // signed with k1
  const during = parseKeyRing("k2:secret-beta-1111111111111111111111111111111,k1:secret-alpha-000000000000000000000000000000");
  expect(await verifyAssetToken(tok, "s", during)).not.toBeNull(); // k1 still present
  const after = parseKeyRing("k2:secret-beta-1111111111111111111111111111111");
  expect(await verifyAssetToken(tok, "s", after)).toBeNull(); // k1 retired
});

test("rejects a token whose kid is not in the ring", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA); // kid k1
  const foreign = parseKeyRing("kX:secret-alpha-000000000000000000000000000000"); // same secret, different kid
  expect(await verifyAssetToken(tok, "s", foreign)).toBeNull();
});

test("strict schema: a session token is NOT accepted as an asset token", async () => {
  const sess = await signSession(ringA, soon()); // has `sub`, lacks slug/codeId/cookieExp
  expect(await verifyAssetToken(sess, "s", ringA)).toBeNull();
});

test("a correctly-signed token WITHOUT exp is rejected (requiredClaims)", async () => {
  const { SignJWT } = await import("jose");
  const forged = await new SignJWT({ v: 1, slug: "s", codeId: "id1", cookieExp: soon() })
    .setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuedAt()
    .sign(new TextEncoder().encode("secret-alpha-000000000000000000000000000000")); // no setExpirationTime
  expect(await verifyAssetToken(forged, "s", ringA)).toBeNull();
});

test("a token whose exp disagrees with cookieExp is rejected (binding check)", async () => {
  const { SignJWT } = await import("jose");
  const exp = soon();
  const skewed = await new SignJWT({ v: 1, slug: "s", codeId: "id1", cookieExp: exp - 999 })
    .setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode("secret-alpha-000000000000000000000000000000"));
  expect(await verifyAssetToken(skewed, "s", ringA)).toBeNull();
});

test("parseKeyRing rejects empty secrets and duplicate kids", () => {
  expect(() => parseKeyRing("k1:")).toThrow();
  expect(() => parseKeyRing("k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,k1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toThrow();
});

test("session round-trips and rejects a foreign ring", async () => {
  const tok = await signSession(ringA, soon());
  expect(await verifySession(tok, ringA)).toBe(true);
  expect(await verifySession(tok, parseKeyRing("k1:totally-different-secret-22222222222222222222"))).toBe(false);
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- tokens` → FAIL (module not found).

- [x] **Step 3: Implement** `src/lib/crypto/tokens.ts`:

```ts
import { SignJWT, jwtVerify, decodeProtectedHeader } from "jose";

const enc = (s: string) => new TextEncoder().encode(s);
const V = 1; // token schema version

export type KeyRing = { kid: string; key: Uint8Array }[]; // current key FIRST

/** Parse "kid:secret,kid:secret" (current kid first) into a key ring. Rejects empty secrets and
 *  duplicate kids (ambiguous rotation) — obvious misconfigs must fail early, not at verify time. */
export function parseKeyRing(env: string): KeyRing {
  const ring = env.split(",").map((raw) => {
    const e = raw.trim();
    const i = e.indexOf(":");
    if (i <= 0) throw new Error("key ring entry must be 'kid:secret'");
    const secret = e.slice(i + 1);
    if (!secret) throw new Error("key ring secret must be non-empty");
    return { kid: e.slice(0, i), key: enc(secret) };
  });
  if (ring.length === 0) throw new Error("empty key ring");
  if (new Set(ring.map((e) => e.kid)).size !== ring.length) throw new Error("duplicate kid in key ring");
  return ring;
}

async function sign(
  ring: KeyRing,
  claims: Record<string, unknown>,
  exp: number,
  iatSec?: number, // asset tokens pass DB time (spec §6 step 4); sessions omit it (wall clock)
): Promise<string> {
  const { kid, key } = ring[0]; // sign with the current key
  return await new SignJWT({ v: V, ...claims })
    .setProtectedHeader({ alg: "HS256", kid })
    .setIssuedAt(iatSec)
    .setExpirationTime(exp)
    .sign(key);
}

/** Select key by kid, verify signature+exp, PIN the algorithm to HS256 (block alg-confusion),
 *  enforce version. Returns the payload or null. */
async function verify(ring: KeyRing, token: string): Promise<Record<string, unknown> | null> {
  let kid: string | undefined;
  try { kid = decodeProtectedHeader(token).kid; } catch { return null; }
  const entry = ring.find((e) => e.kid === kid);
  if (!entry) return null; // unknown/retired kid → reject
  try {
    // Pin alg; REQUIRE exp+iat to exist (jose only enforces exp when present — a signed no-exp
    // token must not verify); jose then enforces the exp value.
    const { payload } = await jwtVerify(token, entry.key, {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iat"],
    });
    if (payload.v !== V) return null; // unknown schema version → reject
    return payload as Record<string, unknown>;
  } catch {
    return null; // bad signature / expired / missing claims / wrong alg
  }
}

/** Reject any payload with keys outside `allowed` (strict schema — spec §6 step 4). */
function keysOk(p: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(p).every((k) => set.has(k));
}

export type AssetClaims = { slug: string; codeId: string; cookieExp: number };

/** Asset cookie bound to {slug, codeId, cookieExp}. cookieExp AND iatSec are the absolute
 *  unix-seconds values RETURNED BY the atomic redeem statement (DB time — spec §6 step 4). */
export async function signAssetToken(c: AssetClaims, ring: KeyRing, iatSec?: number): Promise<string> {
  return await sign(ring, { slug: c.slug, codeId: c.codeId, cookieExp: c.cookieExp }, c.cookieExp, iatSec);
}

export async function verifyAssetToken(token: string, expectedSlug: string, ring: KeyRing): Promise<AssetClaims | null> {
  const p = await verify(ring, token);
  if (!p) return null;
  if (!keysOk(p, ["v", "iat", "exp", "slug", "codeId", "cookieExp"])) return null; // reject extra fields
  if (p.slug !== expectedSlug) return null;                                          // no cross-asset replay
  if (typeof p.codeId !== "string" || typeof p.cookieExp !== "number") return null;
  if (p.exp !== p.cookieExp) return null; // the enforced exp IS the DB-computed cookie_exp — no drift
  return { slug: p.slug, codeId: p.codeId, cookieExp: p.cookieExp };
}

export async function signSession(ring: KeyRing, exp: number): Promise<string> {
  return await sign(ring, { sub: "admin" }, exp);
}

export async function verifySession(token: string, ring: KeyRing): Promise<boolean> {
  const p = await verify(ring, token);
  return !!p && keysOk(p, ["v", "iat", "exp", "sub"]) && p.sub === "admin";
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- tokens` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/crypto
git commit -m "feat: versioned key-ring asset+session tokens (v/kid, HS256-pinned, strict validation)"
```

**BEFORE marking Phase 2 complete:** ≥3-round review. Confirm the token tests cover kid-rotation (previous accepted, retired rejected), unknown-kid reject, cross-asset reject, expiry, and strict-schema; confirm schema tests pin no-plaintext-column + DB-side default. Run `npm test` (all green). Update banner + table.

---

## Phase 3 — Gate route, cookie, headers, limiter

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits 2e8cc00 (3.1), e1c3444 (3.2), 5b272cd (3.3), 85df3c2 (3.4). Gate review 3 rounds clean: adversarial security (12 probes; no revocation bypass; cookie only from atomic-redeem success; fail-closed redeem/recheck vs fail-open limiter verified), spec §6 step→code→test mapping complete, cross-task consistency (Phase 4–6 prescribed imports dry-compiled against shipped exports). One type-only deviation (Task 3.1 timer nullability, recorded).

> Depends on Phase 1 (✅ dialect spike) and Phase 2 (tokens, codes). Read
> `docs/pitfalls/implementation-pitfalls.md` → "Fail closed", "The access code is the entire secret",
> "Rate limiting". **Assertion-rigor rule (mandatory for this phase's timing/DB tests):** if any test
> racing on DB state flakes, fix it with deterministic seeding (explicit epoch values) — NOT
> assertion removal. Commit subjects touching assertions MUST say add/strengthen/preserve.

### Task 3.1: Gate DB operations — atomic redeem + fail-closed recheck

> **DEVIATION (executed 2026-07-02, type-only):** withTimeout's timer is `| null = null` (workers-types' clearTimeout signature); everything else verbatim. See top-of-plan Deviations.

> Spec §6 step 4/5: redemption is ONE atomic conditional `UPDATE … RETURNING` (validate + record
> usage + compute `iat`/`cookie_exp` on DB time in a single statement — the exact SQL spike-verified
> in Task 1.1); the per-load recheck is a `unixepoch()` `SELECT` that FAILS CLOSED and is wrapped in
> a short app-side timeout so a blip fails fast. The redeem write is deliberately NOT app-timed:
> an app-side timer cannot cancel a D1 write, so racing one against it could record usage for a
> statement that later commits while we've already denied — "usage written without access issued."
> The write awaits its real result; a genuine D1 error throws ⇒ the route fails closed, no cookie.
> All tests run against the real local D1.

**Files:**
- Create: `src/lib/gate.ts`, `src/lib/gate.test.ts`

- [x] **Step 1: Write the failing tests** `src/lib/gate.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { redeem, recheck } from "./gate";
import { hashCode } from "./codes";

const SLUG = "seedslug000000000000AA";

async function seed(opts: { expiresDelta?: number; revoked?: boolean } = {}): Promise<string> {
  const code = "test-code-aaaaaaaaaaaa";
  const expiresSql = opts.expiresDelta !== undefined ? `unixepoch() + ${opts.expiresDelta}` : "unixepoch() + 7776000";
  await env.DB.prepare(
    `INSERT INTO codes (code_hash, asset_slug, expires_at, revoked_at)
     VALUES (?1, ?2, ${expiresSql}, ${opts.revoked ? "unixepoch()" : "NULL"})`,
  ).bind(await hashCode(code), SLUG).run();
  return code;
}

test("redeem returns codeId + DB-time iat/cookieExp and increments use_count", async () => {
  const code = await seed();
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(res?.codeId).toMatch(/^[0-9a-f]{32}$/);
  expect(res!.cookieExpSec).toBe(res!.iatSec + 86400); // 24h < 90d ⇒ min() picks iat+86400
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(1);
});

test("redeem returns null for wrong slug and records NO usage", async () => {
  const code = await seed();
  expect(await redeem(env.DB, await hashCode(code), "otherslug0000000000000")).toBeNull();
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(0);
});

test("redeem returns null for a revoked code", async () => {
  const code = await seed({ revoked: true });
  expect(await redeem(env.DB, await hashCode(code), SLUG)).toBeNull();
});

test("redeem returns null for an expired code (DB-time comparison)", async () => {
  const code = await seed({ expiresDelta: -1 });
  expect(await redeem(env.DB, await hashCode(code), SLUG)).toBeNull();
});

test("cookieExp is capped by a soon-expiring code (min(now+24h, expires_at))", async () => {
  const code = await seed({ expiresDelta: 3600 }); // ~1h left
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(res!.cookieExpSec - res!.iatSec).toBeLessThanOrEqual(3600);
});

test("sequential redemptions never lose use_count (atomic upsert-style increment)", async () => {
  const code = await seed();
  const h = await hashCode(code);
  await redeem(env.DB, h, SLUG);
  await redeem(env.DB, h, SLUG);
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(2);
});

test("CONCURRENT redemptions do not lose use_count (single-writer atomic statement, spec §13)", async () => {
  const code = await seed();
  const h = await hashCode(code);
  await Promise.all(Array.from({ length: 5 }, () => redeem(env.DB, h, SLUG)));
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(5);
});

test("recheck true for valid, false immediately after revoke (instant revocation)", async () => {
  const code = await seed();
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(await recheck(env.DB, res!.codeId, SLUG)).toBe(true);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE id = ?1").bind(res!.codeId).run();
  expect(await recheck(env.DB, res!.codeId, SLUG)).toBe(false);
});

test("recheck FAILS CLOSED when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  expect(await recheck(throwing, "id1", SLUG)).toBe(false);
});

test("redeem THROWS (fail closed at the caller) when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  await expect(redeem(throwing, "h", SLUG)).rejects.toThrow();
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- gate` → FAIL (module not found).

- [x] **Step 3: Implement** `src/lib/gate.ts`:

```ts
export type Redeemed = { codeId: string; iatSec: number; cookieExpSec: number };

const D1_TIMEOUT_MS = 5000;

/** Race a READ-ONLY D1 call against a short timeout so a blip fails FAST — and therefore CLOSED
 *  at the caller — instead of hanging (spec §3/§6). Do NOT use this on writes: the timer cannot
 *  cancel the statement, so a timed-out-but-later-committed write would break "never write usage
 *  without issuing access" (spec §6 step 4). */
async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("d1 timeout")), D1_TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Spec §6 step 4 — spike-verified on remote D1 (Task 1.1). ONE statement: validate + record usage +
// compute iat/cookie_exp on DB time. code_hash is UNIQUE ⇒ touches ≤1 row in one step.
const REDEEM_SQL = `
UPDATE codes
SET use_count = use_count + 1, last_used_at = unixepoch()
WHERE code_hash = ?1 AND revoked_at IS NULL AND expires_at > unixepoch() AND asset_slug = ?2
RETURNING id, unixepoch() AS iat, min(unixepoch() + 86400, expires_at) AS cookie_exp`;

/** Redemption: a returned row means the code was valid AND usage was recorded atomically; null =
 *  failure. THROWS on DB error — the route maps a throw to the generic failure (no cookie). NOT
 *  app-timed (see withTimeout doc): we await the write's real outcome so access and usage can
 *  never diverge. */
export async function redeem(db: D1Database, codeHash: string, slug: string): Promise<Redeemed | null> {
  const { results } = await db
    .prepare(REDEEM_SQL)
    .bind(codeHash, slug)
    .all<{ id: string; iat: number; cookie_exp: number }>();
  const r = results[0];
  return r ? { codeId: r.id, iatSec: r.iat, cookieExpSec: r.cookie_exp } : null;
}

/** Per-load recheck (spec §6 step 5): still valid at DB unixepoch()? FAILS CLOSED on any DB error —
 *  never serve from the cookie alone. */
export async function recheck(db: D1Database, codeId: string, slug: string): Promise<boolean> {
  try {
    const row = await withTimeout(
      db.prepare(
        "SELECT 1 AS ok FROM codes WHERE id = ?1 AND asset_slug = ?2 AND revoked_at IS NULL AND expires_at > unixepoch() LIMIT 1",
      ).bind(codeId, slug).first<{ ok: number }>(),
    );
    return row !== null;
  } catch {
    return false; // fail closed — see docs/pitfalls/implementation-pitfalls.md
  }
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- gate` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/gate.ts src/lib/gate.test.ts
git commit -m "feat: atomic redeem (UPDATE RETURNING iat/cookie_exp on DB time) + fail-closed recheck"
```

### Task 3.2: Headers, failure page, asset lookup, environment gate, and the `/a/:slug` route

**Files:**
- Create: `src/lib/http/headers.ts`, `src/lib/failure.ts`, `src/lib/assets.ts`, `src/lib/manifest.ts`, `src/lib/envgate.ts`, `src/lib/envgate.test.ts`
- Create: `src/routes/gate.ts`
- Create: `assets/testasset0000000000000/index.html` (committed test fixture — see Step 5)
- Modify: `src/index.ts`, `.generated/assets-manifest.ts`, `.generated/assets-modules.ts`, `.generated/slugs.json`

> The rate limiter is wired in Task 3.4 — this task leaves two clearly-marked `// LIMITER (Task 3.4)`
> insertion comments so 3.4's diff is exact.

- [x] **Step 1: Header module** `src/lib/http/headers.ts` (spec §9 — ONE definition of every policy):

```ts
export const ASSET_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// Admin + failure + everything-else CSP (no 'unsafe-inline' — first-party server-rendered HTML).
export const ADMIN_CSP =
  "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

/** The site-wide set applied to EVERY response class by the finalizing middleware (spec §9).
 *  no-store is global by design: nothing this Worker emits may be cached anywhere. */
export function baseHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "pragma": "no-cache",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    // HSTS without includeSubDomains/preload until the whole domain is confirmed HTTPS-clean (spec §9).
    "strict-transport-security": "max-age=63072000",
  };
}
```

- [x] **Step 2: Generic failure page** `src/lib/failure.ts` (byte-identical for EVERY failure — spec §3, §6 step 3/5):

```ts
export const FAILURE_BODY =
  "<!doctype html><meta charset=utf-8><title>Unavailable</title>" +
  "<p>This link is invalid or has expired. If you were sent a link, please re-open it from your " +
  "original message, or contact the sender.</p>";

/** ONE canonical failure response — identical body+status for unknown-slug, wrong-code,
 *  absent/invalid/lapsed cookie, inert environments, and unknown routes. The header middleware
 *  (Task 3.3) applies the identical header set, so parity holds by construction. No conditional
 *  per-cookie messaging (validity oracle — spec §6 step 5). */
export function failurePage(): Response {
  return new Response(FAILURE_BODY, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

- [x] **Step 3: Asset + manifest lookups over the generated modules** (no filesystem — spec §7):

`src/lib/assets.ts`:

```ts
import { assetModules } from "../../.generated/assets-modules";

const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Module-map lookup. Returns null for a malformed slug or a missing module; the caller
 *  distinguishes "valid code + missing module" (an integrity alert, spec §13) from a normal miss. */
export function getAssetHtml(slug: string): string | null {
  if (!isValidSlug(slug)) return null;
  return Object.prototype.hasOwnProperty.call(assetModules, slug) ? assetModules[slug] : null;
}
```

`src/lib/manifest.ts`:

```ts
import { manifest } from "../../.generated/assets-manifest";

export type Manifest = Record<string, { title: string }>;

export function readManifest(): Manifest {
  return manifest;
}

/** True iff the slug is a real, published asset — used ONLY to pick the limiter bucket (spec §9).
 *  Unconditional for every well-formed slug; never branches the response. */
export function isKnownSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest, slug);
}
```

- [x] **Step 4: Environment gate** `src/lib/envgate.ts` (spec §8/§10):

```ts
/** Positive allow (fail closed, spec §8/§10): ONLY `production` serves traffic — preview, unset,
 *  development, or any future env name is INERT (generic page). Local QA opts in EXPLICITLY by
 *  setting ENVIRONMENT=production in .dev.vars, which is safe because local `wrangler dev`
 *  bindings point at the local D1 file (never remote). One serving environment means a
 *  mis-deployed non-prod Worker can never serve confidential content, whatever DB it is bound
 *  to — the `meta` environment marker (migration 0001) remains as an OPERATOR verification signal
 *  (Tasks 7.1/7.4), not a runtime branch. */
export function servesTraffic(environment: string | undefined): boolean {
  return environment === "production";
}
```

`src/lib/envgate.test.ts`:

```ts
import { expect, test } from "vitest";
import { servesTraffic } from "./envgate";

test("servesTraffic: positive allow — production ONLY; everything else inert", () => {
  expect(servesTraffic("production")).toBe(true);
  expect(servesTraffic("development")).toBe(false);
  expect(servesTraffic("preview")).toBe(false);
  expect(servesTraffic(undefined)).toBe(false);
  expect(servesTraffic("")).toBe(false);
});
```

- [x] **Step 5: Commit a permanent test-fixture asset** (Phase 3 integration tests need a real slug in
  the module map, and `SELF` runs the real compiled Worker — module mocks don't reach it. The fixture
  is dummy content, flows through the same registry the build enforces, and doubles as the Phase 7
  production-verification asset):

`assets/testasset0000000000000/index.html`:

```html
<!doctype html><meta charset="utf-8"><title>Test Fixture</title><h1>fixture ok</h1>
```

`.generated/slugs.json` (create; COMMITTED registry — spec §7):

```json
[
  "testasset0000000000000"
]
```

Overwrite `.generated/assets-manifest.ts` with:

```ts
// GENERATED by scripts/build-manifest.mjs — do not edit by hand (fixture entry hand-seeded in
// Task 3.2; Task 6.2's build regenerates this file identically from assets/ + the registry).
export const manifest: Record<string, { title: string }> = {
  testasset0000000000000: { title: "Test Fixture" },
};
```

Overwrite `.generated/assets-modules.ts` with:

```ts
// GENERATED by scripts/build-manifest.mjs — do not edit by hand (fixture entry hand-seeded in
// Task 3.2; Task 6.2's build regenerates this file identically from assets/ + the registry).
import a0 from "../assets/testasset0000000000000/index.html";
export const assetModules: Record<string, string> = {
  testasset0000000000000: a0,
};
```

- [x] **Step 6: The gate route** `src/routes/gate.ts` (spec §6 — do NOT log `?code=`, URLs, or cookie values):

```ts
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { ASSET_CSP } from "../lib/http/headers";
import { getAssetHtml, isValidSlug } from "../lib/assets";
import { redeem, recheck } from "../lib/gate";
import { hashCode } from "../lib/codes";
import { parseKeyRing, signAssetToken, verifyAssetToken } from "../lib/crypto/tokens";
import { servesTraffic } from "../lib/envgate";

export const gate = new Hono<{ Bindings: Env }>();

const cookieName = (slug: string) => `asset_access_${slug}`;

gate.get("/a/:slug", async (c) => {
  // Spec §10/§15 Q3: ONLY production serves — every other environment gets the same generic page
  // (no fingerprint). Local QA opts in via .dev.vars ENVIRONMENT=production (local D1 only).
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();

  const slug = c.req.param("slug");
  // Runtime slug-shape check before ANY DB/map access (spec §6 step 5). Malformed slugs may
  // fast-reject (accepted timing class, spec §6 step 3).
  if (!isValidSlug(slug)) {
    // LIMITER (Task 3.4): count bad-shape traffic toward the global breaker here.
    return failurePage();
  }

  const ring = parseKeyRing(c.env.ASSET_COOKIE_SECRET);
  const code = c.req.query("code");

  // Redemption precedence (spec §6 step 2): a present ?code ALWAYS re-validates + re-issues,
  // ignoring any existing cookie.
  if (code !== undefined) {
    // LIMITER (Task 3.4): enforce the redemption limiter here (before the DB hit).
    let res: Awaited<ReturnType<typeof redeem>>;
    try {
      res = await redeem(c.env.DB, await hashCode(code), slug);
    } catch {
      res = null; // DB error/timeout ⇒ fail closed: no cookie, generic page (spec §6 step 4)
    }
    if (!res) return failurePage();
    // Integrity check AFTER the constant-work redeem, NEVER before it (a pre-redeem module check
    // would fail unknown slugs faster than wrong codes — the §6 timing oracle). A valid code whose
    // module is missing is an integrity failure (spec §13): alert loudly, issue NO cookie.
    if (getAssetHtml(slug) === null) {
      console.error(JSON.stringify({ level: "error", event: "asset_module_missing", slug, codeId: res.codeId }));
      return failurePage();
    }
    const token = await signAssetToken(
      { slug, codeId: res.codeId, cookieExp: res.cookieExpSec },
      ring,
      res.iatSec, // DB-time iat from the atomic redeem (spec §6 step 4)
    );
    setCookie(c, cookieName(slug), token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax", // Strict would drop the cookie on the cross-site link click (spec §6 step 4)
      path: `/a/${slug}`,
      // Both attributes mirror the DB-computed cookie_exp (spec §6 step 4); the ENFORCED expiry is
      // inside the signed token — a tampered attribute can't extend access.
      maxAge: res.cookieExpSec - res.iatSec,
      expires: new Date(res.cookieExpSec * 1000),
    });
    return c.redirect(`/a/${slug}`, 302); // strips ?code=; no-store applied by the header middleware
  }

  // Clean load (spec §6 step 5): the signature check decides ONLY the limiter skip; authorization is
  // ALWAYS the DB recheck (fail closed).
  const token = getCookie(c, cookieName(slug));
  const claims = token ? await verifyAssetToken(token, slug, ring) : null;
  if (!claims) {
    // LIMITER (Task 3.4): count unauthenticated load-failures toward the limiter here.
    return failurePage();
  }
  if (!(await recheck(c.env.DB, claims.codeId, slug))) return failurePage(); // instant revoke

  const html = getAssetHtml(slug);
  if (html === null) {
    // Valid code but missing asset module = integrity failure (bad build), NOT a normal 404
    // (spec §13). Same page to the client; loud structured alert. NEVER log the code or URL.
    console.error(JSON.stringify({ level: "error", event: "asset_module_missing", slug, codeId: claims.codeId }));
    return failurePage();
  }
  c.header("content-security-policy", ASSET_CSP); // asset CSP overrides the middleware default
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(html);
});
```

- [x] **Step 7: Mount the route** — replace `src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { gate } from "./routes/gate";

const app = new Hono<{ Bindings: Env }>();

// Spec §9: "/" is deliberately neutral/blank — nothing to enumerate.
app.get("/", (c) => c.body(null, 200));

app.route("/", gate);

export default app;
```

- [x] **Step 8: Run the envgate tests + full suite** — `npm test` → PASS (route integration tests land in 3.3 after the header middleware, so parity assertions aren't split across tasks).

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: /a/:slug gate — atomic redeem, DB-capped cookie, production-only env gate, fixture asset"
```

### Task 3.3: Site-wide header middleware, robots.txt, uniform not-found + the header/parity test suite

**Files:**
- Modify: `src/index.ts`
- Create: `src/routes/gate.test.ts`

- [x] **Step 1: Header middleware + robots + uniform notFound** — replace `src/index.ts` with:

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { gate } from "./routes/gate";
import { ADMIN_CSP, baseHeaders } from "./lib/http/headers";
import { failurePage } from "./lib/failure";

const app = new Hono<{ Bindings: Env }>();

// Finalizing middleware (spec §9): the FULL security-header set on EVERY response class —
// redemption 302, asset 200, failure page, admin, robots, root, not-found. Handlers that set their
// own CSP (the asset 200) keep it; everything else gets the restrictive default. Uniformity here is
// what makes failure-vs-failure byte-parity hold by construction.
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(baseHeaders())) c.res.headers.set(k, v);
  if (!c.res.headers.has("content-security-policy")) {
    c.res.headers.set("content-security-policy", ADMIN_CSP);
  }
});

// Spec §9: "/" is deliberately neutral/blank — nothing to enumerate.
app.get("/", (c) => c.body(null, 200));

// Spec §9: robots.txt Disallow: / — rendered by the Worker (there are no static files).
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.route("/", gate);

// Every unknown route returns the SAME generic page (spec §13 deny tests: the manifest URLs land
// here; no route class is distinguishable from a gate failure).
app.notFound(() => failurePage());

export default app;
```

- [x] **Step 2: Write the integration suite** `src/routes/gate.test.ts` (via `SELF` — the real Worker; fixture slug from Task 3.2):

```ts
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { hashCode } from "../lib/codes";
import app from "../index";

const SLUG = "testasset0000000000000";
const BASE = "https://share.test";

async function seedCode(code = "integration-code-0001"): Promise<string> {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind(await hashCode(code), SLUG).run();
  return code;
}

function expectFullHeaderSet(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("pragma")).toBe("no-cache");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
  expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
}

test("happy path: ?code= → 302 (no-store, cookie) → clean URL → 200 asset with asset CSP", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
  expect(r1.headers.get("location")).toBe(`/a/${SLUG}`); // ?code= stripped
  expectFullHeaderSet(r1);
  const setCookie = r1.headers.get("set-cookie")!;
  expect(setCookie).toContain(`asset_access_${SLUG}=`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie.toLowerCase()).toContain("samesite=lax");
  expect(setCookie.toLowerCase()).toContain("max-age="); // mirrors DB cookie_exp (spec §6 step 4)
  expect(setCookie).toContain(`Path=/a/${SLUG}`);

  const cookie = setCookie.split(";")[0];
  const r2 = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } });
  expect(r2.status).toBe(200);
  expect(await r2.text()).toContain("fixture ok");
  expectFullHeaderSet(r2);
  expect(r2.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
});

test("failure parity: unknown-slug and wrong-code responses are byte-identical", async () => {
  await seedCode();
  const unknown = await SELF.fetch(`${BASE}/a/unknownslug00000000000?code=x`);
  const wrong = await SELF.fetch(`${BASE}/a/${SLUG}?code=wrong-code`);
  expect(unknown.status).toBe(200);
  expect(wrong.status).toBe(200);
  expect(await unknown.text()).toBe(await wrong.text());
  const strip = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  expect(strip(unknown.headers)).toBe(strip(wrong.headers));
  expectFullHeaderSet(unknown);
});

test("no-cookie and garbage-cookie clean loads return the same generic page", async () => {
  const none = await SELF.fetch(`${BASE}/a/${SLUG}`);
  const garbage = await SELF.fetch(`${BASE}/a/${SLUG}`, {
    headers: { cookie: `asset_access_${SLUG}=garbage` },
  });
  expect(await none.text()).toBe(await garbage.text());
  expect(none.status).toBe(200);
});

test("revoked code is denied on the NEXT load (instant revocation via recheck)", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
  expect((await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("redemption precedence: a present ?code= re-validates even with a cookie attached", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
  // Wrong code + valid cookie ⇒ redemption path runs and FAILS (cookie is ignored, spec §6 step 2).
  const res = await SELF.fetch(`${BASE}/a/${SLUG}?code=wrong`, { headers: { cookie }, redirect: "manual" });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("invalid or has expired");
});

test("malformed/traversal slugs are rejected before any DB access", async () => {
  for (const bad of ["..%2f..%2fetc", "short", "waytoolongslug0000000000000000"]) {
    const res = await SELF.fetch(`${BASE}/a/${bad}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("invalid or has expired");
  }
});

test("malformed slugs are denied even when the DB is down (shape check precedes any load-bearing DB use)", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  const res = await app.request("/a/..%2f..%2fetc", {}, { ...env, DB: throwing });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("invalid or has expired"); // limiter fails OPEN; response identical
});

test("preview environment is INERT for /a/* — BYTE-IDENTICAL to a wrong-code failure", async () => {
  const code = await seedCode();
  const canonical = await app.request(`/a/${SLUG}?code=wrong-code`, {}, env);
  const preview = await app.request(`/a/${SLUG}?code=${code}`, {}, { ...env, ENVIRONMENT: "preview" });
  expect(preview.status).toBe(200);
  expect(await preview.text()).toBe(await canonical.text());
  const stripDate = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  expect(stripDate(preview.headers)).toBe(stripDate(canonical.headers));
  expect(preview.headers.get("set-cookie")).toBeNull(); // no cookie issued off-production
});

test("robots.txt disallows everything; root is blank; both carry the full header set", async () => {
  const robots = await SELF.fetch(`${BASE}/robots.txt`);
  expect(await robots.text()).toContain("Disallow: /");
  expectFullHeaderSet(robots);
  const root = await SELF.fetch(`${BASE}/`);
  expect(root.status).toBe(200);
  expectFullHeaderSet(root);
});

test("manifest URLs are not routable — they land on the generic page (spec §13 deny tests)", async () => {
  for (const path of ["/assets/manifest.json", "/a/manifest.json", `/a/${SLUG}/manifest.json`]) {
    const res = await SELF.fetch(`${BASE}${path}`);
    expect(await res.text()).toContain("invalid or has expired");
  }
});
```

- [x] **Step 3: Run** — `npm test -- gate` → PASS (all).

- [x] **Step 4: Commit**

```bash
git add src/index.ts src/routes/gate.test.ts
git commit -m "feat: uniform security-header middleware, robots, generic not-found + gate parity/header suite"
```

### Task 3.4: Rate limiting on `/a/*` (bucketed + global; valid-cookie exempt; fails open)

> Spec §9: limit UNAUTHENTICATED traffic only; a signature-valid-cookie load is limiter-EXEMPT but
> still DB-rechecked (enforced by WHERE the route calls this). Bucket well-formed-but-unknown slugs
> into ONE fixed key (bounded cardinality); malformed slugs get their own fixed bucket; keep a
> generous GLOBAL circuit-breaker. Increments are ONE atomic upsert on DB time. The limiter fails
> OPEN (defense-in-depth); authorization fails CLOSED — never swap those.

**Files:**
- Create: `src/lib/db/rateStore.ts`, `src/lib/ratelimit.ts`, `src/lib/ratelimit.test.ts`
- Modify: `src/routes/gate.ts` (fill the three `// LIMITER (Task 3.4)` insertion points)

- [x] **Step 1: Atomic limiter store** `src/lib/db/rateStore.ts` (the spec §5 upsert, verbatim):

```ts
// ONE statement — no read-then-write (lost updates). Window compared and reset on unixepoch().
const UPSERT_SQL = `
INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, unixepoch())
ON CONFLICT(key) DO UPDATE SET
  count        = CASE WHEN window_start <= unixepoch() - ?2 THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start <= unixepoch() - ?2 THEN unixepoch() ELSE window_start END
RETURNING count`;

/** Atomically bump the fixed-window counter for `key`; returns the count within the current window.
 *  Lazily prunes long-stale rows (spec §5/§9 — indexed window_start) on fresh-window bumps only,
 *  so steady-state traffic pays no extra write. Prune failures are ignored (limiter fails open). */
export async function bumpRateLimit(db: D1Database, key: string, windowSec: number): Promise<number> {
  const row = await db.prepare(UPSERT_SQL).bind(key, windowSec).first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count === 1) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < unixepoch() - 86400").run()
      .catch(() => {});
  }
  return count;
}
```

- [x] **Step 2: Failing tests** `src/lib/ratelimit.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { bumpRateLimit } from "./db/rateStore";
import { gateLimitOk, slugKey, PER_SLUG_LIMIT } from "./ratelimit";

test("slugKey: known slugs get their own bucket; unknown collapse into ONE fixed bucket", () => {
  expect(slugKey("redeem", "known000000000000000aA", () => true)).toBe("redeem:known000000000000000aA");
  expect(slugKey("redeem", "randaaaaaaaaaaaaaaaaaa", () => false)).toBe("redeem:unknown-slug");
  expect(slugKey("redeem", "randbbbbbbbbbbbbbbbbbb", () => false)).toBe("redeem:unknown-slug");
});

test("bumpRateLimit increments atomically within a window", async () => {
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(1);
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(2);
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(3);
});

test("bumpRateLimit resets a stale window in the same statement", async () => {
  await bumpRateLimit(env.DB, "k2", 60);
  await bumpRateLimit(env.DB, "k2", 60);
  await env.DB.prepare("UPDATE rate_limits SET window_start = unixepoch() - 120 WHERE key = 'k2'").run();
  expect(await bumpRateLimit(env.DB, "k2", 60)).toBe(1); // fresh window
});

test("stale rows are lazily pruned on a fresh-window bump (spec §5/§9)", async () => {
  await bumpRateLimit(env.DB, "old-key", 60);
  await env.DB.prepare("UPDATE rate_limits SET window_start = unixepoch() - 90000 WHERE key = 'old-key'").run();
  await bumpRateLimit(env.DB, "fresh-key", 60); // fresh window ⇒ prune runs
  const row = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits WHERE key = 'old-key'").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("a random-slug spray does NOT create unbounded rate_limits rows (bucketed)", async () => {
  for (let i = 0; i < 50; i++) {
    const slug = `spray${String(i).padStart(17, "0")}`; // well-formed 22-char, not in manifest
    await gateLimitOk(env.DB, "redeem", slug);
  }
  const row = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits").first<{ n: number }>();
  expect(row!.n).toBeLessThanOrEqual(2); // redeem:unknown-slug + global:a — bounded cardinality
});

test("gateLimitOk denies past the per-slug limit and FAILS OPEN on DB error", async () => {
  for (let i = 0; i < PER_SLUG_LIMIT; i++) {
    expect(await gateLimitOk(env.DB, "redeem", "testasset0000000000000")).toBe(true);
  }
  expect(await gateLimitOk(env.DB, "redeem", "testasset0000000000000")).toBe(false); // limit + 1
  const throwing = { prepare() { throw new Error("down"); } } as unknown as D1Database;
  expect(await gateLimitOk(throwing, "redeem", "testasset0000000000000")).toBe(true); // fail OPEN
});
```

- [x] **Step 3: Run to verify fail** — `npm test -- ratelimit` → FAIL (module not found).

- [x] **Step 4: Implement** `src/lib/ratelimit.ts`:

```ts
import { bumpRateLimit } from "./db/rateStore";
import { isKnownSlug } from "./manifest";

export const WINDOW_SEC = 60;
export const PER_SLUG_LIMIT = 20;
export const GLOBAL_LIMIT = 2000; // high-water circuit-breaker across all unauthenticated /a/* traffic
export const LOGIN_WINDOW_SEC = 300;

/** Bucket key (spec §9): known-manifest slugs get their own bucket; well-formed-but-unknown slugs
 *  collapse into ONE fixed key. The manifest lookup is unconditional for every well-formed slug and
 *  only selects a KEY — it never branches the response (timing-uniformity, spec §6 step 3). */
export function slugKey(
  kind: "redeem" | "load",
  slug: string,
  known: (s: string) => boolean = isKnownSlug,
): string {
  return known(slug) ? `${kind}:${slug}` : `${kind}:unknown-slug`;
}

/** Limiter for UNAUTHENTICATED /a/* traffic (redemptions + no-valid-cookie loads). Per-slug bucket
 *  AND global circuit-breaker. Fails OPEN — defense-in-depth only; the atomic redeem/recheck is the
 *  load-bearing fail-closed control. The route never calls this for a signature-valid-cookie load,
 *  so authenticated viewers are never limited (limiter-exempt ≠ authorization-exempt). */
export async function gateLimitOk(db: D1Database, kind: "redeem" | "load", slug: string): Promise<boolean> {
  try {
    const [perSlug, global] = await Promise.all([
      bumpRateLimit(db, slugKey(kind, slug), WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return perSlug <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // FAIL OPEN — intentional (spec §9)
  }
}

/** Malformed-slug traffic: a fixed bucket (never the bad slug as a key, never a manifest lookup)
 *  that still feeds the global circuit-breaker (spec §9). */
export async function badShapeLimitOk(db: D1Database): Promise<boolean> {
  try {
    const [bad, global] = await Promise.all([
      bumpRateLimit(db, "bad-shape", WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return bad <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // fail open
  }
}

/** Login throttle: an escalating DELAY (ms), NEVER a hard deny — a single admin means a hard lockout
 *  is a self-DoS (spec §8). A correct password+TOTP always succeeds, just slower under attack. */
export async function loginThrottleMs(db: D1Database): Promise<number> {
  try {
    const n = await bumpRateLimit(db, "login", LOGIN_WINDOW_SEC);
    return Math.min(Math.max(0, n - 3) * 500, 5000);
  } catch {
    return 0; // fail open
  }
}
```

- [x] **Step 5: Run to verify pass** — `npm test -- ratelimit` → PASS.

- [x] **Step 6: Fill the three insertion points in `src/routes/gate.ts`.** Add the import:

```ts
import { badShapeLimitOk, gateLimitOk } from "../lib/ratelimit";
```

Replace the malformed-slug block's `// LIMITER (Task 3.4)` comment so it reads:

```ts
  if (!isValidSlug(slug)) {
    await badShapeLimitOk(c.env.DB); // count junk toward the global breaker (fixed bucket)
    return failurePage();
  }
```

Replace the redemption `// LIMITER (Task 3.4)` comment (FIRST statement inside `if (code !== undefined) {`):

```ts
    if (!(await gateLimitOk(c.env.DB, "redeem", slug))) return failurePage();
```

Replace the no-valid-cookie `// LIMITER (Task 3.4)` comment so the branch reads:

```ts
  if (!claims) {
    // Deliberately NOT branching on the result: this request is denied either way (no valid
    // cookie), and the bump exists purely to feed the per-slug/global counters that protect the
    // REDEMPTION path. Do not "fix" this into a branch — it would change nothing observable.
    await gateLimitOk(c.env.DB, "load", slug);
    return failurePage();
  }
```

- [x] **Step 7: Add the limiter-exemption integration test** — append to `src/routes/gate.test.ts`:

```ts
test("a signature-valid-cookie load is limiter-EXEMPT but still DB-rechecked", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
  // Exhaust the per-slug load bucket with unauthenticated (cookie-less) loads…
  for (let i = 0; i < 25; i++) await SELF.fetch(`${BASE}/a/${SLUG}`);
  // …the cookie-holder still gets through (exempt), because the route never calls the limiter for
  // a signature-valid cookie — but revocation still bites (authorization is never skipped):
  expect((await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});
```

Also append the route-level fail-closed test (the recheck unit test alone would not catch a future
route bug that serves from a verified cookie):

```ts
test("a VALID signed cookie with D1 down is DENIED at the route (fail closed, spec §6 step 5)", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  const res = await app.request(`/a/${SLUG}`, { headers: { cookie } }, { ...env, DB: throwing });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("invalid or has expired");
  expect(body).not.toContain("fixture ok"); // never served from the cookie alone
});

test("valid code + MISSING asset module → generic page + alert + NO cookie (spec §13)", async () => {
  const missing = "missingmodule000000000"; // 22 chars, well-formed, NOT in assetModules
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind(await hashCode("integrity-test-code-1"), missing).run();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const r1 = await app.request(`/a/${missing}?code=integrity-test-code-1`, {}, env);
  expect(r1.status).toBe(200); // generic page, not a redirect — integrity check runs post-redeem
  expect(await r1.text()).toContain("invalid or has expired"); // same page to the recipient
  expect(r1.headers.get("set-cookie")).toBeNull(); // NO cookie for an integrity-failed asset
  expect(spy).toHaveBeenCalledWith(expect.stringContaining("asset_module_missing"));
  spy.mockRestore();
});
```

(Add `import { vi } from "vitest";` to the test file's imports if not already present.)

- [x] **Step 8: Run** — `npm test` → PASS (all).

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: bucketed+global atomic rate limiting (fails open), valid-cookie exempt, login throttle"
```

**BEFORE marking Phase 3 complete:** ≥3-round review across: security invariants (fail-closed redeem/recheck vs fail-open limiter; cookie issued ONLY from the atomic-redeem success branch), spec conformance (§6 steps 2–5 all present; §9 header set on every class), and type/name consistency (`Redeemed`, `AssetClaims`, `CodeRow`, fixture slug string identical everywhere). Confirm the parity, revocation, precedence, spray-cardinality, and exemption tests all pass. `npm test` green. Update banner + table.

---

## Phase 4 — Admin auth (WASM argon2id + TOTP)

**Execution Status:** ✅ SHIPPED 2026-07-02 — commits 3baf7bd (4.1), 7c2fa78 (4.2), 03712d1 (4.3), 7c18222 (gate: login-throttle coverage). Gate 3 rounds clean: adversarial (auth boundary — password-before-TOTP, CSRF, session forgery, env-gate all held under probing), spec §8 (requirement→test mapped; throttle-coverage gap closed by 7c18222), cross-task (Phase 5 slot-in dry-compiled). Deviations: 4.1 KDF hash-wasm→@noble/hashes (security preserved), 4.3 throttle syntax fix.

> Read `docs/pitfalls/implementation-pitfalls.md` → "Bootstrap hash must be byte-compatible",
> "TOTP: consume the step only AFTER the password verifies". Assertion-rigor rule from Phase 3
> applies to TOTP-step tests (pass explicit timestamps; never sleep).

### Task 4.1: Password hashing (hash-wasm argon2id) + bootstrap/recovery scripts

> **DEVIATION (executed 2026-07-02, KDF library — security decision preserved):** `hash-wasm` does
> NOT run on Workers (runtime `WebAssembly.compile` is forbidden by workerd). Shipped with pure-JS
> **`@noble/hashes` argon2id** at the identical pinned params (byte-compatible; same PHC format).
> Everything below that says "hash-wasm" is realized with noble; the security requirement (memory-hard
> argon2id, OWASP params, Workers Paid) is unchanged. `verifyPassword` parses params+salt from the PHC
> string. See top-of-plan Deviations + Discoveries and the updated pitfall entry.

> Spec §8: memory-hard KDF = **argon2id via `hash-wasm` (WASM)** with pinned OWASP params —
> `@node-rs/argon2` is a native addon and does NOT run on Workers; a fast hash or PBKDF2 is NOT an
> acceptable substitute (spec §15 Q9: Workers Paid is confirmed, so the CPU budget exists). The
> PHC-encoded output embeds params+salt, and the Node-side bootstrap script uses the SAME library,
> so the printed hash verifies in the Worker byte-for-byte.

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/password.test.ts`
- Create: `scripts/hash-password.mjs`, `scripts/totp-setup.mjs`
- Modify: `vitest.config.ts` (replace the ADMIN_PASSWORD_HASH placeholder with a real test hash)

- [x] **Step 1: Failing test** `src/lib/auth/password.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("verifies a correct password and rejects a wrong one", async () => {
  const h = await hashPassword("correct horse");
  expect(h.startsWith("$argon2id$")).toBe(true); // PHC-encoded argon2id
  expect(h).toContain("m=19456,t=2,p=1"); // pinned OWASP params (spec §8)
  expect(await verifyPassword("correct horse", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});

test("rejects a malformed or fast-hash value without throwing", async () => {
  expect(await verifyPassword("x", "garbage")).toBe(false);
  expect(await verifyPassword("x", "5f4dcc3b5aa765d61d8327deb882cf99")).toBe(false); // md5-shaped
  expect(await verifyPassword("x", "$argon2i$v=19$m=16,t=1,p=1$AAAAAAAAAAAAAAAA$AAAA")).toBe(false); // not argon2id
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- password` → FAIL.

- [x] **Step 3: Implement** `src/lib/auth/password.ts`:

```ts
import { argon2id, argon2Verify } from "hash-wasm";

// Pinned OWASP argon2id params (spec §8): 19 MiB memory, 2 iterations, parallelism 1 (the Worker
// isolate is single-threaded — higher parallelism buys nothing). Do NOT accept library defaults.
const ARGON2 = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return await argon2id({ password, salt, ...ARGON2, outputType: "encoded" }); // PHC string
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("$argon2id$")) return false; // reject fast-hash/argon2i/malformed outright
  try {
    return await argon2Verify({ password, hash: stored }); // params+salt read back from `stored`
  } catch {
    return false; // malformed hash → reject, never throw
  }
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- password` → PASS.

- [x] **Step 5: Bootstrap + recovery scripts** (Node-side; SAME library ⇒ byte-compatible — see pitfalls):

`scripts/hash-password.mjs`:

```js
import { argon2id } from "hash-wasm";
import { randomBytes } from "node:crypto";

const pw = process.argv[2];
if (!pw) { console.error("usage: npm run hash-password -- <password>"); process.exit(1); }
const hash = await argon2id({
  password: pw, salt: randomBytes(16),
  parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: "encoded",
});
console.log(hash);
console.log("\nSet it with: npx wrangler secret put ADMIN_PASSWORD_HASH --env production");
```

`scripts/totp-setup.mjs` (also the RECOVERY script — re-run, re-put the secret, re-scan; spec §8):

```js
import * as OTPAuth from "otpauth";

const secret = new OTPAuth.Secret({ size: 20 });
const totp = new OTPAuth.TOTP({ issuer: "artifact-share", label: "admin", secret });
console.log("Secret (set with: npx wrangler secret put ADMIN_TOTP_SECRET --env production):");
console.log(secret.base32);
console.log("\nScan this otpauth URI (recovery = re-run this script, re-put, re-scan):");
console.log(totp.toString());
```

- [x] **Step 6: Fulfill the test-hash placeholder** (login-flow tests in Task 4.3 need a REAL hash):

Run: `node scripts/hash-password.mjs test-password`
Replace `"ADMIN_PASSWORD_HASH": "PLACEHOLDER-REPLACED-IN-TASK-4.1"` in `vitest.config.ts` with the printed `$argon2id$…` string. (The test password is literally `test-password`.)

- [x] **Step 7: Commit**

```bash
git add src/lib/auth scripts/hash-password.mjs scripts/totp-setup.mjs vitest.config.ts
git commit -m "feat: WASM argon2id (pinned params) + bootstrap/recovery scripts; real test hash in vitest config"
```

### Task 4.2: TOTP verify + replay rejection via D1

**Files:**
- Create: `src/lib/auth/totp.ts`, `src/lib/auth/totp.test.ts`
- Create: `src/lib/db/totpStore.ts`, `src/lib/db/totpStore.test.ts`

- [x] **Step 1: Failing tests** `src/lib/auth/totp.test.ts` (explicit timestamps; injected fake store):

```ts
import { expect, test, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { verifyTotp } from "./totp";

const secret = "JBSWY3DPEHPK3PXP";
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
const at = 1_700_000_000_000; // fixed epoch ms
const token = totp.generate({ timestamp: at });

function fakeStore() {
  const used = new Set<number>();
  return { markUsed: vi.fn(async (s: number) => (used.has(s) ? false : (used.add(s), true))) };
}

test("accepts a valid code and marks the step used", async () => {
  expect(await verifyTotp(secret, token, fakeStore(), at)).toBe(true);
});
test("rejects a replay of the same step", async () => {
  const store = fakeStore();
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
  expect(await verifyTotp(secret, token, store, at)).toBe(false); // replay
});
test("rejects a wrong code without touching the store", async () => {
  const store = fakeStore();
  expect(await verifyTotp(secret, "000000", store, at)).toBe(false);
  expect(store.markUsed).not.toHaveBeenCalled();
});
test("accepts a previous-step code (±1) and consumes the MATCHED step, not the current one", async () => {
  const store = fakeStore();
  const currentStep = Math.floor(at / 1000 / 30);
  const prev = totp.generate({ timestamp: at - 30_000 });
  expect(await verifyTotp(secret, prev, store, at)).toBe(true);
  expect(store.markUsed).toHaveBeenCalledWith(currentStep - 1); // the MATCHED (previous) step
  expect(await verifyTotp(secret, prev, store, at)).toBe(false); // replay of that step
  // The CURRENT step was not burned by the previous-step login:
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
});
test("rejects a code two steps away (outside ±1)", async () => {
  expect(await verifyTotp(secret, totp.generate({ timestamp: at - 60_000 }), fakeStore(), at)).toBe(false);
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- totp` → FAIL.

- [x] **Step 3: Implement** `src/lib/auth/totp.ts`:

```ts
import * as OTPAuth from "otpauth";

export interface TotpStepStore {
  /** Returns true if `step` was newly marked (i.e., not a replay). */
  markUsed(step: number): Promise<boolean>;
}

const PERIOD = 30;

export async function verifyTotp(
  secretB32: string,
  token: string,
  store: TotpStepStore,
  nowMs: number,
): Promise<boolean> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB32), period: PERIOD });
  const delta = totp.validate({ token, timestamp: nowMs, window: 1 }); // ±1 step (spec §8), or null
  if (delta === null) return false;
  const step = Math.floor(nowMs / 1000 / PERIOD) + delta;
  return await store.markUsed(step); // replay → false
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- totp` → PASS.

- [x] **Step 5: D1 step store + tests.**

`src/lib/db/totpStore.ts`:

```ts
import type { TotpStepStore } from "../auth/totp";

/** Replay rejection backed by totp_used_steps (spec §5/§8): ONE INSERT with ON CONFLICT DO NOTHING;
 *  D1's meta.changes === 0 means the step already existed ⇒ replay ⇒ false. Fails CLOSED. */
export function totpStore(db: D1Database): TotpStepStore {
  return {
    async markUsed(step) {
      try {
        const res = await db
          .prepare("INSERT INTO totp_used_steps (step) VALUES (?1) ON CONFLICT(step) DO NOTHING")
          .bind(step).run();
        const fresh = (res.meta.changes ?? 0) > 0;
        if (fresh) {
          // Lazy prune: steps older than the ±1 acceptance window are dead weight (spec §5).
          await db.prepare("DELETE FROM totp_used_steps WHERE step < ?1").bind(step - 2).run()
            .catch(() => {});
        }
        return fresh;
      } catch {
        return false; // fail closed
      }
    },
  };
}
```

`src/lib/db/totpStore.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { totpStore } from "./totpStore";

test("first use of a step is accepted; the same step again is a replay (meta.changes === 0)", async () => {
  const store = totpStore(env.DB);
  expect(await store.markUsed(1000)).toBe(true);
  expect(await store.markUsed(1000)).toBe(false);
});

test("prunes steps older than the acceptance window", async () => {
  const store = totpStore(env.DB);
  await store.markUsed(1000);
  await store.markUsed(1010);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM totp_used_steps WHERE step = 1000")
    .first<{ n: number }>();
  expect(row!.n).toBe(0); // 1000 < 1010 - 2 ⇒ pruned
});

test("fails closed when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("down"); } } as unknown as D1Database;
  expect(await totpStore(throwing).markUsed(1)).toBe(false);
});
```

- [x] **Step 6: Run** — `npm test -- totp` → PASS (all).

- [x] **Step 7: Commit**

```bash
git add src/lib/auth/totp.ts src/lib/auth/totp.test.ts src/lib/db/totpStore.ts src/lib/db/totpStore.test.ts
git commit -m "feat: TOTP verify (±1 window) + D1 replay rejection via totp_used_steps"
```

### Task 4.3: Session (key-ring) + CSRF + login route + admin guard (fail-closed env gate + admin CSP)

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/http/csrf.ts`, `src/lib/http/csrf.test.ts`
- Create: `src/routes/admin.ts`, `src/routes/admin.test.ts`
- Modify: `src/index.ts` (mount the admin routes)

- [x] **Step 1: Session helpers** `src/lib/auth/session.ts` (exp lives INSIDE the signed payload — spec §8):

```ts
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { parseKeyRing, signSession, verifySession } from "../crypto/tokens";

const NAME = "admin_session";
const TTL_SEC = 7 * 24 * 60 * 60; // 7 days (spec §8)

export async function startSession(c: Context, sessionSecret: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const token = await signSession(parseKeyRing(sessionSecret), exp); // exp signed; jose enforces it
  setCookie(c, NAME, token, {
    httpOnly: true, secure: true, sameSite: "Strict", path: "/", expires: new Date(exp * 1000),
  });
}

export async function isAuthed(c: Context, sessionSecret: string): Promise<boolean> {
  const t = getCookie(c, NAME);
  return t ? await verifySession(t, parseKeyRing(sessionSecret)) : false;
}
```

- [x] **Step 2: CSRF helper + tests.**

`src/lib/http/csrf.ts`:

```ts
function originOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/** True iff this state-changing request is same-origin with PUBLIC_ORIGIN (spec §8 — pinned origin,
 *  NOT the request's own Host). A PRESENT Origin decides alone — a malformed Origin is a REJECT,
 *  never a fallback; only an ABSENT Origin falls back to a Referer same-origin check;
 *  missing-both ⇒ reject. Sec-Fetch-Site is corroboration only (unused). */
export function originOk(req: Request, publicOrigin: string | undefined): boolean {
  if (!publicOrigin) return false; // misconfig → fail closed
  const originHeader = req.headers.get("origin");
  if (originHeader !== null) return originOf(originHeader) === publicOrigin;
  const referer = originOf(req.headers.get("referer"));
  return referer !== null && referer === publicOrigin;
}
```

`src/lib/http/csrf.test.ts`:

```ts
import { expect, test } from "vitest";
import { originOk } from "./csrf";

const req = (h: Record<string, string>) => new Request("https://share.test/admin/login", { method: "POST", headers: h });
const PIN = "https://share.test";

test("accepts a matching Origin, rejects cross-site", () => {
  expect(originOk(req({ origin: PIN }), PIN)).toBe(true);
  expect(originOk(req({ origin: "https://evil.example" }), PIN)).toBe(false);
});
test("falls back to Referer ONLY when Origin is absent; rejects when both absent", () => {
  expect(originOk(req({ referer: `${PIN}/admin` }), PIN)).toBe(true);
  expect(originOk(req({}), PIN)).toBe(false);
});
test("a malformed PRESENT Origin is rejected even with a valid Referer (no fallback — spec §8)", () => {
  expect(originOk(req({ origin: "not a url" }), PIN)).toBe(false);
  expect(originOk(req({ origin: "not a url", referer: `${PIN}/admin` }), PIN)).toBe(false);
});
test("fails closed when PUBLIC_ORIGIN is unset", () => {
  expect(originOk(req({ origin: PIN }), undefined)).toBe(false);
});
```

- [x] **Step 3: Admin routes** `src/routes/admin.ts` (login + guard; the panel body lands in Task 5.2):

```ts
import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { servesTraffic } from "../lib/envgate";
import { isAuthed, startSession } from "../lib/auth/session";
import { verifyPassword } from "../lib/auth/password";
import { verifyTotp } from "../lib/auth/totp";
import { totpStore } from "../lib/db/totpStore";
import { originOk } from "../lib/http/csrf";
import { loginThrottleMs } from "../lib/ratelimit";

export const admin = new Hono<{ Bindings: Env }>();

// Environment gate (spec §8, fail closed): inert unless production (local QA opts in via
// .dev.vars ENVIRONMENT=production). Returns the SAME generic page as the gate (no fingerprint).
admin.use("/admin/*", async (c, next) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  await next();
});
admin.use("/admin", async (c, next) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  await next();
});

// Session guard for everything under /admin except the login page (spec §8).
admin.use("/admin/*", async (c, next) => {
  if (c.req.path === "/admin/login") return next();
  if (!(await isAuthed(c, c.env.SESSION_SECRET))) return c.redirect("/admin/login", 302);
  await next();
});
admin.use("/admin", async (c, next) => {
  if (!(await isAuthed(c, c.env.SESSION_SECRET))) return c.redirect("/admin/login", 302);
  await next();
});

const loginPage = (error?: string) => html`<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form method="post" action="/admin/login">
  <input name="password" type="password" placeholder="Password" autocomplete="current-password">
  <input name="totp" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code">
  <button type="submit">Sign in</button>
  ${error ? html`<p role="alert">${error}</p>` : ""}
</form>`;

admin.get("/admin/login", (c) => c.html(loginPage()));

admin.post("/admin/login", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);

  // Throttle, never hard-lock (single admin, spec §8): an escalating delay — a correct
  // password+TOTP still succeeds under attack, just slower.
  await new Promise((r) => setTimeout(r, await loginThrottleMs(c.env.DB)));

  const form = await c.req.formData();
  const password = String(form.get("password") ?? "");
  const totp = String(form.get("totp") ?? "");

  // Password FIRST; a TOTP step is consumed ONLY after it passes (spec §5/§8) — a wrong-password
  // attempt must never burn or probe TOTP steps. Same generic error either way.
  if (!(await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH))) {
    return c.html(loginPage("invalid credentials"), 401);
  }
  if (!(await verifyTotp(c.env.ADMIN_TOTP_SECRET, totp, totpStore(c.env.DB), Date.now()))) {
    return c.html(loginPage("invalid credentials"), 401);
  }

  await startSession(c, c.env.SESSION_SECRET);
  return c.redirect("/admin", 302);
});

// Placeholder panel body — replaced by Task 5.2. The guard above already protects it.
admin.get("/admin", (c) => c.html(html`<!doctype html><meta charset="utf-8"><title>Admin</title><h1>Admin</h1>`));
```

- [x] **Step 4: Mount** — in `src/index.ts`, add `import { admin } from "./routes/admin";` and, next to the gate mount, `app.route("/", admin);` (before `app.notFound`).

- [x] **Step 5: Security-invariant tests** `src/routes/admin.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import app from "../index";

const BASE = "https://share.test";
const validTotp = () =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env.ADMIN_TOTP_SECRET) }).generate();

const loginForm = (password: string, totp: string) => {
  const body = new URLSearchParams({ password, totp });
  return {
    method: "POST",
    headers: { origin: "https://share.test", "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual" as const,
  };
};

test("/admin without a session redirects to login (production env)", async () => {
  const res = await SELF.fetch(`${BASE}/admin`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin/login");
});

test("/admin and /admin/login are INERT on preview — BYTE-IDENTICAL to a gate failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  const stripDate = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  for (const path of ["/admin", "/admin/login"]) {
    const res = await app.request(path, {}, { ...env, ENVIRONMENT: "preview" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(canonicalBody);
    expect(stripDate(res.headers)).toBe(stripDate(canonical.headers));
  }
});

test("wrong password does NOT consume a TOTP step (spec §5/§8)", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("wrong-password", validTotp()));
  expect(res.status).toBe(401);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM totp_used_steps").first<{ n: number }>();
  expect(row!.n).toBe(0); // step NOT burned
});

test("right password + wrong TOTP → generic 401, no session cookie", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", "000000"));
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await res.text()).toContain("invalid credentials");
});

test("full login: password + valid TOTP → session cookie (HttpOnly/Strict) → /admin reachable", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", validTotp()));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin");
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toContain("admin_session=");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie.toLowerCase()).toContain("samesite=strict");
  const cookie = setCookie.split(";")[0];
  const panel = await SELF.fetch(`${BASE}/admin`, { headers: { cookie } });
  expect(panel.status).toBe(200);
  expect(panel.headers.get("content-security-policy")).not.toContain("unsafe-inline"); // admin CSP
});

test("reusing the SAME TOTP code inside its window is rejected as replay", async () => {
  const code = validTotp();
  expect((await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", code))).status).toBe(302);
  expect((await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", code))).status).toBe(401);
});

test("admin responses carry the FULL security-header set (spec §9 — every response class)", async () => {
  for (const res of [
    await SELF.fetch(`${BASE}/admin/login`),
    await SELF.fetch(`${BASE}/admin`, { redirect: "manual" }), // the 302 class
  ]) {
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});

test("login POST with a cross-site or absent Origin is rejected (CSRF, spec §8)", async () => {
  const evil = { ...loginForm("test-password", validTotp()), headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" } };
  expect((await SELF.fetch(`${BASE}/admin/login`, evil)).status).toBe(403);
  const none = { ...loginForm("test-password", validTotp()), headers: { "content-type": "application/x-www-form-urlencoded" } };
  expect((await SELF.fetch(`${BASE}/admin/login`, none)).status).toBe(403);
});
```

- [x] **Step 6: Run** — `npm test -- admin csrf` → PASS (all). Note the TOTP tests share one D1 per test file with isolated storage per test — replay state cannot leak across tests.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: key-ring session, pinned-origin CSRF, TOTP-after-password login throttle, fail-closed admin gate + tests"
```

**BEFORE marking Phase 4 complete:** ≥3-round review. Confirm: a wrong password never reaches `verifyTotp` (proven by the zero-rows test); TOTP replay + ±1 window covered; `originOk` pins `PUBLIC_ORIGIN` (not Host) and rejects absent-both; the login path throttles but never hard-denies correct credentials; `/admin` is inert on preview with the byte-identical page; the session token verifies via the key ring. `npm test` green. Update banner + table.

---

## Phase 5 — Admin panel UI

**Execution Status:** 🚧 IN PROGRESS — claimed 2026-07-02T19:47:04Z, branch `dev`

> Depends on Phase 4 (auth). The manifest shape `{ [slug]: { title } }` is already fixed (Task 3.2);
> the fixture asset gives the panel a real entry to list.

### Task 5.1: Orphan detection + admin repo (hash-on-insert, show-once, collision retry)

**Files:**
- Modify: `src/lib/manifest.ts`
- Create: `src/lib/manifest.test.ts`, `src/lib/db/adminRepo.ts`, `src/lib/db/adminRepo.test.ts`

- [x] **Step 1: Failing test** `src/lib/manifest.test.ts` (orphan detection — spec §8):

```ts
import { expect, test } from "vitest";
import { findOrphans, isKnownSlug } from "./manifest";

test("flags codes whose slug is not in the manifest", () => {
  const manifest = { aaaaaaaaaaaaaaaaaaaaaa: { title: "A" } };
  const codes = [{ asset_slug: "aaaaaaaaaaaaaaaaaaaaaa" }, { asset_slug: "bbbbbbbbbbbbbbbbbbbbbb" }];
  expect(findOrphans(codes, manifest)).toEqual(["bbbbbbbbbbbbbbbbbbbbbb"]);
});

test("isKnownSlug reflects the generated manifest (fixture present)", () => {
  expect(isKnownSlug("testasset0000000000000")).toBe(true);
  expect(isKnownSlug("nopenopenopenopenopeno")).toBe(false);
});
```

- [x] **Step 2: Run to verify fail** — `npm test -- manifest` → FAIL (`findOrphans` not defined).

- [x] **Step 3: Implement** — append to `src/lib/manifest.ts`:

```ts
/** Codes whose asset_slug left the manifest (asset renamed/deleted) — flagged in the panel (spec §8). */
export function findOrphans(codes: { asset_slug: string }[], m: Manifest): string[] {
  const known = new Set(Object.keys(m));
  return [...new Set(codes.map((c) => c.asset_slug).filter((s) => !known.has(s)))];
}
```

- [x] **Step 4: Run to verify pass** — `npm test -- manifest` → PASS.

- [x] **Step 5: Admin repo + tests.**

`src/lib/db/adminRepo.ts`:

```ts
import { generateCode, hashCode, type CodeRow } from "../codes";

/** Expiry override (spec §5/§8): a duration in days (computed DB-side — single time source) OR an
 *  absolute epoch-seconds instant OR null (⇒ the DB column default of unixepoch()+90d). */
export type ExpirySpec = { days: number } | { atSec: number } | null;

export async function listCodes(db: D1Database): Promise<CodeRow[]> {
  const { results } = await db.prepare("SELECT * FROM codes ORDER BY created_at DESC").all<CodeRow>();
  return results;
}

/** Mint a code. Stores ONLY SHA-256(code); returns the RAW code ONCE for show-once display
 *  (spec §8) — never persisted, never recoverable. Retries on the astronomically unlikely hash
 *  collision, revealing nothing about it (spec §5). `gen` injectable for the collision test only. */
export async function createCode(
  db: D1Database,
  assetSlug: string,
  label: string,
  expiry: ExpirySpec,
  gen: () => string = generateCode,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = gen();
    const hash = await hashCode(code);
    try {
      if (expiry && "days" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at) VALUES (?1, ?2, ?3, unixepoch() + ?4 * 86400)",
        ).bind(hash, assetSlug, label, expiry.days).run();
      } else if (expiry && "atSec" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at) VALUES (?1, ?2, ?3, ?4)",
        ).bind(hash, assetSlug, label, expiry.atSec).run();
      } else {
        // Omit expires_at → the DB-side 90-day default applies (spec §5).
        await db.prepare("INSERT INTO codes (code_hash, asset_slug, label) VALUES (?1, ?2, ?3)")
          .bind(hash, assetSlug, label).run();
      }
      return code;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique code");
}

export async function revokeCode(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE id = ?1").bind(id).run(); // DB time
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message);
}
```

`src/lib/db/adminRepo.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createCode, listCodes, revokeCode } from "./adminRepo";
import { hashCode } from "../codes";

test("createCode stores ONLY the hash; default expiry comes from the DB (≈90d)", async () => {
  const code = await createCode(env.DB, "sluga0000000000000000A", "Acme CFO", null);
  expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at - unixepoch() AS delta, label FROM codes",
  ).first<{ code_hash: string; delta: number; label: string }>();
  expect(row!.code_hash).toBe(await hashCode(code)); // hash at rest, raw code only in the return value
  expect(row!.delta).toBeGreaterThan(7776000 - 60);
  expect(row!.label).toBe("Acme CFO");
});

test("duration expiry is computed DB-side (days → unixepoch()+days*86400)", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { days: 7 });
  const row = await env.DB.prepare("SELECT expires_at - unixepoch() AS delta FROM codes").first<{ delta: number }>();
  expect(row!.delta).toBeGreaterThan(7 * 86400 - 60);
  expect(row!.delta).toBeLessThanOrEqual(7 * 86400);
});

test("absolute expiry is stored as given", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { atSec: 2_000_000_000 });
  const row = await env.DB.prepare("SELECT expires_at FROM codes").first<{ expires_at: number }>();
  expect(row!.expires_at).toBe(2_000_000_000);
});

test("collision retry: a colliding first candidate is silently retried", async () => {
  const first = await createCode(env.DB, "sluga0000000000000000A", "", null);
  const candidates = [first, "freshcode000000000000B"]; // first collides, second unique
  const code = await createCode(env.DB, "sluga0000000000000000A", "", null, () => candidates.shift()!);
  expect(code).toBe("freshcode000000000000B");
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(2);
});

test("revokeCode sets revoked_at on DB time", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", null);
  const { id } = (await listCodes(env.DB))[0];
  await revokeCode(env.DB, id);
  const row = await env.DB.prepare("SELECT revoked_at FROM codes WHERE id = ?1").bind(id).first<{ revoked_at: number | null }>();
  expect(row!.revoked_at).not.toBeNull();
});
```

- [x] **Step 6: Run** — `npm test -- adminRepo manifest` → PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/manifest.ts src/lib/manifest.test.ts src/lib/db/adminRepo.ts src/lib/db/adminRepo.test.ts
git commit -m "feat: orphan detection + admin repo (hash-on-insert, DB-side expiry, show-once, collision retry)"
```

### Task 5.2: Admin dashboard + actions (show-once link, no raw-code column)

**Files:**
- Modify: `src/routes/admin.ts` (replace the placeholder `GET /admin`; add the two POST actions)
- Create: `src/routes/adminPanel.test.ts`

- [ ] **Step 1: Replace the placeholder panel in `src/routes/admin.ts`.** Add imports:

```ts
import { findOrphans, isKnownSlug, readManifest } from "../lib/manifest";
import { createCode, listCodes, revokeCode, type ExpirySpec } from "../lib/db/adminRepo";
import { codeStatus } from "../lib/codes";
```

Delete the placeholder `admin.get("/admin", …)` line and add:

```ts
function panelPage(opts: { oneTimeLink?: string; error?: string }, codesRows: Awaited<ReturnType<typeof listCodes>>, nowSec: number) {
  const manifest = readManifest();
  const orphans = new Set(findOrphans(codesRows, manifest));
  return html`<!doctype html><meta charset="utf-8"><title>Admin</title>
<h1>Assets &amp; codes</h1>
${opts.error ? html`<p role="alert">${opts.error}</p>` : ""}
${opts.oneTimeLink
  ? html`<p role="status"><strong>Copy this link now — it will NOT be shown again:</strong> <code>${opts.oneTimeLink}</code></p>`
  : ""}
<h2>Generate code</h2>
<form method="post" action="/admin/codes">
  <select name="slug">
    ${Object.entries(manifest).map(([slug, m]) => html`<option value="${slug}">${m.title} (${slug})</option>`)}
  </select>
  <input name="label" placeholder="Recipient label">
  <input name="days" inputmode="numeric" placeholder="Expiry days (blank = 90)">
  <input name="date" type="date" aria-label="Absolute expiry date (overrides days)">
  <button type="submit">Generate</button>
</form>
<h2>Codes</h2>
<table>
  <thead><tr><th>Label</th><th>Asset</th><th>Status</th><th>Last used</th><th>Redemptions</th><th></th></tr></thead>
  <tbody>
    ${codesRows.map((c) => html`<tr>
      <td>${c.label}${orphans.has(c.asset_slug) ? " ⚠ orphaned" : ""}</td>
      <td>${manifest[c.asset_slug]?.title ?? c.asset_slug}</td>
      <td>${codeStatus(c, nowSec)}</td>
      <td>${c.last_used_at !== null ? new Date(c.last_used_at * 1000).toISOString() : "—"}</td>
      <td>${c.use_count}</td>
      <td><form method="post" action="/admin/revoke"><input type="hidden" name="id" value="${c.id}"><button type="submit" ${c.revoked_at !== null ? "disabled" : ""}>Revoke</button></form></td>
    </tr>`)}
  </tbody>
</table>`;
}

// use_count is labeled "Redemptions", never "views" (spec §5). The raw code appears NOWHERE in this
// page except the one-time link immediately after generation — lost link ⇒ revoke + reissue (spec §8).
admin.get("/admin", async (c) => {
  return c.html(panelPage({}, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)));
});

admin.post("/admin/codes", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  // Do NOT trust the posted slug — a forged POST could target any string; it MUST be a real,
  // published asset (spec §7 provenance boundary).
  if (!isKnownSlug(slug)) {
    return c.html(panelPage({ error: "unknown asset" }, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)), 400);
  }
  const label = String(form.get("label") ?? "");
  const dateRaw = String(form.get("date") ?? "").trim(); // absolute date — wins if present
  const daysRaw = String(form.get("days") ?? "").trim(); // duration in days (computed DB-side)
  // Invalid input is a 400, NEVER a silent fall-through to the 90-day default (an admin who typed
  // an expiry must get that expiry or an error). Days must be a positive INTEGER — a fractional
  // value would store a non-integer epoch in the INTEGER column.
  let expiry: ExpirySpec = null;
  const badInput = (msg: string) =>
    c.html(panelPage({ error: msg }, [], Math.floor(Date.now() / 1000)), 400);
  if (dateRaw) {
    // Strict shape + round-trip: Date.parse NORMALIZES impossible dates (2026-02-31 → March) —
    // reject anything that doesn't survive the round trip unchanged.
    const ms = Date.parse(`${dateRaw}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(ms)
      || new Date(ms).toISOString().slice(0, 10) !== dateRaw) {
      return badInput("invalid expiry date");
    }
    expiry = { atSec: Math.floor(ms / 1000) };
  } else if (daysRaw) {
    if (!/^\d+$/.test(daysRaw) || Number(daysRaw) <= 0) return badInput("expiry days must be a positive integer");
    expiry = { days: Number(daysRaw) };
  }
  const code = await createCode(c.env.DB, slug, label, expiry);
  // Show ONCE (spec §8, §3 D3): the raw code is not persisted and cannot be recovered.
  const oneTimeLink = `${c.env.PUBLIC_ORIGIN}/a/${slug}?code=${code}`;
  return c.html(panelPage({ oneTimeLink }, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)));
});

admin.post("/admin/revoke", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);
  const form = await c.req.formData();
  await revokeCode(c.env.DB, String(form.get("id") ?? ""));
  return c.redirect("/admin", 302);
});
```

> **Do NOT** render the raw code anywhere except the one-time link (it is unrecoverable by design;
> lost link ⇒ revoke + reissue, spec §8). **Do NOT** add auth/session checks inside these handlers —
> the Task 4.3 middleware already guards `/admin/*`; duplicating it invites drift. **No styling** is
> in scope (plain HTML). **Do NOT** add new columns, sorting, or pagination — YAGNI (spec §14).

- [ ] **Step 2: Write the panel tests** `src/routes/adminPanel.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import * as OTPAuth from "otpauth";

const BASE = "https://share.test";
const SLUG = "testasset0000000000000";

async function loginCookie(): Promise<string> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env.ADMIN_TOTP_SECRET) }).generate();
  const res = await SELF.fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-password", totp }).toString(),
    redirect: "manual",
  });
  return res.headers.get("set-cookie")!.split(";")[0];
}

function post(path: string, cookie: string, fields: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { origin: BASE, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

test("generate → one-time link shown once; the codes list NEVER contains a raw code", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: SLUG, label: "Acme CFO", days: "", date: "" });
  const body = await res.text();
  const m = body.match(/\?code=([A-Za-z0-9_-]{22})/);
  expect(m).not.toBeNull(); // link shown once, with PUBLIC_ORIGIN + 22-char code
  expect(body).toContain(env.PUBLIC_ORIGIN);
  // Reload the panel: the raw code must appear NOWHERE (hash-only at rest, spec §8).
  const panel = await (await SELF.fetch(`${BASE}/admin`, { headers: { cookie } })).text();
  expect(panel).not.toContain(m![1]);
  expect(panel).toContain("Redemptions"); // labeled redemptions, not views (spec §5)
  expect(panel).toContain("Acme CFO");
});

test("the minted link actually redeems through the gate", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: SLUG, label: "e2e", days: "", date: "" });
  const link = (await res.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await SELF.fetch(`${BASE}${link}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
});

test("invalid expiry input is a 400, never a silent 90-day default", async () => {
  const cookie = await loginCookie();
  for (const fields of [
    { slug: SLUG, label: "x", days: "1.5", date: "" },
    { slug: SLUG, label: "x", days: "0", date: "" },
    { slug: SLUG, label: "x", days: "-3", date: "" },
    { slug: SLUG, label: "x", days: "", date: "not-a-date" },
    { slug: SLUG, label: "x", days: "", date: "2026-02-31" }, // normalizes to March — must be rejected
  ]) {
    const res = await post("/admin/codes", cookie, fields);
    expect(res.status).toBe(400);
  }
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0); // nothing was minted
});

test("a forged POST with an unknown slug is rejected (provenance boundary, spec §7)", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: "AcmeCorpQ4BoardDeck00A", label: "x", days: "", date: "" });
  expect(res.status).toBe(400);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("revoke from the panel makes the gate deny on the next load", async () => {
  const cookie = await loginCookie();
  const created = await post("/admin/codes", cookie, { slug: SLUG, label: "r", days: "", date: "" });
  const link = (await created.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await SELF.fetch(`${BASE}${link}`, { redirect: "manual" });
  const assetCookie = r1.headers.get("set-cookie")!.split(";")[0];
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  await post("/admin/revoke", cookie, { id });
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie: assetCookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("panel mutations without a session are unreachable (redirect to login)", async () => {
  const res = await SELF.fetch(`${BASE}/admin/codes`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: SLUG, label: "x" }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin/login");
});
```

- [ ] **Step 3: Run** — `npm test -- adminPanel` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.ts src/routes/adminPanel.test.ts
git commit -m "feat: admin panel — show-once link, no raw-code column, orphan flag, DB-side expiry, revoke"
```

**BEFORE marking Phase 5 complete:** ≥3-round review. Confirm: the list shows label/status/last-used/**Redemptions** and NEVER a raw code; the one-time link renders exactly once; expiry accepts absolute date or duration (duration computed DB-side); forged-slug POSTs rejected; revoke → instant gate denial proven end-to-end. `npm test` green. Update banner + table.

---

## Phase 6 — Asset pipeline (generator + module-map build)

**Execution Status:** ⬜ NOT STARTED

> Read `docs/pitfalls/implementation-pitfalls.md` → "NEVER add an assets key", "Confidential manifest
> is a generated MODULE + generator registry". The build enforces the slug contract Phase 3 relies on
> and emits the modules Phase 3 imports.

### Task 6.1: `new-asset` generator

**Files:**
- Create: `scripts/new-asset.mjs`

- [ ] **Step 1: Implement** `scripts/new-asset.mjs` (scaffold + register provenance):

```js
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const title = process.argv.slice(2).join(" ").trim() || "Untitled asset";
const slug = randomBytes(16).toString("base64url"); // 22 chars, 128-bit (spec §7)
const root = process.cwd();

const dir = path.join(root, "assets", slug);
await mkdir(dir, { recursive: true });
await writeFile(
  path.join(dir, "index.html"),
  `<!doctype html>\n<meta charset="utf-8">\n<title>${title}</title>\n<h1>${title}</h1>\n`,
);

// Record provenance so the build can reject a hand-crafted folder (spec §7 D2 backstop).
// .generated/slugs.json is COMMITTED.
const regPath = path.join(root, ".generated", "slugs.json");
await mkdir(path.dirname(regPath), { recursive: true });
let reg = [];
try { reg = JSON.parse(await readFile(regPath, "utf8")); } catch { /* first asset */ }
if (!reg.includes(slug)) reg.push(slug);
await writeFile(regPath, JSON.stringify(reg, null, 2) + "\n");

console.log("Created assets/%s/index.html and registered the slug.", slug);
console.log("Slug (opaque):", slug);
console.log("Next: edit the HTML, run 'npm run build-manifest', commit, PR.");
```

- [ ] **Step 2: Verify**

Run: `npm run new-asset -- "Scratch"` then `ls assets/` and `cat .generated/slugs.json`
Expected: a new 22-char folder with `index.html`; the slug appended to the registry (fixture slug still present). Clean up: `rm -rf assets/<new-slug>` and remove that slug from `.generated/slugs.json` (keep the fixture entry).

- [ ] **Step 3: Commit**

```bash
git add scripts/new-asset.mjs
git commit -m "feat: new-asset generator (opaque 128-bit slug, scaffold + provenance registry)"
```

### Task 6.2: `build-manifest` — registry provenance, generated modules, advisory scan, config lint, size report

> Spec §7: the build compiles the confidential manifest + module map into the Worker source tree,
> REJECTS any asset folder whose slug is not in the committed registry (the D2 backstop), runs the
> **advisory** external-origin scan (CSP is the boundary — §9), **lints wrangler.jsonc for the
> forbidden `assets` key** (spec §4/§13 config tripwire), and enforces the §15 Q5 size threshold.
>
> **Documented deviation (owner-visible), same posture as the reviewed Vercel sibling plan:** the
> spec carries a clause that the scan "MUST use a real HTML/CSS parser if it is to be relied on at
> all." This plan implements the scan with REGEXES covering exactly the spec-§13 surfaces
> (`src/href`, `srcset`, CSS `@import`/`url()`, SVG `<use>`, `meta refresh`) and accepts regex
> false-negatives (unquoted URLs, exotic attribute orders, CSS escapes, import maps), because the
> scan is an authoring LINT — the §9 CSP is the enforcement boundary, and a scan miss is contained
> by CSP exactly like runtime-constructed URLs are. Failing the build on a hit is loud-author-
> feedback, not security enforcement. If the owner wants the literal parser-based scan, that is a
> recorded upgrade (parse5 + a CSS value parser with a denied-construct list), not an executor
> improvisation — do NOT add the parser stack unprompted.

**Files:**
- Create: `scripts/manifest-lib.mjs`, `scripts/build-manifest.mjs`
- Create: `src/lib/build/manifest-lib.test.ts`

- [ ] **Step 1: Failing test** `src/lib/build/manifest-lib.test.ts` (the pure checks; scan surface per spec §7/§13):

```ts
import { expect, test } from "vitest";
import { extractTitle, externalOriginHits, validateSlug, firstDuplicate } from "../../../scripts/manifest-lib.mjs";

test("extractTitle reads <title>, falls back to slug", () => {
  expect(extractTitle("<title>Hi</title>", "slug00000000000000000a")).toBe("Hi");
  expect(extractTitle("<h1>no title</h1>", "slug00000000000000000b")).toBe("slug00000000000000000b");
});

test("externalOriginHits flags the broadened surface, ignores data:/relative", () => {
  expect(externalOriginHits(`<script src="https://cdn.example/x.js"></script>`)).toContain("src/href");
  expect(externalOriginHits(`<img srcset="https://cdn/x.png 1x">`)).toContain("srcset");
  expect(externalOriginHits(`<style>@import url(https://f/x.css);</style>`)).toContain("css @import");
  expect(externalOriginHits(`<div style="background:url('https://e/x.png')">`)).toContain("css url()");
  expect(externalOriginHits(`<svg><use href="https://e/s.svg#i"/></svg>`)).toContain("svg <use>");
  expect(externalOriginHits(`<meta http-equiv="refresh" content="0;url=https://evil/">`)).toContain("meta refresh");
  expect(externalOriginHits(`<img src="data:image/png;base64,AAAA"><a href="/rel">x</a>`)).toEqual([]);
});

test("validateSlug requires 22 base64url chars", () => {
  expect(validateSlug("A7fK9dZ2qR3sT1uV5wXyB0")).toBe(true);
  expect(validateSlug("acme-corp")).toBe(false);
});

test("firstDuplicate finds a repeated registry entry", () => {
  expect(firstDuplicate(["a", "b", "a"])).toBe("a");
  expect(firstDuplicate(["a", "b"])).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- manifest-lib` → FAIL.

- [ ] **Step 3: Implement the pure lib** `scripts/manifest-lib.mjs`:

```js
export function extractTitle(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** Best-effort ADVISORY scan (spec §7): reports external-origin surfaces present. CSP is the real
 *  boundary — this cannot catch runtime-constructed URLs. Broaden here; never trust it fully. */
export function externalOriginHits(html) {
  const hits = [];
  const add = (re, what) => { if (re.test(html)) hits.push(what); };
  add(/(?:src|href)\s*=\s*["']https?:\/\//i, "src/href");
  add(/srcset\s*=\s*["'][^"']*https?:\/\//i, "srcset");
  add(/@import\s+(?:url\()?\s*["']?\s*https?:\/\//i, "css @import");
  add(/url\(\s*["']?\s*https?:\/\//i, "css url()");
  add(/<use\b[^>]*\bhref\s*=\s*["']https?:\/\//i, "svg <use>");
  add(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*https?:\/\//i, "meta refresh");
  return hits;
}

export function validateSlug(slug) {
  return /^[A-Za-z0-9_-]{22}$/.test(slug);
}

export function firstDuplicate(list) {
  const seen = new Set();
  for (const x of list) { if (seen.has(x)) return x; seen.add(x); }
  return null;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- manifest-lib` → PASS.

- [ ] **Step 5: Implement the build script** `scripts/build-manifest.mjs`:

```js
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { extractTitle, externalOriginHits, validateSlug, firstDuplicate } from "./manifest-lib.mjs";

const root = process.cwd();
const assetsDir = path.join(root, "assets");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// Config lint (spec §4/§7/§13): the platform must never serve this site's files — the Worker is the
// only door. An "assets" key in wrangler.jsonc would hand confidential HTML to the platform.
const wranglerRaw = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
if (/^\s*"assets"\s*:/m.test(wranglerRaw)) {
  fail('wrangler.jsonc contains an "assets" key — forbidden (spec §4/§7). Remove it; do not weaken this lint.');
}

// The committed registry is the ONLY provenance source (spec §7 D2 backstop).
let registry = [];
try { registry = JSON.parse(await readFile(path.join(root, ".generated", "slugs.json"), "utf8")); } catch { /* none yet */ }
const dup = firstDuplicate(registry);
if (dup) fail(`duplicate slug "${dup}" in .generated/slugs.json`);
const registered = new Set(registry);

let dirents = [];
try { dirents = await readdir(assetsDir); } catch { /* no assets yet */ }
const entries = [];
let gzTotal = 0;

for (const slug of dirents.sort()) {
  const dir = path.join(assetsDir, slug);
  if (!(await stat(dir)).isDirectory()) continue;
  if (!validateSlug(slug)) fail(`slug "${slug}" is not 22 base64url chars`);
  if (!registered.has(slug)) {
    fail(`slug "${slug}" is not in .generated/slugs.json — mint asset folders with 'npm run new-asset' (spec §7 D2 backstop)`);
  }
  const html = await readFile(path.join(dir, "index.html"), "utf8").catch(() => null);
  if (html === null) fail(`${slug}/index.html missing`);
  const hits = externalOriginHits(html);
  if (hits.length) {
    fail(`${slug} references external origins [${hits.join(", ")}] — assets must be self-contained (advisory lint; CSP is the boundary, spec §9)`);
  }
  gzTotal += gzipSync(Buffer.from(html)).length;
  entries.push({ slug, title: extractTitle(html, slug) });
}

// Bundle-size report (spec §7 / §15 Q5): fail at 70% of the ~8 MiB compressed asset budget.
const BUDGET = 8 * 1024 * 1024;
console.log(`asset gzip total: ${(gzTotal / 1024).toFixed(1)} KiB of ${(BUDGET / 1024 / 1024).toFixed(0)} MiB budget (fail at 70%)`);
if (gzTotal > 0.7 * BUDGET) {
  fail("compressed assets exceed 70% of the bundle budget — trigger the §15 Q5 R2 cutover; do NOT just raise this number");
}

const esc = (s) => JSON.stringify(s);
const manifestTs = `// GENERATED by scripts/build-manifest.mjs — do not edit by hand. Confidential (slug→title = client
// identities, spec §7); compiled into the Worker, NEVER routable.
export const manifest: Record<string, { title: string }> = {
${entries.map((e) => `  ${esc(e.slug)}: { title: ${esc(e.title)} },`).join("\n")}
};
`;
const modulesTs = `// GENERATED by scripts/build-manifest.mjs — do not edit by hand. Slug → asset HTML (Text modules).
${entries.map((e, i) => `import a${i} from ${esc(`../assets/${e.slug}/index.html`)};`).join("\n")}
export const assetModules: Record<string, string> = {
${entries.map((e, i) => `  ${esc(e.slug)}: a${i},`).join("\n")}
};
`;
await writeFile(path.join(root, ".generated", "assets-manifest.ts"), manifestTs);
await writeFile(path.join(root, ".generated", "assets-modules.ts"), modulesTs);
console.log(`Wrote .generated modules for ${entries.length} asset(s).`);
```

- [ ] **Step 6: Verify end-to-end** (the regenerated modules must keep the fixture working):

Run: `npm run build-manifest && npm test`
Expected: build reports 1 asset (the fixture) + a size line; regenerated `.generated/*.ts` differ from the hand-seeded stubs only in the header comment and key quoting; **all tests still pass** (the fixture entries are semantically identical). Then prove the failure modes:
1. `mkdir -p assets/AcmeCorpQ4BoardDeck00A && echo '<title>x</title>' > assets/AcmeCorpQ4BoardDeck00A/index.html && npm run build-manifest` → FAIL (not in registry — the D2 backstop). Clean up: `rm -rf assets/AcmeCorpQ4BoardDeck00A`.
2. `mkdir -p assets/short && echo x > assets/short/index.html && npm run build-manifest` → FAIL (shape). Clean up: `rm -rf assets/short`.
3. Temporarily add `"assets": {},` under the top level of `wrangler.jsonc` → `npm run build-manifest` → FAIL (config lint). Revert immediately.
4. Add `<script src="https://evil.example/x.js"></script>` to the fixture HTML → FAIL (advisory scan). Revert.

- [ ] **Step 7: Commit**

```bash
git add scripts/ .generated/ src/lib/build/
git commit -m "feat: build-manifest — registry provenance, generated modules, advisory scan, assets-key lint, size budget"
```

**BEFORE marking Phase 6 complete:** ≥3-round review. Confirm the build FAILS on: unregistered slug, malformed slug, duplicate registry entry, external-origin reference (all four surfaces tested), the `assets` config key, and the size threshold; confirm the generated modules are the ONLY manifest/asset access path in `src/` (grep for `node:fs` in `src/` → no hits). `npm test` green. Update banner + table.

---

## Phase 7 — Environments, deploy pipeline & isolation

**Execution Status:** ⬜ NOT STARTED

> Infra/config + human-in-the-loop Cloudflare dashboard steps. Read spec §10, §11. Requires
> `npx wrangler login` / `CLOUDFLARE_API_TOKEN` and (for CI) GitHub repo secrets — human-assisted.

### Task 7.1: Per-environment databases, bindings, secrets & environment markers

**Files:**
- Modify: `wrangler.jsonc` (env blocks + `secrets.required`)

- [ ] **Step 1: Create the two remote databases**

```bash
npx wrangler d1 create artifact-share-prod
npx wrangler d1 create artifact-share-preview
```

Record both printed `database_id` UUIDs. (These are configuration values, not plan placeholders —
paste them into Step 2. There is NO branching/cloning: both DBs are born empty; migrations are the
only thing that ever populates preview — spec §10.)

- [ ] **Step 2: Add the environment blocks + required-secrets declaration to `wrangler.jsonc`**
  (merge into the existing config; replace `<PROD_DB_ID>`/`<PREVIEW_DB_ID>` with Step 1's UUIDs and
  the two hostnames with the real ones):

```jsonc
{
  // …existing top-level (local dev) config from Task 0.2 stays as-is…
  "secrets": {
    "required": ["ADMIN_PASSWORD_HASH", "ADMIN_TOTP_SECRET", "SESSION_SECRET", "ASSET_COOKIE_SECRET"]
  },
  "env": {
    "preview": {
      "name": "artifact-share-preview",
      // Preview is reachable ONLY at its workers.dev hostname, which Task 7.3 puts behind
      // Cloudflare Access. The app-level ENVIRONMENT gate keeps /a/* and /admin inert regardless.
      "workers_dev": true,
      "vars": { "ENVIRONMENT": "preview", "PUBLIC_ORIGIN": "https://artifact-share-preview.samuel-carson.workers.dev" },
      "d1_databases": [{
        "binding": "DB", "database_name": "artifact-share-preview",
        "database_id": "<PREVIEW_DB_ID>", "migrations_dir": "migrations"
      }]
    },
    "production": {
      // Deploys to the EXISTING production Worker (custom domain share.scarson.io already bound).
      "name": "artifact-share",
      "workers_dev": false,
      // NOTE (owner-visible, spec §10): this deliberately DISABLES the currently-enabled
      // *-artifact-share.samuel-carson.workers.dev version-preview URLs on the production Worker.
      // Version previews of production run with PRODUCTION bindings (prod D1 + ENVIRONMENT=
      // production) — a live, non-custom-domain door into confidential content. Previews belong to
      // the separate artifact-share-preview Worker (empty DB, Access-gated) instead.
      "preview_urls": false,
      "routes": [{ "pattern": "share.scarson.io", "custom_domain": true }],
      "vars": { "ENVIRONMENT": "production", "PUBLIC_ORIGIN": "https://share.scarson.io" },
      "d1_databases": [{
        "binding": "DB", "database_name": "artifact-share-prod",
        "database_id": "<PROD_DB_ID>", "migrations_dir": "migrations"
      }]
    }
  }
}
```

> `secrets.required` is a real, current Wrangler feature (added 2026: deploys fail listing any
> missing secrets — see the Wrangler configuration docs, "Secrets configuration property"). Do NOT
> remove it because an older reference doesn't know it; verify against current docs instead.
>
> The per-env `name` overrides deploy `--env production` onto the EXISTING `artifact-share` Worker
> (keeping its share.scarson.io custom domain) and `--env preview` onto `artifact-share-preview` —
> two separate Workers with disjoint bindings. Double-check the two `database_id`s against Step 1's output — a mis-pointed
> preview→prod binding is exactly the hazard the `meta` guard exists for (spec §10); don't rely on
> the guard to catch a config you can verify by eye.

- [ ] **Step 3: Apply migrations + set the environment markers**

```bash
npx wrangler d1 migrations apply artifact-share-prod --env production --remote
npx wrangler d1 migrations apply artifact-share-preview --env preview --remote
npx wrangler d1 execute artifact-share-prod --env production --remote \
  --command "UPDATE meta SET value = 'production' WHERE key = 'environment';"
npx wrangler d1 execute artifact-share-preview --env preview --remote \
  --command "UPDATE meta SET value = 'preview' WHERE key = 'environment';"
```

Verify: `npx wrangler d1 execute artifact-share-prod --env production --remote --command "SELECT * FROM meta;"` → `environment = production` (and `preview` for the other). The marker is the operator's binding-audit signal — it proves each environment is pointed at the intended database (re-checked in Task 7.4); the runtime protection is production-only serving (Task 3.2).

- [ ] **Step 4: Set the secrets — distinct values per environment (spec §10)**

```bash
node scripts/hash-password.mjs '<the real admin password>'   # → hash for the next command
npx wrangler secret put ADMIN_PASSWORD_HASH --env production
node scripts/totp-setup.mjs                                  # → secret + QR; scan it NOW
npx wrangler secret put ADMIN_TOTP_SECRET --env production
# Key rings: "<kid>:<secret>" — generate each secret with: openssl rand -base64 32
npx wrangler secret put SESSION_SECRET --env production       # e.g. k1:<random>
npx wrangler secret put ASSET_COOKIE_SECRET --env production  # e.g. k1:<different random>
# Preview gets its own, DIFFERENT values (throwaway password/TOTP are fine — preview mints nothing real):
npx wrangler secret put ADMIN_PASSWORD_HASH --env preview
npx wrangler secret put ADMIN_TOTP_SECRET --env preview
npx wrangler secret put SESSION_SECRET --env preview
npx wrangler secret put ASSET_COOKIE_SECRET --env preview
```

> Secrets are write-only after set (spec §8). Rotation = prepend a new `<kid>:<secret>` to a ring and
> keep the previous entry until tokens age out (≤7d sessions / ≤24h asset cookies), then drop it.
> Rotation is NOT the response to a suspected code exposure — that is revoke + reissue (spec §10).

- [ ] **Step 5: Deploy both environments and smoke-check the gates**

```bash
npm run build-manifest
npx wrangler deploy --env preview
npx wrangler deploy --env production
curl -sS https://artifact-share-preview.samuel-carson.workers.dev/a/testasset0000000000000
curl -sS https://share.scarson.io/robots.txt
```

Expected: the preview `/a/*` returns the **generic failure page** (ENVIRONMENT gate — spec §10) even
though the fixture is bundled; production robots returns `Disallow: /`. A deploy with a missing
secret fails loudly (the `secrets.required` declaration).

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc
git commit -m "chore: per-env D1 bindings, required secrets, env markers, preview/production deploys"
```

### Task 7.2: CI deploy pipeline (gated, serialized, forward-only migrations)

**Precondition (owner setup, 2026-07-02): disable Cloudflare Workers Builds for this Worker —
BOTH the deploy-on-main build and the non-production-branch builds** (dashboard → Workers & Pages →
artifact-share → Settings → Builds). Rationale: (a) two deployers on `main` (Workers Builds + this
workflow) would race, and only this workflow runs tests and applies D1 migrations BEFORE the deploy
(spec §11 ordering); (b) Workers Builds' managed build token is not guaranteed D1-edit scope for
`wrangler d1 migrations apply`; (c) non-prod-branch builds upload versions of the PRODUCTION Worker,
which is exactly the version-preview exposure surface Task 7.1 turns off. Verify in the dashboard
that no build triggers remain before enabling this workflow, and record the confirmation in this
plan's Execution Status.

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Implement** `.github/workflows/deploy.yml` (spec §11: migrations run ONLY from this
  gated step, `main`-only for prod, BEFORE the deploy; `concurrency` serializes concurrent pushes —
  the honest D1 replacement for Postgres advisory locks; rollback is `wrangler rollback` = code-only,
  never schema):

```yaml
name: deploy
on:
  push:
    branches: [main, dev]
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npm run build-manifest
      # The generated modules are COMMITTED (Task 0.2); a merge that forgot to regenerate them
      # would deploy stale content silently. Fail instead.
      - run: git diff --exit-code .generated
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      WRANGLER_ENV: ${{ github.ref == 'refs/heads/main' && 'production' || 'preview' }}
      DB_NAME: ${{ github.ref == 'refs/heads/main' && 'artifact-share-prod' || 'artifact-share-preview' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npm run build-manifest
      # Forward-only migrations, applied BEFORE the code deploy (spec §11). Never run from previews
      # of the other environment; never rolled back — schema stays compatible one release back.
      - run: npx wrangler d1 migrations apply "$DB_NAME" --env "$WRANGLER_ENV" --remote
      - run: npx wrangler deploy --env "$WRANGLER_ENV"
```

- [ ] **Step 2: Add repo secrets** (GitHub → Settings → Secrets): `CLOUDFLARE_API_TOKEN` (a token
  scoped to Workers Scripts:Edit + D1:Edit on this account — NOT a global key) and
  `CLOUDFLARE_ACCOUNT_ID`. Record in the runbook (Task 7.3) that this token can deploy code and thus
  read every secret at runtime — GitHub repo access is now part of the §8 trust boundary.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: gated deploy pipeline — tests, forward-only D1 migrations, serialized per-branch"
```

### Task 7.3: Cloudflare Access on non-prod + the zone/ops runbook

**Files:**
- Create: `docs/deploy/SETUP.md`

- [ ] **Step 1: Enable Cloudflare Access on the preview hostname** (spec §10/§15 Q3).
  **Precondition:** the owner has ratified §15 Q3 (Access on non-prod). If unconfirmed, ASK before
  proceeding; if declined, skip this step, record the decision in this plan's Deviations + spec §15,
  and rely on the app-level gate alone (it is the fail-closed boundary either way). In the Cloudflare dashboard: **Workers & Pages →
  artifact-share-preview → Settings → Domains & Routes → workers.dev → Enable Cloudflare Access**; edit
  the generated policy to allow ONLY the owner's email. Verify:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://artifact-share-preview.samuel-carson.workers.dev/
```

Expected: a `302` to `cloudflareaccess.com` (NOT the app). The app-level ENVIRONMENT gate remains
the fail-closed boundary underneath (Task 7.1 Step 5 proved it).

- [ ] **Step 2: Write the runbook** `docs/deploy/SETUP.md` documenting exactly:
  - **Branches (spec §11):** `main` = production, `dev` = integration; work flows `dev` → PR → `main`;
    the Task 7.2 workflow deploys `dev` pushes to the Access-gated preview Worker and `main` merges to
    production (migrations first, serialized).
  - **Publishing an asset:** `npm run new-asset -- "Title"` → edit the HTML → `npm run build-manifest`
    → commit (assets/ + .generated/) → PR `dev`→`main` → merge deploys → mint the code in `/admin`.
    A code can only be minted for an asset that is deployed and in the manifest.
  - **Environments (spec §10):** top-level config = local dev (`wrangler dev`, local D1, real gate
    flow QA happens HERE); `preview` = Access-gated workers.dev, empty D1, inert app gates;
    `production` = custom domain only, `workers_dev`+`preview_urls` false. `ENVIRONMENT` var is the
    only oracle; the D1 `meta` marker is the operator's binding audit (verified at setup + in
    production verification), and production-only serving means a mis-bound non-prod Worker cannot
    serve confidential content regardless.
  - **Access decisions (spec §15):** Q3 = Access-on-non-prod **enabled** (Step 1 — owner to ratify);
    Q6 (Access in front of production `/admin`) = **off by default**; to enable later: create a
    self-hosted Access app for `share.scarson.io/admin` allowing only the owner — it is an ADDITIONAL
    layer; never remove the app-level password+TOTP. Q7 (Turnstile) = off; if ever enabled, login page
    ONLY — **never on `/a/*`** (breaks one-click/no-JS recipients). Q8 (zone rate-limiting/WAF) = off;
    if ever enabled: block/throttle actions only, thresholds far above the app limiter, **no challenge
    actions on `/a/*`**.
  - **Zone foot-guns (spec §9 — standing invariants, one dashboard click from breaking the design):**
    NO Cache Rules / Cache Response Rules / APO matching this hostname; NO Rocket Loader, Email
    Obfuscation, Mirage, or Cloudflare Fonts (they rewrite HTML bodies → inject script into
    confidential assets and break byte-identical failure parity); no `caches.default` /
    `cf.cacheEverything` anywhere in the Worker (grep in review).
  - **Log & access hygiene (spec §3 D4, §8):** the reusable code transits the URL — keep Workers
    observability invocation logs disabled or minimal-retention; NO Logpush for this Worker; never
    `console.log` URLs/codes; restrict Cloudflare account membership + API tokens (anyone who can
    deploy can exfiltrate secrets and mint codes — same for the GitHub `CLOUDFLARE_API_TOKEN`).
  - **D1 durability & confidentiality (spec §11):** Time Travel gives 30-day PITR (Workers Paid);
    `wrangler d1 export artifact-share-prod --env production --remote --output backup.sql` for periodic
    offline exports. Exports and restores contain **client identities (labels) + the sharing graph**
    even with hashed codes — encrypt at rest, restrict access, retention limit, minimal labels.
    Deleting a row is NOT erasure within the 30-day Time Travel window.
  - **Rotation & exposure (spec §10):** key-ring rotation procedure (prepend kid, retire later);
    suspected code exposure ⇒ **revoke + reissue in `/admin`**, never secret rotation.
  - **TOTP / authenticator recovery (spec §8):** re-run `npm run totp-setup` (mints a NEW secret +
    matching QR together), `npx wrangler secret put ADMIN_TOTP_SECRET --env production`, scan the QR.
    Setting a hand-invented secret without the script's QR will not match the authenticator.
  - **Integrity alerting (spec §13):** the gate emits a structured error log
    (`event=asset_module_missing`, level error) when a VALID code hits a missing asset module — an
    integrity failure, not a 404. Wire a Cloudflare notification (Workers alert on error-rate) or a
    scheduled log review to that event so it pages someone; until that exists, treat any occurrence
    found in logs as an incident.
  - **Read replication (spec §5):** never enable on these databases (instant-revocation invariant).

- [ ] **Step 3: Commit**

```bash
git add docs/deploy/SETUP.md
git commit -m "docs: deploy runbook — Access on non-prod, zone foot-guns, log hygiene, rotation, backups"
```

### Task 7.4: Full production verification

- [ ] **Step 1: Run the real end-to-end flow** against production (fixture asset is already deployed):
  1. **Preview isolation:** on the preview URL (after Access login), `/a/testasset0000000000000` and
     `/admin` both return the **generic failure page** (ENVIRONMENT gate). Without Access login, the
     hostname never reaches the app at all.
  2. **Production login:** `/admin/login` with password + TOTP → `/admin`. A wrong password shows the
     generic error and does NOT lock the account (throttle only — retry the correct password
     immediately after; it succeeds, possibly delayed).
  3. **Mint:** generate a code for the fixture asset with label "Prod verification". The **one-time
     link is shown once** — copy it. The codes list shows label/status/last-used/Redemptions and no
     raw code anywhere.
  4. **Redeem:** open the link in a fresh browser → 302 → clean URL → fixture renders. URL bar has no
     `?code=`. Check headers (`curl -sD - -o /dev/null -H "cookie: asset_access_…"` — a GET, not HEAD; only GET is routed): `cache-control: no-store`,
     `strict-transport-security`, `x-content-type-options: nosniff`, CSP with `frame-ancestors 'none'`,
     and **`cf-cache-status` absent or DYNAMIC — never HIT** (spec §9 edge-cache probe).
  5. **Byte-stability probe (spec §9/§13):** `curl -sS https://share.scarson.io/a/wrongslug0000000000000` twice;
     the bodies are identical to each other AND contain no injected script (no Rocket-Loader/email-
     obfuscation artifacts — confirms the zone foot-guns are off).
  6. **Revoke:** revoke the code in `/admin`; reload the asset in the same browser → generic failure
     page (instant revocation). `curl https://share.scarson.io/robots.txt` → `Disallow: /`.
  7. **No plaintext at rest + binding audit:** `npx wrangler d1 execute artifact-share-prod --env production --remote
     --command "SELECT name FROM pragma_table_info('codes') WHERE name='code';"` → zero rows (and
     spot-check a `code_hash` value is 64-hex, not a raw code). Then
     `--command "SELECT value FROM meta WHERE key='environment';"` → `production` (and `preview` on
     the preview DB) — each Worker is bound to its intended database.
  8. **No stray hostnames:** `https://artifact-share.samuel-carson.workers.dev` returns an error page,
     not the app (workers_dev disabled), and the previously-enabled
     `*-artifact-share.samuel-carson.workers.dev` version-preview URLs no longer resolve
     (`preview_urls: false` deployed — spec §10; expected and deliberate).

- [ ] **Step 2: Record results** in the plan's Execution Status (Discoveries if anything deviated).
  Revoke the verification code when done.

**BEFORE marking Phase 7 complete:** all eight verification substeps pass against the real production
URL, including the preview-gate, cf-cache-status, byte-stability, and no-plaintext checks. Update
banner + table + Overall.

---

## Final self-review (run after all phases planned/executed)

- **Spec coverage (against the Cloudflare spec):**
  - **§4 (purpose-built Worker; no static surface):** no `assets` key ever (Task 0.2 config + Task 6.2
    lint); every response rendered per-request by Hono handlers; robots/failure/root are Worker
    responses (Tasks 3.2/3.3).
  - **§5 (data model, DB time, hashed codes, atomic increments, replication-off):** Task 1.1 schema
    (epoch INTEGERs, expression defaults, no plaintext column — spike-verified) + Task 2.1 property
    tests + Task 3.4 atomic upsert + Task 4.2 step-store + runbook replication note (Task 7.3).
  - **§6 (gate flow):** redemption precedence, atomic redeem with DB-returned `iat`/`cookie_exp`,
    fail-closed recheck, byte-identical failure + uniform-path taxonomy, cookie attributes +
    `Path=/a/<slug>`, 302 code-strip (Tasks 3.1–3.4; parity/header suite in 3.3).
  - **§7 (bundled modules, manifest, registry, sizes):** Tasks 3.2 (module lookups + fixture),
    6.1 (generator+registry), 6.2 (build: provenance, generated modules, advisory scan, size budget).
  - **§8 (admin):** WASM argon2id pinned params + byte-compatible scripts (4.1); TOTP-after-password
    + replay (4.2/4.3); key-ring session with signed exp (4.3); pinned-origin CSRF (4.3); throttle
    never lockout (3.4/4.3); show-once + orphans + "Redemptions" label (5.1/5.2); env gate fail-closed
    (3.2/4.3); secrets write-only + trust notes (7.1/7.3).
  - **§9 (headers/CSP/limiter/edge-cache):** one header middleware on every class (3.3); asset vs
    admin CSPs (3.2/3.3); bucketed+global limiter, valid-cookie exempt, fails open (3.4); zone
    foot-gun runbook + deployed probes (7.3/7.4).
  - **§10/§11 (secrets/envs/pipeline/durability):** per-env DBs+secrets+`ENVIRONMENT` with
    production-only serving (3.2/7.1); `meta` marker as operator binding-audit (7.1/7.4); Access on
    non-prod (7.3, pending Q3); serialized forward-only migrations (7.2); ALTER-COLUMN rebuild
    caveat (pitfalls); Time Travel + exports confidentiality (7.3).
  - **§12 order** = phase order (dialect spike first, replacing the Vercel bundling spike).
    **§13 tests** = per-task suites + the parity/header/property/deploy checks above; Build-category
    checks live in Task 6.2 Step 6. **§14 YAGNI** respected (no sidecars, no audit log, no iframe —
    all surfaced). **§15** = the "Open owner decisions" section (Q4/Q9 resolved; Q1/Q2/Q3/Q5/Q6/Q7/Q8
    defaulted with seams).
- **No placeholders:** every code step is complete and runnable. The TWO intentional placeholders are
  explicitly fulfilled in-plan: `vitest.config.ts`'s `ADMIN_PASSWORD_HASH` (Task 4.1 Step 6) and the
  `<PROD_DB_ID>`/`<PREVIEW_DB_ID>`/hostname config values (Task 7.1 — configuration-time values from
  `wrangler d1 create` output, not unwritten design).
- **Type consistency (defined once, reused):** `Env` (src/env.ts), `CodeRow`/`codeStatus` (snake_case,
  epoch numbers), `KeyRing`/`AssetClaims` (tokens), `Redeemed` (gate), `Manifest`/`isKnownSlug`/
  `findOrphans` (manifest), `ExpirySpec` (adminRepo), `TotpStepStore` (totp). The fixture slug is the
  literal `testasset0000000000000` everywhere (22 chars). The generated-module import paths are
  relative (`../../.generated/…` from `src/lib`, `../assets/...` from `.generated`).
