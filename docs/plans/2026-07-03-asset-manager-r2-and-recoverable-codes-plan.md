# Asset Manager on R2 + Recoverable Codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make share codes recoverable by the admin (AES-GCM vault, Show-link UI) and replace the git/CI asset pipeline with runtime upload/version/delete into a private R2 bucket managed from the admin panel.

**Architecture:** Two independent phases. **Phase A** adds a `code_enc` column encrypted with a new `CODE_VAULT_KEY` Worker-secret key ring; lookup stays hash-only, decryption happens only in the Access-gated admin "Show link" action. **Phase B** moves asset bytes to a private R2 bucket (binding-only access, app-level `a/<slug>/<version>/…` prefix versioning, originals under `orig/`), replaces the build-time manifest with D1 tables (`assets`, `asset_versions`), adds admin upload/activate/download/delete, rewrites the gate to stream from R2 (including a new cookie-checked subresource route), then retires the bundling pipeline. Design doc (owner-approved): [`docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md`](../design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md).

**Tech Stack:** Cloudflare Workers (Hono), D1, R2 via binding, WebCrypto AES-256-GCM, `fflate` (zip), vitest-pool-workers (tests run inside workerd; local R2/D1 simulated).

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

## Execution Status

**Overall:** Not started.

| Phase | Status | Ship SHA(s) | Notes |
|---|---|---|---|
| A — Recoverable codes vault | ⬜ Not started | — | independent; ships alone |
| B — R2 asset manager | ⬜ Not started | — | tasks B1–B9 sequential |
| C — Public assets + /about (owner-requested 2026-07-03) | ⬜ Not started | — | after B; C1–C4 sequential |

### Standing context for every task (read once, applies throughout)

- **TDD is mandatory.** BEFORE starting any task: (1) invoke `superpowers:test-driven-development`, (2) read `docs/pitfalls/testing-pitfalls.md`. Write the failing test → run it (expect FAIL) → implement minimally → run again (expect PASS). BEFORE marking any task complete: review new tests against `docs/pitfalls/testing-pitfalls.md`, check error paths + edge cases are covered, run `npm test` AND `npx tsc --noEmit` and confirm green.
- **Never weaken assertions to fix flakes.** If a test races or flakes, fix it with deterministic synchronization or seeded state — never by removing/loosening the assertion. If that's impossible, STOP and raise to the dispatcher.
- **Two pitfall-doc entries are SUPERSEDED by this plan** (Task A5/B9 update them — until then, do not "correct" code back toward them): `implementation-pitfalls.md` "Store SHA-256(code), never the raw code" (now: hash for lookup + AES-GCM vault column for recovery) and "Confidential manifest is a generated MODULE" (now: D1 tables + R2).
- **Pitfalls that still bind and are easy to trip here:** SQLite `ALTER TABLE ADD COLUMN` cannot take expression DEFAULTs (both new migrations avoid them); fail CLOSED on DB/R2 errors (generic page, no cookie); D1 is the single time source (`unixepoch()`, never `Date.now()` in SQL); the wrangler.jsonc `assets` key stays banned (R2 binding is NOT the `assets` key — the lint stays); CSRF `originOk` on every admin mutation; test bindings live in `vitest.config.ts`, not env files.
- **Env/config invariants:** every wrangler.jsonc change goes in ALL THREE places (top-level dev block + `env.preview` + `env.production`); `secrets.required` is per-env (not inherited); never touch `ACCESS_DEV_BYPASS` in committed config.
- **Style/CSP invariant:** any change to `ADMIN_STYLE`/`PUBLIC_STYLE`/`ADMIN_SCRIPT` in `src/lib/ui/styles.ts` requires updating the sha256 hashes in `src/lib/http/headers.ts`; `src/lib/http/csp.test.ts` fails with the correct hash printed — paste it, rerun.
- Commit after every task with a conventional message. Branch: work happens on a feature branch off `dev`; PRs go `dev → main` (never push `main`).

### File structure (end state)

```
src/lib/vault.ts                    NEW  A2  AES-GCM code vault (encrypt/decrypt, key ring)
migrations/0003_code_enc.sql        NEW  A1  ALTER TABLE codes ADD code_enc
migrations/0004_assets.sql          NEW  B1  assets + asset_versions tables
src/lib/db/assetRepo.ts             NEW  B3  D1 CRUD for assets/versions (+ code auto-revoke)
src/lib/content/validate.ts         NEW  B4  upload validation + zip extraction (fflate), caps, MIME map
src/lib/content/store.ts            NEW  B5  R2 object ops (store/read/delete, orig zip)
src/routes/adminView.ts             NEW  B6  panel HTML rendering (extracted from admin.ts)
src/routes/admin.ts                 MOD  A5,B6  routes only after B6 (guards, codes, assets)
src/routes/gate.ts                  MOD  B7  serve from R2; new /a/:slug/* subresource route
src/lib/codes.ts                    MOD  A4 (CodeRow.code_enc), B7 (isValidSlug moves here)
src/lib/db/adminRepo.ts             MOD  A4  encrypt-at-mint, getCodeEnc, listCodes JOIN assets
src/env.ts                          MOD  A3 (CODE_VAULT_KEY), B2 (ASSETS: R2Bucket)
wrangler.jsonc                      MOD  A3 (secrets.required), B2 (r2_buckets ×3)
vitest.config.ts                    MOD  A3  test CODE_VAULT_KEY binding
src/test/seedAsset.ts               NEW  B6  test helper: D1 rows + R2 objects for a fixture asset
scripts/lint-config.mjs             NEW  B8  config lints only (replaces build-manifest)
src/routes/publicAsset.ts           NEW  C2  shared public-serve helper + alias routes
docs/assets-src/about/index.html    NEW  C3  architecture explainer (public content — safe in the public repo)
DELETED in B8: src/lib/manifest.ts, src/lib/assets.ts, .generated/, assets/,
  scripts/build-manifest.mjs, scripts/new-asset.mjs, src/lib/manifest.test.ts
```

---

## Phase A — Recoverable codes vault

**Execution Status:** ⬜ NOT STARTED

Ships alone. The `CODE_VAULT_KEY` secret is **already set on both live Workers** (owner session
2026-07-03, `k1:`-prefixed, independent random keys per env) — executors only wire config/code.

### Task A1: Migration 0003 — `code_enc` column

