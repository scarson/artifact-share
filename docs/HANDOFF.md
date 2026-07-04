# Session Handoff — Artifact Share (Cloudflare Worker + D1 + R2)

**Written:** 2026-07-04 · **Branch:** `dev` (worktree `.claude/worktrees/eager-almeida-95f4ee`) · **Tip:** `origin/dev` = latest on this branch · **Status: FULLY BUILT, DEPLOYED & LIVE. No open PRs. Nothing blocked.**

This is a fresh-agent checkpoint. It replaces the accreted 2026-07-03 handoff (which described a
pre-R2, pre-Access-token-fix world; that version is preserved in git — see the History note at the
bottom). **Authoritative durable records, in read order:**
- Spec: [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md) (code cites its §N; carries amendment banners for the R2/audit changes).
- Asset-manager + recoverable-codes + public + file-sharing + audit design: [`docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md`](design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md) (Parts A–E).
- Living plan: [`docs/plans/2026-07-03-asset-manager-r2-and-recoverable-codes-plan.md`](plans/2026-07-03-asset-manager-r2-and-recoverable-codes-plan.md) (Execution Status: all phases ✅ shipped).
- Pitfalls (read before coding): [`docs/pitfalls/implementation-pitfalls.md`](pitfalls/implementation-pitfalls.md), [`docs/pitfalls/testing-pitfalls.md`](pitfalls/testing-pitfalls.md).
- Deploy/ops runbook: [`docs/deploy/SETUP.md`](deploy/SETUP.md).

## What this app is (1 paragraph — CURRENT)

Single-admin Cloudflare Worker (Hono) for sharing confidential files behind per-recipient access
codes. `GET /a/:slug?code=` redeems a code in one atomic D1 `UPDATE…RETURNING`, sets a signed
HttpOnly cookie, and 302s to `/a/:slug/` (trailing slash — so relative subresources in bundles
resolve, RFC 3986). Every later request re-checks the code in D1 and **fails closed** — instant
revocation. Codes are stored as `SHA-256(code)` for lookup **plus** AES-256-GCM ciphertext
(`code_enc`, `CODE_VAULT_KEY`) so the admin can re-show a sent link. **Asset bytes live in a
private R2 bucket** (binding-only, no public URL), metadata in D1 — publishing is a runtime admin
upload, NOT a git/deploy step, so the public repo holds zero content. Assets support any file type
(single file, served inline-where-renderable / download otherwise) or a zip (stored as a download
by default, with an on-demand **Unpack** to a browsable bundle). Assets can be toggled **public**
(served with no code) and given a friendly **alias** (e.g. `/about`). `/admin` (Cloudflare Access +
Google SSO) mints/revokes codes, manages assets, shows a recoverable link, and shows an **Activity**
audit log. Everything fails closed to ONE byte-identical generic page.

## Headline state

- **LIVE in production:** Worker `artifact-share` on `https://share.scarson.io`, D1
  `artifact-share-prod` (`220fd2d6-e467-41fb-9eed-30d96b431ebb`), R2 `artifact-share-prod`.
- **Preview:** `artifact-share-preview` at `artifact-share-preview.samuel-carson.workers.dev`, D1
  `artifact-share-preview` (`37eeeefc-880d-464f-844b-e99cb0db091a`), R2 `artifact-share-preview`.
- **CI is fully green** (`.github/workflows/deploy.yml`): push `dev` → preview deploy; merge `main`
  → production deploy. The deploy token now has the scopes it needs (Workers Scripts:Edit,
  D1:Edit, Zone→Workers Routes:Edit on `scarson.io`, Account→Workers R2 Storage:Edit).
- **170 tests green, `tsc --noEmit` clean, `npm run lint-config` clean.** Working tree clean.
- **Migrations 0001–0006** applied to both remote DBs (via CI deploy job).
- **Secrets set (both envs):** `ASSET_COOKIE_SECRET` (`k1:` key ring), `CODE_VAULT_KEY` (`k1:` key
  ring, standard-base64 32 bytes). **`ALERT_WEBHOOK_URL` is OPTIONAL and currently UNSET.**
- **Admin auth:** Cloudflare Access app `c24ca76d-ef67-4280-ad9c-fc6d9f31d257`, team
  `https://samuel-carson.cloudflareaccess.com`, AUD
  `b5f88feddc211551d9dad1a3e7541bc9c376138f6553438883ff4e3a4b9c2f11`, policy = Google login +
  email `samuel.carson@gmail.com`. `/admin` gated on prod + preview.
- **Live content:** one public asset — the `/about` architecture explainer
  (source: [`docs/assets-src/about/index.html`](assets-src/about/index.html), slug
  `zTz_nuGaw8qeTImrag14Bw`, public, alias `about`). Its D1 row has `entry = NULL` (pre-0005) which
  the code reads as `index.html` — a live proof of back-compat; leave it or re-upload to normalize.

## What shipped (this multi-session arc — all merged to `main`)

