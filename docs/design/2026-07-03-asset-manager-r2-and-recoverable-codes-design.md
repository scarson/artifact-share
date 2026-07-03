# Asset manager on R2 + recoverable share codes — design

**Date:** 2026-07-03 · **Status:** APPROVED by owner 2026-07-03 (amendments: keep original zip + per-asset Download; Part C public assets + alias routes added at owner request the same night) · **Supersedes:** spec §7's
git-native asset pipeline (bundled Text modules) and spec §3 D3's hash-only code storage.
**Brainstorm mode:** owner-directed self-answered (owner set the requirements and asked the agent
to answer the open questions itself).

## 1. Why (two problems, one root)

1. **The repo is PUBLIC and the repo is the asset pipeline.** Assets today are committed under
   `assets/`, compiled into the Worker as Text modules, and deployed by CI. Any real asset
   published this way is world-readable in git — the share codes would protect nothing. (Audited
   2026-07-03: the only asset ever committed in all history is the test fixture, so nothing has
   leaked. This must be fixed before the first real publish.) Even with a private repo, GitHub
   would sit inside the confidentiality boundary, and every publish would require a code deploy.
2. **Codes are non-recoverable by design (spec §3 D3: hash-only at rest),** but the operator
   reality is "what link did I send Nels last month? I want to resend it." Re-minting invalidates
   the link already sitting in the recipient's inbox. The owner has ratified that recoverability
   is acceptable here: these are per-recipient access codes to specific content, mintable and
   revocable at will by the same single admin — not user credentials.

The fix for (1) — runtime upload through the Access-gated admin panel into private storage —
also removes GitHub and CI from the content path entirely: publishing stops being a deploy.

## 2. Part A — recoverable share codes

### Decision

Store each code **encrypted at rest** (not plaintext, not hash-only): AES-256-GCM via WebCrypto,
key supplied as a new Worker secret `CODE_VAULT_KEY` using the same `kid:secret[,kid:secret…]`
key-ring format as `ASSET_COOKIE_SECRET` (rotation-ready, `k1:` first). The existing
`code_hash` column stays and remains the **only** lookup path — redemption logic is untouched.
New column `code_enc TEXT` holds `kid:iv:ciphertext` (base64url).

### Options considered

| Option | Recoverable | DB-leak posture | Verdict |
|---|---|---|---|
| Plaintext column | yes | D1 dump / Time Travel / `d1 export` reveals every live link | rejected — needlessly weak |
| **Encrypt w/ Worker-secret key** | **yes (via admin UI only)** | **dump alone is useless; needs the secret too** | **chosen** |
| Keep hash-only + one-click reissue | no (new link ≠ sent link) | unchanged | rejected — doesn't solve "resend the same link" |

The encryption option costs ~40 lines and keeps the property that mattered about D3: a leaked
database export doesn't leak access. What changes is only that the *running Worker* (which
already holds the cookie-signing secret and serves the content itself) can decrypt on demand.

### UI

Per-row **"Show link"** action in the codes table (a small POST form, same `originOk` CSRF check
as revoke). It re-renders the panel with that code's full URL in the same copy-row used for
freshly minted links (Copy button included). Not displayed by default — explicit action only.
Revoked/expired rows keep the action (useful for audit: "which URL was that?"), clearly labeled
with their status.

### Consequences

- Spec §3 D3 and §8 get an amendment note; the "lost link ⇒ revoke + reissue" guidance becomes
  "lost link ⇒ Show link (or revoke if exposure is suspected)".
- Existing rows minted before the migration have no `code_enc` → the panel shows "not
  recoverable (pre-vault)" for them; they can be reissued once and are recoverable after.
- Codes still never appear in logs; `code_enc` is never rendered — only the decrypted URL on
  explicit request.

## 3. Part B — asset manager on R2

### Requirements (owner-stated)

Upload new assets, versioning, delete; support a single HTML file **or** a zip bundle
(multi-file assets); managed from the Access-gated admin page; assets never in git; pick the
right Cloudflare primitives.

### Approaches considered

1. **Private R2 bucket + D1 metadata, Worker-proxied upload/serve** — **recommended.** R2 via
   binding only (no public bucket access, no r2.dev, no custom domain on the bucket) is private
   by construction and preserves the "no static surface" invariant. Strong read-after-write
   consistency makes publish-then-view safe. No egress fees; streams large bodies; the spec
   already names this the growth path (§7).
2. KV for asset bodies — **rejected.** 25 MB value cap, eventual consistency (a version flip or
   delete could serve stale content from another PoP for up to a minute — wrong for a
   confidentiality tool), no streaming, and the spec already disqualified KV for consistency
   reasons elsewhere.
