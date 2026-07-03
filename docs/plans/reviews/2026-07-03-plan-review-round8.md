# Adversarial Plan Review — Round 8 (final convergence check)

**Plan:** `docs/plans/2026-07-03-asset-manager-r2-and-recoverable-codes-plan.md`
**Scope:** (1) verify every round-6 finding (`reviews/2026-07-03-plan-review-round6.md`) is correctly and CONSISTENTLY resolved — trailing-slash canonicalization end-to-end scrutinized hardest; (2) cross-check only for contradictions the round-7 edits could have introduced elsewhere (grepped the full plan for `servePublicFile`, `index.html`, `redirect`/`302`/`location`, `/a/${slug}`, `bare`, `canonical` outside the B7/C2 task bodies). Claims re-verified against real code where load-bearing: `src/routes/gate.test.ts`, `src/routes/adminPanel.test.ts` + `src/routes/admin.ts` (mint heading), `src/lib/ratelimit.test.ts`.

**Verdict: CONVERGED — 0 substantive findings.** Every round-6 finding landed, and the fixes are mutually consistent across B7's prose, B7's bullets, B7's snippets, B7's Step-1 tests, C2's snippets, C2's tests, and C2's "Final handler order". No new contradiction found elsewhere in the plan.

---

## Round-6 findings — resolution verification

### 1. [B7 — HIGH, self-contradictory bare-path/wildcard instructions] — RESOLVED, consistently

- **(a) Clean-load paragraph now matches the canonicalization bullet.** The "Clean-load branch" paragraph (lines 1214–1217) now reads: "do NOT serve a body — `return c.redirect(\`/a/${slug}/\`, 302)` … The bare handler therefore no longer touches R2 on clean loads at all — the integrity alert moves entirely into the wildcard handler below." This is exactly the 302 design mandated by the trailing-slash block (lines 1098–1101: redirect ONLY post-authorization, never a slug-validity oracle) and by C2's Final handler order (lines 1582–1584). The stale serve-a-body instruction is gone.
- **(b) Wildcard snippet implements the empty-tail bullet.** Line 1237: `if (path === "") path = "index.html";` with the trailing-slash-canonicalization comment — matches bullet line 1102 and C2's order line 1586. `safePath`'s `length > 0` rejection can no longer strand `GET /a/<slug>/`.
- **(c) Integrity alert has an explicit home in the wildcard.** Snippet lines 1239–1245: on `readAssetFile` miss, log `asset_object_missing` (with `slug`, `version`, `codeId: claims.codeId`) **iff** `path === "index.html"`, else silent generic page (parity). This matches C2's order parenthetical (lines 1587–1588) verbatim, and the clean-load paragraph explicitly hands the alert off to the wildcard. The redeem branch keeps its own `head()`-based alert (lines 1174–1177), and B7 Step 1 retains the integrity-alert test (lines 1158–1166) plus the unpublished-silent test — no spec §13 coverage gap between B7 ship and C2 ship.
- **(d) The trailing-slash test is in the Step-1 code block.** Lines 1120–1128: `GET /a/${SLUG}/` → 200 + "fixture ok", and bare `/a/${SLUG}` with a valid cookie → 302 with Location `/a/${SLUG}/`. The subresource test (lines 1130–1140) covers `css/app.css` under the same cookie. `mintAndRedeem` (lines 1112–1118) pins the redeem Location to `/a/${SLUG}/` exactly.
- **Existing-test fallout is covered.** The only bare-path Location assertion in today's `gate.test.ts` is line 29 (`/a/${SLUG}`), and bullet lines 1096–1097 mandate updating it to `/a/${slug}/`. Every other existing bare-path clean load with a valid cookie (`gate.test.ts` lines 40, 72, 138) uses `SELF.fetch` without `redirect: "manual"`, which follows the new 302 automatically and still asserts 200 — no unflagged breakage. Round 6's suggested extra Step-4 sentence turned out to be unnecessary: no existing `app.request` clean-load test expects a 200 body at the bare path (line 149 is the throwing-DB fail-closed case, which still returns the failure page pre-redirect).

### 2. [C2 — HIGH, tests contradicted the "exact" handler order] — RESOLVED, consistently

