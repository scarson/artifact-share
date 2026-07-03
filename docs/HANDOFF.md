# Session Handoff — Artifact Share (Cloudflare Worker + D1)

**Written:** 2026-07-03 · **Branch:** `dev` · **Tip:** `182c1e2` (pushed to `origin/dev`) · **PR:** [#1](https://github.com/scarson/artifact-share/pull/1) `dev` → `main` (OPEN, unmerged)

This is a fresh-agent handoff. The **authoritative durable record is the plan**:
[`docs/plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md`](plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md)
— read its top **Execution Status** table, **Deviations**, and **Discoveries** first. This doc points at it and adds session continuation state; it does not duplicate it.

---

## Headline state

- **The app is DEPLOYED and LIVE** (deployed manually via `wrangler deploy`, NOT via CI):
  - **Production:** Worker `artifact-share` on custom domain **`https://share.scarson.io`**, D1 `artifact-share-prod` (`220fd2d6-e467-41fb-9eed-30d96b431ebb`).
  - **Preview:** Worker `artifact-share-preview` at **`https://artifact-share-preview.samuel-carson.workers.dev`**, D1 `artifact-share-preview` (`37eeeefc-880d-464f-844b-e99cb0db091a`).
  - Both: migrations `0001`+`0002` applied `--remote`; `meta.environment` markers set (`production`/`preview`); secret `ASSET_COOKIE_SECRET` set per env.
- **Working tree clean; 94 tests green; `npx tsc --noEmit` clean.**
- **Admin auth = Cloudflare Access + Google SSO** (replaced password+TOTP). Access app `c24ca76d-ef67-4280-ad9c-fc6d9f31d257`, team `https://samuel-carson.cloudflareaccess.com`, AUD `b5f88feddc211551d9dad1a3e7541bc9c376138f6553438883ff4e3a4b9c2f11`, policy = `Include Login Method=Google` + `Require Emails=samuel.carson@gmail.com` (attached to the app). Destinations: `/admin` on prod + preview only.

## What this app is (1 paragraph)

Single-admin Cloudflare Worker (Hono + D1). `GET /a/:slug?code=` redeems a per-recipient access code in one atomic D1 `UPDATE…RETURNING`, sets a signed HttpOnly cookie, 302s to a clean URL; every later load re-checks the code in D1 and **fails closed** (instant revocation). Codes stored only as `SHA-256(code)`. Asset HTML is compiled into the Worker as Text modules (`.generated/*`) — **no `assets` config key ever** (the build lints it). `/admin` (Cloudflare Access-gated) mints/revokes codes. Spec: [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md).

## What shipped this session

1. **Phases 0–7 of the plan** via subagent-driven development (fresh subagent per task, two-stage review, ≥3-round adversarial gate per phase — all clean; findings caught+fixed: FK-safe test reset, assets-key lint evasion, login-throttle coverage). → PR #1.
2. **Admin-auth follow-up (commits `75c1647`→`fa749d9`):** replaced password+TOTP with Cloudflare Access. New `src/lib/auth/cfaccess.ts` (jose remote-JWKS verify, RS256/iss/aud pinned, email allowlist, fail-closed). `src/routes/admin.ts` guard = production env-gate → Access verification, with `ACCESS_DEV_BYPASS=1` local-dev bypass (`.dev.vars` only, **linted out of committed config** via `hasDevBypass()` in the build). Removed password/TOTP/session code, `@noble/hashes`+`otpauth` deps, `ADMIN_PASSWORD_HASH`/`ADMIN_TOTP_SECRET`/`SESSION_SECRET` secrets, `hash-password`/`totp-setup` scripts, and (migration `0002`) the dead `totp_used_steps` table. Dedicated adversarial review = SHIP (one fail-closed hardening applied). Docs updated (spec §8/§15 Q6, plan Deviations, SETUP.md).
3. **Deploy + config fix (commits `fa1cf84`→`182c1e2`):** owner ran the account hand-off; hit a `wrangler d1 create` mishap (its "add on your behalf?" prompt appended top-level bindings with wrong names instead of filling env blocks). Fixed `wrangler.jsonc` (real IDs in env blocks; `secrets.required` moved per-env since it isn't inherited); both `--dry-run`s warning-free; deployed; live-verified.

## Remaining work (priority queue)

1. **End-to-end mint→redeem test on production** (the one unverified Task 7.4 substep — and the single highest-value check). Needs the OWNER (only their Google account passes Access): open `https://share.scarson.io/admin` → Google login → mint a code for the `testasset0000000000000` fixture → open `/a/testasset0000000000000?code=<code>` → must render `fixture ok`; then revoke → reload → generic page. **This one test transitively proves the two riskiest untested live states:** the real Cloudflare Access **JWT path** (Google login actually reaching the panel = the Worker-side verification works live, not just in unit tests) and the **`ASSET_COOKIE_SECRET` key-ring format** (item 4 — if the link renders `fixture ok`, the `k1:` key ring parsed correctly; if it silently fails to `fixture ok`, suspect the cookie secret first). A fresh agent CANNOT do this alone (no admin access); prompt the owner.
2. **CI activation before merging `main`:** add GitHub repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + D1:Edit) + `CLOUDFLARE_ACCOUNT_ID`; **confirm Cloudflare Workers Builds is DISABLED** for the `artifact-share` Worker (dashboard → the Worker → Settings → Builds) — else two deployers race on `main`. See SETUP.md §5. (Owner/dashboard action.)
3. **Merge PR #1** (`dev` → `main`) — owner's call. On merge, `deploy.yml` runs on `main` → migrations + `wrangler deploy --env production`. Until the repo secrets in (2) exist, that deploy job reds (expected; the current live version was deployed manually).
4. **Verify `ASSET_COOKIE_SECRET` is `k1:<random>` format** (key-ring `kid:secret`). If the owner set the bare `openssl` output, share links fail. Re-set if unsure: `echo "k1:$(openssl rand -base64 32)" | npx wrangler secret put ASSET_COOKIE_SECRET --env production` (and `--env preview`). (Owner.)
5. **Publish a real asset** (when wanted): `npm run new-asset -- "Title"` → edit `assets/<slug>/index.html` → `npm run build-manifest` → commit `assets/`+`.generated/` → PR `dev`→`main` → merge deploys → mint a code in `/admin`.

## Deferred / blocked items (with unblock conditions)

- **Task 7.4 full production verification** — plan Phase 7 Task 7.4. Unblock: owner completes item (1) above. Several substeps already done (preview isolation, admin→Access 302, `/robots.txt`, blank root, byte-stable failure page — all live-verified this session); only the mint→redeem→revoke round-trip remains (needs admin login).
- **CI-driven deploys** — deploy.yml (`fe63660`). Unblock: item (2). Currently inert (no repo secrets); the live deploy was manual.

## Operational guardrails (learned this session — don't re-discover)

- **`wrangler d1 create`: DECLINE its "add it on your behalf?" prompt.** It appends a wrong-named TOP-LEVEL binding; paste the UUID into the matching **env block** `DB` binding instead. (SETUP.md §2.1 warns; `wrangler.jsonc` comment too.)
- **`ASSET_COOKIE_SECRET` MUST be `k1:<random>`** (parsed as a key ring). Bare value breaks the recipient gate.
- **`secrets.required` is per-env, not inherited** — it lives inside each `env` block in `wrangler.jsonc`, not top-level.
- **`ACCESS_DEV_BYPASS` is local-only** (`.dev.vars`); the build FAILS if it appears anywhere in `wrangler.jsonc`. Local admin QA needs it set (there's no Access edge locally); `ENVIRONMENT=production` in `.dev.vars` is also needed for the app to serve locally.
- **Never push `main` directly** — flow is `dev` → PR → `main`.
- **Deploying production intentionally disables the `*-artifact-share.samuel-carson.workers.dev` version-preview URLs** (spec §10). Expected, not a regression.
- **Toolchain reality:** `@cloudflare/vitest-pool-workers` 0.17 (vitest 4) — see Task 0.3 deviation. **KDF:** `hash-wasm` does NOT run on Workers (runtime `WebAssembly.compile` forbidden) — that's why argon2id→`@noble/hashes` originally, now moot (auth is Access). **Cloudflare account MCP is NOT authorized** in a non-interactive session; wrangler's OAuth token lacks Zero-Trust/Access scope — so Access config is dashboard-only or via a Zero-Trust-scoped API token.

## Blank-page note (already resolved)

The owner reported "blank pages" post-deploy. **Not a bug:** `/` returns a blank 200 by design (spec §9 — nothing to enumerate). All real surfaces verified live: `/robots.txt` → `Disallow: /`; `/a/<fixture>` → generic fail page; `/admin` → 302 to Cloudflare Access. To see content, use `/admin` (Google login) → mint → open the `/a/…?code=…` link.

## Continuation prompt (paste-ready)

```
You're resuming the "Artifact Share" Cloudflare Worker (Hono + D1) in ~/Code/artifact-share, branch dev (tip 182c1e2, PR #1 open dev→main). Read docs/HANDOFF.md and the plan's Execution Status table first. The app is DEPLOYED & LIVE (share.scarson.io + artifact-share-preview.samuel-carson.workers.dev); admin auth is Cloudflare Access + Google. 94 tests green, tsc clean.

Most of what remains needs the OWNER (admin actions behind Google/Access, dashboard, GitHub secrets), so surface those rather than attempting them. Priority queue (see HANDOFF "Remaining work"): (1) owner runs the end-to-end mint→redeem→revoke test on production /admin — the last Task 7.4 substep; (2) owner adds GitHub repo secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID and confirms Workers Builds is disabled before merging main; (3) merge PR #1; (4) verify ASSET_COOKIE_SECRET is k1:<random>. Respect the operational guardrails in HANDOFF (esp. wrangler d1-create prompt, the k1: prefix, never push main, ACCESS_DEV_BYPASS is local-only). Use subagent-driven development + a gate review for any further code changes.
```
