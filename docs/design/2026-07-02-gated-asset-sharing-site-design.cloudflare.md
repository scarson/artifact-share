# Gated Asset Sharing Site — Design Spec (Cloudflare)

**Date:** 2026-07-02
**Status:** Cloudflare port of the 2026-07-01 REVISED design (`2026-07-01-gated-asset-sharing-site-design.REVISED.md`).
Same product, same security model, different platform primitives. Section numbering mirrors the
source so the two documents can be diffed section-by-section. Every security invariant of the
source is preserved; where Cloudflare changes the calculus (for better or worse) the change is
stated explicitly, never silently dropped.
**Repo:** github.com/oren-datanation/share-site

## Platform mapping (Vercel → Cloudflare)

| Concern | Vercel design (source) | Cloudflare design (this doc) |
|---|---|---|
| Compute | Next.js (App Router) serverless functions | Purpose-built Workers app (Hono router) — see §4 decision |
| Database | Neon Postgres via `@neondatabase/serverless` | **D1 (SQLite)** via binding — see §4/§15 Q4 |
| ORM/migrations | Drizzle + gated CI migration step | `wrangler d1 migrations` (or Drizzle-on-D1), gated CI step (§11) |
| Shared state (`totp_used_steps`, `rate_limits`) | Same Postgres DB | Same D1 DB (single-datastore rule preserved; DO is the named growth path, KV is disqualified) (§5/§9) |
| Password KDF | `@node-rs/argon2` (native) | **argon2id via WASM (`hash-wasm`)** — native addons don't run on Workers (§8) |
| TOTP / signing | `otpauth` / Node crypto HMAC | `otpauth` + WebCrypto `crypto.subtle` HMAC (both Workers-compatible) (§6/§8) |
| Asset bundling | `outputFileTracingIncludes` traces `assets/**` into the lambda | **Build-generated module map** (HTML imported as strings into the Worker bundle); private R2 as the growth path. Workers Static Assets explicitly rejected (§7) |
| Env detection | `VERCEL_ENV === 'production'` | Explicit **`ENVIRONMENT` var binding** per Wrangler environment (there is no platform equivalent of `VERCEL_ENV`) (§10) |
| Secrets | Vercel dashboard env vars | `wrangler secret put` per environment (write-only after set); `.dev.vars` locally (§10) |
| Preview isolation | Preview deploys + schema-only Neon branch DB | Wrangler `preview` environment + separate empty D1 database + **Cloudflare Access** on all non-prod hostnames (recommended, pending §15 Q3 ratification) (§10) |
| Preview DB risk | Neon branch = copy-on-write clone of prod (must avoid) | D1 has **no branching/cloning** — separate DB is empty by construction; risk becomes "mis-pointed `database_id`" (§10) |
| Edge cache | Vercel CDN honors `no-store`; `force-dynamic` routes | Worker responses are not edge-cached by default; `no-store` retained; operational "no Cache Rules on this zone" rule (§9) |
| DB durability | Neon free-tier PITR (limited) + manual exports | D1 **Time Travel** (30-day point-in-time restore) + `wrangler d1 export` (§11) |
| Bot/perimeter options | (none used) | Cloudflare Access, Turnstile, zone WAF/rate-limiting — offered as options, not silently adopted (§15 Q6–Q8) |

## What changed and why (summary)