**Files:**
- Create: `migrations/0003_code_enc.sql`
- Test: `src/lib/db/schema.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `src/lib/db/schema.test.ts`, matching its existing style of asserting schema shape against real D1):

```ts
test("codes.code_enc exists, TEXT, nullable (migration 0003)", async () => {
  const cols = (await env.DB.prepare("PRAGMA table_info(codes)").all<{ name: string; type: string; notnull: number }>()).results;
  const enc = cols.find((c) => c.name === "code_enc");
  expect(enc).toBeDefined();
  expect(enc!.type).toBe("TEXT");
  expect(enc!.notnull).toBe(0); // pre-vault rows stay NULL = "not recoverable"
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/db/schema.test.ts` → FAIL (column missing).
- [ ] **Step 3: Create the migration** — `migrations/0003_code_enc.sql`:

```sql
-- Recoverable codes (design 2026-07-03, supersedes spec §3 D3 hash-only): AES-256-GCM ciphertext
-- "kid:iv:ct" (base64url), encrypted with the CODE_VAULT_KEY Worker-secret key ring. The HASH
-- remains the only lookup path; this column exists solely for the admin Show-link action.
-- NULL = minted pre-vault (not recoverable). NOTE: plain column add — SQLite ALTER TABLE cannot
-- take expression DEFAULTs (pitfalls doc), and none is wanted.
ALTER TABLE codes ADD COLUMN code_enc TEXT;
```

- [ ] **Step 4: Run again** → PASS (the test setup re-applies all migrations per test file).
- [ ] **Step 5: Commit** — `git commit -m "feat(vault): migration 0003 — codes.code_enc column"`

### Task A2: Vault library (AES-256-GCM, key ring)

**Files:**
- Create: `src/lib/vault.ts`
- Test: `src/lib/vault.test.ts`

- [ ] **Step 1: Write the failing tests** — `src/lib/vault.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { decryptCode, encryptCode } from "./vault";

const KEY_A = "k1:" + btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_B = "k2:" + btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("code vault", () => {
  test("round-trips a code under the primary key", async () => {
    const enc = await encryptCode("PERKAi19siR7mTTLen3cvA", KEY_A);
    expect(enc.startsWith("k1:")).toBe(true);
    expect(await decryptCode(enc, KEY_A)).toBe("PERKAi19siR7mTTLen3cvA");
  });
  test("two encryptions of the same code differ (fresh IV each time)", async () => {
    expect(await encryptCode("same", KEY_A)).not.toBe(await encryptCode("same", KEY_A));
  });
  test("rotation: old-kid ciphertext decrypts when its key is anywhere in the ring", async () => {
    const enc = await encryptCode("rotate-me", KEY_A); // k1
    expect(await decryptCode(enc, `${KEY_B},${KEY_A}`)).toBe("rotate-me"); // k2 now primary
  });
  test("fails closed to null: wrong key, unknown kid, tampered ct, malformed, NULL input", async () => {
    const enc = await encryptCode("x", KEY_A);
    expect(await decryptCode(enc, KEY_B)).toBeNull();                       // unknown kid k1
    const [kid, iv, ct] = enc.split(":");
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === "AA" ? "BB" : "AA");
    expect(await decryptCode(`${kid}:${iv}:${flipped}`, KEY_A)).toBeNull(); // GCM auth fails
    expect(await decryptCode("garbage", KEY_A)).toBeNull();
    expect(await decryptCode(null, KEY_A)).toBeNull();                      // pre-vault row
  });
  test("malformed RING throws loudly on encrypt (misconfig must not silently mint unrecoverable codes)", async () => {
    await expect(encryptCode("x", "not-a-ring")).rejects.toThrow();
    await expect(encryptCode("x", "k1:" + btoa("short"))).rejects.toThrow(); // key must be 32 bytes
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/lib/vault.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** — `src/lib/vault.ts`:

```ts
/** Code vault (design 2026-07-03): AES-256-GCM encryption of raw share codes so the ADMIN can
 *  re-show a sent link. Key ring format matches ASSET_COOKIE_SECRET: "kid:<b64 32B>[,kid:<b64>…]",
 *  FIRST entry encrypts, every entry may decrypt (rotation). Ciphertext: "kid:<ivB64u>:<ctB64u>".
 *  decryptCode fails CLOSED to null (renders as "not recoverable"); encryptCode fails LOUD —
 *  a misconfigured ring must not silently mint unrecoverable codes. */

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importRing(ring: string): Promise<Map<string, CryptoKey>> {
  const out = new Map<string, CryptoKey>();
  for (const part of ring.split(",")) {
    const i = part.indexOf(":");
    if (i < 1) throw new Error("CODE_VAULT_KEY: malformed ring entry");
    const raw = Uint8Array.from(atob(part.slice(i + 1)), (c) => c.charCodeAt(0));
    if (raw.length !== 32) throw new Error("CODE_VAULT_KEY: keys must be 32 bytes");
    out.set(part.slice(0, i), await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  if (out.size === 0) throw new Error("CODE_VAULT_KEY: empty ring");
  return out;
}

export async function encryptCode(code: string, ring: string): Promise<string> {
  const keys = await importRing(ring);
  const [kid, key] = keys.entries().next().value as [string, CryptoKey];
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(code));
  return `${kid}:${b64uEncode(iv)}:${b64uEncode(new Uint8Array(ct))}`;
}

export async function decryptCode(enc: string | null, ring: string): Promise<string | null> {
  if (!enc) return null;
  try {
    const parts = enc.split(":");
    if (parts.length !== 3) return null;
    const key = (await importRing(ring)).get(parts[0]);
    if (!key) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uDecode(parts[1]) as BufferSource },
      key,
      b64uDecode(parts[2]) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // fail closed: shows as "not recoverable", never throws into a page render
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(vault): AES-256-GCM code vault with key-ring rotation`

### Task A3: Env + config plumbing for `CODE_VAULT_KEY`

**Files:**
- Modify: `src/env.ts` (add field), `wrangler.jsonc` (secrets.required ×2 env blocks + a dev-vars note), `vitest.config.ts` (test binding), `.dev.vars.example`
- Test: `src/lib/http/csp.test.ts` unaffected; verified by A4's tests exercising the binding

- [ ] **Step 1:** `src/env.ts` — add below `ASSET_COOKIE_SECRET`:

```ts
  /** Key ring for the code vault (recoverable codes, design 2026-07-03): "kid:<b64 32B>[,…]",
   *  first key encrypts. Secret per env; already set on both live Workers. */
  CODE_VAULT_KEY: string;
```

- [ ] **Step 2:** `wrangler.jsonc` — in BOTH `env.preview` and `env.production`, extend `secrets.required` to `["ASSET_COOKIE_SECRET", "CODE_VAULT_KEY"]` (remember: per-env, NOT top-level — it is not inherited).
- [ ] **Step 3:** `.dev.vars.example` — append:

```
# Code vault (recoverable codes). Local-only placeholder; real envs use per-env secrets.
CODE_VAULT_KEY=k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
```

Also add the same line to your local `.dev.vars` (gitignored).
- [ ] **Step 4:** `vitest.config.ts` — in the `bindings` object, after `ASSET_COOKIE_SECRET`, add:

```ts
            CODE_VAULT_KEY: "k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", // 32 zero bytes — test-only
```

- [ ] **Step 5:** Run `npm test` + `npx tsc --noEmit` → all green (nothing consumes it yet). `npx wrangler deploy --dry-run --env production` → still succeeds (secret exists on the live Worker). Commit — `chore(vault): CODE_VAULT_KEY env/config plumbing`

**Format contract (stricter than ASSET_COOKIE_SECRET — document, don't assume):** the vault
requires each ring value to be STANDARD base64 of exactly 32 bytes (`openssl rand -base64 32`);
`encryptCode` throws on anything else BY DESIGN (a misconfigured ring must not silently mint
unrecoverable codes). The live secrets were set 2026-07-03 with exactly
`echo "k1:$(openssl rand -base64 32)" | npx wrangler secret put CODE_VAULT_KEY --env <env>`,
so they comply by construction — but the post-deploy verification below is still mandatory
because a throwing ring means EVERY production mint 500s.

### Task A4: Encrypt at mint; decrypt accessor

**Files:**
- Modify: `src/lib/codes.ts` (CodeRow), `src/lib/db/adminRepo.ts` (createCode signature + inserts, new getCodeEnc), `src/routes/admin.ts` (pass the ring at the single `createCode` call site inside `POST /admin/codes` — find it with `grep -n "createCode(" src/routes/admin.ts`)
- Test: `src/lib/db/adminRepo.test.ts` (append)

**Context:** `createCode` currently takes `(db, assetSlug, label, expiry, gen?)` and inserts only the hash. All three INSERT branches gain a `code_enc` value. The ONLY call site is `src/routes/admin.ts` `POST /admin/codes`. Tests in `adminRepo.test.ts` call `createCode` directly — update every call site in that file with the test ring constant.

- [ ] **Step 1: Failing tests** (append to `src/lib/db/adminRepo.test.ts`; use `env.CODE_VAULT_KEY` as the ring):

```ts
test("createCode stores code_enc decryptable back to the returned raw code (all 3 expiry branches)", async () => {
  for (const expiry of [null, { days: 5 }, { atSec: 4102444800 }] as const) {
    const raw = await createCode(env.DB, SLUG, "enc-test", expiry, env.CODE_VAULT_KEY);
    const row = await env.DB.prepare("SELECT code_enc FROM codes WHERE code_hash = ?1")
      .bind(await hashCode(raw)).first<{ code_enc: string | null }>();
    expect(row!.code_enc).not.toBeNull();
    expect(await decryptCode(row!.code_enc, env.CODE_VAULT_KEY)).toBe(raw);
  }
});
test("getCodeEnc returns enc+slug+label by id; null for unknown id", async () => {
  const raw = await createCode(env.DB, SLUG, "Nels", null, env.CODE_VAULT_KEY);
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  const got = await getCodeEnc(env.DB, id);
  expect(got!.asset_slug).toBe(SLUG);
  expect(got!.label).toBe("Nels");
  expect(await decryptCode(got!.code_enc, env.CODE_VAULT_KEY)).toBe(raw);
  expect(await getCodeEnc(env.DB, "nope")).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement:**

`src/lib/codes.ts` — add to `CodeRow`: `code_enc: string | null;` (after `code_hash`).

`src/lib/db/adminRepo.ts` — new signature and inserts (vaultRing REQUIRED, before `gen` so existing `gen` injections shift one arg — update the collision test's call accordingly):

```ts
import { encryptCode } from "../vault";
// signature: createCode(db, assetSlug, label, expiry, vaultRing: string, gen: () => string = generateCode)
// inside the attempt loop, after `const hash = await hashCode(code);`:
    const enc = await encryptCode(code, vaultRing); // throws on misconfig — better than silent unrecoverable
// each INSERT gains the column, e.g. the default-expiry branch becomes:
//   "INSERT INTO codes (code_hash, asset_slug, label, code_enc) VALUES (?1, ?2, ?3, ?4)"
//     .bind(hash, assetSlug, label, enc)
// (days branch: (code_hash, asset_slug, label, expires_at, code_enc) VALUES (?1,?2,?3, unixepoch()+?4*86400, ?5))
// (atSec branch: (code_hash, asset_slug, label, expires_at, code_enc) VALUES (?1,?2,?3,?4,?5))

export async function getCodeEnc(
  db: D1Database, id: string,
): Promise<{ code_enc: string | null; asset_slug: string; label: string } | null> {
  return await db.prepare("SELECT code_enc, asset_slug, label FROM codes WHERE id = ?1")
    .bind(id).first<{ code_enc: string | null; asset_slug: string; label: string }>();
}
```

`src/routes/admin.ts` — the `createCode` call becomes `createCode(c.env.DB, slug, label, expiry, c.env.CODE_VAULT_KEY)`.
- [ ] **Step 4:** Fix EVERY existing `createCode(...)` call site in the repo — run `grep -rn "createCode(" src/` and insert `env.CODE_VAULT_KEY` (tests) or `c.env.CODE_VAULT_KEY` (routes) as argument 5 in each (known: `src/lib/db/adminRepo.test.ts` incl. the collision test's injected `gen`, which shifts to argument 6; `src/routes/gate.test.ts` if it mints directly; `src/routes/admin.ts`). Run `npm test` + `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** — `feat(vault): encrypt raw code at mint; getCodeEnc accessor`

### Task A5: "Show link" admin action + UI

**Files:**
- Modify: `src/routes/admin.ts` (panelPage notice generalization + new POST route), `src/lib/ui/styles.ts` if any style tweak (then update hashes per csp.test), `docs/pitfalls/implementation-pitfalls.md` (amend superseded entry), spec `docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md` §3 D3/§8 (amendment note)
- Test: `src/routes/adminPanel.test.ts` (append)

**Context:** `panelPage(opts, …)` currently renders `opts.oneTimeLink` under the fixed heading "Copy this link now — it will NOT be shown again:". Generalize to `opts.link?: { url: string; heading: string }` so mint and show share the copy-row UI (existing tests grep the mint heading and the `?code=` regex — keep the mint heading text EXACTLY).

- [ ] **Step 1: Failing tests** (append to `src/routes/adminPanel.test.ts`):

```ts
test("Show link reveals the SAME url that was minted (vault round-trip through the panel)", async () => {
  const minted = await apost("/admin/codes", { slug: SLUG, label: "shower", days: "", date: "" });
  const url = (await minted.text()).match(/(https:\/\/share\.test\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  const shown = await apost("/admin/show", { id });
  const body = await shown.text();
  expect(body).toContain(url);                 // identical link, recovered
  expect(body).toContain("Link for shower");   // show-heading, not the mint heading
});
test("Show link on a pre-vault row (code_enc NULL) says not recoverable, no crash", async () => {
  await apost("/admin/codes", { slug: SLUG, label: "old", days: "", date: "" });
  await env.DB.prepare("UPDATE codes SET code_enc = NULL").run();
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  const res = await apost("/admin/show", { id });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("not recoverable");
});
test("Show link: unknown id → panel error; cross-site Origin → 403; unauthorized → generic page", async () => {
  expect((await apost("/admin/show", { id: "nope" })).status).toBe(400);
  expect((await apost("/admin/show", { id: "x" }, { origin: "https://evil.example" })).status).toBe(403);
  const unauth = await app.request("/admin/show", { method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id: "x" }).toString() }, env);
  expect(await unauth.text()).toContain("invalid or has expired");
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `src/routes/admin.ts`:

Panel: replace the `oneTimeLink` opt with `link?: { url: string; heading: string }`; mint call sites pass `{ url: oneTimeLink, heading: "Copy this link now — it will NOT be shown again:" }`; notice block becomes:

```ts
${opts.link
  ? html`<div role="status" class="notice"><strong>${opts.link.heading}</strong><div class="linkrow"><code id="onetime-link">${opts.link.url}</code><button type="button" class="copy" data-copy="onetime-link">Copy</button></div></div>`
  : ""}
```

Codes-table row: add a Show cell next to Revoke (small form, same pattern):

```ts
<td><form method="post" action="/admin/show"><input type="hidden" name="id" value="${c.id}"><button type="submit" class="revoke">Show link</button></form></td>
```

(add a matching empty `<th></th>`; the empty-state `colspan` becomes 7). New route (after the existing revoke route):

```ts
admin.post("/admin/show", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const row = await getCodeEnc(c.env.DB, String(form.get("id") ?? ""));
  const host = displayHost(c.env.PUBLIC_ORIGIN);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!row) return c.html(panelPage({ error: "unknown code", host }, await listCodes(c.env.DB), nowSec), 400);
  const raw = await decryptCode(row.code_enc, c.env.CODE_VAULT_KEY);
  if (raw === null) {
    return c.html(panelPage({ error: `"${row.label}" is not recoverable (minted before the vault)`, host }, await listCodes(c.env.DB), nowSec));
  }
  const link = { url: `${c.env.PUBLIC_ORIGIN}/a/${row.asset_slug}?code=${raw}`, heading: `Link for ${row.label}:` };
  return c.html(panelPage({ link, host }, await listCodes(c.env.DB), nowSec));
});
```

- [ ] **Step 4:** Run full `npm test` + `npx tsc --noEmit` → green (existing mint tests must pass UNCHANGED — the mint heading text is load-bearing).
- [ ] **Step 5: Docs.** `docs/pitfalls/implementation-pitfalls.md` "Store SHA-256(code)…" entry: append `**AMENDED 2026-07-03:** lookup remains hash-only, but the raw code is ALSO stored AES-GCM-encrypted in codes.code_enc (CODE_VAULT_KEY secret) for the admin Show-link action — see docs/design/2026-07-03-…-design.md §2. Never store or log the raw code anywhere else.` Spec §3 D3 + §8: add a one-line amendment note pointing at the design doc ("lost link ⇒ Show link; revoke if exposure suspected").
- [ ] **Step 6: Commit** — `feat(admin): Show link — recover a sent share link from the vault`

### Task A6: Post-deploy live verification (production)

After Phase A merges and deploys: owner (or agent via curl for the non-Access parts) verifies on
`share.scarson.io/admin`: mint a code → Show link on it returns the identical URL → a pre-vault
row (any code minted before this deploy) shows "not recoverable" without crashing. If minting
500s, suspect the CODE_VAULT_KEY format first (see A3's format contract) — rotate with the exact
command there and retry. Record the outcome in this plan.

### Phase A group review

- [ ] After A1–A5: review the batch from ≥3 perspectives (security: does the raw code ever hit logs/pages except the explicit show? fail-closed: every decrypt failure renders generic messaging? spec-conformance: amendments recorded?). Minimum 3 review rounds; keep going past 3 until a round is clean. Then update this plan's banners + Execution Status table, push, and open/refresh the PR.

---

## Phase B — R2 asset manager

**Execution Status:** ⬜ NOT STARTED

**Owner-action gate (VERIFIED BLOCKED 2026-07-03 08:09Z — before MERGE, not before coding):**
`wrangler r2 bucket create` fails with API code 10042 "Please enable R2 through the Cloudflare
Dashboard" — **R2 is not enabled on the account**. Owner must: dashboard → R2 → enable (accept
terms), then run `npx wrangler r2 bucket create artifact-share-prod && npx wrangler r2 bucket
create artifact-share-preview` (or an agent retries once R2 is enabled). Until then Phase B/C
build + test + PR normally (miniflare simulates R2 locally) but the PR MUST NOT merge — a deploy
with `r2_buckets` pointing at nonexistent buckets fails and CI reds.

### Task B1: Migration 0004 — `assets` + `asset_versions`

**Files:**
- Create: `migrations/0004_assets.sql`
- Test: `src/lib/db/schema.test.ts` (append)

- [ ] **Step 1: Failing test:**

```ts
test("assets + asset_versions exist with expected columns (migration 0004)", async () => {
  const acols = (await env.DB.prepare("PRAGMA table_info(assets)").all<{ name: string }>()).results.map((c) => c.name);
  expect(acols).toEqual(expect.arrayContaining(["slug", "title", "active_version", "is_public", "public_alias", "created_at", "updated_at"]));
  const vcols = (await env.DB.prepare("PRAGMA table_info(asset_versions)").all<{ name: string }>()).results.map((c) => c.name);
  expect(vcols).toEqual(expect.arrayContaining(["slug", "version", "created_at", "file_count", "total_bytes"]));
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** `migrations/0004_assets.sql`:

```sql
-- Asset manager (design 2026-07-03, supersedes the build-time module manifest): metadata in D1,
-- bytes in the private R2 bucket under a/<slug>/<version>/… . active_version NULL = unpublished
-- (gate fails closed). Time via unixepoch() — D1 is the single time source.
CREATE TABLE assets (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  active_version INTEGER,
  is_public INTEGER NOT NULL DEFAULT 0,
  public_alias TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE asset_versions (
  slug TEXT NOT NULL REFERENCES assets(slug),
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  PRIMARY KEY (slug, version)
);
```

- [ ] **Step 4:** Run → PASS. **Step 5: Commit** — `feat(assets): migration 0004 — assets + asset_versions`

### Task B2: R2 bindings + `fflate`

**Files:**
- Modify: `wrangler.jsonc` (three `r2_buckets` blocks), `src/env.ts` (`ASSETS: R2Bucket;`), `package.json` (fflate dep), `docs/deploy/SETUP.md` (bucket runbook §2.2)

- [ ] **Step 1:** `wrangler.jsonc` — top-level (local dev; miniflare simulates, name is arbitrary-but-stable):

```jsonc
	"r2_buckets": [
		{ "binding": "ASSETS", "bucket_name": "artifact-share-dev" }
	],
```

`env.preview`: `{ "binding": "ASSETS", "bucket_name": "artifact-share-preview" }` · `env.production`: `{ "binding": "ASSETS", "bucket_name": "artifact-share-prod" }`. NOTE for executor: this is the `r2_buckets` key — the banned `assets` key remains banned; do not confuse them. The bucket must NEVER get public access, an r2.dev URL, or a custom domain (design §3; add that sentence to SETUP.md).
- [ ] **Step 2:** `src/env.ts` — add `/** Private R2 bucket: asset bytes under a/<slug>/<v>/…, originals under orig/. Binding-only access. */ ASSETS: R2Bucket;`
- [ ] **Step 3:** `npm install fflate` (runtime dep, pure JS — works on Workers).
- [ ] **Step 4:** Attempt bucket creation (see phase banner); document outcome in SETUP.md §2.2 (creation commands + "decline any wrangler auto-add prompt; the bindings are already in wrangler.jsonc" — same guardrail as D1).
- [ ] **Step 5:** `npm test` + `npx tsc --noEmit` + `npx wrangler deploy --dry-run --env production` → green (dry-run validates binding syntax without needing the bucket). Commit — `chore(assets): R2 ASSETS binding ×3 envs + fflate`

### Task B3: Asset repository (D1)

**Files:**
- Create: `src/lib/db/assetRepo.ts`
- Test: `src/lib/db/assetRepo.test.ts`

- [ ] **Step 1: Failing tests** — `src/lib/db/assetRepo.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { activateVersion, activeVersion, assetExists, createAsset, deleteAsset, deleteVersion, listAssets, recordVersion } from "./assetRepo";
import { createCode } from "./adminRepo";

test("createAsset mints a 22-char slug; recordVersion(activate) publishes; listAssets shows both", async () => {
  const slug = await createAsset(env.DB, "Q3 Report");
  expect(slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(await assetExists(env.DB, slug)).toBe(true);
  expect(await activeVersion(env.DB, slug)).toBeNull(); // unpublished until a version activates
  await recordVersion(env.DB, slug, 1, 3, 1234, true);
  expect(await activeVersion(env.DB, slug)).toBe(1);
  const [a] = await listAssets(env.DB);
  expect(a.title).toBe("Q3 Report");
  expect(a.versions.map((v) => v.version)).toEqual([1]);
});
test("activate flips between recorded versions; activating a missing version throws", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await recordVersion(env.DB, slug, 2, 1, 20, true);
  expect(await activeVersion(env.DB, slug)).toBe(2);
  await activateVersion(env.DB, slug, 1); // rollback
  expect(await activeVersion(env.DB, slug)).toBe(1);
  await expect(activateVersion(env.DB, slug, 9)).rejects.toThrow();
});
test("deleteVersion refuses the ACTIVE version; deletes inactive", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await recordVersion(env.DB, slug, 2, 1, 20, false);
  await expect(deleteVersion(env.DB, slug, 1)).rejects.toThrow();
  await deleteVersion(env.DB, slug, 2);
  expect((await listAssets(env.DB))[0].versions.map((v) => v.version)).toEqual([1]);
});
test("deleteAsset removes rows AND auto-revokes its codes (design: delete = kill access)", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await createCode(env.DB, slug, "victim", null, env.CODE_VAULT_KEY);
  await deleteAsset(env.DB, slug);
  expect(await assetExists(env.DB, slug)).toBe(false);
  const row = await env.DB.prepare("SELECT revoked_at FROM codes WHERE asset_slug = ?1").bind(slug).first<{ revoked_at: number | null }>();
  expect(row!.revoked_at).not.toBeNull();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** — `src/lib/db/assetRepo.ts`:

```ts
import { generateSlug } from "../codes";

export interface AssetVersionRow { slug: string; version: number; created_at: number; file_count: number; total_bytes: number }
export interface AssetRow { slug: string; title: string; active_version: number | null; created_at: number; updated_at: number }

export async function createAsset(db: D1Database, title: string, gen: () => string = generateSlug): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = gen();
    try {
      await db.prepare("INSERT INTO assets (slug, title) VALUES (?1, ?2)").bind(slug, title).run();
      return slug;
    } catch (e) {
      if (e instanceof Error && /UNIQUE|PRIMARY/i.test(e.message) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique slug");
}

export async function assetExists(db: D1Database, slug: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM assets WHERE slug = ?1").bind(slug).first()) !== null;
}

export async function activeVersion(db: D1Database, slug: string): Promise<number | null> {
  const row = await db.prepare("SELECT active_version FROM assets WHERE slug = ?1").bind(slug).first<{ active_version: number | null }>();
  return row ? row.active_version : null; // missing asset and unpublished asset both ⇒ null (fail closed)
}

export async function listAssets(db: D1Database): Promise<(AssetRow & { versions: AssetVersionRow[] })[]> {
  const assets = (await db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all<AssetRow>()).results;
  const versions = (await db.prepare("SELECT * FROM asset_versions ORDER BY version DESC").all<AssetVersionRow>()).results;
  return assets.map((a) => ({ ...a, versions: versions.filter((v) => v.slug === a.slug) }));
}

export async function nextVersion(db: D1Database, slug: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM asset_versions WHERE slug = ?1").bind(slug).first<{ v: number }>();
  return row!.v;
}

/** Insert the version row and (optionally) flip the active pointer — one atomic batch. */
export async function recordVersion(db: D1Database, slug: string, version: number, fileCount: number, totalBytes: number, activate: boolean): Promise<void> {
  const stmts = [
    db.prepare("INSERT INTO asset_versions (slug, version, file_count, total_bytes) VALUES (?1, ?2, ?3, ?4)").bind(slug, version, fileCount, totalBytes),
  ];
  if (activate) stmts.push(db.prepare("UPDATE assets SET active_version = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, version));
  await db.batch(stmts);
}

export async function activateVersion(db: D1Database, slug: string, version: number): Promise<void> {
  const exists = await db.prepare("SELECT 1 FROM asset_versions WHERE slug = ?1 AND version = ?2").bind(slug, version).first();
  if (!exists) throw new Error("no such version");
  await db.prepare("UPDATE assets SET active_version = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, version).run();
}

export async function deleteVersion(db: D1Database, slug: string, version: number): Promise<void> {
  const row = await db.prepare("SELECT active_version FROM assets WHERE slug = ?1").bind(slug).first<{ active_version: number | null }>();
  if (row?.active_version === version) throw new Error("cannot delete the active version");
  await db.prepare("DELETE FROM asset_versions WHERE slug = ?1 AND version = ?2").bind(slug, version).run();
}

/** Delete = kill access: revoke every code for the slug, drop version rows, drop the asset. */
export async function deleteAsset(db: D1Database, slug: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE asset_slug = ?1 AND revoked_at IS NULL").bind(slug),
    db.prepare("DELETE FROM asset_versions WHERE slug = ?1").bind(slug),
    db.prepare("DELETE FROM assets WHERE slug = ?1").bind(slug),
  ]);
}
```

- [ ] **Step 4:** Run → PASS; full suite + tsc green. **Step 5: Commit** — `feat(assets): D1 asset repository`

### Task B4: Upload validation + zip extraction

**Files:**
- Create: `src/lib/content/validate.ts`
- Test: `src/lib/content/validate.test.ts`

**Deviation from the design doc's illustrative caps (25 MB file / 100 MB total), inline-documented here:** Workers isolates have ~128 MB memory and `unzipSync` inflates in memory alongside the source zip — caps are 20 MB upload / 20 MB per file / 60 MB total uncompressed / 200 entries. The design named them "adjustable constants"; record this in the top Deviations table when shipping.

- [ ] **Step 1: Failing tests** — `src/lib/content/validate.test.ts` (build zips in-test with fflate's `zipSync`):

```ts
import { describe, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { UploadError, validateUpload } from "./validate";

const html = strToU8("<!doctype html><h1>hi</h1>");
const zip = (files: Record<string, Uint8Array>) => zipSync(files);

describe("single file", () => {
  test("a .html upload becomes index.html with the html content-type", () => {
    const { files, isBundle } = validateUpload("report.html", html);
    expect(isBundle).toBe(false);
    expect(files).toEqual([{ path: "index.html", bytes: html, contentType: "text/html; charset=utf-8" }]);
  });
  test("non-html single files are rejected", () => {
    expect(() => validateUpload("report.pdf", html)).toThrow(UploadError);
  });
});

describe("zip bundles", () => {
  test("extracts entries with allowlisted content-types; requires root index.html", () => {
    const { files, isBundle } = validateUpload("b.zip", zip({ "index.html": html, "css/app.css": strToU8("body{}"), "data/x.json": strToU8("{}") }));
    expect(isBundle).toBe(true);
    expect(files.map((f) => f.path).sort()).toEqual(["css/app.css", "data/x.json", "index.html"]);
    expect(files.find((f) => f.path === "css/app.css")!.contentType).toBe("text/css");
  });
  test("missing root index.html rejected", () => {
    expect(() => validateUpload("b.zip", zip({ "nested/index.html": html }))).toThrow(/index\.html/);
  });
  test("zip-slip and absolute paths rejected", () => {
    expect(() => validateUpload("b.zip", zip({ "../evil.html": html, "index.html": html }))).toThrow(UploadError);
    expect(() => validateUpload("b.zip", zip({ "a/../../evil.html": html, "index.html": html }))).toThrow(UploadError);
    expect(() => validateUpload("b.zip", zip({ "/abs.html": html, "index.html": html }))).toThrow(UploadError);
  });
  test("macOS junk (__MACOSX/, .DS_Store) is SKIPPED silently, not a rejection", () => {
    const { files } = validateUpload("b.zip", zip({ "index.html": html, "__MACOSX/._x": strToU8("j"), ".DS_Store": strToU8("j") }));
    expect(files.map((f) => f.path)).toEqual(["index.html"]);
  });
  test("paths with spaces are allowed (URLs arrive percent-encoded)", () => {
    const { files } = validateUpload("b.zip", zip({ "index.html": html, "img/chart 1.png": strToU8("p") }));
    expect(files.map((f) => f.path).sort()).toEqual(["img/chart 1.png", "index.html"]);
  });
  test("disallowed extension rejected; directories skipped silently", () => {
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "run.exe": html }))).toThrow(/extension/);
  });
  test("ALL size/count caps throw (small injected limits exercise each branch)", () => {
    const tiny = { uploadBytes: 10_000, entries: 2, fileBytes: 50, totalBytes: 60 } as const;
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "a.txt": strToU8("x"), "b.txt": strToU8("x") }), tiny)).toThrow(/entries/);
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "big.txt": strToU8("y".repeat(51)) }), tiny)).toThrow(/too large/);
    expect(() => validateUpload("b.zip", zip({ "index.html": strToU8("z".repeat(40)), "c.txt": strToU8("z".repeat(30)) }), tiny)).toThrow(/total size/);
    expect(() => validateUpload("big.html", strToU8("h".repeat(10_001)), tiny)).toThrow(/exceeds/);
  });
  test("not actually a zip → UploadError, not a crash", () => {
    expect(() => validateUpload("b.zip", strToU8("plain text"))).toThrow(UploadError);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** — `src/lib/content/validate.ts`:

```ts
import { unzipSync } from "fflate";

/** Upload validation (design §3). Admin-only surface (Access-gated), but zip contents are still
 *  parsed defensively: path traversal, caps, extension allowlist. Caps sized for the ~128 MB
 *  Worker isolate (unzipSync inflates in memory): see plan Task B4 deviation note. */
export const LIMITS = {
  uploadBytes: 20 * 2 ** 20,   // the file field itself (html or zip)
  entries: 200,
  fileBytes: 20 * 2 ** 20,     // any single uncompressed file
  totalBytes: 60 * 2 ** 20,    // sum of uncompressed files
} as const;

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", map: "application/json", csv: "text/csv", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff2: "font/woff2", pdf: "application/pdf",
};

export class UploadError extends Error {} // message is admin-facing (rendered in the panel alert)

export interface UploadFile { path: string; bytes: Uint8Array; contentType: string }

function typeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const ct = CONTENT_TYPES[ext];
  if (!ct) throw new UploadError(`disallowed file extension: ${path}`);
  return ct;
}

/** Junk that real-world zips (especially macOS Archive Utility) always contain — SKIP silently,
 *  never fail the whole upload over them. Dotfiles/dot-dirs also skip (never intentional content). */
function isJunk(p: string): boolean {
  return p.startsWith("__MACOSX/") || /(^|\/)\./.test(p);
}

function normalizePath(raw: string): string {
  const p = raw.replace(/\\/g, "/");
  // Absolute paths, ".." SEGMENTS, and control chars REJECT (hostile shape). Spaces are legal —
  // subresource URLs arrive percent-encoded and are decoded before lookup.
  if (p.startsWith("/") || p.split("/").includes("..") || /[\x00-\x1f]/.test(p)) {
    throw new UploadError(`unsafe path in zip: ${raw}`);
  }
  return p;
}

/** `limits` is injectable FOR TESTS ONLY (small values exercise every cap throw); production
 *  call sites always use the default. */
export function validateUpload(filename: string, data: Uint8Array, limits: typeof LIMITS = LIMITS): { files: UploadFile[]; isBundle: boolean } {
  if (data.length > limits.uploadBytes) throw new UploadError(`upload exceeds ${limits.uploadBytes / 2 ** 20} MB`);
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    if (data.length === 0) throw new UploadError("empty file");
    return { files: [{ path: "index.html", bytes: data, contentType: CONTENT_TYPES.html }], isBundle: false };
  }
  if (!lower.endsWith(".zip")) throw new UploadError("upload a single .html file or a .zip bundle");

  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    entries = unzipSync(data, {
      // ALL THREE caps enforce inside the filter — i.e. BEFORE/DURING decompression — so a
      // hostile zip is rejected without inflating everything first.
      filter: (f) => {
        if (++count > limits.entries) throw new UploadError(`zip has too many entries (max ${limits.entries})`);
        if (f.originalSize > limits.fileBytes) throw new UploadError(`file too large in zip: ${f.name}`);
        total += f.originalSize;
        if (total > limits.totalBytes) throw new UploadError("zip contents exceed the total size cap");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("not a readable zip file");
  }

  const files: UploadFile[] = [];
  const seen = new Set<string>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;                 // directory entry
    if (isJunk(name.replace(/\\/g, "/"))) continue;   // macOS junk / dotfiles: skip, don't fail
    const path = normalizePath(name);
    if (seen.has(path)) throw new UploadError(`duplicate path in zip: ${path}`);
    seen.add(path);
    files.push({ path, bytes, contentType: typeFor(path) });
  }
  if (!seen.has("index.html")) throw new UploadError("bundle must contain a root index.html");
  return { files, isBundle: true };
}
```

- [ ] **Step 4:** Run → PASS; suite + tsc green. **Step 5: Commit** — `feat(assets): upload validation + zip extraction with hard caps`

### Task B5: R2 content store

**Files:**
- Create: `src/lib/content/store.ts`
- Test: `src/lib/content/store.test.ts` (runs against the miniflare-local `env.ASSETS`)

- [ ] **Step 1: Failing tests:**

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { deleteAssetObjects, deleteVersionObjects, readAssetFile, readOriginalZip, storeVersion } from "./store";

const F = (s: string) => new TextEncoder().encode(s);
const SLUG = "slugslugslugslugslug00";

test("storeVersion + readAssetFile round-trip with content types; version isolation", async () => {
  await storeVersion(env.ASSETS, SLUG, 1, [{ path: "index.html", bytes: F("v1"), contentType: "text/html; charset=utf-8" }], null);
  await storeVersion(env.ASSETS, SLUG, 2, [{ path: "index.html", bytes: F("v2"), contentType: "text/html; charset=utf-8" }], null);
  const v1 = await readAssetFile(env.ASSETS, SLUG, 1, "index.html");
  expect(await v1!.text()).toBe("v1");
  expect(v1!.httpMetadata?.contentType).toBe("text/html; charset=utf-8");
  expect(await (await readAssetFile(env.ASSETS, SLUG, 2, "index.html"))!.text()).toBe("v2");
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "missing.css")).toBeNull();
});
test("original zip stored under orig/ and readable; absent for single-file versions", async () => {
  await storeVersion(env.ASSETS, SLUG, 3, [{ path: "index.html", bytes: F("x"), contentType: "text/html; charset=utf-8" }], F("ZIPBYTES"));
  expect(await (await readOriginalZip(env.ASSETS, SLUG, 3))!.text()).toBe("ZIPBYTES");
  expect(await readOriginalZip(env.ASSETS, SLUG, 1)).toBeNull();
});
test("readAssetFile refuses traversal/absolute paths without touching R2", async () => {
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "../1/index.html")).toBeNull();
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "/etc/passwd")).toBeNull();
});
test("deleteVersionObjects removes a/ + orig/ for that version only; deleteAssetObjects removes all", async () => {
  await deleteVersionObjects(env.ASSETS, SLUG, 3);
  expect(await readAssetFile(env.ASSETS, SLUG, 3, "index.html")).toBeNull();
  expect(await readOriginalZip(env.ASSETS, SLUG, 3)).toBeNull();
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "index.html")).not.toBeNull();
  await deleteAssetObjects(env.ASSETS, SLUG);
  expect(await readAssetFile(env.ASSETS, SLUG, 2, "index.html")).toBeNull();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** — `src/lib/content/store.ts`:

