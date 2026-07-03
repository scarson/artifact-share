# Adversarial Plan Review — Round 4 (independent, subagent-readiness)

**Plan:** `docs/plans/2026-07-03-asset-manager-r2-and-recoverable-codes-plan.md`
**Design:** `docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md` (incl. Part C)
**Reviewer scope:** fresh-executor readiness; Phase C scrutinized hardest (never independently reviewed); second-order effects of the round-3 revisions (B7 rate-limiter rewiring, B4 injectable limits, seeding discipline, integrity-test deletion); plan claims verified against real code (`src/index.ts`, `src/routes/gate.ts`, `src/routes/admin.ts`, `src/lib/ratelimit.ts` + test, `src/lib/codes.ts`, `src/lib/db/adminRepo.ts`, `src/test/apply-migrations.ts`, `vitest.config.ts`, `wrangler.jsonc`, `src/lib/build/manifest-lib.test.ts`, `.github/workflows/deploy.yml`, pitfalls docs).

---

## Findings (most severe first)

### 1. [B7 + C2 — CRITICAL — feature is broken in a real browser] Bundle documents are served at URLs without a trailing slash, so every relative subresource reference resolves OUTSIDE the bundle

The design doc claims "Relative URLs inside the bundle just work because the document lives at `/a/<slug>` and subresources at `/a/<slug>/…`". That is false by RFC 3986 base-URL resolution: a document at `https://host/a/<slug>` (no trailing slash) resolving the relative reference `css/app.css` strips the last path segment (`<slug>`) and requests **`/a/css/app.css`** — which hits `/a/:slug` with slug `"css"`, fails the shape check, and returns the failure page. Every zip bundle whose `index.html` uses relative refs (i.e., every real bundle) will render with no CSS/JS/images. Exactly the same failure hits alias bundles: a page at `/about` referencing `x.css` requests **`/x.css`**, which lands on `/:alias` with alias `x.css`, fails `ALIAS_RE` (dot), failure page.

The planned tests do NOT catch this because they fetch subresource URLs absolutely (`/a/${SLUG}/css/app.css`, `/about/x.css`) — the routes work; the *document-relative resolution* is what's broken. B7's own handler makes the fix impossible as written: for `/a/<slug>/` (empty tail) it computes `path = ""`, `safePath("")` is false (`path.length > 0`), → failure page even for a valid cookie holder.

**Why a fresh subagent ships the bug:** the plan says "keep EVERY existing gate invariant" and the tests go green; nothing prompts them to open a bundle in a browser until B9 live verification — after B8 has already deleted the old pipeline.

