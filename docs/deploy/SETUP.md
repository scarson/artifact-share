# Artifact Share — Deploy & Operations Runbook

This is the authoritative operations doc for the Artifact Share Worker: a
single-admin, gated-asset-sharing app on Cloudflare (Hono + D1). It covers
branches, first-time provisioning, publishing, environments, the CI
precondition, Cloudflare Access decisions, zone-level foot-guns, log hygiene,
backups, secret rotation, TOTP recovery, integrity alerting, and D1 read
replication.

Authoritative design reference: [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](../design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md)
("spec §N" below). Implementation plan: [`docs/plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md`](../plans/2026-07-02-gated-asset-sharing-site-cloudflare-plan.md).

**Deployment topology:**

| Environment | Worker name | Hostname | D1 database |
|---|---|---|---|
| local dev | `artifact-share-dev` | `localhost:8787` (`wrangler dev`) | local SQLite file |
| preview | `artifact-share-preview` | `artifact-share-preview.samuel-carson.workers.dev` | `artifact-share-preview` |
| production | `artifact-share` | `share.scarson.io` | `artifact-share-prod` |

---

## 1. Branches & flow (spec §11)

- `main` = production. `dev` = integration.
- Work flows `dev` → PR → `main`. Never commit directly to `main`.
- `.github/workflows/deploy.yml` is the **sole deployer** — Cloudflare Workers
  Builds must stay disabled for the `artifact-share` Worker (see §5 below).
- A push to `dev` runs the test job, then deploys `--env preview` to the
  Access-gated preview Worker (migrations applied to `artifact-share-preview`
  first).
- A merge to `main` runs the test job, then deploys `--env production` to
  `share.scarson.io` (migrations applied to `artifact-share-prod` first).
- Both deploy jobs are serialized by the workflow's `concurrency` group
  (`deploy-${{ github.ref }}`, `cancel-in-progress: false`) — the honest D1
  replacement for a Postgres advisory lock, since D1 migrations have no
  built-in lock. Concurrent pushes to the same branch queue instead of
  racing.
- Migrations are forward-only (D1 has no down-migration concept) and always
  run **before** the code deploy in the same job, so the deployed code is
  never ahead of the schema.

---

## 2. OPERATOR HAND-OFF — first-time production/preview provisioning

**This section is for the account owner only.** These steps touch the live
Cloudflare account (creates real D1 databases, sets the real admin
password/TOTP secret, and deploys to production) and cannot be run
autonomously. Run them in order, top to bottom, from a machine with
`npx wrangler login` already authenticated against the target account.

### Step 2.1 — Create the two remote D1 databases

```bash
npx wrangler d1 create artifact-share-prod
npx wrangler d1 create artifact-share-preview
```

Each command prints a `database_id` UUID. Copy each UUID into
`wrangler.jsonc`, replacing the matching placeholder:

- `artifact-share-prod`'s UUID → `<PROD_DB_ID>` (inside `env.production.d1_databases[0].database_id`)
- `artifact-share-preview`'s UUID → `<PREVIEW_DB_ID>` (inside `env.preview.d1_databases[0].database_id`)

**Double-check which UUID goes into which env block before saving.** A
mis-pointed preview→prod binding is exactly the hazard the `meta` marker in
Step 2.2 exists to catch — but catching it after the fact is a much worse day
than getting it right by eye now. Re-read the two `database_name` fields next
to the two `database_id` fields as a final sanity check: `artifact-share-prod`
must pair with the UUID `wrangler d1 create artifact-share-prod` printed, and
likewise for `artifact-share-preview`.

Commit the filled-in `wrangler.jsonc` (no secrets in this file — just the two
UUIDs) before continuing.

### Step 2.2 — Apply migrations and set the environment markers