3. Separate **private** content repo + CI fetch at deploy — **rejected.** Keeps GitHub (now two
   repos + a cross-repo token) inside the confidentiality boundary, still couples publishing to
   deploys, and gives no runtime delete. It fixes only the "public" half of the problem.
4. (Sub-option) Direct-to-R2 presigned uploads — **deferred.** Needs S3 API credentials as
   Worker secrets and opens a second upload surface. Worker-proxied multipart form upload is
   simpler and sufficient for the realistic sizes (self-contained HTML reports, small zips).
   Revisit only if assets outgrow the request-body limit.

### Storage layout (R2)

```
a/<slug>/<version>/<path…>       e.g. a/x7Kf…/3/index.html, a/x7Kf…/3/data/chart.json
orig/<slug>/<version>.zip        original upload, bundles only (admin Download source)
```

The `orig/` prefix is deliberately OUTSIDE the `a/` tree the gate serves from, so the original
zip is reachable only through the admin download route — never by recipients.

- Slugs stay opaque fixed-length server-minted tokens (unchanged provenance rule: the server
  mints them at asset creation; clients never choose them).
- Versions are immutable integer-numbered prefixes. R2 has no S3-style bucket versioning;
  app-level prefix versioning is the standard pattern and gives us explicit activate/rollback.
- Every stored object records `httpMetadata.contentType` (from a server-side allowlist by
  extension) and a per-file sha256 in customMetadata.

### Schema (migration 0003)

```sql
CREATE TABLE assets (
  slug TEXT PRIMARY KEY,              -- opaque 22-char token, server-minted
  title TEXT NOT NULL,
  active_version INTEGER,             -- NULL = nothing published (codes fail closed)
  is_public INTEGER NOT NULL DEFAULT 0,  -- Part C: 1 = viewable without a code
  public_alias TEXT UNIQUE,           -- Part C: optional pretty route (e.g. "about"); served only while public
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE asset_versions (
  slug TEXT NOT NULL REFERENCES assets(slug),
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  PRIMARY KEY (slug, version)
);
ALTER TABLE codes ADD COLUMN code_enc TEXT;  -- Part A
```

The build-time manifest (`.generated/` module map, `readManifest()`/`isKnownSlug()`) is replaced
by D1 queries. The gate's "known slug with active version" check is one indexed lookup, joined
into the existing atomic redeem statement where possible.

### Upload flow (admin, Access-gated, `originOk`-checked)

1. `POST /admin/assets` multipart form: `title`, `file` (`.html` or `.zip`), auto-activate flag
   (default on). New version of an existing asset: `POST /admin/assets/:slug/versions`.
2. Single HTML file → stored as `index.html`. Zip → **unzipped at upload time** (fflate), each
   entry stored as its own object, and the original zip preserved at `orig/<slug>/<version>.zip`
   (owner-requested — the admin Download source for bundles). Unzip-at-upload beats
   unzip-per-request: CPU spent once, and serving stays a straight R2 streamed read.
3. Zip safety (enforced before any write): entry-count cap (200), per-file cap (25 MB), total
   uncompressed cap (100 MB), reject absolute paths / `..` traversal / symlinks / duplicate
   normalized paths; require a root `index.html`; extension→content-type allowlist (html, css,
   js, json, csv, svg, png, jpg, webp, woff2, txt, pdf…), reject the rest.
4. Writes go to the **next** version prefix; only after all objects are stored does one D1
   transaction insert the `asset_versions` row and (if auto-activate) flip
   `assets.active_version`. A crashed upload leaves unreferenced R2 objects (garbage, not a
   security issue) — cleaned by re-upload or delete.
5. Request-body ceiling: Workers paid plan permits large bodies (plan-dependent, ≥200 MB;
   confirm exact figure at implementation) — the app enforces its own 100 MB cap regardless.

### Serving flow (gate)

- `GET /a/:slug` — unchanged semantics (redeem `?code=` → cookie → 302 clean URL; every load
  re-checks D1, fails closed). Body now comes from
  `R2.get("a/<slug>/<active_version>/index.html")` streamed with the existing `ASSET_CSP`.
- **New:** `GET /a/:slug/*path` — subresources for bundled assets. Cookie-checked exactly like
  the index (every request re-checks the code in D1 → instant revocation covers subresources);
  no `?code=` redemption on subpaths. Unknown path / missing object / no active version → the
  same byte-identical generic failure page. Relative URLs inside the bundle just work because
  the document lives at `/a/<slug>` and subresources at `/a/<slug>/…`.