Everything is on `main`. PRs #1–#7 all merged after blind adversarial review (artifacts in
[`docs/plans/reviews/`](plans/reviews/)). Phase-by-phase status lives in the plan's Execution
Status table; the design doc Parts A–E carry the rationale. Summary:
- **PR #1** — the original gate + admin + bundled-asset app (later superseded by R2). **PR #2** —
  admin CSRF fix (Referrer-Policy) + minimalist UI. **PR #3** — toolchain (actions v7/v6, wrangler
  4.107).
- **PR #4 (Phase A)** — recoverable codes: `code_enc` vault + Show-link.
- **PR #5 (Phases B+C)** — R2 asset manager (upload/version/activate/download/delete) + public
  assets + aliases + `/about` + README; **retired the git/CI bundling pipeline** (no more
  `assets/`, `.generated/`, `build-manifest`; `scripts/lint-config.mjs` keeps the two structural
  lints).
- **PR #6 (Phase D)** — general file sharing (any type single-file, on-demand Unpack) + root→About
  link.
- **PR #7 (Phase E)** — admin-action audit log (`audit_log`, migration 0006) + Activity panel +
  integrity-alert webhook + runbook fixes.

## Codebase orientation (fresh-agent map)

- `src/index.ts` — app assembly: finalizing header middleware (applies the §9 header set + default
  CSP + `app.onError`→generic page), root page (wordmark + `/about` link), route mounting. Alias
  routes are mounted LAST (`publicAlias`) so fixed routes always win.
