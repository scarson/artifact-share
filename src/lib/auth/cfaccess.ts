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
  const keys = keySet ?? createRemoteJWKSet(new URL(`${cfg.teamDomain}/cdn-cgi/access/certs`));
  const verifyOptions = {
    issuer: cfg.teamDomain,
    audience: cfg.aud,
    algorithms: ["RS256"], // Cloudflare Access signs with RS256; pin to block alg-confusion
  };
  try {
    // `jwtVerify` is overloaded (direct key vs. key-resolver function) and TS can't distribute a
    // union argument across overloads at a single call site, so discriminate here to call the
    // matching overload directly — both branches run the identical verification logic.
    const { payload } =
      typeof keys === "function"
        ? await jwtVerify(token, keys, verifyOptions)
        : await jwtVerify(token, keys, verifyOptions);
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email || email.toLowerCase() !== cfg.adminEmail.toLowerCase()) return null;
    return email;
  } catch {
    return null;
  }
}