```ts
import type { UploadFile } from "./validate";

/** R2 layout (design §3): served tree a/<slug>/<version>/<path>; originals orig/<slug>/<version>.zip
 *  — orig/ is OUTSIDE the gate-served tree, reachable only via the admin download route. */
const filePrefix = (slug: string, v: number) => `a/${slug}/${v}/`;
const origKey = (slug: string, v: number) => `orig/${slug}/${v}.zip`;

function safePath(path: string): boolean {
  // Mirrors validate.ts normalizePath: absolute paths + ".." segments + control chars rejected;
  // spaces are legal (subresource URLs arrive percent-encoded).
  return path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..") && !/[\x00-\x1f]/.test(path);
}

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function storeVersion(bucket: R2Bucket, slug: string, version: number, files: UploadFile[], originalZip: Uint8Array | null): Promise<void> {
  for (const f of files) {
    await bucket.put(filePrefix(slug, version) + f.path, f.bytes as unknown as ArrayBuffer, {
      httpMetadata: { contentType: f.contentType },
      customMetadata: { sha256: await sha256hex(f.bytes) },
    });
  }
  if (originalZip) {
    await bucket.put(origKey(slug, version), originalZip as unknown as ArrayBuffer, { httpMetadata: { contentType: "application/zip" } });
  }
}

export async function readAssetFile(bucket: R2Bucket, slug: string, version: number, path: string): Promise<R2ObjectBody | null> {
  if (!safePath(path)) return null;
  return await bucket.get(filePrefix(slug, version) + path);
}

export async function readOriginalZip(bucket: R2Bucket, slug: string, version: number): Promise<R2ObjectBody | null> {
  return await bucket.get(origKey(slug, version));
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteVersionObjects(bucket: R2Bucket, slug: string, version: number): Promise<void> {
  await deletePrefix(bucket, filePrefix(slug, version));
  await bucket.delete(origKey(slug, version));
}

export async function deleteAssetObjects(bucket: R2Bucket, slug: string): Promise<void> {
  await deletePrefix(bucket, `a/${slug}/`);
  await deletePrefix(bucket, `orig/${slug}/`);
}
```

