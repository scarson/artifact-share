import { SignJWT, jwtVerify, decodeProtectedHeader } from "jose";

const enc = (s: string) => new TextEncoder().encode(s);
const V = 1; // token schema version

export type KeyRing = { kid: string; key: Uint8Array }[]; // current key FIRST

/** Parse "kid:secret,kid:secret" (current kid first) into a key ring. Rejects empty secrets and
 *  duplicate kids (ambiguous rotation) — obvious misconfigs must fail early, not at verify time. */
export function parseKeyRing(env: string): KeyRing {
  const ring = env.split(",").map((raw) => {
    const e = raw.trim();
    const i = e.indexOf(":");
    if (i <= 0) throw new Error("key ring entry must be 'kid:secret'");
    const secret = e.slice(i + 1);
    if (!secret) throw new Error("key ring secret must be non-empty");
    return { kid: e.slice(0, i), key: enc(secret) };
  });
  if (ring.length === 0) throw new Error("empty key ring");
  if (new Set(ring.map((e) => e.kid)).size !== ring.length) throw new Error("duplicate kid in key ring");
  return ring;
}

async function sign(
  ring: KeyRing,
  claims: Record<string, unknown>,
  exp: number,
  iatSec?: number, // asset tokens pass DB time (spec §6 step 4); sessions omit it (wall clock)
): Promise<string> {
  const { kid, key } = ring[0]; // sign with the current key
  return await new SignJWT({ v: V, ...claims })
    .setProtectedHeader({ alg: "HS256", kid })
    .setIssuedAt(iatSec)
    .setExpirationTime(exp)
    .sign(key);
}

/** Select key by kid, verify signature+exp, PIN the algorithm to HS256 (block alg-confusion),
 *  enforce version. Returns the payload or null. */
async function verify(ring: KeyRing, token: string): Promise<Record<string, unknown> | null> {
  let kid: string | undefined;
  try { kid = decodeProtectedHeader(token).kid; } catch { return null; }
  const entry = ring.find((e) => e.kid === kid);
  if (!entry) return null; // unknown/retired kid → reject
  try {
    // Pin alg; REQUIRE exp+iat to exist (jose only enforces exp when present — a signed no-exp
    // token must not verify); jose then enforces the exp value.
    const { payload } = await jwtVerify(token, entry.key, {
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iat"],
    });
    if (payload.v !== V) return null; // unknown schema version → reject
    return payload as Record<string, unknown>;
  } catch {
    return null; // bad signature / expired / missing claims / wrong alg
  }
}

/** Reject any payload with keys outside `allowed` (strict schema — spec §6 step 4). */
function keysOk(p: Record<string, unknown>, allowed: string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(p).every((k) => set.has(k));
}

export type AssetClaims = { slug: string; codeId: string; cookieExp: number };

/** Asset cookie bound to {slug, codeId, cookieExp}. cookieExp AND iatSec are the absolute
 *  unix-seconds values RETURNED BY the atomic redeem statement (DB time — spec §6 step 4). */
export async function signAssetToken(c: AssetClaims, ring: KeyRing, iatSec?: number): Promise<string> {
  return await sign(ring, { slug: c.slug, codeId: c.codeId, cookieExp: c.cookieExp }, c.cookieExp, iatSec);
}

export async function verifyAssetToken(token: string, expectedSlug: string, ring: KeyRing): Promise<AssetClaims | null> {
  const p = await verify(ring, token);
  if (!p) return null;
  if (!keysOk(p, ["v", "iat", "exp", "slug", "codeId", "cookieExp"])) return null; // reject extra fields
  if (p.slug !== expectedSlug) return null;                                          // no cross-asset replay
  if (typeof p.codeId !== "string" || typeof p.cookieExp !== "number") return null;
  if (p.exp !== p.cookieExp) return null; // the enforced exp IS the DB-computed cookie_exp — no drift
  return { slug: p.slug, codeId: p.codeId, cookieExp: p.cookieExp };
}

export async function signSession(ring: KeyRing, exp: number): Promise<string> {
  return await sign(ring, { sub: "admin" }, exp);
}

export async function verifySession(token: string, ring: KeyRing): Promise<boolean> {
  const p = await verify(ring, token);
  return !!p && keysOk(p, ["v", "iat", "exp", "sub"]) && p.sub === "admin";
}
