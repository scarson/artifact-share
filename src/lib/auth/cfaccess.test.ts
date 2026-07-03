import { generateKeyPair, SignJWT } from "jose";
import { expect, test } from "vitest";
import { verifyAccessToken } from "./cfaccess";

const CFG = { teamDomain: "https://team.cloudflareaccess.com", aud: "test-aud-tag", adminEmail: "admin@share.test" };

async function keys() {
  return await generateKeyPair("RS256", { extractable: true });
}
async function mkToken(
  privateKey: CryptoKey,
  claims: { email?: string; iss?: string; aud?: string } = {},
  opts: { expSec?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email: claims.email ?? CFG.adminEmail })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(claims.iss ?? CFG.teamDomain)
    .setAudience(claims.aud ?? CFG.aud)
    .setIssuedAt(now)
    .setExpirationTime(opts.expSec ?? now + 3600)
    .sign(privateKey);
}

test("accepts a valid Access token for the admin email; returns the email", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await mkToken(privateKey);
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBe("admin@share.test");
});

test("returns null for an undefined/missing token", async () => {
  const { publicKey } = await keys();
  expect(await verifyAccessToken(undefined, CFG, publicKey)).toBeNull();
  expect(await verifyAccessToken("", CFG, publicKey)).toBeNull();
});

test("a malformed teamDomain fails CLOSED (returns null, does not throw)", async () => {
  // No injected keySet ⇒ the module builds createRemoteJWKSet(new URL(`${teamDomain}/...`)). An
  // empty or scheme-less teamDomain makes `new URL()` throw; it MUST be caught → null, never escape
  // as a 500 (fail-page parity). URL construction fails before any network fetch, so no network here.
  const { privateKey } = await keys();
  const tok = await mkToken(privateKey);
  for (const badDomain of ["", "   ", "team.cloudflareaccess.com"]) {
    expect(await verifyAccessToken(tok, { ...CFG, teamDomain: badDomain })).toBeNull();
  }
});

test("rejects a token signed by a DIFFERENT key (forged)", async () => {
  const signer = await keys();
  const verifier = await keys();
  const tok = await mkToken(signer.privateKey);
  expect(await verifyAccessToken(tok, CFG, verifier.publicKey)).toBeNull();
});

test("rejects a wrong audience (token for another Access app)", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await mkToken(privateKey, { aud: "some-other-aud" });
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBeNull();
});

test("rejects a wrong issuer (token from another team)", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await mkToken(privateKey, { iss: "https://evil.cloudflareaccess.com" });
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBeNull();
});

test("rejects a valid token whose email is NOT the admin (allowlist)", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await mkToken(privateKey, { email: "someone-else@gmail.com" });
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBeNull();
});

test("email match is case-insensitive", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await mkToken(privateKey, { email: "Admin@Share.Test" });
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBe("Admin@Share.Test");
});

test("rejects an expired token", async () => {
  const { privateKey, publicKey } = await keys();
  const now = Math.floor(Date.now() / 1000);
  const tok = await mkToken(privateKey, {}, { expSec: now - 10 });
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBeNull();
});

test("rejects a token with no email claim", async () => {
  const { privateKey, publicKey } = await keys();
  const tok = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(CFG.teamDomain).setAudience(CFG.aud)
    .setIssuedAt().setExpirationTime("1h").sign(privateKey);
  expect(await verifyAccessToken(tok, CFG, publicKey)).toBeNull();
});