- [ ] **Step 4:** Run → PASS; suite + tsc green. **Step 5: Commit** — `feat(assets): R2 content store`

### Task B6: Admin asset routes + UI (and the D1 bridge for codes)

**Files:**
- Create: `src/routes/adminView.ts` (panel rendering extracted from admin.ts), `src/test/seedAsset.ts`
- Modify: `src/routes/admin.ts` (asset routes; codes mint switches `isKnownSlug`→`assetExists`; options/orphans from D1), `src/lib/db/adminRepo.ts` (`listCodes` LEFT JOIN assets → `asset_title`), `src/lib/codes.ts` (`CodeRow.asset_title?: string | null`), `src/lib/ui/styles.ts` (assets-section styles → update BOTH hashes in `headers.ts` via csp.test), `src/routes/adminPanel.test.ts` + `src/routes/admin.test.ts` (seed D1 fixture)
- Test: `src/routes/adminAssets.test.ts` (new)

**Bridge note (interim state until B7):** the gate still serves from the bundled fixture, so the
existing "minted link redeems through the gate" e2e test keeps passing ONLY if the fixture slug
`testasset0000000000000` exists in BOTH systems. **Seeding discipline (exact):** register
`beforeEach(() => seedFixtureAsset())` FILE-WIDE at the top of `adminPanel.test.ts` (this task)
and `gate.test.ts` (B7) — not per-test. Two reasons: (1) after the `isKnownSlug`→`assetExists`
switch, an UN-seeded 400-expecting test (invalid expiry, forged slug) would still pass via the
unknown-asset 400 and silently stop testing its real claim; (2) R2 state persists across tests
within a file, so a test that deletes an object (B7's integrity test) would break later tests
unless every test re-seeds. `admin.test.ts` needs NO seeding — its panel assertions are text-only
and hold with zero assets.

- [ ] **Step 1:** `src/test/seedAsset.ts`:

```ts
import { env } from "cloudflare:test";

export const FIXTURE_SLUG = "testasset0000000000000";

/** Seed the fixture asset in D1 (+ its v1 index.html in R2) for tests. NOTE: the per-test reset
 *  (apply-migrations.ts) covers D1 ONLY — R2 persists across tests within a file, so the R2 put
 *  here is an idempotent overwrite, which also repairs objects a prior test deleted. */
export async function seedFixtureAsset(html = "<!doctype html><p>fixture ok</p>"): Promise<void> {
  await env.DB.prepare("INSERT INTO assets (slug, title, active_version) VALUES (?1, 'Test Fixture', 1)").bind(FIXTURE_SLUG).run();
  await env.DB.prepare("INSERT INTO asset_versions (slug, version, file_count, total_bytes) VALUES (?1, 1, 1, ?2)").bind(FIXTURE_SLUG, html.length).run();
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/index.html`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
}
```

- [ ] **Step 2: Failing tests** — `src/routes/adminAssets.test.ts` (same `apost` helper pattern as adminPanel.test.ts, plus a multipart helper):

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { zipSync, strToU8 } from "fflate";
import app from "../index";

const BASE = "https://share.test";
const AUTH = { ...env, ACCESS_DEV_BYPASS: "1" };

function upload(path: string, fields: Record<string, string>, file: { name: string; bytes: Uint8Array }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([file.bytes as unknown as ArrayBuffer], file.name));
  return app.request(path, { method: "POST", headers: { origin: BASE }, body: form }, AUTH);
}
const HTML = strToU8("<!doctype html><h1>up</h1>");

test("upload single html → asset created, v1 active, appears in panel with title", async () => {
  const res = await upload("/admin/assets", { title: "Board Deck" }, { name: "deck.html", bytes: HTML });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain("Board Deck");
  const a = await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>();
  expect(a!.active_version).toBe(1);
});
test("upload zip bundle → files stored under a/<slug>/1/, original under orig/", async () => {
  await upload("/admin/assets", { title: "Bundle" }, { name: "b.zip", bytes: zipSync({ "index.html": HTML, "app.css": strToU8("body{}") }) });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  expect(await env.ASSETS.get(`a/${slug}/1/app.css`)).not.toBeNull();
  expect(await env.ASSETS.get(`orig/${slug}/1.zip`)).not.toBeNull();
});
test("invalid upload (no index.html in zip) → 400 with the validator's message, nothing persisted", async () => {
  const res = await upload("/admin/assets", { title: "bad" }, { name: "b.zip", bytes: zipSync({ "readme.txt": HTML }) });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("index.html");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM assets").first<{ n: number }>()).toMatchObject({ n: 0 });
});
test("new version + activate/rollback + download + delete flows", async () => {
  await upload("/admin/assets", { title: "t" }, { name: "a.html", bytes: HTML });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  await upload("/admin/assets/version", { slug }, { name: "b.html", bytes: strToU8("<!doctype html>v2") });
  expect((await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>())!.active_version).toBe(2);
  // rollback
  const ap = (f: Record<string, string>, path: string) => app.request(path, { method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(f).toString() }, AUTH);
  await ap({ slug, version: "1" }, "/admin/assets/activate");
  expect((await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>())!.active_version).toBe(1);
  // download active (single-file → the html)
  const dl = await app.request(`/admin/assets/download?slug=${slug}`, {}, AUTH);
  expect(dl.headers.get("content-disposition")).toContain(`${slug}-v1`);
  // delete inactive version 2, then the asset
  await ap({ slug, version: "2" }, "/admin/assets/delete-version");
  expect(await env.ASSETS.get(`a/${slug}/2/index.html`)).toBeNull();
  await ap({ slug, confirm: "1" }, "/admin/assets/delete");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM assets").first<{ n: number }>()).toMatchObject({ n: 0 });
  expect(await env.ASSETS.get(`a/${slug}/1/index.html`)).toBeNull();
});
test("asset mutations enforce CSRF and admin auth like every other admin mutation", async () => {
  const forged = await app.request("/admin/assets", { method: "POST", headers: { origin: "https://evil.example" }, body: new FormData() }, AUTH);
  expect(forged.status).toBe(403);
  const unauth = await app.request("/admin/assets", { method: "POST", headers: { origin: BASE }, body: new FormData() }, env);
  expect(await unauth.text()).toContain("invalid or has expired");
});
```

- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** Extract ALL page-rendering from `admin.ts` into `src/routes/adminView.ts` (exports `panelPage(opts, assets, codesRows, nowSec)` — signature gains `assets: Awaited<ReturnType<typeof listAssets>>`). Panel gains an **Assets** section between "Generate code" and "Codes": per asset one row (title, `<code>slug</code>`, active version, per-version mini-forms Activate/Download/Delete-version, Delete-asset form with a required `confirm` checkbox), plus the two upload forms (`/admin/assets` with title+file; `/admin/assets/version` with slug select+file; `enctype="multipart/form-data"` on both). The codes mint `<select>` options now come from `assets` (value slug, label `title (slug)`); orphan flag = `c.asset_title === null`. Routes in `admin.ts` (all POSTs behind the existing guards + `originOk`; the upload handlers):

```ts
// Shared render helpers — define ONCE in admin.ts; every route (codes + assets) uses them:
type Ctx = Context<{ Bindings: Env }>;
async function renderPanel(c: Ctx, extra: { error?: string; link?: { url: string; heading: string } } = {}, status = 200) {
  return c.html(panelPage(
    { ...extra, host: displayHost(c.env.PUBLIC_ORIGIN) },
    await listAssets(c.env.DB),
    await listCodes(c.env.DB),
    Math.floor(Date.now() / 1000),
  ), status as 200);
}
const panelError = (c: Ctx, error: string, status = 400) => renderPanel(c, { error }, status);

admin.post("/admin/assets", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const file = form.get("file");
  if (!title || !(file instanceof File)) return panelError(c, "title and file are required");
  if (file.size > LIMITS.uploadBytes) return panelError(c, "file too large");
  const data = new Uint8Array(await file.arrayBuffer()); // read ONCE; doubles as the orig-zip bytes
  let validated: ReturnType<typeof validateUpload>;
  try {
    validated = validateUpload(file.name, data);
  } catch (e) {
    return panelError(c, e instanceof UploadError ? e.message : "invalid upload");
  }
  const slug = await createAsset(c.env.DB, title);
  await storeVersion(c.env.ASSETS, slug, 1, validated.files, validated.isBundle ? data : null);
  await recordVersion(c.env.DB, slug, 1, validated.files.length, validated.files.reduce((n, f) => n + f.bytes.length, 0), true);
  return renderPanel(c);
});
```