**Fix (plan must specify, don't leave to executor judgment):**
- Redemption redirect target becomes `` `/a/${slug}/` `` (trailing slash). Cookie `path=/a/<slug>` still path-matches `/a/<slug>/…` per RFC 6265, so no cookie change.
- `/a/:slug/*` treats an empty decoded tail as `"index.html"` (so `/a/<slug>/` serves the document); `/a/:slug` (no slash) can keep serving index for direct/legacy hits, or 302 to the slash form post-auth (no new oracle: the redirect only happens after redeem/recheck succeeds; failures stay byte-identical).
- Alias routes: `/​<alias>` should either 302 → `/<alias>/` or the plan must document that alias bundles require the slash form and have `aliasHandler` map the `/​<alias>/` empty tail to `index.html` (currently `sub === "" ? "index.html" : sub` handles `/<alias>` but the *browser* will still mis-resolve relative refs from the slash-less form). Public assets are deliberately enumerable, so a redirect is parity-safe here.
- Add a test that actually pins document-relative resolution, e.g. assert the redeem 302 Location ends with `/` and that `GET /a/<slug>/` with cookie returns index.html.

### 2. [B4 — HIGH — planned code does not compile] `limits: typeof LIMITS = LIMITS` cannot accept the test's `tiny` object

`LIMITS` is declared `as const`. The computed members (`20 * 2 ** 20`) widen to `number`, but `entries: 200` is a **literal type `200`**. So `typeof LIMITS` requires `entries: 200`, and the test's `const tiny = { …, entries: 2, … } as const` fails `tsc` ("Type '2' is not assignable to type '200'"). The TDD loop breaks at the first compile.

**Fix:** define `export interface UploadLimits { uploadBytes: number; entries: number; fileBytes: number; totalBytes: number }`, declare `export const LIMITS: UploadLimits = { … }` (or keep `as const` + `satisfies UploadLimits`), and type the parameter `limits: UploadLimits = LIMITS`. B6 references `LIMITS.uploadBytes` only — unaffected either way.

### 3. [C2 — HIGH — instruction is self-contradictory for `/a/:slug/*`] Public short-circuit placement vs. "already-decoded path"

C2 says to insert the public check in BOTH gate routes "immediately after the slug-shape check (BEFORE any code/cookie logic)", and that `/a/:slug/*` "passes its already-decoded `path`". But in B7's `/a/:slug/*` handler the `decodeURIComponent` happens **near the end** (after cookie verify, recheck, and `activeVersion`). At the stated insertion point no decoded `path` exists. A fresh executor either references an undeclared variable or silently reorders the handler with no guidance on where decode-failure (`catch → failurePage`) sits relative to the public branch, and whether `readAssetFile`'s traversal guard is still the backstop on the public path (it is, via `servePublicFile → readAssetFile`, but only if they route through it).

**Fix:** spell out the final `/a/:slug/*` order explicitly: env gate → slug shape → decode tail (catch → failurePage) → `publicAssetBySlug` short-circuit (`servePublicFile(env, slug, pub.active_version, tail === "" ? "index.html" : tail)`) → cookie/claims → recheck → activeVersion → readAssetFile. (Interacts with Finding 1's empty-tail handling.)

### 4. [C2 — MEDIUM — test doesn't prove what it claims] The public-asset CSP assertion passes even if `servePublicFile` forgets the CSP

`expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")` is annotated "// ASSET_CSP applied", but the finalizing middleware's **default `ADMIN_CSP` also contains `frame-ancestors 'none'`** (verified in `src/lib/http/headers.ts`). If `servePublicFile` never sets the header, the middleware fills in ADMIN_CSP and the test still passes — while served HTML runs under the hash-pinned admin CSP and the asset's own inline scripts are blocked (the /about page's inline `<script>` would silently die). **Fix:** assert a discriminating substring, e.g. `toContain("script-src 'self' 'unsafe-inline'")`, matching the existing `gate.test.ts` happy-path pattern.

### 5. [C2 — MEDIUM — pitfall violation] New Phase C response classes are never added to the full header-contract test

`docs/pitfalls/testing-pitfalls.md`: "Assert the full header/cookie contract on EVERY response class via SELF." B7 Step 4 explicitly adds the gated-subresource class to that test; Phase C adds three new classes (public-asset 200 at `/a/<slug>`, alias 200 at `/<alias>`, alias failure) and the plan never instructs adding them. A fresh executor treating the plan as complete will skip it. **Fix:** add a C2 step mirroring B7's "add the class to the SELF header test" instruction (public 200s must still carry no-store/nosniff/HSTS etc.).

### 6. [C2 — MEDIUM — fragile typing likely to fail tsc] `aliasHandler`'s hand-rolled structural context type

`aliasHandler(c: { env: Env; req: { param: (k: string) => string; path: string } })` passed to `publicAlias.get("/:alias", aliasHandler)` relies on `Context`/`HonoRequest` being assignable to that ad-hoc shape. Whether `HonoRequest.param`'s overloads (`param<P2 extends ParamKeys<"/:alias">>(key: P2): string` etc.) are assignable to `(k: string) => string` depends on method-bivariance details across Hono versions (repo is on hono ^4.12); if tsc rejects it, the executor improvises. There is no reason for the hack. **Fix:** type it as a plain Hono handler, e.g. `const aliasHandler = async (c: Context<{ Bindings: Env }, "/:alias" | "/:alias/*">) => { … }`, or register two thin inline handlers calling a `(env, alias, rawPath)` helper. Also note (fail-closed wart, not a blocker): `c.req.param("alias")` is percent-DECODED while `c.req.path` is raw, so a percent-encoded alias (`/%61bout/x.css`) mis-slices the tail — it fails closed, but a one-line comment in the plan would stop a future "fix" from introducing decoding on the wrong side.

### 7. [B7 — MEDIUM — coverage silently lost by the rate-limiter rewiring] No test proves a KNOWN (D1-existing) slug still gets its own bucket

Verified against `src/lib/ratelimit.ts` + `src/lib/ratelimit.test.ts`: the rewiring itself is sound (signature change, fail-open preservation, `assetExists` inside the try, call-site inventory via grep — all check out; `slugKey` is only used in `ratelimit.ts` and its test). But the existing test `"gateLimitOk denies past the per-slug limit"` uses slug `testasset0000000000000` **without seeding an assets row**, so after the rewiring it silently exercises the `redeem:unknown-slug` bucket instead of a per-slug bucket (it still passes because both buckets share `PER_SLUG_LIMIT`). Combined with converting the `slugKey` unit test to booleans, no test any longer proves the real end-to-end property "asset in D1 ⇒ its own `redeem:<slug>` key". **Fix:** in the B7 rewiring step, instruct: seed an asset (insert into `assets`) in that test and assert the created `rate_limits` row key is `redeem:<slug>` (or that two different seeded slugs don't share a bucket). Also update the spray test's stale "not in manifest" comment.

### 8. [B6/C2 — MEDIUM-LOW — seeding hazard + underspecified step] `seedFixtureAsset` is not idempotent in D1, and C2's "gate.test.ts (append public cases)" is unspecified

`seedFixtureAsset` does plain `INSERT`s; it is safe only because the setup-file reset wipes D1 before each test. `gate.test.ts` gets a file-wide `beforeEach(seedFixtureAsset)` in B6/B7 — so any C2 "public case" appended to `gate.test.ts` that calls a `seedPublic()`-style helper (which calls `seedFixtureAsset` again, as `publicAsset.test.ts`'s helper does) hits a PRIMARY KEY violation mid-test. C2 lists `src/routes/gate.test.ts (append public cases)` in its Files header but defines zero such tests — a fresh executor must invent them and is likely to copy `seedPublic` from `publicAsset.test.ts`. **Fix:** either make the D1 inserts `INSERT OR IGNORE` (keeping the R2 put an overwrite) with a comment, or delete the `gate.test.ts` mention from C2's Files list (the C2 test file already covers the gate short-circuit through `app`), or enumerate the exact appended cases using `setPublic` only.

### 9. [A4 — LOW — snippet references symbols that don't exist in the target file] `SLUG` constant and imports in `adminRepo.test.ts`

Verified: `src/lib/db/adminRepo.test.ts` uses inline slug literals (`"sluga0000000000000000A"`), has no `SLUG` constant, and doesn't import `decryptCode`/`getCodeEnc`/`hashCode`-adjacent helpers the A4 snippets use. The appended tests reference `SLUG` undefined. Trivial for a competent executor, but the plan's "append, matching existing style" phrasing plus an undefined identifier invites a wrong guess (e.g. importing gate.test.ts's fixture slug, which needs no assets row here anyway). **Fix:** one line: "define `const SLUG = "sluga0000000000000000A";` at top and add the imports."

### 10. [B2/B9 — LOW — doc-target collision] "SETUP.md §2.2" already exists and is about migrations

`docs/deploy/SETUP.md` "Step 2.2 — Apply migrations and set the environment markers" is an existing, unrelated section. B2 Step 4 / B9 say to document the bucket runbook "in SETUP.md §2.2". A fresh executor will either stuff R2 bucket creation into the migrations step or renumber the doc. **Fix:** say "add a new numbered step/section for R2 bucket creation" and drop the hardcoded §2.2.

### 11. [B8 — LOW — leftover dead artifacts] `src/types/html.d.ts` and the grep-check phrasing

B8 deletes the wrangler `rules` Text-module block and all `.html` imports but never deletes `src/types/html.d.ts` (`declare module "*.html"`), leaving a dead ambient declaration that contradicts the "content never in git / no module assets" end state. Also, B8's completion grep (`grep -rn "manifest\|…" src scripts` "must return only the new lint files") will match `scripts/manifest-lib.mjs`, `src/lib/build/manifest-lib.test.ts`, and `scripts/lint-config.mjs` by content and name — the phrase "only the new lint files" arguably covers them, but naming the three expected files would remove the judgment call. **Fix:** add `src/types/html.d.ts` to the delete list; enumerate the expected grep survivors.

### 12. [B6 — LOW — 500 path on the upload handler] No try/catch around `createAsset`/`storeVersion`/`recordVersion`

B6 mandates try/catch → `panelError` for activate/delete handlers ("MUST render as panel errors, never a 500") but the shown `/admin/assets` handler lets `createAsset` (slug-collision exhaustion), `storeVersion` (R2 error), and `recordVersion` throw to a raw 500. Admin-only surface, so low severity, but it's inconsistent with the stated rule in the same task. **Fix:** extend the same wrap (or state the exemption deliberately).

### 13. [A5 — INFO — overstated claim, conservative direction] "existing tests grep the mint heading"

No test in `adminPanel.test.ts` asserts the mint heading text (only the `?code=` regex and `PUBLIC_ORIGIN`). Keeping the heading byte-exact is still harmless; noting so the executor doesn't burn time hunting for a nonexistent test.

---

## Verified-clean dimensions (checked against real code; no action needed)

- **Hook ordering / seeding discipline claim (B6):** correct — `setupFiles` (`src/test/apply-migrations.ts`) registers its global `beforeEach` before file-level hooks, so D1 reset precedes `seedFixtureAsset`; the "D1-only reset, R2 persists per-file" characterization matches `apply-migrations.ts` + the `vitest.config.ts` isolation comments.
- **Deleted-vs-renamed integrity test (B7):** the plan's DELETE instruction names the real test verbatim (`gate.test.ts` line 156) and the semantic-obsolescence rationale is correct (no-assets-row now lands on the silent unpublished path); replacement coverage (unpublished-silent + integrity-alert tests) is genuinely equivalent-or-better, and the `asset_module_missing → asset_object_missing` grep is sound.
- **Rate-limiter rewiring mechanics (B7):** matches real `ratelimit.ts` (import, injectable-default removal, fail-open try scope, `badShapeLimitOk` untouched); `slugKey` has no other call sites (grep-verified). Only the coverage gap in Finding 7 remains.
- **`createCode` call-site inventory (A4):** grep-verified — the only route call site is `admin.ts:150`; `adminRepo.test.ts` has 6 call sites incl. the collision test's `gen` at arg 5 (plan's shift-to-6 note is right); `gate.test.ts` mints via direct INSERT today (plan's conditional phrasing is accurate), though B7's new tests introduce `createCode` there — executor must add the import.
- **B1 migration vs. C1 SQL:** `is_public`/`public_alias TEXT UNIQUE` present in B1's migration; `publicAssetBySlug`/`publicAssetByAlias` columns and NULL-handling consistent; SQLite UNIQUE permits multiple NULL aliases; `setAlias`'s UNIQUE-error mapping matches D1's message shape.
- **Hono mount ordering (C2):** verified against `src/index.ts` — `/` and `/robots.txt` are registered before `route("/", gate)`/`admin`, so mounting `publicAlias` after `admin` and before `notFound` makes fixed routes win; `/:alias` cannot match `/`; authorized `/admin/<junk>` falling through admin middleware into `publicAlias` yields the same failure page as today's notFound (incl. the referrer-policy carve-out behavior).
- **Alias reserved-name/shape tests (C1):** every "bad" case rejects via `ALIAS_RE` or `RESERVED_ALIASES`; `cdn-cgi` is the only reserved name that passes the regex and is correctly in the set.
- **Config/CI claims (B2/B8):** `wrangler.jsonc` three-block structure, per-env `secrets.required`, the bottom invariant comment text, `deploy.yml` both-jobs `build-manifest` + `.generated` diff step, `package.json` scripts, and `manifest-lib.test.ts` location/imports all match the plan's descriptions; `--dry-run` not needing a real bucket is correct.
- **Vault key placeholders (A2/A3):** both `k1:AAA…=` strings decode to exactly 32 bytes (verified); A2's test vectors and fail-closed matrix are coherent; `decryptCode` catch-all correctly swallows `importRing` throws on the decrypt path only.
- **Byte-parity posture (B7/C2):** all new failure paths return the shared `failurePage()` constant and flow through the finalizing header middleware; body-equality assertions are meaningful.
