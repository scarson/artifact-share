export interface Env {
  DB: D1Database;
  /** "development" | "preview" | "production" — the ONLY environment oracle (spec §10). */
  ENVIRONMENT: string;
  /** Canonical origin for this environment — CSRF pin + link minting (spec §8). */
  PUBLIC_ORIGIN: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_TOTP_SECRET: string;
  /** Key rings: "<kid>:<secret>[,<kid>:<secret>…]", current kid first (spec §10). */
  SESSION_SECRET: string;
  ASSET_COOKIE_SECRET: string;
}