`/admin/assets/version` is identical minus `createAsset` (validates `assetExists` FIRST — unknown slug ⇒ `panelError(c, "unknown asset")`; uses `nextVersion`). Activation semantics (exact, because checkbox absence is meaningful): the form carries `<input type="checkbox" name="draft" value="1">` labeled "Upload as draft — don't activate"; the handler calls `recordVersion(..., /* activate: */ form.get("draft") !== "1")`. Absent checkbox ⇒ activate (what the tests assume). New-asset uploads (v1) ALWAYS activate — no checkbox on that form. `activate`/`delete-version`/`delete` are small urlencoded forms calling the B3 repo + B5 object deletion (delete: require `confirm === "1"` else panel error; call `deleteAsset` THEN `deleteAssetObjects`). **Every one of these handlers wraps its repo call in try/catch → `panelError(c, e instanceof Error ? e.message : "failed")`** — `activateVersion` ("no such version") and `deleteVersion` ("cannot delete the active version") throw by design on forged/stale forms and MUST render as panel errors, never a 500. Add one negative route test: POST delete-version for the ACTIVE version → 400 panel error containing "active", D1 row still present. Download (GET, no originOk — read-only, admin-gated):

```ts
admin.get("/admin/assets/download", async (c) => {
  const slug = c.req.query("slug") ?? "";
  const v = Number(c.req.query("v") ?? NaN) || (await activeVersion(c.env.DB, slug));
  if (!v) return failurePage();
  const orig = await readOriginalZip(c.env.ASSETS, slug, v);
  const body = orig ?? (await readAssetFile(c.env.ASSETS, slug, v, "index.html"));
  if (!body) return failurePage();
  c.header("content-type", orig ? "application/zip" : "text/html; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${slug}-v${v}${orig ? ".zip" : ".html"}"`);
  return c.body(body.body);
});
```

`listCodes` becomes `SELECT codes.*, assets.title AS asset_title FROM codes LEFT JOIN assets ON assets.slug = codes.asset_slug ORDER BY codes.created_at DESC`; `CodeRow` gains `asset_title?: string | null`. `POST /admin/codes` unknown-slug check switches from `isKnownSlug(slug)` to `await assetExists(c.env.DB, slug)`. Seeding: file-wide `beforeEach(() => seedFixtureAsset())` in `adminPanel.test.ts` per the discipline above; `admin.test.ts` is NOT touched (its panel assertions are text-only and hold with zero assets).
- [ ] **Step 5:** Update ADMIN_STYLE for the new section (reuse existing `.field`/`.revoke`/table classes; add only what's needed) → csp.test prints new hashes → paste into `headers.ts`. Run FULL suite + tsc → green (the manifest-based select is gone; `findOrphans`/`readManifest` now unused by admin — leave the lib files for B8's deletion).
- [ ] **Step 6: Commit** — `feat(admin): asset manager UI — upload, versions, activate, download, delete`

### Task B7: Gate serves from R2 (+ subresource route)

**Files:**
- Modify: `src/routes/gate.ts` (whole serving path), `src/lib/codes.ts` (add `isValidSlug` — move from `src/lib/assets.ts`; gate + any other importer switches), `src/routes/gate.test.ts` (seed via `seedFixtureAsset`)
- Test: `src/routes/gate.test.ts` (append subresource + parity cases)

**Context:** keep EVERY existing gate invariant: env gate first; slug-shape check before DB; redeem precedence; rate-limit call ORDER unchanged; fail closed on any DB/R2 error; integrity alert only for "valid code but active version's object missing"; unpublished (`active_version` NULL) is a SILENT generic page. The cookie (`path=/a/<slug>`) already flows to subpaths.

- [ ] **Step 1: Failing tests** (append; seed with `seedFixtureAsset` which B6 added to this file's setup):

```ts
// Helper for these tests (add near the top of gate.test.ts — it does NOT already exist):
async function mintAndRedeem(): Promise<{ cookie: string }> {
  const raw = await createCode(env.DB, SLUG, "sub", null, env.CODE_VAULT_KEY);
  const r = await app.request(`/a/${SLUG}?code=${raw}`, { redirect: "manual" }, env);
  expect(r.status).toBe(302); // sanity: redemption must succeed before any subresource assertion
  return { cookie: r.headers.get("set-cookie")!.split(";")[0] };
}