- Integrity alert (spec §13) is re-pointed: valid code redeems but
  `active_version` object missing in R2 → same structured error-level log.

### Versions & delete (admin UI)

Assets section above the codes table: per asset — title, slug (copyable), active version,
version list with **Activate** (instant rollback = point at an older version), **Download**
(admin-only route `GET /admin/assets/:slug/download?version=N`, default = active version:
bundles stream the preserved original zip from `orig/…`; single-file assets stream the
`index.html`), **Delete version** (inactive versions only; deletes both the `a/` and `orig/`
prefixes), **Delete asset** (requires zero
active codes or an explicit confirm; auto-revokes remaining codes, deletes all prefixes, keeps
the D1 rows tombstoned for the codes table's orphan display). Upload form supports "new asset"
and "new version of existing".

### What gets retired / what stays

- Retired: `assets/` in git as the publish path, `.generated/` Text-module map, the
  build-manifest bundling step, the 8 MB bundle budget (replaced by per-asset caps above), and
  CI's role in publishing content. The repo can stay public with zero content in it.
- Stays: the `wrangler.jsonc` "no `assets` key" lint (that invariant — no platform-served static
  surface — is untouched by R2-via-binding), the deploy pipeline (app code only), all gate
  semantics, admin auth, header/CSP discipline, and the failure-page byte-parity invariant.
- Tests: the fixture asset moves from a committed file to test seeding via the R2 binding
  (vitest-pool-workers provides local R2 bindings; `wrangler dev` uses local R2 storage — the
  local-QA story is unchanged).

### New bindings/secrets

- `env.ASSETS` → R2 bucket `artifact-share-prod` / `-preview` / local (per env block; same
  never-cross-env discipline as D1, and the same "decline wrangler's auto-add prompt" guardrail).
- `CODE_VAULT_KEY` secret per env (Part A), `k1:`-prefixed key ring; added to
  `secrets.required` in both env blocks.

### Part C — public assets + alias routes (owner-requested 2026-07-03)

A **Public** toggle per asset: when `is_public = 1` and an active version exists, `/a/<slug>` (and
its `/a/<slug>/*` subresources) serve WITHOUT a code or cookie. Codes minted for a public asset
keep working (harmless). Toggling public off restores the gate instantly — same fail-closed D1
check path, evaluated per request.

An optional **`public_alias`** gives a public asset a friendly route: `GET /<alias>` (and
`/<alias>/*` for bundle subresources) serves the active version. Rules:
- Alias shape `^[a-z0-9-]{1,32}$`, globally unique, server-validated; RESERVED names rejected:
  `a`, `admin`, `robots.txt`, `favicon.ico`, `cdn-cgi` (Cloudflare-reserved path prefix).
- Alias routes are registered AFTER every fixed route (`/`, `/robots.txt`, `/a/*`, `/admin*`), so
  they can never shadow first-party surfaces even if validation were bypassed — defense in depth.
- An alias on a non-public or unpublished asset serves the generic failure page (byte parity).
- Enumeration posture: a public asset is deliberately enumerable at its alias — that is the
  point of the toggle. Slugs stay opaque; there is still no listing endpoint anywhere.
- `robots.txt` stays `Disallow: /` and the global `x-robots-tag: noindex` stays — public means
  "no code required", not "search-indexed". Revisit only if the owner asks.

First consumer: the **architecture explainer** (`/about`) — a fun single-page HTML asset
describing how this app works, uploaded as a public asset with alias `about`.

## Part D — general file sharing (owner-requested 2026-07-04)

R2 made this a general file host, not an HTML-only one. Formalized:

- **Any file type is a single-file asset.** Upload a PDF, image, CSV, or arbitrary file; it becomes
  an asset served at `/a/<slug>/` (and `/<alias>/`) with its content-type. Known extensions map to
  their type; unknown extensions serve as `application/octet-stream`. Browser-renderable types
  (html, pdf, png/jpg/gif/webp/avif, svg, txt) serve **inline** (`content-disposition: inline`);
  everything else serves as an **attachment** download. Only `text/html` gets `ASSET_CSP`; every
  other type falls to the finalizing middleware's restrictive default CSP, so an inline SVG cannot
  run script (defense in depth on top of the trusted-admin-upload boundary).
- **Zips default to a single-file download.** A zip is stored as one downloadable `.zip` (entry =
  `<name>.zip`), never auto-unpacked. If it contains a root `index.html`, the asset shows a
  persistent **Unpack as browsable bundle** action (owner's chosen confirmation mechanism, decline
  = do nothing). Unpacking reads the retained `orig/<v>.zip`, clears the version prefix, writes the
  files, and flips the version's entry to `index.html`. Not clicking leaves it a single zip.
- **Data model:** `asset_versions.entry TEXT` (migration 0005) — the object served as the document
  (`index.html` for bundles, the filename for single files). NULL on legacy rows means
  `index.html`.
- Unchanged: the gate re-check, revocation, public toggle, versioning, and byte-identical failure
  parity all apply regardless of asset kind.

## Part E — auditing & integrity alerting (owner-requested 2026-07-04)

Made the audit/logging posture explicit and operational:

- **Admin-action audit log (native, D1).** A new `audit_log` table (migration 0006) gets one
  append per admin MUTATION — mint/revoke/show-link, upload/new-version/activate/delete-version/
  delete-asset, set-public/set-alias/unpack — via a best-effort `writeAudit` (an audit-write
  failure never breaks the action it records). A read-only **Activity** section in the panel shows
  the recent trail. INVARIANT: only ids, slugs, and summaries (label/title/toggle) — NEVER a raw
  code or share URL. This supersedes spec §14's "separate access-audit log … out of scope".
- **Integrity alert delivery (native + optional webhook).** The existing `asset_object_missing`
  event (valid code redeems, active version's R2 object gone — spec §13) now routes through
  `reportIntegrity`: always `console.error` (Workers Logs channel), PLUS an optional HTTPS webhook
  (`ALERT_WEBHOOK_URL` secret) POSTed via `waitUntil`, carrying only the safe fields. The webhook
  is the recommended primary channel because it works with platform observability OFF.
- **Cloudflare Notifications / observability tradeoff** documented in SETUP §8/§12: Workers Logs
  capture request URLs (which hold the code), so platform logging stays off/minimal; Cloudflare
  Notifications fire on predefined product metrics (e.g. Worker error-rate), not on log content,
  so a content-exact "this event happened" alert is best done code-side (the webhook).

## 4. Self-answered open questions

| Question | Answer | Why |
|---|---|---|
| Encrypt codes vs plaintext? | Encrypt (AES-GCM, secret key ring) | Keeps DB-dump safety; recoverability only via the running, Access-gated Worker |
| Keep original zip in R2? | **Yes** (owner-ratified) | Stored under `orig/` outside the gate-served tree; powers the admin Download action |
| Unzip when? | At upload | CPU once, streaming reads forever; per-request unzip complicates everything |
| Presigned direct uploads? | Deferred | Worker-proxied multipart is enough at realistic sizes; fewer credentials/surfaces |
| Delete asset with live codes? | Confirm + auto-revoke | Delete means "kill access"; silent orphaning is the worst outcome |
| Subresource auth? | Cookie re-check per request, no `?code=` redeem on subpaths | Preserves instant revocation; keeps redemption single-entry |
| Caps | 200 files / 25 MB file / 100 MB version | Generous for self-contained reports; adjustable constants |
| KV anywhere? | No | Eventual consistency is wrong for both authz and version flips |
| Public toggle semantics | Per-request D1 check, same fail-closed path | Toggling off must be instant, like revocation |
| Alias collisions with app routes | Reserved-name validation + alias routes registered last | Two independent layers (defense in depth) |
| Rate limiting on public serves | None (public content), malformed-shape counter only | The limiter protects redemption; public paths have no secrets to guess |

## 5. Security posture summary

Unchanged: no public static surface; opaque server-minted slugs; atomic single-statement
redemption; fail-closed everything; byte-identical failure page; Access-gated admin with
independent JWT verification; pinned-origin CSRF on all mutations; strict hashed-CSP pages.
Changed knowingly: codes recoverable **by the admin through the Worker** (encrypted at rest,
owner-ratified); asset bytes move from "inside the deployed bundle" to "private R2 via binding"
(equivalent access model: only the Worker can read them, after the same checks). New surfaces
hardened: upload parsing (zip-slip/bomb caps, content-type allowlist), subresource serving
(cookie-checked, parity-preserving).

## 6. Rollout

1. **Phase A — recoverable codes** (small, independent): migration `ALTER TABLE codes ADD
   code_enc`, vault lib + secret, Show-link UI. Ships alone.
2. **Phase B — asset manager**: migration 0003 tables, R2 buckets + bindings, upload/manage
   routes + UI, gate serving from R2 (with subresource route), retire bundling, move fixture to
   test seeding, update spec §7/§13 + SETUP.md (bucket creation runbook, new secret).
3. Cutover: current live content is fixture-only, so there is no data migration — Phase B
   replaces the mechanism before any real asset exists. After merge, verify live: upload via
   panel → mint → redeem → revoke → delete.