```bash
npx wrangler d1 migrations apply artifact-share-prod --env production --remote
npx wrangler d1 migrations apply artifact-share-preview --env preview --remote

npx wrangler d1 execute artifact-share-prod --env production --remote \
  --command "UPDATE meta SET value = 'production' WHERE key = 'environment';"
npx wrangler d1 execute artifact-share-preview --env preview --remote \
  --command "UPDATE meta SET value = 'preview' WHERE key = 'environment';"
```

Verify:

```bash
npx wrangler d1 execute artifact-share-prod --env production --remote \
  --command "SELECT * FROM meta;"
```

Expected: `environment = production` (and `preview` when you run the
equivalent command against `artifact-share-preview --env preview`). This
`meta` row is the operator's binding-audit signal — it proves each Worker
environment is actually pointed at the database you think it is. It is not a
runtime safety mechanism (see §4 below for what actually enforces isolation);
treat a mismatch here as a sign the `database_id`s in Step 2.1 were swapped,
and fix `wrangler.jsonc` before deploying.

### Step 2.3 — Set the secrets (distinct per environment)

**This is the step that needs the real admin password and a real
authenticator app.** Never reuse the test password (`test-password`) or any
value used in tests/fixtures for production.

Hash the real admin password and store it:

```bash
node scripts/hash-password.mjs '<the real admin password>'
```

This prints a `$argon2id$v=19$m=19456,t=2,p=1$…` PHC-format hash to stdout.
Copy the entire printed hash string (nothing else) as the value for:

```bash
npx wrangler secret put ADMIN_PASSWORD_HASH --env production
```

Mint the TOTP secret and enroll it in an authenticator app **immediately**:

```bash
node scripts/totp-setup.mjs
```

This prints a base32 secret and an `otpauth://` URI. Scan the otpauth URI (or
its QR encoding, if your terminal/tool renders one) into your authenticator
app **now, before closing the terminal** — the printed secret and the
authenticator enrollment must come from the same run, or they will never
agree on codes. Then store the base32 secret:

```bash
npx wrangler secret put ADMIN_TOTP_SECRET --env production
```

Generate the two key-ring secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Run this twice to get two **different** random values — one for the session
ring, one for the asset-cookie ring. `openssl rand -base64` never emits a
comma, which matters: the key-ring parser splits ring entries on commas, so a
secret containing a comma would silently corrupt the ring. Also note that the
parser does not enforce a minimum secret length — a too-short, hand-typed
string is accepted without error, so always use the `openssl` output
verbatim rather than typing a secret by hand.

Each ring value is stored with a key-id prefix, `k1:<secret>`:

```bash
npx wrangler secret put SESSION_SECRET --env production
# value: k1:<first openssl output>
npx wrangler secret put ASSET_COOKIE_SECRET --env production
# value: k1:<second, different openssl output>
```