test("bundle subresources served under a valid cookie; content-type from R2; revocation kills them instantly", async () => {
  await env.ASSETS.put(`a/${SLUG}/1/css/app.css`, "body{color:red}", { httpMetadata: { contentType: "text/css" } });
  const link = await mintAndRedeem();
  const css = await app.request(`/a/${SLUG}/css/app.css`, { headers: { cookie: link.cookie } }, env);
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toBe("text/css");
  expect(await css.text()).toBe("body{color:red}");
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await app.request(`/a/${SLUG}/css/app.css`, { headers: { cookie: link.cookie } }, env);
  expect(await denied.text()).toContain("invalid or has expired"); // instant revoke covers subresources
});
test("subresource WITHOUT a cookie, with a traversal path, or for a missing file → byte-identical generic failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  const link = await mintAndRedeem();
  for (const req of [
    app.request(`/a/${SLUG}/css/app.css`, {}, env),                                        // no cookie
    app.request(`/a/${SLUG}/%2e%2e%2f1%2findex.html`, { headers: { cookie: link.cookie } }, env), // ENCODED traversal — a literal ../ is URL-normalized away before routing and never reaches the guard
    app.request(`/a/${SLUG}/nope.css`, { headers: { cookie: link.cookie } }, env),         // missing object
  ]) expect(await (await req).text()).toBe(canonicalBody);
});
test("unpublished asset (active_version NULL): valid code redeems to the generic page, NO integrity alert", async () => {
  await env.DB.prepare("UPDATE assets SET active_version = NULL WHERE slug = ?1").bind(SLUG).run();
  const raw = await createCode(env.DB, SLUG, "x", null, env.CODE_VAULT_KEY);
  const res = await app.request(`/a/${SLUG}?code=${raw}`, { redirect: "manual" }, env);
  expect(res.status).toBe(200); // failure page, not a redirect — no cookie issued
  expect(await res.text()).toContain("invalid or has expired");
});
test("integrity alert: active version set but R2 object missing → generic page + structured error log", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // match the existing gate.test.ts pattern (pristine output)
  await env.ASSETS.delete(`a/${SLUG}/1/index.html`);
  const raw = await createCode(env.DB, SLUG, "x", null, env.CODE_VAULT_KEY);
  const res = await app.request(`/a/${SLUG}?code=${raw}`, { redirect: "manual" }, env);
  expect(await res.text()).toContain("invalid or has expired");
  expect(spy.mock.calls.some(([m]) => typeof m === "string" && m.includes('"asset_object_missing"'))).toBe(true);
  spy.mockRestore();
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement.** Move `isValidSlug` (and its regex) into `src/lib/codes.ts`; gate imports it from there and drops the `getAssetHtml` import. In the redeem branch, replace the module check with:

```ts
    const v = await activeVersion(c.env.DB, slug).catch(() => null);   // fail closed
    if (v === null) return failurePage();                              // unpublished/unknown: silent
    if ((await c.env.ASSETS.head(`a/${slug}/${v}/index.html`)) === null) {
      console.error(JSON.stringify({ level: "error", event: "asset_object_missing", slug, version: v, codeId: res.codeId }));
      return failurePage();                                            // integrity failure: loud, no cookie
    }
```

**Rate-limiter rewiring (load-bearing, do FIRST in this task):** `src/lib/ratelimit.ts` imports
`isKnownSlug` from the manifest module (B8 deletes it) to pick per-slug vs `unknown-slug` limiter
buckets. Replace with a D1-backed check INSIDE `gateLimitOk`'s existing fail-open try/catch,
preserving the two invariants stated in its comments: the lookup is unconditional for every
well-formed slug, and it only selects a KEY — it never branches the response.

```ts
// ratelimit.ts — slugKey takes the answer instead of the oracle:
export function slugKey(kind: "redeem" | "load", slug: string, known: boolean): string {
  return known ? `${kind}:${slug}` : `${kind}:unknown-slug`;
}
// gateLimitOk — resolve `known` from D1 inside the same fail-open try block:
export async function gateLimitOk(db: D1Database, kind: "redeem" | "load", slug: string): Promise<boolean> {
  try {
    const known = await assetExists(db, slug); // keying only — never branches the response (spec §9/§6)
    const [perSlug, global] = await Promise.all([
      bumpRateLimit(db, slugKey(kind, slug, known), WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return perSlug <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // FAIL OPEN — intentional (spec §9)
  }
}
```

Import `assetExists` from `./db/assetRepo`; drop the `isKnownSlug` import and the injectable
`known` default parameter. Update `slugKey` call sites/tests (`grep -rn "slugKey" src/`) to pass a
boolean; `badShapeLimitOk` is untouched (it never keyed by slug).

Clean-load branch: same `activeVersion` + `readAssetFile(env.ASSETS, slug, v, "index.html")`; on hit set `ASSET_CSP` + the object's content type and `return c.body(obj.body)`; on MISS (valid cookie, active version set, object gone) log the SAME `asset_object_missing` structured error and return `failurePage()` — the §13 integrity alert covers both branches, exactly as the module check does today. New route AFTER the existing one:

```ts
gate.get("/a/:slug/*", async (c) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) { await badShapeLimitOk(c.env.DB); return failurePage(); }
  // No ?code= redemption on subpaths (design §3): redemption is single-entry at /a/:slug.
  const token = getCookie(c, cookieName(slug));
  const claims = token ? await verifyAssetToken(token, slug, parseKeyRing(c.env.ASSET_COOKIE_SECRET)) : null;
  if (!claims) { await gateLimitOk(c.env.DB, "load", slug); return failurePage(); }
  if (!(await recheck(c.env.DB, claims.codeId, slug))) return failurePage(); // instant revoke
  const v = await activeVersion(c.env.DB, slug).catch(() => null);
  if (v === null) return failurePage();
  let path: string;
  try {
    path = decodeURIComponent(c.req.path.slice(`/a/${slug}/`.length));
  } catch {
    return failurePage(); // malformed %-encoding is the generic page, never a 500
  }
  const obj = await readAssetFile(c.env.ASSETS, slug, v, path).catch(() => null); // store re-guards traversal
  if (!obj) return failurePage(); // missing subresource: silent generic page (parity)
  if (obj.httpMetadata?.contentType?.startsWith("text/html")) c.header("content-security-policy", ASSET_CSP);
  c.header("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
  return c.body(obj.body);
});
```

- [ ] **Step 4:** Register the file-wide `beforeEach(() => seedFixtureAsset())` (see B6's seeding discipline) and update the existing gate tests that asserted fixture HTML content (the served bytes now come from `seedFixtureAsset`'s html). **DELETE the existing test `"valid code + MISSING asset module → generic page + alert + NO cookie (spec §13)"`** — its setup (a code whose slug has NO assets row) lands on B7's SILENT unpublished path by design, so the test's alert assertion is semantically obsolete, not renamable; its coverage is replaced by this task's new "unpublished → silent" + "integrity alert" tests. Then grep the repo for `asset_module_missing` — zero hits when done. FULL suite + tsc → green. Header-contract tests must pass unchanged for the new route class (the finalizing middleware applies to it automatically — verify via the existing SELF header test pattern, add the subresource class to it).
- [ ] **Step 5: Commit** — `feat(gate): serve assets from R2; cookie-checked bundle subresources`

### Task B8: Retire the bundling pipeline

**Files:**
- Delete: `src/lib/manifest.ts`, `src/lib/manifest.test.ts`, `src/lib/assets.ts`, `.generated/` (both files), `assets/testasset0000000000000/`, `scripts/build-manifest.mjs`, `scripts/new-asset.mjs`
- Create: `scripts/lint-config.mjs`
- Modify: `scripts/manifest-lib.mjs` (slim to the two config lints + keep their tests), `package.json` (scripts), `.github/workflows/deploy.yml` (both jobs), `README.md`

**Ordering:** ONLY after B6+B7 are green — nothing may import the deleted modules (`grep -rn "manifest\|\.generated\|getAssetHtml\|assets-modules" src scripts` must return only the new lint files).

- [ ] **Step 1:** `scripts/lint-config.mjs` (the two invariants keep their teeth):

```js
import { readFileSync } from "node:fs";
import { hasAssetsKey, hasDevBypass } from "./manifest-lib.mjs";
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
if (hasAssetsKey(raw)) { console.error("FATAL: wrangler.jsonc must NEVER contain an \"assets\" key (spec §4/§7)."); process.exit(1); }
if (hasDevBypass(raw)) { console.error("FATAL: ACCESS_DEV_BYPASS must never appear in committed config (.dev.vars only)."); process.exit(1); }
console.log("config lints OK");
```

- [ ] **Step 2:** `package.json` scripts: drop `new-asset` + `build-manifest`; add `"lint-config": "node scripts/lint-config.mjs"`; `"deploy": "npm run lint-config && wrangler deploy"`. Slim `manifest-lib.mjs` to `hasAssetsKey`/`hasDevBypass` (keep their existing unit tests, delete the rest — the title/slug/dup helpers die with the generator). Test files (verified locations): the `hasAssetsKey`/`hasDevBypass` tests live in `src/lib/build/manifest-lib.test.ts` (already importing `../../../scripts/manifest-lib.mjs`, already covered by the vitest include) — SLIM that file to just the two lint-fn describe blocks (its `extractTitle`/`externalOriginHits`/`validateSlug`/`firstDuplicate` tests die with the generator). DELETE `src/lib/manifest.test.ts` outright (it tests only `findOrphans`/`isKnownSlug`, both gone).
- [ ] **Step 3:** `deploy.yml`: in BOTH jobs replace `- run: npm run build-manifest` with `- run: npm run lint-config`; DELETE the `- run: git diff --exit-code .generated` step (test job). Delete the files listed above. In `wrangler.jsonc`: DELETE the now-dead Text-module `rules` block (the `{ "type": "Text", "globs": ["**/*.html"] … }` entry near the top) and update the bottom invariant comment `"The build lints this (Task 6.2)"` → `"scripts/lint-config.mjs lints this in CI"`. Update README's publish flow (now: admin panel upload; git is app-code only).
- [ ] **Step 4:** `grep` check from the ordering note → clean. FULL suite + tsc + `npx wrangler deploy --dry-run --env production` → green.
- [ ] **Step 5: Commit** — `feat(assets)!: retire git/CI asset bundling — content lives in R2 only`

### Task B9: Docs, spec amendments, live verification

**Files:**
- Modify: spec §7/§13 (amendment banners pointing at the design doc), `docs/pitfalls/implementation-pitfalls.md` ("Confidential manifest is a generated MODULE" → AMENDED banner: manifest is now D1+R2; the `assets`-key ban and no-static-surface invariants unchanged), `docs/deploy/SETUP.md` (publish runbook §, bucket creation §2.2 finalized), `docs/HANDOFF.md` if still referenced
- No code.

- [ ] **Step 1:** Write the amendments (each a short banner: what changed, date, link to design doc — do NOT rewrite history sections). This includes the pitfalls entry "NEVER add an `assets` key…", whose enforcement pointer currently names `scripts/build-manifest.mjs` — repoint it at `scripts/lint-config.mjs` (the invariant itself is unchanged).
- [ ] **Step 2:** Update this plan's Execution Status (contract above) and commit — `docs: spec/pitfalls/setup amendments for R2 asset manager`.
- [ ] **Step 3: Live verification (owner-assisted where Access is needed).** After merge+deploy: create buckets (if not yet), then owner runs: `/admin` → upload a small test HTML → mint code → open link (content renders from R2) → upload a v2 → verify it serves → rollback to v1 → verify → Download returns the file → revoke + delete → link shows the generic page. Record results in this plan.

### Phase B group review

- [ ] After B1–B9: ≥3 review rounds from distinct perspectives (security: subresource auth/traversal/CSP/content-type; parity: every new failure path byte-identical; spec-conformance: amendments complete + no `assets` key + no public bucket; ops: migration order, bucket runbook, CI green). Keep going past 3 rounds until one is clean. Update banners + table; PR `dev → main`.

---

## Phase C — Public assets + /about (owner-requested 2026-07-03)

**Execution Status:** ⬜ NOT STARTED

Runs strictly AFTER Phase B (it extends the asset manager). Design: design doc §Part C. The two
schema columns (`is_public`, `public_alias`) ship inside Phase B's migration 0004 (B1) since that
migration is unshipped — Phase C adds NO migration.

### Task C1: Public toggle + alias in the repo and admin UI

**Files:**
- Modify: `src/lib/db/assetRepo.ts` (AssetRow fields + setPublic/setAlias/publicAssetBySlug/publicAssetByAlias), `src/routes/admin.ts` (two POST routes), `src/routes/adminView.ts` (per-asset Public checkbox form + alias input form), `src/lib/ui/styles.ts` if styles change (re-hash!)
- Test: `src/lib/db/assetRepo.test.ts`, `src/routes/adminAssets.test.ts` (append)

- [ ] **Step 1: Failing repo tests** (append to `assetRepo.test.ts`):

```ts
test("setPublic toggles; publicAssetBySlug returns only public+published assets", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // not public yet
  await setPublic(env.DB, slug, true);
  expect((await publicAssetBySlug(env.DB, slug))!.active_version).toBe(1);
  await setPublic(env.DB, slug, false);
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // instant un-publish
  await setPublic(env.DB, slug, true);
  await env.DB.prepare("UPDATE assets SET active_version = NULL WHERE slug = ?1").bind(slug).run();
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // public but unpublished ⇒ null
});
test("setAlias validates shape, reserved names, uniqueness; publicAssetByAlias resolves", async () => {
  const a = await createAsset(env.DB, "a");
  const b = await createAsset(env.DB, "b");
  await recordVersion(env.DB, a, 1, 1, 10, true);
  await setPublic(env.DB, a, true);
  await setAlias(env.DB, a, "about");
  expect((await publicAssetByAlias(env.DB, "about"))!.slug).toBe(a);
  for (const bad of ["Admin", "a", "admin", "robots.txt", "favicon.ico", "cdn-cgi", "UPPER", "has space", "x".repeat(33), "sla/sh"]) {
    await expect(setAlias(env.DB, b, bad)).rejects.toThrow();
  }
  await expect(setAlias(env.DB, b, "about")).rejects.toThrow(/taken|UNIQUE/i); // duplicate
  await setAlias(env.DB, a, null); // clearing works
  expect(await publicAssetByAlias(env.DB, "about")).toBeNull();
});
test("alias on a NON-public asset does not resolve", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await setAlias(env.DB, slug, "hidden");
  expect(await publicAssetByAlias(env.DB, "hidden")).toBeNull(); // alias parked, not served
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** in `assetRepo.ts` (AssetRow gains `is_public: number; public_alias: string | null;`):

```ts
export const ALIAS_RE = /^[a-z0-9-]{1,32}$/;
// "a"/"admin" collide with app routes; robots/favicon are well-known; cdn-cgi is Cloudflare-reserved.
export const RESERVED_ALIASES = new Set(["a", "admin", "robots.txt", "favicon.ico", "cdn-cgi"]);

export async function setPublic(db: D1Database, slug: string, isPublic: boolean): Promise<void> {
  await db.prepare("UPDATE assets SET is_public = ?2, updated_at = unixepoch() WHERE slug = ?1")
    .bind(slug, isPublic ? 1 : 0).run();
}

export async function setAlias(db: D1Database, slug: string, alias: string | null): Promise<void> {
  if (alias !== null) {
    if (!ALIAS_RE.test(alias) || RESERVED_ALIASES.has(alias)) throw new Error("invalid or reserved alias");
    try {
      await db.prepare("UPDATE assets SET public_alias = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, alias).run();
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new Error("alias already taken");
      throw e;
    }
    return;
  }
  await db.prepare("UPDATE assets SET public_alias = NULL, updated_at = unixepoch() WHERE slug = ?1").bind(slug).run();
}

/** Public + published only — the single oracle both public routes use (fail closed on null). */
export async function publicAssetBySlug(db: D1Database, slug: string): Promise<{ active_version: number } | null> {
  return await db.prepare(
    "SELECT active_version FROM assets WHERE slug = ?1 AND is_public = 1 AND active_version IS NOT NULL",
  ).bind(slug).first<{ active_version: number }>();
}

export async function publicAssetByAlias(db: D1Database, alias: string): Promise<{ slug: string; active_version: number } | null> {
  return await db.prepare(
    "SELECT slug, active_version FROM assets WHERE public_alias = ?1 AND is_public = 1 AND active_version IS NOT NULL",
  ).bind(alias).first<{ slug: string; active_version: number }>();
}
```

- [ ] **Step 4: Admin routes** (in `admin.ts`, same guard/CSRF pattern as every other mutation):

```ts
admin.post("/admin/assets/public", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  await setPublic(c.env.DB, slug, form.get("public") === "1");
  return renderPanel(c);
});

admin.post("/admin/assets/alias", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  const raw = String(form.get("alias") ?? "").trim();
  try {
    await setAlias(c.env.DB, slug, raw === "" ? null : raw);
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "invalid alias");
  }
  return renderPanel(c);
});
```

UI (adminView.ts, per asset row): a Public form — checkbox named `public` value `1`, checked from
`a.is_public === 1`, submit button "Apply" (checkbox absence = make private; that is the standard
uncheck-to-disable semantics and the handler reads `=== "1"`); an alias form — text input named
`alias` prefilled `a.public_alias ?? ""` + submit "Set alias" (empty = clear). When public+alias,
render the served path as text, e.g. `<code>/about</code> (public)`.
- [ ] **Step 5: Failing route tests** (append to `adminAssets.test.ts`): toggle on via POST → `assets.is_public = 1` in D1; reserved alias via POST → 400-class panel error, D1 unchanged; CSRF cross-origin on both routes → 403.
- [ ] **Step 6:** Full suite + tsc → green. If styles changed, re-hash (csp test prints). **Commit** — `feat(assets): public toggle + alias (repo, admin routes, panel UI)`

### Task C2: Gate serves public assets; alias routes

**Files:**
- Create: `src/routes/publicAsset.ts` (shared serve helper + alias router)
- Modify: `src/routes/gate.ts` (public short-circuit in both routes), `src/index.ts` (mount alias routes LAST, before notFound)
- Test: `src/routes/publicAsset.test.ts` (new), `src/routes/gate.test.ts` (append public cases)

**Ordering/shadowing invariant (do NOT deviate):** alias routes are mounted AFTER `gate` and
`admin` in `src/index.ts` so `/a/*`, `/admin*`, `/`, `/robots.txt` always win; reserved-name
validation in C1 is the second, independent layer.

- [ ] **Step 1: Failing tests** — `src/routes/publicAsset.test.ts`:

```ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import app from "../index";
import { FIXTURE_SLUG, seedFixtureAsset } from "../test/seedAsset";
import { setAlias, setPublic } from "../lib/db/assetRepo";

async function seedPublic(alias?: string) {
  await seedFixtureAsset();
  await setPublic(env.DB, FIXTURE_SLUG, true);
  if (alias) await setAlias(env.DB, FIXTURE_SLUG, alias);
}

test("public asset serves at /a/<slug> with NO code and NO cookie; toggling off restores the gate instantly", async () => {
  await seedPublic();
  const res = await app.request(`/a/${FIXTURE_SLUG}`, {}, env);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("fixture ok");
  expect(res.headers.get("set-cookie")).toBeNull();               // public path issues nothing
  expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'"); // ASSET_CSP applied
  await setPublic(env.DB, FIXTURE_SLUG, false);
  expect(await (await app.request(`/a/${FIXTURE_SLUG}`, {}, env)).text()).toContain("invalid or has expired");
});
test("public bundle subresources serve without a cookie", async () => {
  await seedPublic();
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/app.css`, "body{}", { httpMetadata: { contentType: "text/css" } });
  const res = await app.request(`/a/${FIXTURE_SLUG}/app.css`, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/css");
});
test("alias route serves the active version at /<alias> and /<alias>/<path>", async () => {
  await seedPublic("about");
  expect(await (await app.request("/about", {}, env)).text()).toContain("fixture ok");
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/x.css`, "i{}", { httpMetadata: { contentType: "text/css" } });
  expect((await app.request("/about/x.css", {}, env)).status).toBe(200);
});
test("unknown alias, non-public alias, malformed alias → byte-identical generic failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  await seedFixtureAsset();
  await setAlias(env.DB, FIXTURE_SLUG, "parked"); // NOT public
  for (const path of ["/nope", "/parked", "/UPPER", "/x%00y"]) {
    expect(await (await app.request(path, {}, env)).text()).toBe(canonicalBody);
  }
});
test("?code= on a public asset serves publicly (no cookie minted, code not consumed)", async () => {
  await seedPublic();
  const res = await app.request(`/a/${FIXTURE_SLUG}?code=whatever`, { redirect: "manual" }, env);
  expect(res.status).toBe(200);                                   // served directly, not a 302 redeem
  expect(res.headers.get("set-cookie")).toBeNull();
  const n = await env.DB.prepare("SELECT count(*) AS n FROM codes WHERE use_count > 0").first<{ n: number }>();
  expect(n!.n).toBe(0);
});
test("fixed routes always win over aliases (defense in depth beyond reserved-name validation)", async () => {
  await seedPublic("about");
  expect(await (await app.request("/robots.txt", {}, env)).text()).toContain("Disallow");
  expect((await app.request("/", {}, env)).status).toBe(200);     // root identity page, not an asset
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** — `src/routes/publicAsset.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { ASSET_CSP } from "../lib/http/headers";
import { servesTraffic } from "../lib/envgate";
import { ALIAS_RE, publicAssetByAlias } from "../lib/db/assetRepo";
import { readAssetFile } from "../lib/content/store";

/** Streams one file of a PUBLIC asset version. Shared by the gate's public short-circuit and the
 *  alias routes. Fail closed: any miss/error is the generic page (byte parity). */
