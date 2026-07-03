export const ASSET_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

// Admin + failure + everything-else CSP. Still NO 'unsafe-inline': the two first-party <style>
// blocks (ui/styles.ts PUBLIC_STYLE + ADMIN_STYLE) and the single <script> (ADMIN_SCRIPT, the
// copy button) are allowlisted by sha256 hash. An explicit script-src of ONLY that hash is
// STRICTER than the previous default-src 'self' fallback: no other script — inline or same-origin
// file — can run on these pages. csp.test.ts recomputes all three hashes from the exported
// constants — editing them without updating these fails that test with the correct values
// printed. img-src data: is for the inline SVG favicon.
export const ADMIN_CSP =
  "default-src 'self'; " +
  "style-src 'sha256-yAEFmINTkCHC3+A/1bv1OXvr7Zwb8UtKjnlSoXwayrc=' 'sha256-hgRgyNpE5IpPn7GYrsC17fLSZB7qYqNfu1FaFXwGNwo='; " +
  "script-src 'sha256-t8r2vfkBVAJuigX+lZ3X6kR5DE9oTstCy57ksIYKyJ8='; " +
  "img-src 'self' data:; " +
  "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

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
