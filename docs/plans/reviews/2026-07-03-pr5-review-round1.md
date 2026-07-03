# PR #5 — Blind Adversarial Security Review (Round 1)

**PR:** feat: R2 asset manager + public assets + /about (Phases B & C)
**Reviewer:** blind adversarial (read-only)
**Date:** 2026-07-03
**Verification run locally:** `npx tsc --noEmit` → clean (exit 0). `npm test` → 150 passed / 22 files. `node scripts/lint-config.mjs` → "config lints OK".

## Verdict: **SHIP**

Every original gate invariant survives the rewrite, upload parsing is defensively sound (traversal + bomb caps genuinely enforced pre-inflation), the R2/DB path guards agree, public serving cannot shadow reserved routes or escape the asset tree, and the test suite is strengthened rather than weakened. I found **no exploitable vulnerability and no broken invariant**. Below are the verification results per focus area, then two low-severity hardening notes (neither blocks ship).

---

## Verification of invariants (all PASS)

### 1. Gate rewrite (src/routes/gate.ts)
- **Env gate first:** both routes call `servesTraffic()` before touching slug/DB/R2 (lines 40, 110). Off-production is byte-identical to a wrong-code failure (gate.test.ts "preview environment is INERT" asserts `.toBe(canonical.text())` + header parity).
- **Slug shape before any DB:** `isValidSlug` (22-char base64url) runs before every DB/R2 call (lines 42, 112). Proven DB-independent by the "malformed slugs are denied even when the DB is down" test (injects a throwing D1).
- **Redeem precedence:** a present `?code=` re-validates ignoring the cookie (line 56); wrong-code+valid-cookie fails (test "redemption precedence"). Public short-circuit intentionally wins over `?code=` (documented; code not consumed — publicAsset.test.ts asserts `use_count = 0`).
- **Fail-closed on DB/R2 error:** `redeem` throw → `res = null` → failurePage (lines 61-64); `recheck` fails closed on any DB error; `activeVersion`/`publicAssetBySlug`/`ASSETS.head`/`readAssetFile` all `.catch(() => null)`. "VALID signed cookie with D1 down is DENIED" test confirms never-serve-from-cookie-alone.
- **Trailing-slash 302 is NOT a private-slug oracle:** the 302 fires only for (a) a *public* asset (line 49, pre-auth by design — public assets are meant to be discoverable) or (b) an *authorized* clean load (valid cookie + recheck, line 103) or (c) a successful redeem (line 89). A private known-but-unauthorized slug and an unknown slug both return `failurePage()` — indistinguishable. No private-existence oracle. The only distinction the 302 draws is "a public asset exists here," which is the intended semantics of `is_public`.
- **Cookie Path vs subresource route:** `Path=/a/<slug>` (22-char fixed slug). RFC 6265 prefix-matching sends it to `/a/<slug>/…` (subresources) but NOT to `/a/<slug>EXTRA` (next char is not `/`). Fixed-length slugs cannot prefix-collide. No cross-asset cookie leak.
- **Instant revocation on subresources:** `/a/:slug/*` re-checks the cookie and calls `recheck` per request before `serveFile` (lines 137-140). "revocation is instant on subresources too" test flips `revoked_at` and confirms the very next subresource load denies.
- **Integrity alert (`asset_object_missing`) placement:** redeem branch does `ASSETS.head(index.html)` post-redeem (line 70); the wildcard `serveFile` re-checks index.html and logs on miss (lines 25-27). A valid code + missing object always alerts on at least one path (redeem alerts immediately; the subsequent `/a/<slug>/` load also alerts). Unpublished (`active_version NULL`) is correctly silent (test 186). No path where a valid code + missing object escapes without an alert; no bare 500 (failurePage is 200).
- **Traversal guard on `/a/:slug/*`:** single `decodeURIComponent` (line 118, malformed `%` → generic page, never 500), then store.ts `safePath` rejects `/`-prefix, `..` segments, control chars. Encoded `../` (`%2e%2e%2f`) decodes to `../` → rejected (test "encoded traversal" asserts byte-identical failure). Double-encoded `%252e` decodes to literal `%2e` — not a `..` segment, and R2 keys are literal strings with no `..` resolution, so it simply misses → generic page. Absolute paths rejected. Encoded NUL (`%00`) is a control char → `safePath` returns null → generic page (publicAsset.test.ts `/x%00y`).
- **Byte-parity of failure paths:** every new failure returns the single `failurePage()`; the finalizing middleware applies the identical header set to all response classes. gate.test.ts and publicAsset.test.ts assert `.toBe(canonicalBody)` and header equality across the new 200/302/failure classes via both `SELF.fetch` and `app.request`.

