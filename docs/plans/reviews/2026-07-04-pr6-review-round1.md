# PR #6 review round 1 — "root→About link + general file sharing (Phase D)"

Reviewer: blind adversarial security review. Scope: `gh pr diff 6` (base `main`, head `dev`).
True Phase-D delta reviewed against `f50347d^..HEAD` (20 files). Read-only.

## Verdict: **SHIP**

Verification run locally on the PR head:

- `npx tsc --noEmit` → exit 0, no errors.
- `npm test` (vitest run) → **22 files / 162 tests passed**, exit 0.

I found no exploitable vulnerability and no broken project invariant. The XSS surface is
correctly contained, byte-parity failure paths hold, migration 0005 back-compat is correct,
and the entry-driven serving fails closed. The findings below are two low-severity durability /
test-coverage rough edges plus confirmations of the specific attack surfaces I was asked to probe.
None block the ship.

---

## Confirmed-safe (the specific attacks requested)

### 1. Content handling & XSS surface — CONTAINED
- **(a) Which types get ASSET_CSP vs ADMIN_CSP.** `fileResponse` (gate.ts:38) sets
  `content-security-policy: ASSET_CSP` (has `script-src 'self' 'unsafe-inline'`) **iff**
  `ct.startsWith("text/html")`. A single-file `.html`/`.htm` upload gets `text/html; charset=utf-8`
  and therefore ASSET_CSP with unsafe-inline. This is identical to a bundle's `index.html` and is
  **by design** — every upload path (`/admin/assets`, `/admin/assets/version`,
  `/admin/assets/unpack`) is behind `requireProduction` + `requireAdmin` (Cloudflare Access +
  admin-email check), so file bytes are always trusted-admin. The design (Part D) and the
  in-code threat-model comment both state this explicitly. No non-admin upload path exists ⇒
  no untrusted-HTML-with-unsafe-inline vector.
- **SVG is inline WITHOUT unsafe-inline.** `image/svg+xml` is in `INLINE_TYPES` (served inline,
  no attachment) but its ct does **not** start with `text/html`, so `fileResponse` sets no CSP.
  The finalizing middleware (index.ts:31) then fills `ADMIN_CSP`, whose `script-src 'sha256-…'`
  (no `'unsafe-inline'`, no `'self'`) blocks both inline `<script>` and inline `onload=` handlers
  inside a standalone SVG document. Defense-in-depth works as specified. `.xml`/`.xhtml` are not in
  `CONTENT_TYPES` ⇒ octet-stream ⇒ attachment, so no XHTML/XML inline-script vector.
- **(b) nosniff reaches served files.** `x-content-type-options: nosniff` is in `baseHeaders()`
  and applied to **every** response by the finalizing middleware (it never special-cases the asset
  200). Confirmed reaching public/alias 200s by `publicAsset.test.ts` ("FULL §9 security-header set").
- **(c) octet-stream + attachment for unknown extensions.** Unknown ext ⇒
  `application/octet-stream` (not inline) ⇒ `content-disposition: attachment` + nosniff. A
  `.html`-renamed-to-`.xyz` is served octet-stream/attachment/nosniff and cannot be sniffed+run.
- **(d) content-disposition filename is injection-safe.** The filename is the last path segment
  with `["\\]` → `_`. CR/LF (and all `\x00–\x1f`) can never appear: for subresources the path is
  gated by `safePath` (rejects control chars) in `readAssetFile`; for the document `entry` it comes
  from `safeFilename` which whitelists `[A-Za-z0-9._-]` only. No header injection.
- **(e) isInlineType correctness.** The only script-capable inline types are `text/html` (handled
  with ASSET_CSP; trusted admin) and `image/svg+xml` (ADMIN_CSP blocks script). No script-capable
  type ends up inline with a permissive-yet-untested CSP.