Repeat all four `secret put` commands for `--env preview`, using **different**
values from production (a throwaway password and a throwaway TOTP secret are
fine for preview — preview never mints anything that grants access to real
content, since preview's D1 starts empty and stays behind Cloudflare Access):

```bash
node scripts/hash-password.mjs '<a throwaway preview password>'
npx wrangler secret put ADMIN_PASSWORD_HASH --env preview
node scripts/totp-setup.mjs
npx wrangler secret put ADMIN_TOTP_SECRET --env preview
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET --env preview
openssl rand -base64 32
npx wrangler secret put ASSET_COOKIE_SECRET --env preview
```

### Step 2.4 — Deploy

```bash
npm run build-manifest
npx wrangler deploy --env preview
npx wrangler deploy --env production
```

A deploy with any of the four required secrets missing in the target
environment fails loudly — `wrangler.jsonc`'s `secrets.required` declaration
lists `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, `SESSION_SECRET`,
`ASSET_COOKIE_SECRET`, and Wrangler refuses to deploy an environment that is
missing any of them.

**Note:** deploying `--env production` intentionally disables the
currently-enabled `*-artifact-share.samuel-carson.workers.dev` version-preview
URLs on the production Worker (spec §10). Version previews of production run
with production bindings — real D1 data and `ENVIRONMENT=production` — on a
non-custom-domain hostname, which is a live door into confidential content
that bypasses the custom-domain-only design. Version previews of this app
belong on the separate, Access-gated `artifact-share-preview` Worker instead,
not on production version-preview URLs. This is expected and correct; it is
not a regression to investigate.

---

## 3. Publishing an asset

1. `npm run new-asset -- "Title"` — scaffolds `assets/<slug>/index.html` with
   an opaque 128-bit slug and registers the slug in `.generated/slugs.json`
   (the provenance registry the build checks against).
2. Edit the generated HTML (and any inline script/style — assets are
   self-contained single-file HTML under the asset CSP).
3. `npm run build-manifest` — regenerates the manifest and asset module map
   under `.generated/`.
4. Commit both `assets/` and `.generated/` together. A merge where these are
   out of sync fails CI (`git diff --exit-code .generated` in the test job).
5. Open a PR `dev` → `main`. Merging deploys production (migrations, then
   code).
6. Once deployed, go to `/admin`, log in, and mint the access code for the
   new slug.

A code can only be minted for an asset that is **already deployed and present
in the manifest** — the admin panel's asset picker is driven by the deployed
manifest, not by the working tree.

---

## 4. Environments (spec §10)

Three environments share one `wrangler.jsonc`, with disjoint bindings and no
inheritance between them:

- **Local dev** (top-level config, Worker name `artifact-share-dev`): run
  with `wrangler dev`, against a local D1 SQLite file — no cloud resources at
  all. `ENVIRONMENT` defaults to `development` in the top-level `vars`, which
  is **inert** (see below). To exercise the real gate/admin flow locally,
  copy `.dev.vars.example` to `.dev.vars` (git-ignored) and keep
  `ENVIRONMENT=production` set there — this is the explicit, documented
  local-QA opt-in. It is safe specifically because `wrangler dev` always
  binds the **local** D1 file, never a remote database, so setting
  `ENVIRONMENT=production` locally cannot touch real data. **This is where
  real gate-flow QA happens** — never test the live flow against preview or
  production directly.
- **Preview** (`env.preview`, Worker name `artifact-share-preview`): reachable
  at its `workers.dev` hostname, which sits behind Cloudflare Access (§6).
  Its D1 database (`artifact-share-preview`) starts empty and only ever
  receives migrations — there is no database cloning/branching on D1, so
  preview can never inherit production's codes or client labels. Its
  `ENVIRONMENT` var is `preview`, which the app gate treats as inert:
  `/a/*` and `/admin/*` both serve the generic page regardless of what is
  bundled or what the database contains.
- **Production** (`env.production`, Worker name `artifact-share`): the only
  environment with `ENVIRONMENT=production`. Reachable only on the custom
  domain `share.scarson.io` — both `workers_dev` and `preview_urls` are
  pinned `false` in this env block, so no accidental `workers.dev` or
  version-preview hostname can ever serve it.

**`ENVIRONMENT` is the only oracle.** `servesTraffic()` (`src/lib/envgate.ts`)
is a positive allow-list of exactly one string, `"production"` — every other
value (`preview`, `development`, unset, or any future typo) is inert. This is
never inferred from hostname, URL, or binding shape.

**The D1 `meta` marker is the operator's binding audit, not a runtime
mechanism.** Because serving is production-only at the app level, a
mis-bound non-prod Worker (e.g. `preview` accidentally pointed at the prod
`database_id`) still cannot serve confidential content — the `ENVIRONMENT`
gate blocks it regardless of which database it is bound to. The `meta` row
exists so a human can catch a mis-pointed binding by inspection (Step 2.2,
re-verified in any future production-verification pass), not because the app
depends on it at request time.

---

## 5. CI precondition — Cloudflare Workers Builds MUST be disabled

Before merging or relying on `.github/workflows/deploy.yml`, confirm in the
Cloudflare dashboard that **Workers Builds is disabled for the
`artifact-share` Worker** — both triggers:

**Dashboard → Workers & Pages → artifact-share → Settings → Builds** — turn
off:
- the deploy-on-`main` build, **and**
- non-production-branch builds.

Why this matters:

1. **Race on `main`.** If both Workers Builds and this GitHub Actions
   workflow can deploy `main`, they can race each other. Only this workflow
   runs tests and applies D1 migrations **before** the deploy (spec §11
   ordering) — a Workers Builds deploy racing in has no such gate.
2. **Scope.** Workers Builds' managed build token is not guaranteed to carry
   D1-edit scope, so it may not even be able to run
   `wrangler d1 migrations apply` correctly.
3. **Non-prod-branch builds are the version-preview exposure surface Task
   7.1 turns off.** A non-prod-branch Workers Build uploads a new *version*
   of the **production** Worker (`artifact-share`), reachable at a
   `*-artifact-share.samuel-carson.workers.dev` version-preview URL with
   production bindings — precisely the exposure `preview_urls: false`
   in `env.production` is meant to close. A stray non-prod-branch build
   would reopen it out of band.

**Re-verify no build triggers remain in the dashboard before merging the
workflow to `main`** — do this check again any time the Worker's dashboard
settings might have changed (e.g. after transferring account ownership or
recreating the Worker).

Also add the two GitHub repo secrets the workflow consumes
(**GitHub repo → Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN` — a token scoped narrowly to **Workers Scripts:Edit**
  and **D1:Edit** on this account. **Do not use a Global API Key.**
- `CLOUDFLARE_ACCOUNT_ID`

Note the trust implication: this token can deploy Worker code, and deployed
code can read every secret bound to that Worker at runtime. That means
**GitHub repository access (anyone who can push to `main`/`dev`, or who
controls repo secrets/Actions) is now part of the spec §8 trust boundary**,
on par with direct Cloudflare account access. Treat collaborator access and
branch protection on this repo accordingly.

---

## 6. Cloudflare Access decisions (spec §15)

Four related owner decisions on using Cloudflare Access/Turnstile/WAF as
additional perimeter layers. The app-level password+TOTP gate (spec §8) is
always the actual authorization boundary; everything in this section is
optional defense-in-depth on top of it.

### Q3 — Access on non-production hostnames: **enabled**

The preview Worker (`artifact-share-preview.samuel-carson.workers.dev`) sits
behind Cloudflare Access, restricted to the owner's email only. This is a
dashboard action (performed by the account owner, not scripted here):

**Dashboard → Workers & Pages → artifact-share-preview → Settings → Domains
& Routes → workers.dev → Enable Cloudflare Access.** Then edit the
auto-generated Access policy so the allow rule matches **only** the owner's
email address — remove any broader default rule.

Verify after enabling:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://artifact-share-preview.samuel-carson.workers.dev/
```

Expected: `302`, redirecting to a `cloudflareaccess.com` login page — not the
app itself.

This is a second, independent layer. The app-level `ENVIRONMENT` gate (§4
above) remains the fail-closed boundary underneath regardless of Access
being enabled, misconfigured, or bypassed — preview's `/a/*` and `/admin/*`
are inert at the app level no matter what reaches the Worker.

### Q6 — Access in front of production `/admin`: off by default

Not enabled by default. Password+TOTP is the boundary for `/admin`. To add
Access as an **additional** layer later (never as a replacement):

Create a self-hosted Access application for `share.scarson.io/admin`,
restricted to allow only the owner's email — same one-click pattern as Q3,
applied to the production custom domain instead of the preview `workers.dev`
hostname. If enabled, the app still requires its own password+TOTP login
behind the Access wall; do not remove or weaken the app-level auth to
compensate.

### Q7 — Turnstile: off

Not enabled. If ever enabled, it goes **only** on the `/admin/login` page as
pre-KDF bot damping. **Never on `/a/*`** — a JS challenge breaks the
one-click, no-JS recipient flow that the gate design depends on, and can
make link-scanner/unfurler behavior unpredictable in ways that affect real
recipients.

### Q8 — Zone-level WAF / rate-limiting rules: off

Not enabled. If ever enabled, restrict to **block or throttle actions only**,
with thresholds set **far above** the app-level limiter (`rate_limits` table,
spec §9) — the app limiter is the primary defense and is designed to fail
open. **No challenge or managed-challenge action may ever apply to `/a/*`** —
an interstitial breaks the one-click-from-email property the same way
Turnstile would.

---

## 7. Zone foot-guns (spec §9) — standing invariants

These are one dashboard click away from silently breaking the security
design. None of them are currently enabled; this list exists so they stay
that way. Check the zone dashboard for `scarson.io` (or the relevant zone)
if any of these are ever proposed:

- **No Cache Rules, Cache Response Rules, or APO matching this hostname.**
  Any of these can override the Worker's own `Cache-Control: no-store` on
  gate responses — exactly the cacheable copy of gated content the design
  forbids. The Worker relies on `no-store` being honored end-to-end.
- **No Rocket Loader, Email Obfuscation, Mirage, or Cloudflare Fonts** on
  this hostname. These zone features rewrite HTML response bodies in
  transit — including Worker-generated ones — which would (a) inject
  third-party script into confidential asset HTML, inside the asset CSP's
  trust boundary, and (b) break the byte-identical failure-page property
  the gate design relies on for the unknown-slug/wrong-code parity test.
- **No `caches.default` / `cf.cacheEverything` anywhere in the Worker code.**
  This is a code-level invariant, not a dashboard one — grep for these on
  review. The Worker must never opt any gated response into Cloudflare's
  edge cache.

---

## 8. Log & access hygiene (spec §3 D4, §8)

- The access code is a **reusable bearer credential that transits the URL**
  (`/a/<slug>?code=…`). Anything that logs full request URLs captures it.
- Keep **Workers observability invocation logs disabled, or set to
  minimal retention**, on this Worker.
- **Do not enable Logpush** for this Worker.
- **Never `console.log` a full URL or a raw code** anywhere in the Worker
  code — this includes debug logging added during future work. The one
  intentional structured log the gate emits (`event=asset_module_missing`,
  §13) logs only `slug` and `codeId`, never the raw code.
- Restrict Cloudflare account membership and API token issuance. Anyone who
  can deploy this Worker can read every secret bound to it at runtime and
  can mint access codes via `/admin` — treat account membership and token
  scopes (including the GitHub Actions `CLOUDFLARE_API_TOKEN`, §5 above) as
  full trust grants, not convenience grants.

---

## 9. D1 durability & confidentiality (spec §11)

- **Time Travel** gives 30-day point-in-time restore natively on Workers
  Paid (7 days on the Free tier — this project is provisioned on Paid;
  see spec §15 Q9). This covers most operator mistakes and D1-side
  incidents without a separate backup mechanism.
- For periodic **offline exports**, use:

  ```bash
  npx wrangler d1 export artifact-share-prod --env production --remote --output backup.sql
  ```

  Run this on a regular cadence (e.g. before any risky migration, and
  periodically as a standing backup) and store the output somewhere with
  access control at least as strict as the Cloudflare account itself.

- **Exports and restores are confidential even though codes are hashed.**
  A `backup.sql` export contains `asset_slug`, recipient **labels** (client
  identities), usage timestamps, and expiries — i.e. the full sharing graph
  of who has access to what. Treat every export as confidential: encrypt at
  rest, restrict who can read it, apply a retention limit, and keep labels
  minimal (don't put more identifying information into a label than the
  admin workflow needs).
- **Deleting a row is not erasure within the 30-day Time Travel window.**
  Revoking or deleting a code in `/admin` stops it from working immediately,
  but the underlying data remains restorable from Time Travel for up to 30
  days after deletion. Don't treat a delete as a compliance-grade erasure
  event inside that window.

---

## 10. Rotation & exposure (spec §10)

- **Key-ring rotation** (`SESSION_SECRET`, `ASSET_COOKIE_SECRET`): prepend a
  new `k<n>:<secret>` entry to the ring (e.g. `k2:<new-secret>,k1:<old-secret>`)
  so the Worker signs new tokens with the new key while still accepting
  tokens signed with the previous key. Keep the previous entry in the ring
  until all outstanding tokens signed with it have aged out — sessions live
  at most 7 days, asset cookies at most 24 hours — then drop the retired
  entry from the ring in a follow-up `secret put`.
- **Suspected access-code exposure is never handled by secret rotation.**
  Rotating `SESSION_SECRET`/`ASSET_COOKIE_SECRET` does nothing to a leaked
  access code — the code itself is the credential. The correct response to
  a suspected code exposure is to **revoke the code and reissue a new one
  in `/admin`**, immediately invalidating the leaked value via the D1
  fail-closed recheck on every load.

---

## 11. TOTP / authenticator recovery (spec §8)

If the admin loses access to their authenticator (lost device, uninstalled
app, etc.), recovery is: mint a brand-new TOTP secret and re-enroll, not
attempt to recover the old one.

```bash
npm run totp-setup
```

This mints a **new** secret together with its matching `otpauth://` URI in
one run — the two must come from the same invocation, since the secret and
the QR/URI are only valid as a pair. Set the new secret:

```bash
npx wrangler secret put ADMIN_TOTP_SECRET --env production
```

Then scan the URI/QR from that same run into the authenticator app. A
hand-invented secret typed in without going through the script (and its
matching QR) will not produce codes the Worker accepts — the secret must be
the exact value the authenticator was enrolled with.

---

## 12. Integrity alerting (spec §13)

The gate route emits a structured **error-level** log when a valid,
non-expired, non-revoked code successfully redeems but the corresponding
asset module is missing from the deployed bundle:

```json
{"level":"error","event":"asset_module_missing","slug":"...","codeId":"..."}
```

This is distinct from an ordinary 404 — it means the database and the
deployed code have drifted out of sync (an asset that codes point to was
never bundled, or was removed from a later deploy while codes to it still
exist). The recipient still only sees the generic failure page; there is no
user-facing difference. That is exactly why this needs alerting: nothing
in the UI tells anyone this happened.

**Action required:** wire a Cloudflare notification (a Workers alert on
error-rate for this Worker) or, at minimum, a scheduled review of Workers
logs filtered to `event=asset_module_missing`. Until such alerting exists,
treat any occurrence of this event found in logs as an incident — investigate
which slug/code triggered it and whether the corresponding asset needs to be
restored in a follow-up deploy.

---

## 13. Read replication (spec §5)

**Never enable D1 read replication on `artifact-share-prod` or
`artifact-share-preview`.** The gate's revocation model depends on every
read seeing the single writer's latest state immediately — the atomic
redemption `UPDATE … RETURNING` and the per-load fail-closed recheck both
assume there is exactly one authoritative copy of `codes`, `rate_limits`,
and `totp_used_steps` with no replication lag. A stale replica could let a
just-revoked code keep working, or double-count/under-count a rate-limit
window, until it catches up. This is a standing invariant, not a
performance choice to revisit later.

---

## Appendix: KDF implementation note

Spec §8 originally named `hash-wasm` for argon2id. In practice, `hash-wasm`
compiles WebAssembly at runtime (`WebAssembly.compile(bytes)`), and workerd
forbids runtime Wasm code generation — it throws in both tests and
production. The shipped implementation uses **`@noble/hashes` argon2id**
instead, a pure-JavaScript implementation that runs on Workers. Both
`scripts/hash-password.mjs` (used in Step 2.3 above) and the Worker's own
password verifier (`src/lib/auth/password.ts`) use the same `@noble/hashes`
implementation at the same parameters (`m=19456, t=2, p=1`, 32-byte output,
PHC-format `$argon2id$…` string), so a hash printed by the script is
guaranteed to verify correctly in the deployed Worker — there is no
cross-library compatibility gap to worry about.