### 2. Upload parsing (src/lib/content/validate.ts)
- **Zip-slip:** `assertSafePath` runs BEFORE `isJunk` (lines 86-87), so `../x` throws and cannot be laundered through the `__MACOSX/`/dotfile skip. Backslashes normalized to `/` before the check (line 85), so `..\evil` → `../evil` → rejected. Absolute paths rejected. Tests cover `../evil.html`, `a/../../evil.html`, `/abs.html`.
- **Zip-bomb caps enforced during decompression:** verified against installed fflate 0.8.3 source (`node_modules/fflate/esm/index.mjs` `unzipSync`, lines 2691-2709). The `filter` callback receives `originalSize`/`size` from the central directory and runs BEFORE `inflateSync`. Critically, inflation uses `inflateSync(sub, { out: new u8(su) })` — a fixed output buffer of exactly the declared `originalSize`; fflate cannot write past it (throws on overrun), so a lie in `originalSize` cannot cause more than `su` bytes to allocate. Entry count, per-file size, and running total are all checked inside the filter (throwing `UploadError`), i.e. before/at the point of inflation. Peak memory is bounded by `totalBytes` (60 MB) within the ~128 MB isolate. Caps are genuinely pre-inflation. Test injects tiny limits and exercises every throw branch.
- **Content-type allowlist:** `typeFor` throws on any extension not in `CONTENT_TYPES`; served content-types come only from this map; global `X-Content-Type-Options: nosniff` prevents sniffing. `run.exe` rejected (test).
- **Duplicate paths:** `seen` set → `UploadError` on collision.
- **Single-html path:** any `.html`/`.htm` becomes `index.html`, empty file rejected.