- **Purpose-built Worker instead of Next.js.** The app is one gate route plus a small admin panel;
  it never needed React SSR. On Cloudflare, running Next.js means the OpenNext adapter (large
  bundle, its own CVE history, and framework-managed static assets that fight the "no static
  surface" invariant). A small Hono Worker makes invariant 14 *structural*: a Worker with no
  `assets` config has no prerendered or platform-served surface at all, so the two Vercel
  workarounds (`force-dynamic`, lazy DB connect at build time) disappear rather than being ported.
- **D1 instead of Neon.** The single-time-source, atomic-redeem, and DB-side-default invariants
  all survive translation to SQLite (shown concretely in §5/§6). D1 removes the connection-string
  secret class entirely (binding-authenticated), removes the copy-on-write-clone risk that drove
  H7, and adds 30-day point-in-time restore. The cost is a SQL dialect change and a beta-adjacent
  product; keeping Neon via Hyperdrive was evaluated and rejected (§15 Q4, owner-resolved in
  favor of D1) — it would insert a pooling/caching proxy between the gate and its single trusted
  clock, which is exactly the wrong place for one.
- **The asset-serving trap was confronted, not inherited.** On Workers, static assets are served
  by the *platform before the Worker runs* unless `run_worker_first` says otherwise. Putting
  confidential HTML in the assets directory would make the entire security model depend on one
  config key staying correct. Assets are therefore **bundled into the Worker as modules** — there
  is no public path to misconfigure (§7).
- **Cloudflare Access changes the §15 Q3 answer.** The Vercel design avoided paid Deployment
  Protection; Cloudflare Access is free at this scale and gates non-prod hostnames with SSO in one
  click. The app-level `ENVIRONMENT` gate is kept anyway (defense in depth, fail closed).
- **New residuals introduced by the platform are documented:** D1 read replication must stay off
  (§6), the Worker bundle-size ceiling bounds the bundled-asset mechanism (§7/§15 Q5), a
  memory-hard KDF requires the Workers Paid plan (§8/§15 Q9), and zone-level cache/WAF features
  are foot-guns that must not be enabled casually on this zone (§9).

> **Amendment (2026-07-03, owner-ratified):** §3 D3's "codes are non-recoverable" is superseded —
> codes are now ALSO stored AES-GCM-encrypted (`codes.code_enc`, `CODE_VAULT_KEY` secret) so the
> admin can re-show a sent link ("Show link" panel action). §8's "lost link ⇒ revoke + reissue"
> becomes "lost link ⇒ Show link; revoke if exposure is suspected". Hash-only lookup, no-plaintext,
> and no-logging invariants unchanged. Full rationale:
> `docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md` §2.

## 1. Purpose

A single-admin website for publishing self-contained interactive HTML "assets" (client reports,
dashboards, etc.) gated behind access codes. Content is confidential and shared to select external
recipients. Publishing is git-native: the admin adds an HTML file, commits, opens a PR to `main`,
and Cloudflare deploys the Worker. Access codes are managed at runtime through a web admin panel
(not git).

"Assets" is the chosen term — the content is not always reports.

## 2. Core decisions (from brainstorming — unchanged)

- **Code management:** web admin panel backed by a database (not a git-committed file).
- **Code ↔ asset:** one code unlocks one asset; an asset can have many codes (per-recipient),
  so codes can be expired/revoked individually.
- **Recipient access:** shareable link with the code embedded (`/a/<slug>?code=XXX`), one click,
  no typing.
- **Admin auth:** ~~master password **plus** TOTP 2FA~~ → **Cloudflare Access + Google SSO** (owner-ratified 2026-07-03; owner is in Google Advanced Protection). See §8 banner and §15 Q6.
- **Expiration:** optional to set; default **90 days** if unset; overridable per code
  (absolute date or duration); **instant revoke** always available.
- **Reuse:** codes are reusable until they expire or are revoked.
- **Asset content:** fully self-contained single HTML files to start; storage layout keeps
  the door open for sidecar assets (option B) later.

## 3. Threat model & accepted residual risk

Identical model to the source; only platform-specific surfaces are re-mapped.

- The **access code is the entire security boundary.** All mechanisms below exist to protect it.
- **Codes are stored hashed, never in plaintext (D3).** Only `SHA-256(code)` is persisted (§5); the
  raw code exists only transiently at generation time and in the recipient's link. A DB read, backup,
  D1 Time Travel restore, or the §11 export therefore leaks **no usable codes**. A fast hash is
  sufficient because a 128-bit code has no offline-guessing surface.
- **The reusable code travels in the URL — broad incidental-exposure surface (D4).** Unchanged in
  substance: the redemption request `GET /a/<slug>?code=XXX` can be captured by browser history and
  cross-device sync, endpoint/DLP telemetry, email-security link scanners, chat/link unfurlers,
  corporate proxies, and URL-preview services — all before or independent of the app. On Cloudflare
  the *platform-log* slice of this surface is **Workers Logs / Logpush / `wrangler tail`**, which
  record the request URL including the query string.
  - Mitigations within the current model: keep Workers observability **invocation logs** either
    disabled or on the shortest retention that still supports debugging; never `console.log` full
    URLs (log slug + outcome only); do **not** configure Logpush for this Worker (it exports
    URLs to an external store); restrict Cloudflare account/log access — and as with Vercel, do not
    assume the log-readers equal the code-minters. `Referrer-Policy: no-referrer` and the
    code-stripping redirect (§6/§9) carry over unchanged; **revoke + reissue** remains the standing
    response to any suspected exposure.
  - **This remains the single largest residual and is only partially mitigated.** §15 Q1 carries the
    two alternatives (one-time redemption token; fragment + same-origin POST) forward unchanged.
    Nothing about Cloudflare resolves it — the majority of the D4 surface is platform-independent.
- **Accepted tradeoff (D1):** whoever holds the original link+code can view the asset until it
  expires or is revoked. Response to a leaked link is **revoke + reissue**. The design minimizes
  *incidental* leakage but does not attempt device-locking or one-time-view semantics (declined).
- **Confidentiality of client identity (D2):** public slugs are **opaque, fixed-length** tokens.
  Friendly labels live only in the admin panel. See §7 for generation and enforcement (unchanged).
- **Enumeration resistance = entropy, not response parity.** Unchanged: the defense is the 128-bit
  CSPRNG code and opaque slug; byte-parity is kept only for the failure-vs-failure case. Rate
  limiting is defense-in-depth.
- **CSP residual (accepted; "trusted admin" framing remains optimistic).** Unchanged — the `'self'`
  CSP blocks background exfiltration but not top-level-navigation exfiltration; the sandboxed-iframe
  fix stays a §15 Q2 recommended reconsideration.
- **Availability tradeoff — fail closed on DB error.** Every asset load re-checks the code in D1
  (§6); if D1 errors or times out, the load is **denied**. Blast radius is bounded differently than
  on Vercel: D1 is reached via an in-platform binding (no external network hop, no connection-string
  handshake), and D1 auto-retries *read-only* queries (which covers the per-load recheck; it never
  retries writes, so the atomic redemption is not double-executed by the platform). A short
  app-level timeout wrapper around D1 calls preserves the fail-fast property.
- **New platform-trust note (same class as Vercel, made explicit):** Cloudflare terminates TLS and
  executes the Worker, so Cloudflare-the-operator sees codes in transit and holds the secrets at
  runtime, exactly as Vercel did. No change in trust model, only in vendor.

## 4. Stack

- **Cloudflare Workers + TypeScript, purpose-built app on the Hono router.** One Worker: gate
  route, admin UI (server-rendered HTML from Hono/JSX or template strings — no client framework),
  auth, DB access.
- **Decision — compute/framework (evaluated, not defaulted):**
  - *Next.js via `@opennextjs/cloudflare` (OpenNext)* — rejected. It would port the code most
    directly, but: (a) the adapter emits Next's static/client assets into Workers Static Assets,
    reintroducing a platform-served surface that must then be carefully scoped away from anything
    sensitive — friction directly against invariant D5/14; (b) it is a large moving dependency
    (multi-MiB bundle, its own security history — e.g. the adapter's 2025 SSRF advisory, fixed in
    v1.3.0 — plus Next.js's own middleware-bypass class), which is a poor trade for an app with two
    routes and no SSR/React needs; (c) the Vercel design's §4 workarounds (`force-dynamic`,
    build-time-import-safe DB client) exist *because* Next wants to prerender — porting Next means
    porting the workarounds.
  - *Cloudflare Pages + Functions* — rejected: Pages is in maintenance orbit (Cloudflare's own
    migration guides point at Workers), and Pages' automatic branch preview URLs are exactly the
    uncontrolled non-prod exposure §10 works to eliminate.
  - *Purpose-built Worker (Hono)* — **chosen.** Hono provides routing, middleware (headers on every
    response class), and typed bindings with a tiny footprint, runs identically under `wrangler dev`
    (Miniflare) and production, and has first-class Workers support.
- **D1 (SQLite) via binding + `wrangler d1 migrations`** — schema and migrations versioned in git
  (Drizzle-on-D1 is acceptable if ORM ergonomics are wanted; migrations still applied through the
  gated §11 step). Decision rationale in §15 Q4.
- **No static surface — now structural (D5).** The Worker has **no `assets` configuration at all**.
  Nothing is built ahead of time; every response is rendered per-request by the fetch handler, and
  no build-time artifact of gated content exists anywhere the platform could serve. The two Vercel
  consequences are replaced by their Cloudflare analogues:
  (a) there is no prerender step to suppress — a Worker cannot statically serve anything unless
  assets are explicitly configured, and they are not (a code-review invariant: **the `assets` key
  MUST never be added to `wrangler.jsonc`** — see §7 for why even `run_worker_first` is not an
  acceptable escape hatch);
  (b) the build-time-import trap is gone — D1 is a runtime binding on `env`, not a module-load-time
  connection, so there is nothing to "connect lazily." `robots.txt` and the failure page are
  Worker-rendered responses, not files.
- **Workers Paid plan is required** (10 ms free-tier CPU cannot run a memory-hard KDF, §8; the paid
  10 MiB script limit also gives the bundled-asset mechanism its headroom, §7). Confirmed — the
  owner is on Workers Paid (§15 Q9, resolved).

> **Amendment (2026-07-03, owner-approved) — R2 asset manager (2026-07-03):** §7's bundled Text-module
> mechanism is superseded. Asset bytes now live in a private R2 bucket (binding-only, no public URL);
> metadata (slug/title/versions/active pointer/public flag/alias) lives in D1. §13's integrity alert
> re-points from "module missing from the bundle" to "active version's R2 object missing"
> (`asset_object_missing`). The `assets`-key ban and no-static-surface invariants are unchanged.
> A public-asset toggle + alias routes were added (design §Part C). Full detail:
> `docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md`.

## 5. Data model

All DDL below is SQLite (D1). **Time is stored as INTEGER Unix epoch seconds** — SQLite has no
`TIMESTAMPTZ`; integer epoch is timezone-unambiguous by construction and is the direct analogue of
the source's "TIMESTAMPTZ everywhere" decision.

### `assets` (unchanged concept)
Assets are defined by files in the repo; the DB does not own them. The runtime source of truth for
"which assets exist" is the build-generated manifest module (§7). The admin panel reads it.

### `codes` table

| column | notes |
|---|---|
| `id` | `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))` — 128-bit random id minted **DB-side** (the `code_id` referenced by the asset cookie). Note: SQLite's `randomblob()` is not documented as cryptographically secure — acceptable here because `id` is **not a secret** (it is only a lookup key, and it reaches the client only inside an HMAC-signed cookie); it must never be treated as one. |
| `code_hash` | `TEXT NOT NULL UNIQUE` — **SHA-256 of the access code** (hex). The raw code is 16 CSPRNG bytes (`crypto.getRandomValues`) → base64url (**128-bit**); only its hash is stored — the **raw code is never persisted** (shown once at creation, §8). Redemption looks up by `SHA-256(code)`. On the astronomically unlikely unique-violation at generation, **retry with a new code** — surface nothing. (D3, §3.) |
| `asset_slug` | `TEXT NOT NULL` — opaque slug of the asset this code unlocks |
| `label` | `TEXT NOT NULL` — admin-only recipient note, e.g. "Acme Corp – CFO" |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` |
| `expires_at` | `INTEGER NOT NULL DEFAULT (unixepoch() + 7776000)` — **DB-side 90-day default** (7 776 000 s); overridable at insert (see predicate below) |
| `revoked_at` | `INTEGER` nullable; set on revoke |
| `last_used_at` | `INTEGER`; set on each redemption |
| `use_count` | `INTEGER NOT NULL DEFAULT 0`; incremented on each redemption |

**Validity predicate:** a code is valid iff it exists AND `revoked_at IS NULL` AND
`expires_at > unixepoch()`. Lookups are by indexed `code_hash` (redemption) and by `id` (per-load
cookie recheck). **Single trusted time source = the database — preserved.** `created_at`, the
default `expires_at`, and every `expires_at > unixepoch()` comparison evaluate **on the D1 primary's
clock inside the SQL statement**, never on Worker wall-clock (`Date.now()` in a Worker is both
untrusted for this purpose and deliberately coarsened by the runtime). SQLite specifics that make
this sound:
- `DEFAULT (unixepoch() + 7776000)` is a parenthesized default expression — valid SQLite, evaluated
  at insert time on the DB engine. (Verified as part of the §12 spike on a real D1 database, since
  D1 tracks but does not document every SQLite corner.)
- Within a single statement, SQLite's date/time functions evaluate `'now'` **once per statement
  step**, so every `unixepoch()` in the §6 atomic redeem sees the same instant — the same property
  the Postgres design got from transaction-stable `now()`. (Per-*step* stability suffices here
  specifically because `code_hash` is UNIQUE, so the atomic UPDATE touches at most one row in a
  single step.)
- **D1 read replication MUST remain disabled on this database** (it is off by default and opt-in).
  A lagged replica read on the per-load recheck would delay revocation — a silent break of
  invariant 5. If replication is ever wanted for other reasons, every gate query must run in a
  `withSession('first-primary')` session; simpler to just never enable it. This is a **standing
  configuration invariant**, the D1 analogue of "use the Neon serverless driver."

**`use_count` semantics:** unchanged — counts **redemptions**, not viewers; the admin UI labels it
"redemptions."

### Supporting tables (shared state)

Workers have no shared in-memory state (isolates are per-PoP and evanescent), so shared state lives
in D1 — **the single-datastore rule from the source (§9) is preserved: one store, one set of
bindings, works identically in local dev.** The evaluated alternatives:
- **KV — disqualified** for both tables: KV is eventually consistent (writes take up to ~60 s to
  propagate across PoPs; concurrent writes last-write-win). A TOTP replay check on KV could accept
  a replayed step at another PoP inside the window, and a KV "counter" under-counts by design.
  Note this disqualification also **retires the source design's "Vercel KV as growth path" note —
  the correct Cloudflare growth path is Durable Objects,** not KV.
- **Durable Objects — viable, deferred.** A DO gives strongly-consistent, single-threaded atomic
  state and would fit both the limiter and TOTP replay. It is not chosen *now* because (a) D1's
  single-writer upserts already provide the required atomicity (below), (b) a DO introduces a
  second stateful subsystem and a **second clock** — limiter windows would be computed on DO
  wall-clock, diluting invariant 4, whereas D1 windows use `unixepoch()` on the same DB clock as
  everything else, and (c) traffic is single-admin/low-volume. Recorded as the growth path in §15 Q4b.

| table | purpose |
|---|---|
| `totp_used_steps` | `step INTEGER PRIMARY KEY, used_at INTEGER NOT NULL DEFAULT (unixepoch())`. The **exact matched** TOTP time-step is inserted **only after the password also verifies**; the insert is a single `INSERT ... ON CONFLICT(step) DO NOTHING` and D1's returned `meta.changes === 0` means **replay → reject** (§8). Single admin, so `step` alone suffices; re-key to `(admin_id, step)` if multi-admin ever arrives (§14). Rows older than the ±1 window are pruned lazily with a DB-time predicate. |
| `rate_limits` | `key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL`. Backs the per-slug/global and login limiters (§9); windows compared using `unixepoch()` (single time source, above); pruned lazily. Increments **MUST be atomic** — one upsert, not read-then-write: |

```sql
INSERT INTO rate_limits (key, count, window_start)
VALUES (?1, 1, unixepoch())
ON CONFLICT(key) DO UPDATE SET
  count        = CASE WHEN window_start <= unixepoch() - ?2 THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start <= unixepoch() - ?2 THEN unixepoch() ELSE window_start END
RETURNING count;
```

(`?2` = window length in seconds.) SQLite upsert (`ON CONFLICT ... DO UPDATE`) and `RETURNING` are
both supported by D1; single statements execute atomically on the single-writer primary
(auto-commit), which is what makes this counter lost-update-free.

## 6. Access flow (gate + redemption)

Redemption-redirect model, unchanged step-for-step; only the SQL dialect and error taxonomy are
re-expressed.

1. Recipient opens `/a/<slug>?code=XXX`.
2. **Redemption precedence:** if `?code=` is present, the server **always** validates it and
   re-issues a fresh cookie, ignoring any existing cookie (a re-clicked link stays authoritative
   even after a cookie-secret rotation). The code check: exists, not revoked, not expired,
   `asset_slug` matches `<slug>`.
3. **On failure:** a single generic "This link is invalid or has expired" page — **byte-identical**
   (same `200` body/headers) whether the slug is unknown or the code is wrong. Success returns a
   `302`, inherently distinguishable; anti-enumeration rests on 128-bit entropy (§3).
   - **Uniform failure code path (no timing oracle):** the primary lookup is by `SHA-256(code)` and
     the slug is validated *against the matched code's* `asset_slug`; the server MUST NOT
     short-circuit on "slug not in manifest" before the code lookup. Always run the constant-work
     code lookup, then compare `asset_slug`, then fail. Byte-parity covers body/headers;
     path-uniformity covers timing. In the Hono implementation this means the failure page is
     produced by exactly one function, and the manifest is consulted only *after* (or never) on the
     failure path — same discipline as the source.
   - **Timing-distinction taxonomy (restated for Cloudflare):**
     - *Must be uniform:* unknown-slug vs wrong-code when `?code=` is present.
     - *Accepted as distinguishable:* malformed slug (fails `^[A-Za-z0-9_-]{22}$`) may fast-reject;
       a rate-limited request may return early. These reveal request *shape* only.
     - *Not attacker-reachable:* the missing-asset-module branch (§13) fires only after a valid code.
     - *New, accepted, platform class:* infrastructure failures (Worker exception, CPU-limit
       error 1102, D1 outage) produce Cloudflare- or app-generated error responses that are not
       byte-identical to the failure page. They are **fail-closed denials** (no cookie is ever
       issued on these paths) and occur independently of the `(slug, code)` relationship, so they
       leak nothing an attacker controls; parity is not extended to them.
4. **On success (redemption):**
   - **Validate and record usage in one atomic step, then issue the cookie only if it succeeds.**
     One conditional statement, D1 dialect:

     ```sql
     UPDATE codes
     SET use_count    = use_count + 1,
         last_used_at = unixepoch()
     WHERE code_hash  = ?1
       AND revoked_at IS NULL
       AND expires_at > unixepoch()
       AND asset_slug = ?2
     RETURNING id,
               unixepoch()                      AS iat,
               min(unixepoch() + 86400, expires_at) AS cookie_exp;
     ```

     Validity check, usage write, and the cookie's `iat`/`cookie_exp` are all computed **in one
     atomic statement on DB time** (scalar `min()` is SQLite's `LEAST`; `expires_at` is `NOT NULL`
     so `min()` cannot see a NULL). D1 executes single statements atomically on the single-writer
     primary, and never auto-retries writes — so there is no platform path that double-increments.
     **Row returned → issue the cookie (returned `id`, `iat`, `cookie_exp`). No row → failure
     (step 3). Statement errors/times out → fail closed, no cookie.** Never issue access without a
     successful atomic write; never write usage without issuing access.
   - Set a signed cookie `asset_access_<slug>`: **HttpOnly, Secure, SameSite=Lax,
     `Path=/a/<slug>`**. Payload binds `{v, kid, slug, code_id, iat, cookie_exp}` — never the raw
     code, nothing JS-readable. `cookie_exp` and `iat` are the **DB-returned** values above — this
     is the cookie's own TTL, not an authorization check; the authoritative check is always the
     per-load lookup on `code_id` (step 5). **Token format unchanged from the source:** `v` schema
     version + `kid` key id; **canonical encoding** (fixed binary layout preferred; if JSON, the
     parser MUST reject duplicate keys — plain `JSON.parse` cannot); base64url segments;
     **HMAC-SHA256 over the exact encoded bytes** using the `kid`-selected key from the
     `ASSET_COOKIE_SECRET` ring (§10), computed with **WebCrypto `crypto.subtle`** (native on
     Workers — no library needed for HMAC); verified with a length check then constant-time
     comparison; **strict schema validation** rejecting unknown/duplicate/missing fields and any
     unrecognized `v`/`kid`. `Max-Age` mirrors `cookie_exp`; a tampered attribute breaks nothing
     because the payload is signed.
   - **302-redirect to `/a/<slug>`** (code stripped). The redirect carries
     `Cache-Control: no-store` (§9).
   - **`SameSite=Lax` is required** (not Strict) — unchanged rationale and accepted residual.
5. On the clean `/a/<slug>` load with **no `?code=`**: first validate the path `<slug>` against
   `^[A-Za-z0-9_-]{22}$` **before it touches the DB or the module map** (defense-in-depth; the
   runtime enforces shape independently of the build). Then verify the cookie signature (and that
   its `{slug}` matches the path). Invalid/absent signature → generic failure page. Valid → a
   **cheap indexed D1 lookup on `code_id`** confirms the code is still valid. **This recheck is
   mandatory and runs even for a signature-valid cookie that was exempted from the rate limiter
   (§9)** — the signature only gates the limiter skip, never authorization. This is what makes
   **revocation effectively instant**. Usage is **not** re-written on these loads.
   - **Fail closed on D1 error (§3):** lookup errors/times out → denied (generic page), never
     served from the cookie alone. Wrap D1 calls in a short app-level timeout so a blip fails fast.
     (D1's automatic retry applies only to this read-only class and stays within the timeout
     budget; it improves availability without weakening fail-closed.)
   - **No conditional per-cookie messaging** — unchanged. One byte-identical failure page with
     static, generic-but-helpful copy for everyone: *"This link is invalid or has expired. If you
     were sent a link, please re-open it from your original message, or contact the sender."*
6. The asset HTML is loaded from the **bundled module map** (§7) — an in-memory import, not a disk
   read — and returned with the §9 headers.

**Cookie TTL: 24 hours** (and never beyond the code's `expires_at`) — unchanged, including the
rationale (caps a stolen-cookie window; per-load recheck already gives instant revocation).

## 7. Asset storage, manifest & serving

- Assets stored as **`assets/<slug>/index.html`** in the repo (folder-per-asset). `<slug>` is an
  opaque, fixed-length token: exactly **22 base64url chars** = 16 CSPRNG bytes (128-bit), so no
  slug can be a path-prefix of another (cookie-`Path` collision class stays closed).
- **Slug creation (git-native flow) — unchanged:** `npm run new-asset` mints the token, scaffolds
  `assets/<token>/index.html`, prints the slug, and appends to the generator registry.
- **Build step** scans `assets/*/` and, for each: extracts `<title>` (slug fallback); **fails the
  build loudly** on duplicate slug, shape-check failure, or a slug **absent from the generator
  registry**; runs the **advisory external-origin scan** — still a lint, not the boundary (CSP is
  the boundary, §9), and still under the source's hardening clause, carried verbatim: if it is to
  be relied on at all it MUST use a real HTML/CSS parser with an explicit denied-construct list
  (regexes cannot cover `srcset`, CSS `@import`/`url()`, SVG `<use>`, `<meta refresh>`, import
  maps), with §13 build tests covering those surfaces; and emits **two generated modules** at a
  non-routable path:
  - `.generated/assets-manifest.ts` — the slug→title map, imported server-side only;
  - `.generated/assets-modules.ts` — a map from slug to the asset HTML, importing each
    `assets/<slug>/index.html` **as a string module** (Wrangler `rules` `Text` module type), so the
    HTML is compiled into the Worker bundle.
- **Serving mechanism — DECISION (the central Cloudflare translation):**
  - *Workers Static Assets — REJECTED for confidential content.* On Workers, files in the `assets`
    directory are **served directly by the platform, before the Worker script runs**, unless
    `run_worker_first` routes them through the Worker. Even with `run_worker_first: true`, every
    confidential file would sit at a public, slug-guessable path whose protection is **one config
    key** — a dropped flag, a narrowed glob, or a future "optimization" re-exposes everything,
    silently, with no test tripwire at build time. That converts invariant 14 from a structural
    property into a configuration promise. Rejected; and consequently **the Worker ships with no
    `assets` config at all** (§4).
  - *Bundled module map — CHOSEN.* The HTML strings live inside the Worker script itself. There is
    **no public path** — the only door is the gate handler, definitionally. Deploys are **atomic**:
    asset content, manifest, registry, and gate code version together (no window where code and
    content disagree; rollbacks stay coherent), which is exactly the git-native model. The Vercel
    §12 bundling spike ("works locally, 404s in prod") disappears: a missing module is a
    **build-time error**, not a runtime 404.
  - *Private R2 bucket — the documented growth path, not adopted now.* Bundling is bounded by the
    Worker script limit (**10 MB gzipped on paid**; the app itself is small, so the practical
    budget for asset HTML is ~8–9 MB compressed). Self-contained interactive reports can be large;
    when the total approaches the ceiling — or when sidecar/multi-file assets (§14) arrive — move
    asset bodies to a **private R2 bucket** (no public access, no custom domain, read only via the
    Worker binding after the §6 checks; R2 is strongly consistent, so publish-then-read is safe).
    The build step then uploads `assets/**` to R2 keyed by slug as a deploy step and the module map
    shrinks to the manifest. R2 read failure for a valid code = the §13 integrity-alert path (fail
    closed + page someone). This threshold is an owner decision — §15 Q5.
- **The manifest is confidential and server-only (D2) — strengthened.** On Vercel this required
  keeping the file at a non-served path; here `.generated/assets-manifest.ts` is compiled into the
  Worker and **there is no static file system to route to at all**. The §13 deny tests are kept
  anyway as regression tripwires (they now assert the *router* returns the generic 404/failure
  behavior for `/assets/manifest.json`, `/a/manifest.json`, `/a/<slug>/manifest.json`).
- **Serving:** the gate handler returns the asset HTML only after the §6 checks **and** the runtime
  slug-shape check. Since lookup is a map lookup by validated slug (not a filesystem path), the
  traversal class is structurally gone; the shape check is retained as defense-in-depth and as the
  limiter-bucketing predicate (§9).
- **Cookie `Path` scoping** — unchanged: fine for single-`index.html`; re-evaluate for sidecars
  (§14); `__Host-` cookies remain unavailable (they force `Path=/`).

## 8. Admin authentication & panel

> **UPDATE (2026-07-03, owner-ratified — supersedes the password+TOTP mechanism below):** admin
> authentication is now **Cloudflare Access + Google SSO** (§15 Q6, flipped from "additional layer"
> to "replace"). The owner is enrolled in Google Advanced Protection (hardware-key, phishing-resistant
> MFA), which makes an app-maintained password+TOTP redundant. Cloudflare Access authenticates at the
> edge — an Access application scoped to **`/admin` only, never `/a/*`** — and the Worker
> INDEPENDENTLY verifies the `Cf-Access-Jwt-Assertion` JWT (RS256 signature via the team JWKS at
> `${TEAM_DOMAIN}/cdn-cgi/access/certs`, pinned issuer + audience) and confirms the `email` claim is
> the configured admin, so a request reaching the Worker *bypassing* Access is still denied. Local
> `wrangler dev` (no Access edge) uses an `ACCESS_DEV_BYPASS=1` flag confined to the gitignored
> `.dev.vars` and **linted out of any committed/deployed config** (the build fails on its presence in
> `wrangler.jsonc`). Carried over unchanged: the production-only `ENVIRONMENT` gate, pinned-origin
> CSRF on POST mutations, show-once codes, orphan flagging, and the panel. The subsections below
> (argon2id/`hash-wasm` KDF, TOTP replay, key-ring session, login throttle) are retained as historical
> rationale but are **no longer implemented** — the code, the `@node-rs/argon2`/WASM discussion, the
> `ADMIN_PASSWORD_HASH`/`ADMIN_TOTP_SECRET`/`SESSION_SECRET` secrets, and the `@noble/hashes`/`otpauth`
> dependencies have been removed.

- **`/admin/login`:** master password + 6-digit TOTP. Unchanged flow.
- **Password — the Workers KDF decision (confronted, not assumed):** the Workers runtime has
  WebCrypto but **no Node native addons**, so `@node-rs/argon2` cannot run. **Chosen: argon2id
  compiled to WASM via `hash-wasm`.** WASM runs first-class on Workers; the cost profile fits
  comfortably: OWASP-pinned parameters (**argon2id, ≥19 MiB memory, ≥2 iterations, parallelism 1** —
  parallelism >1 buys nothing in the single-threaded isolate) need tens-to-low-hundreds of ms of
  CPU and <64 MiB memory — well inside the paid plan's 30 s default CPU limit and 128 MB isolate
  memory, and the login endpoint is throttled (below) so KDF cost per attempt is a feature.
  **This is viable only on Workers Paid** (free tier's 10 ms CPU cannot run any memory-hard KDF);
  see §15 Q9. *Stated honestly: there is no credible free-tier fallback.* The only WebCrypto-native
  alternative is PBKDF2 (`crypto.subtle.deriveBits`), but at defensible iteration counts (≥600k
  SHA-256) it also far exceeds a 10 ms CPU budget — a PBKDF2 weak enough to fit the free tier is
  not a password KDF worth the name. PBKDF2 is therefore recorded only as the fallback **if some
  future constraint bans WASM specifically** (not as a free-tier path), and it is **not
  memory-hard** — that residual (GPU/ASIC-friendly offline grinding if the hash leaks) would need
  explicit acceptance. The plan requirement in Q9 is hard, not preferential.
  - Stored in secret `ADMIN_PASSWORD_HASH`; verification uses the library's constant-time verify.
    A local **`npm run hash-password`** helper generates the hash to paste into
    `wrangler secret put ADMIN_PASSWORD_HASH --env production`. Rotate by regenerating and re-putting.
- **TOTP:** secret in `ADMIN_TOTP_SECRET`; verification via **`otpauth`** (pure-JS/WebCrypto —
  works on Workers; `jose` likewise if JWTs are ever needed, though §6 cookies use raw
  `crypto.subtle` HMAC). **±1-step window; replay rejection** via `totp_used_steps` (§5): the
  matched step is inserted `ON CONFLICT DO NOTHING` and `meta.changes === 0` → replay → reject.
  The step is consumed **only after the password verifies** (a wrong-password attempt can neither
  burn steps nor probe replay state).
- **Recovery:** re-run the local TOTP setup script (mints a new secret + QR together), then
  `wrangler secret put ADMIN_TOTP_SECRET --env production` and scan. **Note:** on Cloudflare,
  Worker secrets are **write-only after they are set** (not readable in dashboard or API) — a
  strict improvement over readable Vercel env vars for casual exposure. The trust statement still
  stands with one word changed: anyone with **deploy/edit rights on the Worker or account** can
  *replace* secrets or ship code that exfiltrates them, and can thus mint codes — lock down
  Cloudflare account membership and API tokens accordingly.
- **Production-only:** all `/admin/*` routes are gated on the **`ENVIRONMENT` binding ==
  `'production'`** (§10; there is no `VERCEL_ENV` — the var is bound explicitly per Wrangler
  environment) and return the generic page otherwise. Same rationale: codes are only ever minted
  against production.
- **Session:** unchanged — signed **HttpOnly, Secure, SameSite=Strict** cookie, **7-day** expiry
  **inside the signed payload** (`{v, kid, iat, exp}`, same canonical-encoding/key-ring discipline
  as the asset cookie), enforced server-side; `SESSION_SECRET` ring. Hono middleware guards all
  `/admin/*` except the login page.
- **CSRF:** unchanged policy — POST-only mutations; **require `Origin` equal to the production
  origin** (a config var, e.g. `PUBLIC_ORIGIN`, per environment); `Referer` same-origin fallback if
  `Origin` absent; **reject cross-site, malformed, or missing-without-valid-fallback**;
  `Sec-Fetch-Site` accepted as corroboration, not required. SameSite=Strict stays defense-in-depth.
- **Rate limiting on login:** unchanged — single admin ⇒ **throttle/exponential backoff, never
  hard-lock** (a lockout is an attacker-triggerable DoS); backed by `rate_limits` (§5).
- **Panel features:** unchanged — list assets (from manifest); per-asset code list showing **label
  and status only, never a code value**; generate code (asset, label, optional expiry → 90-day DB
  default); **raw code / full link shown exactly once at generation** (API-key style); revoke;
  lost link ⇒ revoke + reissue; **flag orphaned codes** whose `asset_slug` left the manifest.
- **Admin identity — Cloudflare Access + Google SSO (production), IMPLEMENTED 2026-07-03:** the
  Zero-Trust SSO wall is now the admin identity mechanism (not merely a layer) — see the §8 banner
  and §15 Q6. Access authenticates at the edge; the Worker independently verifies the
  `Cf-Access-Jwt-Assertion` JWT (team-JWKS signature, pinned issuer + audience) and re-checks the
  admin email, so the Worker still enforces its own authorization boundary. Access outage/misconfig
  is an accepted single point for **admin login only** (never recipients); break-glass is dashboard
  control of the Access app. *(Historical: this was originally offered as defense-in-depth in front
  of the app's own password+TOTP; the owner's Google Advanced Protection membership made the separate
  app-maintained factor redundant, so it replaced rather than layered.)*

## 9. Security headers & crawler defense

- **`robots.txt`:** `User-agent: *` / `Disallow: /` — rendered by the Worker (no static files).
- **`X-Robots-Tag: noindex, nofollow, noarchive`** on every response.
- **`Referrer-Policy: no-referrer`** — unchanged.
- **`Cache-Control: no-store`** (+ `Pragma: no-cache`) on **all** gate responses (redemption `302`,
  asset `200`, failure page) — unchanged, and still load-bearing for browser/proxy caches.
- **`Strict-Transport-Security: max-age=63072000`** — unchanged, including the
  `includeSubDomains`/`preload` caution. (Cloudflare has a zone-level HSTS toggle; the header stays
  **app-emitted** so it is testable in §13 and portable — enabling the zone toggle additionally is
  harmless belt-and-braces.)
- **`X-Content-Type-Options: nosniff`** — unchanged.
- **Asset CSP — unchanged verbatim:** `default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none';
  frame-src 'none'; worker-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  — same accurate framing: blocks background exfiltration; does **not** block top-nav exfiltration
  (§3 residual, §15 Q2).
- **Admin CSP — unchanged:** `default-src 'self'; frame-ancestors 'none'; base-uri 'none';
  object-src 'none'; form-action 'self'`, no `'unsafe-inline'` (the admin UI is first-party;
  server-rendered Hono HTML needs no inline script).
- In Hono these are one **response-finalizing middleware** applied to every response class —
  redemption/asset/failure/admin — which §13 asserts per class.
- **Edge-cache reconciliation ("no static surface" vs Cloudflare's cache) — confronted:**
  - Worker-generated responses to eyeball requests are **not cached by Cloudflare's edge** (the
    Worker runs in front of the cache; such responses report `cf-cache-status: DYNAMIC`/none).
    `no-store` governs browsers/intermediaries. So the default posture is already correct.
  - The gate code **MUST NOT** use `caches.default` / the Cache API, `fetch(..., {cf: {cacheTtl,
    cacheEverything}})`, or Smart Placement-adjacent caching for any gated response.
  - **Zone-level foot-guns (operational invariants, documented because they are one dashboard
    click away):** no **Cache Rules** ("cache everything" / Edge TTL overrides) matching this
    hostname; no **Cache Response Rules** that strip or override `no-store`; no APO. Any of these
    can overrule origin `Cache-Control` — that is their purpose — and would create exactly the
    cacheable copy of gated content that D5 forbids. The same runbook line covers **HTML-rewriting
    zone features** (Rocket Loader, Email Obfuscation, Mirage, Cloudflare Fonts): they inject or
    rewrite markup in HTML bodies — including Worker-generated ones — which would put third-party
    inline script inside confidential asset bodies and break the §6 byte-identical-failure
    property. All such features stay **off** for this hostname. §13 adds deployed-environment
    probes (assert `cf-cache-status` is absent/DYNAMIC and never HIT on `/a/*`; assert responses
    arrive byte-identical to what the Worker emitted).
- **Codes are 128-bit CSPRNG** — entropy remains the primary defense.
- **Rate limiting** on `/a/*` and `/admin/login`, backed by the `rate_limits` D1 table (§5), keyed
  **per-slug and globally**, not per-IP alone. All source semantics preserved:
  - **Valid-cookie loads are limiter-exempt, never authorization-exempt.** Verify the cookie
    signature *only* to decide the limiter skip; then always run the §6 step-5 DB recheck
    (revoked/expired → deny; DB error → fail closed). The limiter targets unauthenticated traffic;
    per-slug is primary; global is a high-water circuit-breaker; login throttles (§8).
  - **Bounded row cardinality:** shape-check first; **bucket malformed and non-manifest slugs into
    fixed keys** (`bad-shape`, `unknown-slug`); only known-manifest slugs get per-slug buckets;
    prune via indexed `window_start`. (Ordering note, stated precisely so it can't be misread
    against §6: the manifest lookup for **limiter keying** may — and when the limiter can deny
    pre-response, must — run before the code lookup. That is compatible with the §6 uniform
    failure path provided the lookup is **unconditional for every well-formed slug** and its
    result only selects a limiter key; the prohibited behavior is *returning the failure response
    early* on a manifest miss, which would reintroduce the unknown-slug/wrong-code timing split.)
  - The limiter remains **defense-in-depth and fails open** (a `rate_limits` write error never
    denies a request); authorization always **fails closed**. The atomic upsert (§5) prevents
    under-counting.
  - *Optional outer layer:* Cloudflare **zone rate-limiting rules / WAF** can throttle abusive
    traffic before it reaches (and bills) the Worker. Useful, but configured carefully: **never a
    challenge action on `/a/*`** (an interstitial breaks one-click-from-email and the no-JS
    property) — block/throttle actions only, thresholds far above the app limiter. Option in §15 Q8.
    Similarly **Turnstile is NOT used on `/a/*`** (JS challenge breaks recipient UX); optionally on
    `/admin/login` only (§15 Q7).
- **`/`** stays deliberately neutral/blank.

## 10. Secrets & environments

Secrets via `wrangler secret put <NAME> --env <environment>` (never in the repo; `.dev.vars*` files
git-ignored for local dev): `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`,
`ASSET_COOKIE_SECRET`. Wrangler's `secrets.required` list is declared in config so a deploy fails
loudly if any secret is missing in the target environment. **There are no database credentials at
all** — D1 is a binding, which deletes the `POSTGRES_*` secret class from the source design.

- **Environments:** two Wrangler environments in one config — `production` and `preview` — deployed
  as **separate Workers** with disjoint, non-inheritable binding sets:
  - separate **D1 databases** (`share-site-prod`, `share-site-preview` — distinct `database_id`s);
  - separate **secrets** (per-environment `wrangler secret put`);
  - an explicit **`ENVIRONMENT` var** bound to `"production"` / `"preview"` — the app's only
    environment oracle (never inferred from hostname or URL).
  - Production routes only on the custom domain; **`workers_dev = false` and preview URLs disabled
    on the production Worker** (current Wrangler defaults preview-URL state to the workers.dev
    setting, but both are pinned explicitly — accidental alternate hostnames are exactly the
    exposure class §9 of the source worried about with Vercel deployment URLs).
- **Non-prod must gate BOTH `/a/*` AND `/admin/*` — invariant 13 preserved, mechanism doubled:**
  1. **App-level (fail-closed):** the `ENVIRONMENT` gate returns the generic page for `/admin/*`
     *and* `/a/*` off-production. QA of the real gate flow happens in **local dev (`wrangler dev`,
     Miniflare-local D1)** — the Cloudflare replacement for `vercel dev`, with strictly better
     isolation (local SQLite file, no cloud resources at all).
  2. **Perimeter-level (new, free, recommended — adopted pending §15 Q3 ratification):**
     **Cloudflare Access** on every non-production hostname (one-click for workers.dev/preview
     URLs, or an Access app over the preview route) — SSO-gating the whole preview Worker so even
     the generic pages and any future mistake sit behind authentication. This resolves the
     *"Vercel Deployment Protection is paid"* constraint that shaped the source design; §15 Q3 is
     where the owner confirms or declines this second layer (the app-level gate above is the
     design's own fail-closed boundary either way).
  - **Non-prod DB is schema-only — now structural:** D1 has **no copy-on-write branching**; the
    preview database is a separate, empty database that only ever receives migrations. The H7
    "branch = clone of prod codes" failure class **cannot occur**. The residual it leaves is
    thinner but real: a **mis-pointed `database_id`** (preview env accidentally bound to the prod
    DB) would reconnect preview compute to prod data. Because serving is **production-only** (the
    app-level gate's positive allow — local QA opts in explicitly against a local database), a
    mis-bound non-prod Worker cannot serve that data regardless; the residual is handled as a
    config-review invariant plus an **operator binding audit**: a one-row `meta` table carries the
    environment name (written at migration bootstrap, set per environment at provisioning), and
    setup + production verification assert each Worker's database returns the expected marker.
  - Even with all of the above, preview builds still **bundle** the branch's confidential asset
    HTML into the preview Worker (bundled-module mechanism, §7). Access-gating the preview
    hostname is what closes that; the source's hygiene rule — don't publish genuinely sensitive
    assets through previews reachable by anyone outside the Access policy — carries over.
- **Rotation via key rings (`kid`) — unchanged.** `SESSION_SECRET` and `ASSET_COOKIE_SECRET` are
  key rings (sign with current, verify current+previous, reject retired). **Rotation is still not
  the response to a suspected code exposure — revoke + reissue is** (§3/§8). Wrangler secrets
  update atomically with a new deployment version, so ring rotation needs no downtime.

## 11. Git → Cloudflare pipeline

- **Branches:** `main` (production), `dev` (integration). Deploys via CI (Workers Builds or GitHub
  Actions running `wrangler deploy`): `main` → `--env production`; `dev`/PRs → `--env preview`
  (behind Access, §10).
- **Publishing an asset:** `npm run new-asset` → edit `assets/<slug>/index.html` → commit → PR into
  `main` → merge triggers the production deploy (build regenerates manifest/module map; §7 checks
  can fail the build) → then open `/admin` and generate a code. A code can only be generated for an
  asset after it is deployed and in the manifest — matching the workflow.
- **Migrations:** `wrangler d1 migrations apply share-site-prod --env production --remote` as a
  **gated, `main`-only release step** before the production `wrangler deploy` — not on previews.
  Preview migrations apply to the preview DB from the preview pipeline. Properties, restated
  honestly for D1:
  - **Forward-only** is native to D1 migrations (there is no down-migration concept); rollback is
    **code-only, never schema** — a panicked `wrangler rollback` (or versions re-deploy) must not
    hit a schema-behind-code mismatch, so migrations stay additive/compatible one release back.
  - D1 records applied migrations in the `d1_migrations` table and applies sequentially, but it has
    **no advisory-lock equivalent** — concurrent deploy jobs are serialized in CI instead (e.g. a
    GitHub Actions `concurrency` group on the deploy workflow). This replaces the source's
    Postgres advisory-locking note with the honest platform equivalent.
- **DB durability:** better than the source's position. D1 provides **Time Travel** point-in-time
  restore natively — **30 days on Workers Paid** (confirmed plan, §15 Q9; the Free tier would
  drop this to 7 days) — plus `wrangler d1 export` for periodic offline exports so a
  database-loss event can't permanently lock out all recipients.
- **Migration dialect caveat (forward-only meets SQLite):** SQLite accepts the non-constant
  `DEFAULT (unixepoch() + 7776000)` in `CREATE TABLE` but **rejects non-constant defaults in
  `ALTER TABLE ADD COLUMN`** — any future migration that adds or reshapes such a column must be a
  table-rebuild migration (create-new → copy → rename), not an `ADD COLUMN`. Stated here so a
  future forward-only migration doesn't discover it in production.
- **Backups/exports are confidential even with hashed codes (D3) — unchanged and extended to the
  platform:** exports and Time Travel restores still contain `asset_slug`, recipient **labels
  (client identities, D2)**, usage timestamps, and expiries — the client list and sharing graph.
  Treat exports as confidential (encrypt at rest, restrict access, retention limit, minimal
  labels). Note that **D1's Time Travel retention means deleted rows remain restorable for 30
  days** — deleting a code/label does not scrub it from the platform's history window; acceptable
  here (the data is ours), but stated so nobody mistakes deletion for erasure.

## 12. Implementation order (notable)

1. **Dialect spike first (replaces the Vercel bundling spike):** on a real remote D1 database —
   not only Miniflare — verify the two SQLite mechanisms this design leans on: the **atomic
   redemption `UPDATE … RETURNING`** (with `min()`/`unixepoch()`) and the **expression column
   default** `DEFAULT (unixepoch() + 7776000)`. Both are standard SQLite and expected to pass;
   they are load-bearing, so they get proven before anything is built on them. (The Vercel
   "works locally, 404s in prod" asset-bundling trap is gone — §7 — because missing asset modules
   fail the build.)
2. D1 schema + migrations (`codes`, `totp_used_steps`, `rate_limits`, `meta` environment marker);
   code generation/validation; app-level D1 timeout wrapper.
3. Gate route with redemption-redirect; atomic validate-and-record (§6 step 4); signed cookie
   (24 h TTL, canonical `{v,kid,slug,code_id,iat,cookie_exp}`, WebCrypto HMAC key ring); per-load
   recheck with fail-closed; redemption precedence; single byte-identical failure page; runtime
   slug-shape check.
4. Admin auth (WASM argon2id + TOTP with replay rejection), `ENVIRONMENT` production gate,
   session, CSRF, login throttle.
5. Admin panel UI (orphaned-code flagging; `use_count` labeled "redemptions").
6. `new-asset` generator + registry; build step (manifest + asset **module map** to `.generated/`,
   shape/dup/registry checks, advisory external-origin scan); bundle-size report wired into the
   build (headroom vs the 10 MB gzip ceiling, §7/§15 Q5).
7. Headers middleware on every response class; robots route; rate limiter with valid-cookie
   exemption + bucketed unknown slugs.
8. Environments: preview Worker + empty preview D1 + per-env secrets + `ENVIRONMENT` bindings;
   `workers_dev`/preview-URL pinning; **Cloudflare Access on non-prod hostnames (per the Q3
   ratification)**; key rings; gated migration step in CI.

## 13. Testing & error handling

Test harness note: the Workers **Vitest integration** (`@cloudflare/vitest-pool-workers`) runs
tests inside the real runtime against a local D1 with migrations applied via
`readD1Migrations()`/`applyD1Migrations()` — the entire gate, including SQL-level atomicity
semantics, is integration-testable without cloud resources.

- **Unit:** code validity (valid / expired / revoked / wrong-slug); **90-day default expiry is
  applied by the DB** (insert without `expires_at`, read it back ≈ `unixepoch()+7776000`); 128-bit
  code + 22-char slug generation; asset-cookie sign/verify + payload binding (reject cross-asset
  replay, past-expiry, unknown `v`/`kid`, non-canonical/extra-field payloads; **accept previous-kid
  during rotation, reject retired-kid** — key ring); TOTP verify (±1 window) **and replay rejection
  via `totp_used_steps`** (second use of a step rejected via `meta.changes === 0`).
- **Integration:** valid code → 302 → clean URL → 200 + HTML; **redemption precedence**;
  **failure-vs-failure parity** (unknown slug and wrong code → byte-identical 200 body/headers);
  revoked code denied on next load; **D1 unavailable during a cookie load → denied** (fail-closed —
  simulate by breaking the binding/timeout wrapper); `/admin/*` redirects to login without a
  session and is **inert off-production** (`ENVIRONMENT` gate); **`/a/*` is likewise inert
  off-production**; login rejects wrong password **or** wrong TOTP; **wrong password with valid
  TOTP does not consume the step**; admin mutation without valid `Origin` rejected (CSRF);
  malformed/traversal slug rejected by the shape check before any DB/map access; expired cookie
  with no `?code=` → byte-identical generic page, and re-opening the original link re-redeems;
  **redemption is atomic** — under a concurrent revoke, either the `UPDATE` returns a row (cookie
  issued) or not (failure), never an interleaving that increments `use_count` without access or
  vice-versa; **concurrent redemptions** increment `use_count` without lost updates (single-writer
  upsert); rate limiter trips and recovers; valid-cookie load is limiter-exempt; **slug-spray does
  not create unbounded `rate_limits` rows** (bucketing); manifest not routable
  (`/assets/manifest.json`, `/a/manifest.json`, `/a/<slug>/manifest.json` all return the generic
  not-found behavior).
- **Header/cookie coverage:** assert **every** §9 header on **all four** response classes
  (redemption 302 / asset 200 / failure page / admin), asset-cookie attributes (`HttpOnly`,
  `Secure`, `SameSite=Lax`, `Path=/a/<slug>`), and that the post-redirect URL carries no `?code=`.
- **Build:** manifest and asset module map are emitted **only under `.generated/`** (never inside
  `assets/` or any routable location); duplicate slug fails the build; a slug not matching
  `^[A-Za-z0-9_-]{22}$` fails the build; **a slug absent from the generator registry fails the
  build** (the D2 backstop — this test is what keeps the backstop real); missing `<title>` falls
  back to the slug; the advisory external-origin scan catches references across `srcset`,
  CSS `@import`/`url()`, SVG `<use>`, and `<meta refresh>` (advisory, §7); the bundle-size report
  is produced and the build fails above the configured headroom threshold (§7/§15 Q5).
- **Security-property:** redemption looks up by `SHA-256(code)`; no plaintext code column exists;
  admin password verifies via argon2id (reject a fast-hash implementation — assert the stored hash
  is `$argon2id$` with the pinned parameters); the environment gates above; **the wrangler config
  contains no `assets` key and no workers.dev/preview-URL enablement on production** (config lint
  test — the §7/§10 structural invariants get tripwires).
- **Deployed-environment checks (new class):** against a real deployment — `cf-cache-status` on
  `/a/*` is never `HIT` (no edge caching, §9); asset and failure responses are **byte-stable
  end-to-end** (no zone feature has injected or rewritten markup — the §9 HTML-rewriting
  foot-gun probe); *if Q3's Access layer is ratified:* non-prod hostnames answer with a Cloudflare
  Access login, not the app; production `workers.dev`/preview URLs are disabled.
- **Error handling:** a valid code whose asset module is missing (or whose R2 object is missing,
  once on the §7 growth path) returns the **same generic page** to the recipient **plus a
  high-severity server alert** with slug + `code_id` — an integrity failure, not a 404, and it must
  page someone. Admin shows clear, rate-limited errors for bad credentials. Worker exceptions and
  platform errors (§6 taxonomy) are fail-closed by construction — no path issues a cookie outside
  the atomic-redeem success branch.

## 14. Explicitly out of scope (YAGNI) — unchanged

- User accounts / multi-admin.
- One-time-view or device/IP-locked codes (declined in favor of reusable links).
- Sidecar/multi-file assets **now** (the §7 R2 growth path and the CSP are forward-compatible, but
  it is not built; revisit cookie-`Path` authorization per §7 when it arrives).
- A separate access-audit log beyond `last_used_at` / `use_count` (still labeled "redemptions"). **[SUPERSEDED 2026-07-04 — an admin-ACTION audit log (audit_log, migration 0006) was added; see the 2026-07-03 design doc §Part E. Recipient-side access is still a counter, not a per-event log.]**
- **Sandboxed-iframe asset rendering** — still deferred, still promoted to a §15 recommended
  reconsideration (Q2); nothing about Cloudflare changes that calculus.

## 15. Open design questions (owner decisions — surfaced, not silently resolved)

Carried forward from the source (Q1–Q3, updated where Cloudflare changes the calculus) plus the new
Cloudflare-specific decisions (Q4–Q9). Each records the tension, the alternative, and a
recommendation; the design as written above stands until the owner rules.

1. **Reusable bearer code in the URL (§3 D1/D4) — carried, unchanged.** The one-click model puts a
   reusable code in the query string; browser history/sync, link scanners, unfurlers, proxies, and
   (now) Workers Logs can capture it. Alternatives unchanged: **short-lived one-time redemption
   token** (removes the reusable code from URLs; costs re-clickability and needs a resend flow) or
   **fragment + same-origin POST** (removes server-side log exposure; keeps history exposure; adds
   a JS dependency). *Recommendation unchanged: at least the fragment approach if platform-log
   leakage is a real concern; Cloudflare does not resolve this question.*
2. **Sandboxed-iframe rendering (§3/§9/§14) — carried, unchanged.** The structural fix for the
   top-nav exfiltration residual that CSP cannot close. *Recommendation unchanged: build it before
   onboarding any asset the admin didn't hand-write end-to-end.*
3. **How to gate `/a/*` off-production (§10/§11) — carried, calculus changed.** The Vercel options
   were (a) production-gate + QA locally, (b) cheap shared secret, (c) accept-but-don't-publish-
   sensitive. **Cloudflare Access (free at this scale, one-click on workers.dev/preview URLs)
   supersedes option (b) with real SSO.** *Recommendation: keep the app-level `ENVIRONMENT` gate
   (fail-closed) AND put Access on every non-prod hostname; QA the real flow in `wrangler dev`
   locally. Owner to confirm this two-layer answer.*
4. **Database: D1 vs Neon-via-Hyperdrive — RESOLVED (owner, 2026-07-02): D1.** The owner also has
   no Neon account, mooting the alternative. Rationale kept for the record:
   - *D1 (chosen):* in-platform binding (no DB credential class), single-writer primary that keeps
     single-statement atomic redemption honest, DB-side defaults and DB-time predicates survive in
     SQLite (§5/§6), no copy-on-write clone risk (§10), Time Travel restore (§11), local-dev parity.
     Costs: SQL dialect migration is real (this doc re-expresses every statement); **read
     replication must stay off** (standing invariant, §5); D1 is younger than Postgres and its
     limits/semantics move — the §12 spike de-risks the two load-bearing corners.
   - *Neon + Hyperdrive (rejected):* would keep Postgres SQL verbatim, but adds two external
     systems plus a pooling/caching proxy in the auth path — Hyperdrive's query cache would have
     to be disabled for correctness here (its own changelog shows `now()`-dependent queries were
     incorrectly cacheable until a Feb 2026 fix — precisely the single-time-source hazard);
     connection-string secrets return; preview isolation reverts to "provision a schema-only Neon
     branch and never branch from prod" (H7 vigilance returns).
   4b. **Shared-state store if limiter volume ever grows — NEW.** KV is disqualified outright
   (eventual consistency, §5). The growth path off D1 for `rate_limits` (and, if ever needed,
   `totp_used_steps`) is a **Durable Object** (strong consistency, atomic in-memory counters,
   alarms for pruning) — accepting the second-clock dilution of invariant 4 for the limiter only
   (it is defense-in-depth and fails open). *Recommendation: stay on D1 until write volume says
   otherwise.*
5. **Bundled asset modules vs private R2 — NEW threshold decision.** Bundling (chosen, §7) is
   deploy-atomic and has zero public surface but is bounded by the 10 MB-gzip Worker script limit;
   R2 removes the ceiling at the cost of a two-step publish and a runtime read dependency. The
   build emits a bundle-size report. *Recommendation: bundle now; pre-commit to the R2 mechanism
   (private bucket, Worker-binding reads, fail-closed + integrity alert) and cut over when total
   compressed assets pass ~70% of headroom or when sidecar assets arrive (§14).*
6. **Cloudflare Access in front of production `/admin/*` — RESOLVED (owner, 2026-07-03): REPLACE
   password+TOTP.** Originally offered as an *additional* SSO wall; flipped to the sole admin identity
   mechanism because the owner is in **Google Advanced Protection** (hardware-key, phishing-resistant
   MFA), making an app-maintained password+TOTP redundant. Cloudflare Access + Google authenticates at
   the edge; the Worker still **independently verifies** the Access JWT (issuer/audience/RS256
   signature via the team JWKS) and re-checks the admin email, so the app enforces its own
   authorization boundary rather than blindly trusting the edge — that verification is what makes
   "replace" safe rather than a downgrade. Accepted tradeoff: Cloudflare Access + Google become an
   availability dependency for **admin login only** (never for recipients); break-glass is dashboard
   control of the Access app. The Access application is scoped to `/admin`; the `/a/*` recipient flow
   stays outside Access. Implemented 2026-07-03 (see §8 banner); the former password/TOTP/session
   code, secrets, and deps were removed.
7. **Turnstile — NEW option, narrow.** On `/admin/login` only, as pre-KDF bot damping. **Never on
   `/a/*`** — a JS challenge breaks the one-click, no-JS recipient flow (and link-scanner behavior
   becomes unpredictable). The login throttle (§8) already suffices; Turnstile is optional polish.
   *Recommendation: skip initially; add only if login-endpoint noise shows up in logs.*
8. **Zone WAF / rate-limiting rules — NEW option.** An outer throttle keeps abusive traffic off
   the Worker (cost + noise), but any challenge/managed-challenge action on `/a/*` would break
   recipient UX, and zone cache features are the §9 foot-gun neighbors. *Recommendation: optional;
   block/throttle actions only, thresholds well above the app limiter, and a standing "no cache
   rules, no challenges on `/a/*`" note in the zone runbook.*
9. **Plan tier — RESOLVED (owner, 2026-07-02): Workers Paid (already held).** The constraint it
   satisfied remains load-bearing and is recorded: the memory-hard KDF (§8) requires Workers Paid —
   the free tier's 10 ms CPU cannot run argon2id at OWASP parameters, and **no credible free-tier
   fallback exists** (PBKDF2 at defensible iteration counts also exceeds 10 ms; §8). The paid plan
   also provides the 10 MB script ceiling assumed by Q5, the 30 s CPU default, and D1 Time
   Travel's 30-day retention (§11). The design must not be downgraded to the free tier later
   without reopening this question.
