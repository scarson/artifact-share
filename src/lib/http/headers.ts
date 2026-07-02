export const ASSET_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// Admin + failure + everything-else CSP (no 'unsafe-inline' — first-party server-rendered HTML).
export const ADMIN_CSP =
  "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

/** The site-wide set applied to EVERY response class by the finalizing middleware (spec §9).
 *  no-store is global by design: nothing this Worker emits may be cached anywhere. */
export function baseHeaders(): Record<string, string> {
  return {
    "cache-control": "no-store",
    "pragma": "no-cache",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    // HSTS without includeSubDomains/preload until the whole domain is confirmed HTTPS-clean (spec §9).
    "strict-transport-security": "max-age=63072000",
  };
}
