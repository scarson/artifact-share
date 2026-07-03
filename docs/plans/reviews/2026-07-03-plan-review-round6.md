# Adversarial Plan Review — Round 6 (independent, convergence check)

**Plan:** `docs/plans/2026-07-03-asset-manager-r2-and-recoverable-codes-plan.md`
**Scope:** (1) verify every round-4 finding's fix landed and is itself correct — trailing-slash canonicalization (B7/C2) scrutinized hardest; (2) fresh sweep. Claims verified against real code: `src/routes/gate.ts` (cookie path, redirect), `src/routes/gate.test.ts`, `src/lib/ratelimit.ts` + `src/lib/ratelimit.test.ts`, `src/routes/adminPanel.test.ts`, `src/lib/db/adminRepo.test.ts`, `vitest.config.ts`, `src/index.ts`, `src/lib/http/headers.ts`, `migrations/0001_init.sql`, `src/test/apply-migrations.ts`, plus a live routing probe against the installed Hono 4.12.27.

**Verdict: NOT converged — 2 substantive findings (one HIGH cluster, one C2 test/order contradiction), plus 3 minor residuals.** The trailing-slash fix is the right design and its foundations check out (cookie path-matching, redirect-only-post-auth, Hono wildcard empty-tail matching all verified real), but the fix was applied unevenly: two prose blocks and two code snippets that predate it were left contradicting it, and two C2 tests assert the pre-fix behavior.

---

## Substantive findings

### 1. [B7 — HIGH — self-contradictory instructions for the bare-path document + wildcard route] The trailing-slash fix landed in B7's bullet list but NOT in B7's implementation paragraphs/snippets

Three mutually inconsistent instructions coexist inside Task B7:

