# Artifact Share

A single-admin site for sharing confidential HTML documents behind per-recipient access codes. You upload a self-contained page (a report, a dashboard, a deck), mint a code for one person, and send them a link. Every load re-checks the code, so revoking it cuts access on the next click. When something is wrong, every path returns one identical page, so an outsider can't tell a wrong code from an unknown document.

It runs as one Cloudflare Worker: [Hono](https://hono.dev) for routing, D1 (SQLite) for codes and metadata, R2 for the document bytes. It has no accounts and no sessions. The access code is the whole credential.

Once deployed, the site explains its own architecture at [`/about`](docs/assets-src/about/index.html).

## How sharing works

A share link is `/a/<slug>?code=<code>`. Opening it:

1. Validates the slug's shape before any database access.
2. Redeems the code in one atomic D1 statement that hashes it, checks validity, expiry, and revocation, and stamps the redemption together.
3. Sets a signed, HttpOnly cookie scoped to that document and redirects to a clean URL with the code stripped.
4. Re-checks the code in D1 on every later request. The cookie is a convenience, never the authority.
5. Streams the document from the private R2 bucket.

Codes are stored as a SHA-256 hash for lookup and, separately, encrypted with AES-256-GCM so the admin can re-display a link that was already sent (the panel's **Show link** action). The raw code is never stored in the clear and never logged.

## Publishing documents

Documents live in R2, not in git. The admin uploads them at runtime through the panel at `/admin`, which sits behind Cloudflare Access + Google SSO. From there you:

- Upload a single `.html` file or a `.zip` bundle (multi-file documents; the bundle's original is kept for download).
- Keep numbered versions per document, activate any one (instant rollback), and delete versions or whole documents.
- Mint and revoke access codes, or recover a sent link.
- Mark a document **public** so it serves without a code, and give it a friendly alias, which is how `/about` gets its name.

Because the content never touches the source tree, this repository can stay public without exposing anything shared through it.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars              # local secrets + ENVIRONMENT=production opt-in
npx wrangler d1 migrations apply artifact-share-dev --local
npm run dev                                 # http://localhost:8787
```

`wrangler dev` binds a local D1 file and local R2 storage, so nothing touches remote data. Admin routes need `ACCESS_DEV_BYPASS=1` in `.dev.vars`, since there is no Access edge locally. That flag stays gitignored, and the config lint rejects it if it ever lands in committed config.

```bash
npm test              # vitest, runs inside workerd against real D1/R2 bindings
npx tsc --noEmit      # typecheck
npm run lint-config   # structural config lints (run in CI before deploy)
```

## Deploying

CI (`.github/workflows/deploy.yml`) drives deploys: a push to `dev` deploys the preview Worker, and a merge to `main` deploys production. The deploy job applies D1 migrations before uploading the Worker. Manual `wrangler deploy` is the emergency path only.

[`docs/deploy/SETUP.md`](docs/deploy/SETUP.md) covers the Cloudflare account setup: bindings, secrets, R2 buckets, and Cloudflare Access.

## Documentation

- [`docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md`](docs/design/2026-07-02-gated-asset-sharing-site-design.cloudflare.md): the specification (code comments reference its section numbers).
- [`docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md`](docs/design/2026-07-03-asset-manager-r2-and-recoverable-codes-design.md): the R2 asset manager and recoverable codes.
- [`docs/pitfalls/`](docs/pitfalls/): read before changing code.
- [`docs/git-strategy.md`](docs/git-strategy.md): branch and worktree conventions.
- [`CLAUDE.md`](CLAUDE.md): working conventions for coding agents.

## Security posture

- Every failure returns one byte-identical page with identical headers.
- Authorization is re-checked in the database on every request; revocation is immediate.
- The R2 bucket has no public URL; the Worker is the only way to reach the content, and only after the checks above.
- D1 is the single source of time; expiry and revocation are computed in SQL, never from a client clock.
- Admin pages carry a strict, hash-pinned Content-Security-Policy with no `unsafe-inline`.
- The Worker never serves a static surface: it has no `assets` config, and the build lints against one.