### 2. prepareUpload / safeFilename — SAFE round-trip
`safeFilename` reduces to a basename (`split("/").pop()`), whitelists `[A-Za-z0-9._-]`, strips
leading dots, and defaults to `"file"` — so `entry` can never contain `/`, `..`, control chars, or
be empty. `entry` flows: D1 (`asset_versions.entry`, parameterized bind everywhere — no SQL
injection) → read → used as an R2 sub-key in `filePrefix(slug,v)+path`. Every R2 read goes through
`safePath` (store.ts:11) which re-rejects absolute/`..`/control-char paths and empty. The
`../../etc/passwd → passwd` and `a b/c d.png → c_d.png` tests confirm the collapse. No traversal,
no key escape, no collision with a subresource prefix (single files live at
`a/<slug>/<v>/<entry>`, disjoint from `orig/`).

### 3. The Unpack action — CSRF present, fails closed
- CSRF: `originOk(c.req.raw, PUBLIC_ORIGIN)` first line of the handler (admin.ts:206); test
  "asset mutations enforce CSRF" covers the forged-origin 403.
- **orig/ vs a/ prefix boundary is safe.** `preserveOriginalZip` writes `orig/<slug>/<v>.zip`
  BEFORE `storeVersion` clears `a/<slug>/<v>/`. The two prefixes are disjoint, so the clean-slate
  `deletePrefix("a/<slug>/<v>/")` does **not** delete the just-preserved original. Confirmed by the
  adminAssets test asserting `orig/<slug>/1.zip` survives and `a/<slug>/1/b.zip` is gone.
- Cannot unpack a non-zip / non-bundle: `extractBundle` throws `UploadError` on non-zip bytes or a
  bundle missing root `index.html` ⇒ `panelError`, D1 entry unchanged (test:
  "Unpack refuses it … entry unchanged").
- **Two concurrent unpacks converge** (idempotent preserve + clean-slate rewrite to the same files
  + same entry). A loser whose second read races the winner's `deletePrefix` hits the `!`
  non-null assertion on a now-null object → TypeError → caught → "unpack failed" 500-class
  panelError. Fails closed; no corruption.

