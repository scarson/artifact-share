# PR #7 Blind Adversarial Security Review — Round 1

**PR:** scarson/artifact-share #7 — "feat: admin-action audit log + Activity panel + integrity-alert webhook (Part E)"
**Head commit:** `e295553`
**Reviewer stance:** blind adversarial; paramount invariant = **no raw access code and no full share URL may ever be persisted or transmitted by the new code** (spec §3 D4 / §8 log hygiene).
**Date:** 2026-07-04

---

## VERDICT: **SHIP**

The paramount invariant holds. Every `writeAudit` call passes only ids/slugs/labels/version summaries; the alert payload carries only `{event,slug,version,codeId}` where `codeId` is the D1 row id, not the code. The Activity panel escapes all attacker-influenced fields via hono/html (verified empirically). writeAudit is genuinely best-effort (internal try/catch swallows `.run()` rejection; awaiting it can't reject). CSRF/auth posture is unchanged — all 11 mutating POST routes still call `originOk` behind the `requireProduction`+`requireAdmin` middleware. Migration 0006 is a clean CREATE TABLE. `npx tsc --noEmit` passes (exit 0). `npx vitest run` = **170 passed / 24 files**, including the CSP-hash recompute test (so the new `.act` style rule's hash was correctly updated).

No CRITICAL or HIGH findings. Only low-severity / defensive observations below, none blocking.

---

## Evidence for the paramount invariant

### 1. Every `writeAudit` call site (src/routes/admin.ts) — no code, no URL
- `mint_code` (L111–112): `createCode` returns `code`; audit passes `slug` + `label || "(no label)"`. The raw `code` is used ONLY to build the one-time `link` (L114–116), never audited.
- `revoke_code` (L126): passes `id` only.
- `show_link` (L140–148): decrypts `rawCode`, audits `row.asset_slug` + `row.label` — **not** `rawCode`. The `rawCode` goes only into the returned `link` (L148). This is the highest-risk path (a reveal action) and it correctly logs the fact, not the secret.
- `upload_asset` (L180): `slug` + `` `${title} · ${entry}` `` (title = admin input, entry = filename; both non-secret).
- `new_version` (L202): `slug` + `` `v${version} · ${entry}…` ``.
- `unpack` (L238): `slug` + `` `v${version} → bundle (${n} files)` ``.
- `activate` (L255), `delete_version` (L270), `delete_asset` (L286): `slug` + version/nothing.
- `set_public` (L297): `slug` + `"public=on|off"`.
- `set_alias` (L312): `slug` + `"(cleared)"` or `` `/${alias}` ``.

None passes a raw code, a `?code=` URL, or the decrypted Show-link value. `detail`/`target` are only ids/slugs/summaries. Migration 0006 comments restate the same invariant on the columns.

Test `adminAssets.test.ts:139` ("admin mutations write an Activity audit trail — and NEVER a raw code or URL") mints a real code, scans **every** audit row's `target` and `detail`, and asserts the 22-char code appears in none. Strong, load-bearing coverage.

### 2. Alert payload (src/lib/alert.ts) — safe fields only
- `IntegrityAlert = {event,slug,version,codeId}`; `alertBody` serializes `{level:"error", ...a}`.
- `codeId` originates from `redeem()` → `r.id` (src/lib/gate.ts:39, `RETURNING id`) — the D1 row id, **not** the code. Both call sites (gate.ts:41 `integrity.codeId`, gate.ts:97 `res.codeId`) feed this row id.
- `console.error(body)` (alert.ts:23) logs the same safe body. No URL, no code.
- Test `alert.test.ts:6` asserts the body never matches `/\?code=/` and never contains `"http"`.

### 3. `listAudit` LIMIT is parameterized
`auditRepo.ts:25`: `"… LIMIT ?1"` `.bind(limit)`. No string interpolation. `writeAudit` (L16) fully parameterizes `action/target/detail`. No SQL injection surface.

### 4. XSS in the Activity panel — escaped (verified empirically)
`adminView.ts:82–87` renders `${r.action}`, `${r.target}` (inside `<code>`), and `${r.detail ?? html\`…\`}`. All three are plain-string interpolations into a hono `html` tagged template, which runs `escapeToBuffer` on non-`isEscaped` values (node_modules/hono/dist/utils/html.js:43). I reproduced the exact render pattern with a crafted `detail = '<script>alert(1)</script> " onmouseover=x'`, `target = '<img src=x onerror=alert(2)>'`, and `action = '<b>evil</b>'`: all rendered as `&lt;…&gt;`/`&quot;`. An attacker-controlled asset **title** flows into `upload_asset` detail → still escaped on render. No stored-XSS path. `raw()` is used only for the static `ADMIN_STYLE`/`ADMIN_SCRIPT`/`FAVICON` constants, never for audit data.

