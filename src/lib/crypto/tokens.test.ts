import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { parseKeyRing, signAssetToken, verifyAssetToken, signSession, verifySession } from "./tokens";

const ringA = parseKeyRing("k1:secret-alpha-000000000000000000000000000000");
const soon = () => Math.floor(Date.now() / 1000) + 3600;

test("asset token round-trips {slug, codeId, cookieExp}", async () => {
  const exp = soon();
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: exp }, ringA);
  expect(await verifyAssetToken(tok, "s", ringA)).toEqual({ slug: "s", codeId: "id1", cookieExp: exp });
});

test("asset-token iat is the caller-supplied DB time, not wall-clock (spec §6 step 4)", async () => {
  const exp = soon();
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: exp }, ringA, exp - 86400);
  expect(decodeJwt(tok).iat).toBe(exp - 86400);
});

test("rejects a token for a different slug (no cross-asset replay)", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA);
  expect(await verifyAssetToken(tok, "other", ringA)).toBeNull();
});

test("rejects an expired token", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: Math.floor(Date.now() / 1000) - 1 }, ringA);
  expect(await verifyAssetToken(tok, "s", ringA)).toBeNull();
});

test("key ring: previous kid still verifies during rotation; retired kid is rejected", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA); // signed with k1
  const during = parseKeyRing("k2:secret-beta-1111111111111111111111111111111,k1:secret-alpha-000000000000000000000000000000");
  expect(await verifyAssetToken(tok, "s", during)).not.toBeNull(); // k1 still present
  const after = parseKeyRing("k2:secret-beta-1111111111111111111111111111111");
  expect(await verifyAssetToken(tok, "s", after)).toBeNull(); // k1 retired
});

test("rejects a token whose kid is not in the ring", async () => {
  const tok = await signAssetToken({ slug: "s", codeId: "id1", cookieExp: soon() }, ringA); // kid k1
  const foreign = parseKeyRing("kX:secret-alpha-000000000000000000000000000000"); // same secret, different kid
  expect(await verifyAssetToken(tok, "s", foreign)).toBeNull();
});

test("strict schema: a session token is NOT accepted as an asset token", async () => {
  const sess = await signSession(ringA, soon()); // has `sub`, lacks slug/codeId/cookieExp
  expect(await verifyAssetToken(sess, "s", ringA)).toBeNull();
});

test("a correctly-signed token WITHOUT exp is rejected (requiredClaims)", async () => {
  const { SignJWT } = await import("jose");
  const forged = await new SignJWT({ v: 1, slug: "s", codeId: "id1", cookieExp: soon() })
    .setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuedAt()
    .sign(new TextEncoder().encode("secret-alpha-000000000000000000000000000000")); // no setExpirationTime
  expect(await verifyAssetToken(forged, "s", ringA)).toBeNull();
});

test("a token whose exp disagrees with cookieExp is rejected (binding check)", async () => {
  const { SignJWT } = await import("jose");
  const exp = soon();
  const skewed = await new SignJWT({ v: 1, slug: "s", codeId: "id1", cookieExp: exp - 999 })
    .setProtectedHeader({ alg: "HS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode("secret-alpha-000000000000000000000000000000"));
  expect(await verifyAssetToken(skewed, "s", ringA)).toBeNull();
});

test("parseKeyRing rejects empty secrets and duplicate kids", () => {
  expect(() => parseKeyRing("k1:")).toThrow();
  expect(() => parseKeyRing("k1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,k1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toThrow();
});

test("session round-trips and rejects a foreign ring", async () => {
  const tok = await signSession(ringA, soon());
  expect(await verifySession(tok, ringA)).toBe(true);
  expect(await verifySession(tok, parseKeyRing("k1:totally-different-secret-22222222222222222222"))).toBe(false);
});