### 4. Serving correctness — fails closed
- `activeVersionEntry` / `publicAssetBySlug` / `publicAssetByAlias` all INNER-JOIN
  `asset_versions` on `active_version`; a NULL/absent active version or missing asset yields no row
  ⇒ `null` ⇒ generic page. `publicAsset*` additionally require `is_public = 1 AND active_version
  IS NOT NULL`. Tested (assetRepo.test.ts: "public but unpublished ⇒ null", "alias on NON-public ⇒
  null").
- Trailing-slash canonicalization still holds for single files: bare `/a/<slug>` and `/<alias>`
  302 to the `/…/ ` form; the wildcard/alias handler serves `entry` on empty tail. Tested for a
  single-file PDF and zip.
- **Integrity alert re-key (`path === integrity.entry`) is correct.** Document miss (emptyTail ⇒
  `target = av.entry`, so `path === entry`) alerts; a subresource miss (`path = "app.css"` ≠
  `entry = "index.html"`) does not — exactly the intended semantics (a missing subresource is not a
  document-integrity failure). No valid-code + missing-document path silently skips the alert; the
  redeem path's own `ASSETS.head("a/<slug>/<v>/<av.entry>")` check (gate.ts:84) covers redemption.
  No spurious alert for legitimate misses.
- Byte-parity: every deny path returns the single `failurePage()` constant; the finalizing
  middleware applies the uniform header set to all of them.

### 5. Migration 0005 + back-compat — CORRECT
`ADD COLUMN entry TEXT` (nullable, no expression default — correctly avoids the SQLite
ADD-COLUMN-default pitfall). **Every** reader coalesces NULL → `"index.html"`:
`activeVersionEntry`, `versionEntry`, `publicAssetBySlug`, `publicAssetByAlias` (all
`row.entry ?? "index.html"`), and `adminView` (`v.entry ?? "index.html"`). No code path reads
`entry` raw where NULL would break. Pre-0005 rows only ever stored bundles with `index.html`
(the old bundle-only `validateUpload`), so the NULL→index.html default is exactly right for legacy
rows. `schema.test.ts` asserts the column is TEXT + nullable; `assetRepo.test.ts` asserts the
NULL→index.html read.

### 6. Root page — no enumeration, hashes correct
Root links only to `/about` (one `<a>`; `smoke.test.ts` asserts exactly 1 link, no `admin`, no
slugs). `PUBLIC_STYLE` and `ADMIN_STYLE` changed and BOTH `style-src` sha256 hashes in `ADMIN_CSP`
were updated to match; `csp.test.ts` recomputes all three hashes and passes. No test was weakened
(the CSP no-unsafe-inline regression guard and the exact-hash guard remain).

### 7. Circular import gate.ts ↔ publicAsset.ts — no hazard
`fileResponse` and `servePublicFile` are hoisted function declarations, referenced only inside
request handlers (never at module-init). The ESM cycle resolves cleanly; the full test suite loads
the graph without error.

---

## Findings (low severity — non-blocking)

### F1 (LOW, durability) — Unpack partial-failure can strand a version pointing at a deleted .zip
In `/admin/assets/unpack` (admin.ts:220–227) the sequence is:
1. `preserveOriginalZip` → write `orig/<v>.zip`
2. `storeVersion` → `deletePrefix("a/<v>/")` **deletes the .zip**, then `put`s each unpacked file
3. `updateVersionEntry` → D1 `entry` = `index.html`

If step 2 fails **after** the `deletePrefix` but **before** (or partway through) writing
`index.html` — or if step 3's D1 write fails after step 2 succeeds — the version is left in a
broken state: R2 no longer has the `.zip`, and D1 `entry` may still be the old `<name>.zip`. The
document URL then resolves `entry = <name>.zip` → `readAssetFile` returns null → **generic page /
integrity alert** (fails closed, no wrong content served — good). But re-running Unpack now hits
"nothing to unpack" (the `.zip` object is gone while `entry` still names it), so the admin can't
self-heal via the button. Recovery still exists (the `orig/<v>.zip` was preserved and is
Download-able; the admin can upload a fresh version or delete), so impact is limited to an
awkward stuck version, not data loss or a security regression.

**Fix (optional):** make the operation forward-recoverable — either (a) write the unpacked files
BEFORE deleting the `.zip` (put `index.html` etc. first, then remove the stale `.zip` key), or
(b) update the D1 `entry` to `index.html` before/together-with the R2 rewrite so a retry reads a
consistent pointer, or (c) on unpack, if `entry` names a now-missing object but `orig/<v>.zip`
exists, fall back to re-extracting from the preserved original. Any one closes the stuck-state gap.

### F2 (LOW, test coverage) — No test asserts an inline SVG receives the script-blocking ADMIN_CSP
The security-critical property "SVG served inline does NOT get `unsafe-inline`, and is NOT left
CSP-less" is correct by construction (see §1 above) but **untested**. `publicAsset.test.ts` only
asserts HTML → ASSET_CSP and the generic §9 header set; nothing serves an `image/svg+xml` object
and asserts its `content-security-policy` is `ADMIN_CSP` (script-blocking). A future refactor of
`fileResponse` or the middleware CSP-fill could silently regress SVG to no-CSP or to ASSET_CSP with
no failing test.

**Fix (optional):** add a test that seeds a single-file `image/svg+xml` asset, requests it, and
asserts the response CSP contains `script-src 'sha256-` (ADMIN_CSP) and does **not** contain
`'unsafe-inline'`, plus `content-disposition` is absent (inline).

---

## Notes checked and dismissed (not findings)
- Download route content-disposition (`${slug}-v${v}-${entry…}`): `slug` is unvalidated in the
  handler but only reaches the header when a matching R2 object exists (real generated slugs);
  `entry` is `safeFilename`-constrained + `["\\]`→`_`. No CRLF injection.
- Concurrent double-read of the zip in unpack (`(await readAssetFile(...))!`): a vanished object
  throws → caught → fails closed.
- Unpack forged POST controls only `slug`/`version`, never `entry` (read from D1); can't point the
  extractor at arbitrary bytes. And the route is admin-gated regardless.
- `/about` link on root depends on a public asset/alias existing; a missing one is a broken link to
  the generic page — product/deploy concern, not security, no private enumeration.
</content>
</invoke>