export async function servePublicFile(env: Env, slug: string, version: number, path: string): Promise<Response> {
  const obj = await readAssetFile(env.ASSETS, slug, version, path).catch(() => null);
  if (!obj) return failurePage();
  const headers = new Headers({ "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" });
  if (obj.httpMetadata?.contentType?.startsWith("text/html")) headers.set("content-security-policy", ASSET_CSP);
  return new Response(obj.body, { status: 200, headers });
}

/** Alias routes — mounted LAST in index.ts (after gate + admin), so fixed routes always win. */
export const publicAlias = new Hono<{ Bindings: Env }>();

async function aliasHandler(c: { env: Env; req: { param: (k: string) => string; path: string } }): Promise<Response> {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  const alias = c.req.param("alias");
  if (!ALIAS_RE.test(alias)) return failurePage();
  const hit = await publicAssetByAlias(c.env.DB, alias).catch(() => null);
  if (!hit) return failurePage();
  let sub = c.req.path.slice(`/${alias}`.length).replace(/^\//, "");
  try {
    sub = decodeURIComponent(sub);
  } catch {
    return failurePage();
  }
  return servePublicFile(c.env, hit.slug, hit.active_version, sub === "" ? "index.html" : sub);
}
publicAlias.get("/:alias", aliasHandler);
publicAlias.get("/:alias/*", aliasHandler);
```

`gate.ts` — in BOTH routes, immediately after the slug-shape check (BEFORE any code/cookie
logic — public wins over a present `?code=`):

```ts
  const pub = await publicAssetBySlug(c.env.DB, slug).catch(() => null);
  if (pub) return servePublicFile(c.env, slug, pub.active_version, /* index or decoded subpath */);
```

(`/a/:slug` passes `"index.html"`; `/a/:slug/*` passes its already-decoded `path`.) `index.ts` —
after `app.route("/", admin);` add `app.route("/", publicAlias);` (keep `app.notFound` last).
- [ ] **Step 4:** Full suite + tsc → green (existing gated tests MUST pass unchanged — assets default non-public). **Step 5: Commit** — `feat(gate): public assets serve without codes; alias routes (/about-style)`

### Task C3: Architecture explainer asset (/about)

**Files:**
- Create: `docs/assets-src/about/index.html` (committed SOURCE — public content, safe in the public repo)
- No app code. TDD does not apply (content, not production code); verify by local upload + browser.

- [ ] **Step 1:** Build the page: single self-contained HTML explaining this app's architecture —
fun and educational (owner brief). Constraints: works under ASSET_CSP (inline `<style>`/`<script>`
allowed there; NO external resources of any kind), self-contained, dark-mode aware, mobile-safe.
Content beats: what the site is; the one-Worker + D1 + R2 shape; how a share link redeems
(atomic UPDATE → signed cookie → per-request re-check = instant revocation); why every failure
looks identical (enumeration resistance); Cloudflare Access on /admin; the public-asset toggle
that makes this very page visible. Tone: playful diagrams-in-CSS, no marketing.
- [ ] **Step 2:** Local verify: `wrangler dev` → upload via the admin panel (file, title
"How this site works") → toggle Public → alias `about` → browser-check `/about` renders, CSP
clean, dark/light, 375px.
- [ ] **Step 3: Production publish** (after Phase B+C deploy): preferred path is the owner
uploading through `/admin` (60 seconds). CLI fallback IF wrangler auth allows: `wrangler r2 object put
artifact-share-prod/a/<slug>/1/index.html --file docs/assets-src/about/index.html
--content-type "text/html; charset=utf-8" --remote` + `wrangler d1 execute artifact-share-prod --remote --command
"INSERT INTO assets (slug,title,active_version,is_public,public_alias) VALUES ('<minted-slug>','How this site works',1,1,'about'); INSERT INTO asset_versions (slug,version,file_count,total_bytes) VALUES ('<minted-slug>',1,1,<bytes>);"`
(mint the 22-char slug locally with `node -e "..."` per `src/lib/codes.ts` token128). If auth
lacks scope → leave the owner note in the morning report; do NOT block the merge on it.
- [ ] **Step 4: Commit** — `docs(assets-src): architecture explainer page (/about source)`

### Task C4: README rewrite

**Files:**
- Modify: `README.md`
- No app code; MUST be written via the `stop-slop` skill (owner instruction).

- [ ] **Step 1:** Rewrite README.md for the post-R2 reality: what the site is, how sharing works
(mint → send → revoke/expire; Show link), how publishing works (admin upload, versions, public
toggle, /about), local dev quickstart (.dev.vars, wrangler dev, npm test), deploy flow (dev →
preview, main → production, CI), pointers to spec/design/plan/pitfalls/SETUP/git-strategy.
Honest and concrete; no feature-list inflation. Run it through `stop-slop`.
- [ ] **Step 2: Commit** — `docs: rewrite README for the R2 asset manager era`

### Phase C group review

- [ ] After C1–C4: ≥3 adversarial rounds (lenses: alias shadowing/enumeration posture, public↔gated
toggle races, parity of every new failure path, CSP on served HTML, docs accuracy). Blind
subagents alternate with self-review until a round is clean. Update banners + table; this phase
merges with (or right after) Phase B's PR.

---

## Self-review (author, 2026-07-03)

- Spec coverage: recoverable codes (A1–A5 = design §2 incl. pre-vault UX + pitfall amendment); public assets + alias + /about + README (C1–C4 = design §Part C); R2 manager (B1–B9 = design §3: storage layout incl. orig/, schema, upload+zip safety, versioning/rollback, download, delete+auto-revoke, gate+subresources, retirement, bucket/no-public posture, integrity alert re-point, fixture-to-seeding move). Deviation from design recorded inline: caps lowered for isolate memory (B4).
- Placeholder scan: clean — every code step ships real code; the two "adapt existing tests" steps name the exact files and what changes.
- Type consistency: `createCode(db, slug, label, expiry, vaultRing, gen?)` used identically in A4/A5/B3/B7 tests; `panelPage(opts, assets, codes, nowSec)` change confined to B6; `UploadFile`/`LIMITS` names match B4↔B5↔B6; `activeVersion` returns `number | null` everywhere.
