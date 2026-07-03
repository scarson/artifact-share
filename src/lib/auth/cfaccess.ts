import { createRemoteJWKSet, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from "jose";

export type AccessConfig = { teamDomain: string; aud: string; adminEmail: string };

// `Parameters<typeof jwtVerify>[1]` collapses to just `JWTVerifyGetKey` (TS's `Parameters<>` only
// sees the last overload signature of an overloaded function), which would reject a raw CryptoKey.
// Spell the accepted-key union out explicitly so both the test-injected public key and the
// production remote-JWKS resolver type-check.
type AccessKeySource = CryptoKey | JWTVerifyGetKey;

/** Verify a Cloudflare Access application token (the value of the Cf-Access-Jwt-Assertion header).
 *  Confirms the RS256 signature against the team JWKS, pins issuer (team domain) + audience (the
 *  Access app's AUD tag), then confirms the authenticated `email` claim is the configured admin.
 *  Returns the email on success, null on ANY failure (fail closed). `keySet` is injectable ONLY for
 *  tests; production always resolves the remote JWKS at ${teamDomain}/cdn-cgi/access/certs. */
export async function verifyAccessToken(
  token: string | undefined,
  cfg: AccessConfig,
  keySet?: AccessKeySource,
): Promise<string | null> {
  if (!token) return null;
  const verifyOptions = {
    issuer: cfg.teamDomain,
    audience: cfg.aud,
    algorithms: ["RS256"], // Cloudflare Access signs with RS256; pin to block alg-confusion
  };
  try {
    // Build the key resolver INSIDE the try: a malformed ACCESS_TEAM_DOMAIN (empty, or a scheme-less
    // operator typo like "team.cloudflareaccess.com") makes `new URL()` throw — it must fail CLOSED
    // to null like every other failure, not escape as a distinguishable HTTP 500 (fail-page parity).
    const keys = keySet ?? createRemoteJWKSet(new URL(`${cfg.teamDomain}/cdn-cgi/access/certs`));
    // `jwtVerify` is overloaded (direct key vs. key-resolver function) and TS can't distribute a
    // union argument across overloads at a single call site, so discriminate here to call the
    // matching overload directly — both branches run the identical verification logic.
    const { payload } =
      typeof keys === "function"
        ? await jwtVerify(token, keys, verifyOptions)
        : await jwtVerify(token, keys, verifyOptions);
    // We do NOT check `email_verified`: Cloudflare Access controls token issuance (it only mints an
    // assertion for an authenticated identity from the pinned team+app), so email_verified is not a
    // boundary this Worker owns — the pinned issuer/audience + the admin-email allowlist are.
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email || email.toLowerCase() !== cfg.adminEmail.toLowerCase()) return null;
    return email;
  } catch {
    return null;
  }
}