### 3. R2 store (src/lib/content/store.ts)
- **safePath vs validate.assertSafePath agree:** identical rejection criteria (`/`-prefix, `..` segment, control chars). validate additionally normalizes `\`→`/` at store-time; served paths never contain `\` (stored keys can't), so a `\` in a request path simply misses. No path validate accepts that store mis-handles, or vice versa.
- **delete-prefix pagination:** `deletePrefix` loops on `page.truncated ? page.cursor : undefined` — correct cursor handling, no orphaned objects left by pagination. store.test.ts covers delete of a/ + orig/.
- **sha256 metadata:** stored as `customMetadata.sha256` per file; not security-load-bearing but present.

### 4. Public serving (src/routes/publicAsset.ts + gate short-circuit)
- **Alias RAW-path slicing:** slices `c.req.path` at the first `/` and decodes each piece separately (lines 30-38), avoiding the decoded-length mis-slice; `ALIAS_RE` gate (`^[a-z0-9-]{1,32}$`) applied post-decode before any DB query — no injection, no escape. malformed `%` → generic page.
- **Alias cannot shadow reserved routes:** `publicAlias` mounted LAST in index.ts (line 55, after gate + admin + `/` + `/robots.txt`). Hono matches in registration order, so fixed routes always win. Belt-and-suspenders: `RESERVED_ALIASES` (`a`, `admin`, `robots.txt`, `favicon.ico`, `cdn-cgi`) blocked at `setAlias`. Tests confirm `/robots.txt` and `/` win over an `about` alias.
- **ASSET_CSP applied to public HTML:** `servePublicFile` sets `content-security-policy: ASSET_CSP` when content-type starts with `text/html`; the finalizing middleware only defaults to `ADMIN_CSP` when no CSP is already present (`!c.res.headers.has(...)`), so the ASSET_CSP is preserved. Tests assert public 200 and alias 200 carry `script-src 'self' 'unsafe-inline'` (ASSET_CSP), not the admin hash CSP.
- **Public leaks nothing a gated asset wouldn't:** public serve uses the same `readAssetFile` + `safePath` + version scoping; it only skips the cookie/recheck by design.

### 5. assetRepo (src/lib/db/assetRepo.ts)
- **SQL parameterization:** all statements use `?n` bind parameters; no string interpolation into SQL anywhere.
- **deleteAsset batch:** single `db.batch` (transaction) in FK-safe order — revoke codes, delete `asset_versions`, delete `assets` (children before parent). D1 enforces FKs (`PRAGMA defer_foreign_keys = ON` in the test migration applier confirms enforcement); child-first order avoids violation. Auto-revoke of codes confirmed by assetRepo.test.ts.
- **activate/delete-version guards:** `activateVersion` requires the version row to exist; `deleteVersion` refuses `version === active_version`. Both tested (including "activating a missing version throws" and "deleting the ACTIVE version is refused").
- **alias uniqueness + reserved validation:** `ALIAS_RE` + `RESERVED_ALIASES` at `setAlias`; UNIQUE violation → "alias already taken". Tests cover `Admin`, `a`, `admin`, `robots.txt`, `favicon.ico`, `cdn-cgi`, `UPPER`, `has space`, 33-char, `sla/sh`, and duplicate.
- **is_public/active_version null semantics:** `publicAssetBySlug`/`publicAssetByAlias` both require `is_public = 1 AND active_version IS NOT NULL` — public-but-unpublished returns null (fail closed). Tested.

### 6. admin routes (src/routes/admin.ts)
- **CSRF on every mutation:** `originOk` is the first line of every POST handler (codes, revoke, show, assets, assets/version, assets/activate, assets/delete-version, assets/delete, assets/public, assets/alias). Forged cross-origin → 403 (tested for `/admin/assets` and `/admin/assets/public`). Env gate + Access gate precede all `/admin*`.
- **File-field runtime cast:** `form.get("file") as unknown as File | string | null` then narrowed (`typeof === "string" || null || size === 0`), with a `size > LIMITS.uploadBytes` early reject before buffering.
- **repo-throw → panelError:** upload/version/activate/delete/delete-version/alias all wrap repo calls and surface `e.message` via `panelError` (400, or 500 for the store/record failure) — no raw 500 escapes; parity preserved because guard short-circuits (the generic page) never reach the panelReferrerPolicy override.
- **download route (no originOk):** GET, read-only, admin-gated; reads only `orig/<slug>/<v>.zip` or `a/<slug>/<v>/index.html`. R2 keys are literal (no `..` resolution), and the route is behind requireProduction + requireAdmin, so a crafted `slug` cannot read outside the asset. Read-only + admin-gated is correct; no state change, so CSRF is not required.

### 7. Retirement (B8)
- **No stale imports** of `.generated`, `assets-manifest`, `assets-modules`, `lib/assets`, `lib/manifest`, or `types/html` remain (grep clean).
- **lint-config still enforces both bans** (`hasAssetsKey`, `hasDevBypass`); runs clean; `deploy` script gates on it. manifest-lib.test.ts even tests the inline-after-comma evasion for the assets-key ban.
- **Tests not weakened:** new tests use strong assertions — byte-identical body comparisons for failure parity, real D1+R2 in workerd, header-contract checks via both `SELF.fetch` and `app.request` across the new 200/302/failure response classes, fail-closed-with-DB-down, instant-revocation, and the injected-tiny-limits cap exercises. No happy-path-only or assertion-weakening patterns observed.

---

## Low-severity hardening notes (do NOT block ship)

1. **Version-number reuse after deleting the top non-active version.** `nextVersion` uses `MAX(version)+1`. If the highest version is deleted (`deleteVersion`, non-active) and R2 object deletion (`deleteVersionObjects`, which runs *after* the D1 delete) partially fails, a later upload can reuse that version number and collide with orphaned R2 objects from the old version, potentially serving stale bytes under the reused version. In practice `storeVersion` overwrites each `put` key, so a full re-upload masks stale files of the same path; only paths present in the *old* version but *absent* in the new one would linger and remain reachable. Extremely narrow (requires an R2 delete failure) and admin-only. Consider a monotonic version counter (never decreasing) or verifying `deleteVersionObjects` success before allowing reuse. Not exploitable by an unauthenticated attacker.

2. **`ASSET_CSP` allows `script-src 'unsafe-inline'` in untrusted uploaded HTML.** This is a deliberate, documented design choice (bundles run their own inline JS) and is same-origin-isolated with `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `connect-src 'self'`. Worth an explicit note in the threat model that an uploaded (or public) asset can run arbitrary JS in its own same-origin context; since uploads are Access-gated to a single admin and served content is the admin's own, this is acceptable. No action required.

## Cross-checks performed
- fflate 0.8.3 `unzipSync` filter + fixed-`out`-buffer behavior read directly from installed source.
- D1 FK enforcement confirmed via `src/test/apply-migrations.ts` (`PRAGMA defer_foreign_keys = ON`).
- Hono route registration order in `src/index.ts` (gate → admin → publicAlias last).
- RFC 6265 cookie-path prefix matching against the fixed 22-char slug.
- `decodeURIComponent` does not decode `+`; paths use `%20`; stored keys carry literal spaces — consistent.