- **C2 gate snippet** (lines 1572–1578) now differentiates the two routes exactly as the final order requires: bare route → `if (pub) return c.redirect(\`/a/${slug}/\`, 302)`; wildcard route → `if (pub) return servePublicFile(c.env, slug, pub.active_version, path)` with the "path already decoded; empty tail already mapped to index.html" comment. The prose above it ("note the two routes DIFFER") kills the old "in BOTH routes serve" instruction.
- **Test 1** (lines 1449–1461) is redirect-aware: bare `/a/<slug>` with `redirect: "manual"` → 302 + Location `/a/<slug>/`; the 200/body/CSP/no-cookie assertions moved to `/a/<slug>/`; toggle-off asserted at the slash form.
- **Test 5** (lines 1487–1495) now asserts the 302 + Location (strips `?code=`) + `set-cookie` null + `use_count` still 0 — the code-not-consumed invariant preserved in its redirect-aware form, exactly as round 6 prescribed.
- **Alias parity holds:** bare `/<alias>` 302s only after `publicAssetByAlias` resolves (snippet line 1561 — no oracle for non-public/unknown aliases, confirmed by the byte-parity test at lines 1478–1485 where bare `/parked` gets the generic page), and `sub === "" ? "index.html" : sub` (line 1562) mirrors the wildcard's empty-tail rule. Slug-form and alias-form behavior for the same public asset now match (both 302 bare → serve at slash).

### 3. [B4 — LOW, missing `UploadLimits` import] — RESOLVED
Line 658: `import { UploadError, validateUpload, type UploadLimits } from "./validate";` — the cap test's `const tiny: UploadLimits` (line 701) now compiles.

### 4. [B9 — LOW, stale §2.2 cross-reference] — RESOLVED
B9's Files line (1284) now reads "finalize the NEW bucket section added in B2". The only remaining `§2.2` mention in the plan is B2 Step 4's intentional "do not collide" guard (line 514). No pointer sends the B9 executor back at the colliding section.

### 5. [A5 — INFO, overstated mint-heading-test claim] — RESOLVED
Line 360 now says "existing tests assert only the `?code=` regex — no test pins the mint heading, but keep its text EXACTLY anyway; it is user-facing show-once messaging". Verified true: `grep "Copy this link" src/routes/adminPanel.test.ts` → no hits (only `admin.ts:156`, the source itself). Step 4 (line 427) retains the conservative "mint heading text is load-bearing" guard — consistent, no longer asserts a nonexistent test.

### 6. [Execution Status — OBSERVATION, stale banners] — RESOLVED
Table row (line 62): Phase A "🚧 In progress … PR #4 open (review in flight); A6 pending prod deploy". Phase A banner (line 105): "🚧 IN PROGRESS — claimed 2026-07-03 08:28Z (branch `claude/eager-almeida-95f4ee`, landing on `dev`). A1–A5 implemented + browser-verified … as of 08:50Z". Matches this branch's actual state (A1–A5 committed). Phases B/C correctly remain ⬜. No fresh executor will re-claim Phase A.

---

## Cross-check for newly introduced contradictions — clean

Swept every mention of `servePublicFile`, `index.html`, `redirect`/`302`/`location`, `/a/${slug}`, `bare`, `canonical` outside the B7 (1085–1254) and C2 (1423–1591) task bodies. Only hits: B8's `manifest-lib` slimming text (line 1276, unrelated) and C3's `wrangler r2 object put …/index.html` publish command (line 1611, storage-layout path — consistent with B5's layout, not a serving instruction). The B6 download handler's `readAssetFile(..., "index.html")` fallback (line 1073) is admin-gated download, untouched by canonicalization. `seedFixtureAsset`'s R2 key (line 954) matches the layout. The alias-handler comment "same RFC 3986 rationale as /a/:slug — see B7" (line 1559) now points at prose that actually says what it claims.

## Minor residuals (non-blocking, listed for completeness — none causes executor failure)

- **Line 58 "Overall: Not started."** is stale against the Phase A row one line below it ("In progress"). The contract's claiming signal is the phase banner + table row, both correct and detailed, so no re-claim risk; and the table row names PR #4 but not its URL (contract says number + URL). Cosmetic.
- **Bullet line 1104** says `mintAndRedeem` "follows the redirect"; the canonical helper (lines 1112–1118) instead uses `redirect: "manual"`, asserts the Location, and returns the cookie — the *tests* then request `/a/${SLUG}/` directly. Net behavior identical; the code block is what executors copy. Wording nit.
- **B7's wildcard snippet order** (cookie → recheck → activeVersion → decode → empty-tail) differs from C2's final order (decode → empty-tail → PUBLIC → cookie → …). Within B7 this is behaviorally immaterial (everything precedes serving; no public concept yet). C2's executor must hoist the decode/empty-tail block above the public check — the "Final handler order (exact — do not reorder)" spells the complete target sequence and C2's test 2 (public subresource, no cookie) fails against any wrong placement, so the plan self-corrects. Pre-existing structure already adjudicated coherent in round 6 (its finding 3); not re-litigated.
- **Ratelimit comment attribution** (round-6 INFO): line 1211–1212 still says "its stale 'not in manifest' comment" about the per-slug test while the comment lives in the spray test (`ratelimit.test.ts:35`). Grep finds it instantly; round 6 already classified this as no-executor-failure and it was not in this round's enumerated scope.
