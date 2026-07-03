export interface Env {
  DB: D1Database;
  /** "development" | "preview" | "production" — the ONLY environment oracle (spec §10). */
  ENVIRONMENT: string;
  /** Canonical origin for this environment — CSRF pin + link minting (spec §8). */
  PUBLIC_ORIGIN: string;
  /** Key ring for the recipient asset cookie: "<kid>:<secret>[,<kid>:<secret>…]", current kid first (spec §10). */
  ASSET_COOKIE_SECRET: string;
  /** Cloudflare Access team domain, e.g. https://<team>.cloudflareaccess.com — JWT issuer + JWKS base (admin auth). */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's Audience (AUD) tag — pinned as the JWT audience (admin auth). */
  ACCESS_AUD: string;
  /** The single admin's email; the Worker re-checks the Access token's email claim against this. */
  ADMIN_EMAIL: string;
  /** DEV-ONLY: when "1", the admin routes skip Access verification (local `wrangler dev`, which has
   *  no Access edge). MUST be unset in preview/production — never declared in those env blocks. */
  ACCESS_DEV_BYPASS?: string;
}
