import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { ASSET_CSP } from "../lib/http/headers";
import { redeem, recheck } from "../lib/gate";
import { hashCode, isValidSlug } from "../lib/codes";
import { parseKeyRing, signAssetToken, verifyAssetToken } from "../lib/crypto/tokens";
import { servesTraffic } from "../lib/envgate";
import { badShapeLimitOk, gateLimitOk } from "../lib/ratelimit";
import { activeVersion, publicAssetBySlug } from "../lib/db/assetRepo";
import { readAssetFile } from "../lib/content/store";
import { servePublicFile } from "./publicAsset";

export const gate = new Hono<{ Bindings: Env }>();

const cookieName = (slug: string) => `asset_access_${slug}`;

/** Stream one file of an asset version with the right content type + asset CSP for HTML. Fail
 *  closed: a miss/error is the generic page. `integrityCodeId` set ⇒ a missing index.html is an
 *  integrity failure (valid auth, active version, but the object is gone — spec §13), logged. */
async function serveFile(env: Env, slug: string, version: number, path: string, integrityCodeId?: string): Promise<Response> {
  const obj = await readAssetFile(env.ASSETS, slug, version, path).catch(() => null);
  if (!obj) {
    if (path === "index.html" && integrityCodeId !== undefined) {
      console.error(JSON.stringify({ level: "error", event: "asset_object_missing", slug, version, codeId: integrityCodeId }));
    }
    return failurePage();
  }
  const headers = new Headers({ "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" });
  if (obj.httpMetadata?.contentType?.startsWith("text/html")) headers.set("content-security-policy", ASSET_CSP);
  return new Response(obj.body, { status: 200, headers });
}

// Document route. A present ?code always re-validates + re-issues (spec §6 step 2), ignoring any
// existing cookie. Public assets short-circuit BEFORE any code/cookie logic. Authorized document
// loads 302 to the trailing-slash URL so relative subresource refs resolve inside the bundle
// (RFC 3986); the body streams from the wildcard route below.
gate.get("/a/:slug", async (c) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) {
    await badShapeLimitOk(c.env.DB);
    return failurePage();
  }

  // Public asset: no code, no cookie — canonicalize to the trailing-slash URL (the body serves
  // from /a/:slug/*). Wins over a present ?code=.
  if (await publicAssetBySlug(c.env.DB, slug).catch(() => null)) {
    return c.redirect(`/a/${slug}/`, 302);
  }

  const ring = parseKeyRing(c.env.ASSET_COOKIE_SECRET);
  const code = c.req.query("code");

  if (code !== undefined) {
    if (!(await gateLimitOk(c.env.DB, "redeem", slug))) return failurePage();
    let res: Awaited<ReturnType<typeof redeem>>;
    try {
      res = await redeem(c.env.DB, await hashCode(code), slug);
    } catch {
      res = null; // DB error/timeout ⇒ fail closed: no cookie, generic page (spec §6 step 4)
    }
    if (!res) return failurePage();
    // Integrity check AFTER the constant-work redeem, NEVER before it (a pre-redeem check would
    // fail unknown slugs faster than wrong codes — the §6 timing oracle). Valid code whose active
    // version's index.html is missing from R2 is an integrity failure (spec §13): alert, no cookie.
    const v = await activeVersion(c.env.DB, slug).catch(() => null);
    if (v === null) return failurePage(); // unpublished/unknown ⇒ silent generic page
    if ((await c.env.ASSETS.head(`a/${slug}/${v}/index.html`)) === null) {
      console.error(JSON.stringify({ level: "error", event: "asset_object_missing", slug, version: v, codeId: res.codeId }));
      return failurePage();
    }
    const token = await signAssetToken(
      { slug, codeId: res.codeId, cookieExp: res.cookieExpSec },
      ring,
      res.iatSec, // DB-time iat from the atomic redeem (spec §6 step 4)
    );
    setCookie(c, cookieName(slug), token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax", // Strict would drop the cookie on the cross-site link click (spec §6 step 4)
      path: `/a/${slug}`,
      // Both attributes mirror the DB-computed cookie_exp (spec §6 step 4); the ENFORCED expiry is
      // inside the signed token — a tampered attribute can't extend access.
      maxAge: res.cookieExpSec - res.iatSec,
      expires: new Date(res.cookieExpSec * 1000),
    });
    return c.redirect(`/a/${slug}/`, 302); // trailing slash; strips ?code=; no-store from middleware
  }

  // Clean load: authorization is ALWAYS the DB recheck (fail closed). On success, canonicalize to
  // the trailing-slash URL — do NOT serve a body here (the wildcard route serves it).
  const token = getCookie(c, cookieName(slug));
  const claims = token ? await verifyAssetToken(token, slug, ring) : null;
  if (!claims) {
    // Not branched on: this request is denied either way; the bump feeds the counters protecting
    // the REDEMPTION path.
    await gateLimitOk(c.env.DB, "load", slug);
    return failurePage();
  }
  if (!(await recheck(c.env.DB, claims.codeId, slug))) return failurePage(); // instant revoke
  return c.redirect(`/a/${slug}/`, 302);
});

// Subresource + document-body route: /a/:slug/ (empty tail ⇒ index.html) and /a/:slug/<path>.
// No ?code= redemption here (single-entry at /a/:slug); cookie re-checked per request so instant
// revocation covers every file. Public assets serve without a cookie.
gate.get("/a/:slug/*", async (c) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  const slug = c.req.param("slug");
  if (!isValidSlug(slug)) {
    await badShapeLimitOk(c.env.DB);
    return failurePage();
  }
  let path: string;
  try {
    path = decodeURIComponent(c.req.path.slice(`/a/${slug}/`.length));
  } catch {
    return failurePage(); // malformed %-encoding is the generic page, never a 500
  }
  if (path === "") path = "index.html"; // /a/<slug>/ IS the document URL (trailing-slash canon.)

  // Public asset: serve without any cookie (shared helper — same as the alias routes).
  const pub = await publicAssetBySlug(c.env.DB, slug).catch(() => null);
  if (pub) return servePublicFile(c.env, slug, pub.active_version, path);

  const claims = (() => {
    const token = getCookie(c, cookieName(slug));
    return token ? verifyAssetToken(token, slug, parseKeyRing(c.env.ASSET_COOKIE_SECRET)) : null;
  })();
  const resolved = await claims;
  if (!resolved) {
    await gateLimitOk(c.env.DB, "load", slug);
    return failurePage();
  }
  if (!(await recheck(c.env.DB, resolved.codeId, slug))) return failurePage(); // instant revoke
  const v = await activeVersion(c.env.DB, slug).catch(() => null);
  if (v === null) return failurePage();
  return serveFile(c.env, slug, v, path, resolved.codeId);
});