- **(a) Clean-load paragraph vs. canonicalization bullet.** The trailing-slash block (plan ~line 1098) says an authorized bare `/a/:slug` document request "302-redirects to `/a/${slug}/` **instead of serving a body**". But the "Clean-load branch:" paragraph (~line 1203) still instructs the pre-fix behavior verbatim: "same `activeVersion` + `readAssetFile(env.ASSETS, slug, v, "index.html")`; on hit set `ASSET_CSP` + the object's content type and `return c.body(obj.body)`; on MISS … log … `asset_object_missing`". These are mutually exclusive implementations of the same branch. C2's "Final handler order (exact — do not reorder)" confirms the 302 is the intended end state ("cookie verify → recheck → 302 to `/a/${slug}/` (canonicalize; the body serves from the wildcard route)"), so the clean-load paragraph is a stale pre-fix leftover — but a fresh B7 executor has no way to know which block wins, and the paragraph is the one shaped like implementation guidance.
- **(b) Wildcard snippet does not implement B7's own empty-tail bullet.** The bullet mandates "the `/a/:slug/*` handler treats an EMPTY decoded tail as `index.html`", but the concrete `/a/:slug/*` snippet (~lines 1206–1228) — which an executor will copy verbatim — computes `path = decodeURIComponent(c.req.path.slice(...))`, and for `GET /a/<slug>/` that yields `""`, which `safePath` rejects (`path.length > 0`) → failure page **for a valid cookie holder**. Verified against Hono 4.12.27 that `/a/<slug>/` does route to `/a/:slug/*` with an empty tail, so the snippet is the only thing standing between the design and a working document serve. Mitigation exists but is accidental: the existing happy-path test (gate.test.ts:40, `SELF.fetch` follows the redeem 302 with the cookie) would fail against the unmodified snippet — the executor would be debugging a contradiction rather than following the plan.
- **(c) The clean-load integrity alert silently loses its home.** Under the 302 design, the old clean-load `asset_object_missing` alert (today's gate.ts:82–88) must move to the wildcard route's index.html miss. That placement appears ONLY in C2's final-order parenthetical ("miss on `index.html` ⇒ integrity log; miss on any other path ⇒ silent failure page") — a Phase C task whose stated gate.ts change is just the public short-circuit. B7's wildcard snippet treats **every** miss silently ("missing subresource: silent generic page (parity)"), and no B7 test pins the wildcard/index.html alert (B7's integrity test goes through the `?code=` redeem branch, which has its own `head()` check). Net: between B7 ship and C2 ship — and permanently, if the executor treats C2's parenthetical as descriptive — a published asset whose `index.html` object vanishes fails silently for cookie-holding visitors. That is a spec §13 coverage regression vs. today's code.
- **(d) The mandated trailing-slash test exists only as a bullet.** "add a test: `GET /a/${slug}/` → 200 html AND `GET /a/${slug}/css/app.css` under the same cookie → 200" is in the bullet list but absent from B7 Step 1's test block, which is presented as the tests to write. Executors who treat the code block as canonical skip the one test that pins the whole canonicalization design.

**Fix:** rewrite the "Clean-load branch" paragraph to: valid cookie + recheck pass on bare `/a/:slug` → `return c.redirect(\`/a/${slug}/\`, 302)` (no R2 access on the bare route outside the redeem branch's head-check). Update the wildcard snippet: after decode, `if (path === "") path = "index.html";`, and on `readAssetFile` miss log `asset_object_missing` **iff** `path === "index.html"` (with `codeId: claims.codeId`), else silent. Move the trailing-slash test into the Step 1 block. Add one sentence to Step 4: existing clean-load tests using `app.request` at bare `/a/<slug>` with a valid cookie now expect a 302 (SELF.fetch-based tests follow it automatically).

### 2. [C2 — HIGH — tests contradict the task's own "exact" handler order] Two C2 tests assert the pre-canonicalization behavior at bare `/a/<slug>`, and the C2 gate snippet does too

C2's "Final handler order (exact — do not reorder)" states the bare route's public short-circuit "resolves → **302 to `/a/${slug}/`**". But:

- The C2 gate snippet (~line 1546) says "in BOTH routes … `if (pub) return servePublicFile(c.env, slug, pub.active_version, …)`" — i.e., the bare route serves the body directly. Contradicts the final order.
- Test 1 (`public asset serves at /a/<slug> with NO code and NO cookie`) does `app.request(\`/a/${FIXTURE_SLUG}\`)` and asserts `status 200` + body `"fixture ok"` + ASSET_CSP + no set-cookie. `app.request` does **not** follow redirects, so under the mandated 302 this test fails as written.
- Test 5 (`?code= on a public asset serves publicly`) asserts `res.status).toBe(200); // served directly, not a 302 redeem` at the bare path — same contradiction (under the final order it's a 302 that is *also* not a redeem, which is the actual invariant the test wants).

Whichever side the executor satisfies, something mandated breaks: satisfy the tests → public bundles loaded at `/a/<slug>` get RFC 3986-broken relative resolution (the exact bug the round-4/5 fix targeted), and the slug-form behavior diverges from the alias-form behavior (alias bare correctly 302s, test 3) for the *same* asset; satisfy the order → two written tests fail. Note the plan's own header-contract test (test 6) already uses the slash form `/a/${FIXTURE_SLUG}/` — the inconsistency is within one test file.

**Fix:** align on the 302 (matches B7's rationale and the alias behavior). Snippet: bare route public branch returns `302 → /a/${slug}/`; wildcard route's public branch calls `servePublicFile(..., tail === "" ? "index.html" : tail)`. Test 1: request `/a/${FIXTURE_SLUG}/` for the 200/body/CSP assertions and add `expect((await app.request(\`/a/${FIXTURE_SLUG}\`, { redirect: "manual" }, env)).status).toBe(302)` with Location `/a/${FIXTURE_SLUG}/`. Test 5: assert 302 + Location `/a/${FIXTURE_SLUG}/` + no set-cookie + `use_count` still 0 (the code-not-consumed invariant survives unchanged; `use_count` verified present in migration 0001).

### 3. [B4 — LOW — snippet fails tsc] The cap test uses the `UploadLimits` type without importing it

Round-4 F2's fix introduced `const tiny: UploadLimits = { … }` in the B4 test, but the test file's import line is still `import { UploadError, validateUpload } from "./validate";` — `UploadLimits` is unimported → `tsc` error at the first TDD run. Trivial (add it to the import), but it is the same compile-break class F2 flagged, introduced by F2's own fix. **Fix:** `import { UploadError, validateUpload, type UploadLimits } from "./validate";`

### 4. [B9 — LOW — stale cross-reference undoes round-4 F10] B9's Files list still says "bucket creation §2.2 finalized"

B2 Step 4 correctly landed F10's fix ("document outcome in a NEW SETUP.md section (e.g. '§2b — R2 buckets'; §2.2 already exists as the migrations step — do not collide)"), but B9's Files header (~line 1262) still reads `docs/deploy/SETUP.md (publish runbook §, bucket creation §2.2 finalized)` — pointing the B9 executor back at the colliding section. **Fix:** change to "§2b (or whatever section B2 created) finalized".

---

## Minor residuals (not blockers)

- **[A5 — INFO] Round-4 F13 did not land.** A5's context line still claims "existing tests grep the mint heading" — verified false: `adminPanel.test.ts` contains no assertion on "Copy this link now" (grep clean; only the `?code=` regex and origin checks). Direction is conservative (keeping the heading byte-exact costs nothing), but the plan asserts a nonexistent test.
- **[B7 — INFO] "its stale 'not in manifest' comment" is slightly misattributed** — the comment lives in the *spray* test (`ratelimit.test.ts:35`), not the per-slug-limit test the sentence is about. A grep for the string finds it; no executor failure expected.
- **[Execution Status — OBSERVATION] The plan's banners are stale against this branch:** Tasks A1–A4 are already committed here (`36bc1b7`, `6658d6f`, `20ef77b`, `44d4d4c`; `src/lib/vault.ts`, migration 0003, env/config plumbing, and the A4 adminRepo changes all exist and match the plan), yet the Execution Status table and Phase A banner still say "⬜ Not started". Per the plan's own Living Document Contract this must be flipped before any further dispatch, or a fresh executor will re-claim Phase A.

---

## Round-4 findings — fix verification (1–13)

| # | Round-4 finding | Landed? | Notes |
|---|---|---|---|
| 1 | Trailing-slash relative-resolution break | **Partial** | Design fix is correct and verified: cookie `Path=/a/<slug>` (gate.ts:60) path-matches `/a/<slug>/…` per RFC 6265 (no cookie change needed — claim TRUE); redirect only post-auth (no oracle — gated failures stay byte-identical, alias enumeration is public-by-design); Hono 4.12.27 verified: `/a/<slug>/` routes to `/a/:slug/*` with empty tail, `/:alias` + `/:alias/*` match `/about` and `/about/`, encoded traversal survives to the guard un-normalized. **But** the fix was not propagated into B7's clean-load paragraph, B7's wildcard snippet, C2's gate snippet, or C2 tests 1/5 → Findings 1–2 above. |
| 2 | `typeof LIMITS` literal-type compile break | **Yes** | `UploadLimits` interface + `LIMITS: UploadLimits` + `limits: UploadLimits = LIMITS`; test's `tiny` typed to the interface. New nit: missing type import (Finding 3). |
| 3 | `/a/:slug/*` public-check insertion self-contradiction | **Yes** | "Final handler order (exact)" spells the full sequence (decode → empty-tail → public → cookie → recheck → activeVersion → read); traversal backstop flows through `servePublicFile → readAssetFile`. Order itself is coherent; B7-snippet mismatch folded into Finding 1. |
| 4 | Non-discriminating CSP assertion | **Yes** | Now asserts `script-src 'self' 'unsafe-inline'` — verified present in `ASSET_CSP` and absent from `ADMIN_CSP` (hash-pinned) in `headers.ts`. Cannot pass on the wrong header. |
| 5 | Phase C classes missing from header-contract coverage | **Yes** | C2 test 6 asserts the header set on public-200, alias-200, alias-failure. (Nit: omits `pragma` vs. gate.test.ts's `expectFullHeaderSet` — harmless, middleware sets the block atomically.) B7 Step 4 adds the subresource class to the existing SELF test (helper verified at gate.test.ts:15). |
| 6 | `aliasHandler` hand-rolled context type | **Yes** | Now `Context<{ Bindings: Env }, "/:alias" \| "/:alias/*">`; raw-path slicing with the percent-encoding comment landed; decode failures → failure page. |
| 7 | Known-slug bucket coverage lost | **Yes** | B7 rate-limiter paragraph now mandates seeding an assets row in the per-slug test + asserting the literal `redeem:<slug>` key. Rewiring verified against real `ratelimit.ts` (fail-open scope, key-only lookup, `badShapeLimitOk` untouched, `slugKey` call sites match). |
| 8 | `seedFixtureAsset` idempotency + C2 gate.test.ts ambiguity | **Yes** | `INSERT OR IGNORE` ×2 with rationale comment; R2 put stays an overwrite; C2 now states "gate.test.ts is NOT touched in C2" and all Phase C route tests live in `publicAsset.test.ts`. |
| 9 | Undefined `SLUG`/imports in adminRepo.test.ts | **Yes** | Plan adds the constant + imports; moreover A4 is already executed on this branch and the real file has `decryptCode`, `getCodeEnc`, `hashCode` imports and the tests passing shape. |
| 10 | SETUP.md §2.2 collision | **Partial** | B2 fixed ("§2b … do not collide"); B9's Files line still says §2.2 → Finding 4. |
| 11 | `html.d.ts` + grep survivors | **Yes** | `src/types/html.d.ts` in B8's delete list with rationale; the three expected grep survivors enumerated verbatim. |
| 12 | Upload handler raw-500 path | **Yes** | `createAsset`/`storeVersion`/`recordVersion` now wrapped, `panelError(…, 500)`, with the "same no-raw-500 rule" comment. |
| 13 | Overstated mint-heading-test claim | **No** | Claim still present at A5; verified still false against `adminPanel.test.ts`. INFO-level, conservative direction (residual above). |

## Fresh-sweep checks that came back clean

- `vitest.config.ts` uses `wrangler: { configPath: "./wrangler.jsonc" }`, so B2's top-level `r2_buckets` block gives tests `env.ASSETS` with no vitest.config change — the plan correctly doesn't add one.
- `use_count`/`revoked_at` columns exist in migration 0001 — C2 test 5's D1 assertion is valid.
- `generateSlug` exported from `src/lib/codes.ts` (B3 import valid); `isValidSlug`/`getAssetHtml` in `src/lib/assets.ts` match B7's move instruction; no import cycle in `ratelimit.ts → assetRepo → codes`.
- Existing gate.test.ts Location assertion (`/a/${SLUG}`, line 29) and the integrity test to delete (line 156, `asset_module_missing`) exist exactly as the plan describes; `vi`, `app`, `env`, `SELF` all already imported there.
- `/a/` (bare) and `/x%00y` fall through to `publicAlias` and fail closed (`a` is reserved so `publicAssetByAlias` can never hit; NUL fails `ALIAS_RE`); fixed routes (`/`, `/robots.txt`, gate, admin) all registered before the alias mount point.
- fflate `filter` receives `originalSize` and filter throws propagate synchronously out of `unzipSync` into B4's catch — the cap-enforcement design is sound.
- A2 vault snippet, A3 placeholder key (32 bytes), A4 arg-shift — all consistent with the already-executed A1–A4 code on this branch.