- `src/routes/gate.ts` — `/a/:slug` (redeem → cookie → 302 to `/a/:slug/`) and `/a/:slug/*` (serves
  the version's `entry` + subresources; cookie re-checked per request; public short-circuit).
  `fileResponse()` sets content-type + CSP-for-HTML + inline/attachment. `reportIntegrity` on the
  missing-object path.
- `src/routes/admin.ts` — all `/admin*` routes behind env-gate → Access → `originOk` CSRF +
  `panelReferrerPolicy` (same-origin, NOT no-referrer — that broke form POSTs). `renderPanel`/
  `panelError` are the only renderers. `writeAudit` after each mutation.
- `src/routes/adminView.ts` — panel HTML (Assets / Generate code / Codes / Activity sections).
- `src/routes/publicAsset.ts` — `servePublicFile` + the `/:alias` routes.
- `src/lib/`: `vault.ts` (AES-GCM code vault), `alert.ts` (`reportIntegrity`/`alertBody`),
  `codes.ts` (`isValidSlug`, `hashCode`, `codeStatus`), `content/validate.ts` (`prepareUpload`,
  `extractBundle`, content-type + inline sets), `content/store.ts` (R2 ops), `db/` (adminRepo,
  assetRepo, auditRepo, rateStore, schema.test), `http/` (headers+CSP hashes, csrf), `ui/styles.ts`
  (hashed inline CSS/JS — editing requires re-hashing, see below), `auth/cfaccess.ts`.
- `migrations/` 0001–0006 (forward-only; never edit shipped ones). `src/test/seedAsset.ts` seeds
  the fixture asset (D1 rows + R2 object) — file-wide `beforeEach` in gate/adminPanel/publicAsset
  tests.

## Ready to dispatch (no blockers — pick up any)

1. **Owner-only live smoke test (highest-value, needs Google login):** open `share.scarson.io/admin`
   → **upload a throwaway PRIVATE asset** (the only prod asset today is the *public* `/about`, which
   serves with no code, so it can't exercise the redemption path) → mint a code for it → open the
   `/a/…?code=…` link → confirm it renders → revoke → reload → generic page → delete the throwaway
   asset. This exercises the real Access JWT path + cookie key-ring end to end. A fresh agent CANNOT
   do this (no admin auth) — prompt the owner.
2. **(Optional) Enable the integrity webhook:** `echo -n "https://hooks.slack.com/…" | npx wrangler
   secret put ALERT_WEBHOOK_URL --env production`. Unset today = console channel only. Rationale +
   Cloudflare-Notifications tradeoff in SETUP §8/§12.
3. **(Optional) Normalize the `/about` row's `entry`:** it's `NULL` (reads as `index.html`). Fine as
   is; re-upload via the panel if you want an explicit value.

## Deferred / parked (with unblock conditions)

- **Sandboxed-iframe asset rendering** — spec §15 Q2, still deferred (an owner decision, not a
  gap). Unblock: owner decides the CSP-can't-stop-top-nav-exfiltration tradeoff is worth the iframe
  complexity. Nothing about R2 changed the calculus.
- **Per-event recipient access log** (individual redemption times/IPs) — out of scope; the codes
  table keeps `use_count` + `last_used_at` only. The NEW `audit_log` covers ADMIN actions, not
  recipient reads. Unblock: only if forensic recipient-side history is actually needed.
- **Direct-to-R2 presigned uploads** — deferred (design §3 sub-option). Worker-proxied multipart is
  fine at current sizes (20 MB upload cap). Unblock: assets outgrow the request-body limit.

## Operational guardrails (accumulated — don't re-discover)

- **Never push `main` directly.** Flow: feature work on this `dev`-tracking branch → PR → `main`.
  Merge only after multi-round blind adversarial review (owner grant, recorded in CLAUDE.md §Merge
  authority + `docs/git-strategy.md`). `gh pr merge --merge` (never squash/rebase).
- **Editing `src/lib/ui/styles.ts` (PUBLIC_STYLE / ADMIN_STYLE / ADMIN_SCRIPT) requires re-hashing**
  the sha256 in `src/lib/http/headers.ts`. `src/lib/http/csp.test.ts` fails with the correct hash
  printed — paste it, rerun. No `unsafe-inline`, ever.
- **`Referrer-Policy` on admin pages is `same-origin`, NOT `no-referrer`** — no-referrer makes the
  browser send `Origin: null` on same-origin form POSTs and the CSRF check 403s every submit. (See
  the pitfalls doc + the user-memory entry.)
- **Serve multi-file bundles at a trailing-slash URL** (`/a/<slug>/`) or relative subresources
  resolve outside the bundle (RFC 3986). The gate 302s bare → trailing-slash post-authorization.
- **Key-ring secrets are `kid:secret` (`k1:…`).** `CODE_VAULT_KEY` values must be standard-base64 of
  32 bytes (`openssl rand -base64 32`) or `encryptCode` throws and every mint 500s.
- **`ACCESS_DEV_BYPASS` is `.dev.vars`-only** (lint fails if it's in committed config); tests pin it
  to `"0"` in `vitest.config.ts`. Local admin QA needs `ENVIRONMENT=production` + `ACCESS_DEV_BYPASS=1`
  in `.dev.vars` (there's no Access edge locally).
- **`wrangler d1 create` / `r2 bucket create` "add on your behalf?" prompt: DECLINE.** It appends a
  wrong-named top-level binding; the bindings already live in the `env` blocks.
- **`secrets.required` is per-env, not inherited.** `ALERT_WEBHOOK_URL` is intentionally NOT in it
  (optional). **Keep Workers observability OFF/minimal + Logpush OFF** — request URLs contain the
  code (SETUP §8).
- **Tests run inside workerd** (`@cloudflare/vitest-pool-workers`, real D1/R2). Per-test D1 reset
  from `src/test/apply-migrations.ts`; R2 persists per-file (so `seedFixtureAsset` re-puts
  idempotently). Do NOT use `test.concurrent` in a file.
- **Security invariants a fresh agent MUST NOT casually regress** (a naive "improvement" silently
  breaks confidentiality; full list in the pitfalls doc + spec §9): every failure path returns
  `failurePage()` — one byte-identical generic page, no per-case fingerprint; any new admin action
  `writeAudit`s WITHOUT the raw code/URL and any new logging carries only safe fields (the code is a
  bearer credential in the URL); the R2 bucket never gets a public URL; D1 is the single time source
  (`unixepoch()` in SQL, never `Date.now()` for authz); the gate re-checks the code in D1 on EVERY
  request (the cookie is never the authority).
- **Branch seam:** this `dev`-tracking branch carries docs-only commits (the review artifacts + this
  handoff rewrite) that are AHEAD of `origin/main`. That's normal for the two-branch flow — they ride
  the next feature PR to `main`, or PR them standalone if you want main's docs current sooner. No
  code divergence; `main` and `dev` are code-identical.
- **Local dev:** `cp .dev.vars.example .dev.vars`, `npx wrangler d1 migrations apply
  artifact-share-dev --local`, `npm run dev`. The Preview MCP launch config is `.claude/launch.json`.

## Continuation prompt (paste-ready)

```
You're resuming "Artifact Share" — a single-admin Cloudflare Worker (Hono + D1 + R2) for sharing
confidential files behind per-recipient access codes, LIVE at share.scarson.io. Work in the
worktree at .claude/worktrees/eager-almeida-95f4ee (branch tracks dev). Read docs/HANDOFF.md
first, then the plan's Execution Status table and the two design docs it points at.

State: ALL phases (A–E) shipped and merged to main; production is deployed and green; 170 tests
pass, tsc + lint-config clean; no open PRs; nothing blocked. Assets live in private R2 (NOT git);
publishing is a runtime /admin upload. Admin is Cloudflare Access-gated.

If asked to build: brainstorm/design first, then TDD, then a blind adversarial-review round before
merging (owner granted agent merge authority CONDITIONAL on that review — see CLAUDE.md §Merge
authority). Respect the operational guardrails in HANDOFF: never push main; re-hash CSP when editing
ui/styles.ts; admin pages use Referrer-Policy same-origin; serve bundles at trailing slash; key-ring
secret formats; ACCESS_DEV_BYPASS is local-only. The only owner-only action outstanding is an
optional live mint→redeem→revoke smoke test through /admin (needs Google login) and optionally
setting ALERT_WEBHOOK_URL. Verify claims with real commands (npm test, curl the live site) before
reporting done.
```

---

**History:** the prior 2026-07-03 handoff (pre-R2 asset manager, pre-CI-token-fix) is preserved in
git — `git log -p docs/HANDOFF.md` shows the full evolution. It is fully superseded by the
checkpoint above and merged PRs #4–#7; do not act on it.