### 5. writeAudit best-effort semantics — cannot break a mutation
- `writeAudit` wraps the entire `INSERT … .run()` in try/catch (auditRepo.ts:15–21); the catch only `console.error`s a non-sensitive marker (`{event:"audit_write_failed", action}`). It returns `Promise<void>` that can never reject. Therefore `await writeAudit(...)` at each call site can 500 nothing.
- Test `auditRepo.test.ts:16` proves a throwing DB yields `resolves.toBeUndefined()` and emits the marker.
- **Ordering:** every audit call is placed AFTER the mutation succeeds. For `activate`/`delete_version`/`delete_asset` the audit line sits OUTSIDE the mutation's try/catch, so a mutation throw returns from the catch and never reaches the audit line — no false "action happened" entry. No mis-ordering found.

### 6. CSRF / auth posture unchanged
- Middleware `requireProduction` + `requireAdmin` + `panelReferrerPolicy` bound to `/admin` and `/admin/*` (admin.ts:25–60) — unchanged by this PR.
- All 11 mutating POSTs (`/admin/codes`, `/revoke`, `/show`, `/assets`, `/assets/version`, `/assets/unpack`, `/assets/activate`, `/assets/delete-version`, `/assets/delete`, `/assets/public`, `/assets/alias`) each begin with `if (!originOk(...)) return c.text("forbidden", 403)`.
- The only new-ish GET, `/admin/assets/download`, is read-only, performs no mutation and no audit write — correctly exempt from `originOk`.
- Tests `adminPanel.test.ts:79/90/97` re-assert unauthorized→generic page, cross-site Origin→403, literal `"null"` Origin→403 (0 rows minted in each).

### 7. Migration 0006 + observability
- `audit_log` is `id INTEGER PRIMARY KEY` (rowid alias), `at INTEGER DEFAULT (unixepoch())`, `action/target/detail TEXT`, plus `CREATE INDEX audit_log_at_idx ON audit_log(at DESC)`. Correct shape; CREATE TABLE (not ADD COLUMN) so the non-constant-default pitfall doesn't apply. Schema test `schema.test.ts:57` asserts the columns exist.
- Panel adds exactly one `listAudit(db, 50)` query per render (admin.ts:71), alongside the existing `listAssets`/`listCodes`. At single-admin scale with a 50-row LIMIT on an indexed column this is not an N+1 or perf concern.
- CSP: `csp.test.ts` recomputes sha256 of `PUBLIC_STYLE`/`ADMIN_STYLE`/`ADMIN_SCRIPT` from the exact exported bytes and asserts each is in `ADMIN_CSP`; it also asserts `ADMIN_CSP` never contains `unsafe-inline`. Both pass — so the new `.act` rule (styles.ts:137) is covered by the updated `ADMIN_STYLE` hash. No test weakened; `docs/pitfalls/testing-pitfalls.md` gained content, none removed.

### 8. Pitfalls docs — none newly violated
Checked the code against every entry that touches this PR: "Store SHA-256(code), never the raw code" (audit stores neither code nor `code_enc`), "The access code is the entire secret / never log the raw code or full URL" (no console/alert/audit path logs either), "No zone-level cache / HTML-rewriting" (unchanged), "SQLite ADD COLUMN default" (N/A — CREATE TABLE). No violation.

---

## Non-blocking observations (LOW / informational — no fix required to ship)

1. **[LOW / by-design] Webhook silently skipped when `waitUntil` is unavailable.** `reportIntegrity` dispatches the webhook only when `env.ALERT_WEBHOOK_URL && waitUntil` (alert.ts:24). `safeWaitUntil` (gate.ts:24) returns `undefined` when `c.executionCtx` throws. In production Workers fetch handlers `c.executionCtx` is always present, so `safeWaitUntil` returns a real bound `waitUntil` and the webhook fires; the `catch → undefined` branch is reached only in `app.request()` test contexts (no ctx). The `console.error` fires unconditionally on both paths, so the alert is never fully lost even if the webhook is skipped. Behavior is intentional and documented in the function's JSDoc and the runbook. No action needed. *If* one wanted belt-and-suspenders, dispatching the webhook with an un-awaited `void fetch(...).catch(()=>{})` when no `waitUntil` is present would guarantee the POST even in a ctx-less path — but that risks an unhandled-rejection warning and isn't worth it at this scale.

2. **[INFORMATIONAL] `ALERT_WEBHOOK_URL` is an admin-set secret — SSRF trust is acceptable.** The Worker POSTs to whatever URL the admin configured. It is set only via `wrangler secret` by the single trusted operator, is never derived from request input, and the request body carries only the safe alert fields (no code/URL). This is the same trust boundary as any admin-set config; not attacker-controllable, so not an SSRF vector in this threat model. No fix.

3. **[INFORMATIONAL] Download filename injection already mitigated.** `/admin/assets/download` and `fileResponse` set `content-disposition` with `entry.replace(/["\\]/g, "_")` / `name.replace(/["\\]/g, "_")` (admin.ts:333, gate.ts:56), stripping the quote/backslash that would break out of the quoted filename. Pre-existing, unchanged by this PR, and correct.

---

## Commands run
- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run` → **170 passed (170)**, 24 files passed. Includes `alert.test.ts`, `auditRepo.test.ts`, `schema.test.ts` (audit_log), `csp.test.ts` (hash recompute), `adminPanel.test.ts`, `adminAssets.test.ts` (audit-trail no-leak).
- Empirical hono/html escaping probe on the exact `activitySection` render pattern → all attacker inputs HTML-escaped.
