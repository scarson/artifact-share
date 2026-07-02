import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { ASSET_CSP } from "../lib/http/headers";
import { getAssetHtml, isValidSlug } from "../lib/assets";
import { redeem, recheck } from "../lib/gate";
import { hashCode } from "../lib/codes";
import { parseKeyRing, signAssetToken, verifyAssetToken } from "../lib/crypto/tokens";
import { servesTraffic } from "../lib/envgate";
import { badShapeLimitOk, gateLimitOk } from "../lib/ratelimit";

export const gate = new Hono<{ Bindings: Env }>();

const cookieName = (slug: string) => `asset_access_${slug}`;

gate.get("/a/:slug", async (c) => {
  // Spec §10/§15 Q3: ONLY production serves — every other environment gets the same generic page
  // (no fingerprint). Local QA opts in via .dev.vars ENVIRONMENT=production (local D1 only).
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();

  const slug = c.req.param("slug");
  // Runtime slug-shape check before ANY DB/map access (spec §6 step 5). Malformed slugs may
  // fast-reject (accepted timing class, spec §6 step 3).
  if (!isValidSlug(slug)) {
    await badShapeLimitOk(c.env.DB); // count junk toward the global breaker (fixed bucket)
    return failurePage();
  }

  const ring = parseKeyRing(c.env.ASSET_COOKIE_SECRET);
  const code = c.req.query("code");

  // Redemption precedence (spec §6 step 2): a present ?code ALWAYS re-validates + re-issues,
  // ignoring any existing cookie.
  if (code !== undefined) {
    if (!(await gateLimitOk(c.env.DB, "redeem", slug))) return failurePage();
    let res: Awaited<ReturnType<typeof redeem>>;
    try {
      res = await redeem(c.env.DB, await hashCode(code), slug);
    } catch {
      res = null; // DB error/timeout ⇒ fail closed: no cookie, generic page (spec §6 step 4)
    }
    if (!res) return failurePage();
    // Integrity check AFTER the constant-work redeem, NEVER before it (a pre-redeem module check
    // would fail unknown slugs faster than wrong codes — the §6 timing oracle). A valid code whose
    // module is missing is an integrity failure (spec §13): alert loudly, issue NO cookie.
    if (getAssetHtml(slug) === null) {
      console.error(JSON.stringify({ level: "error", event: "asset_module_missing", slug, codeId: res.codeId }));
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
    return c.redirect(`/a/${slug}`, 302); // strips ?code=; no-store applied by the header middleware
  }

  // Clean load (spec §6 step 5): the signature check decides ONLY the limiter skip; authorization is
  // ALWAYS the DB recheck (fail closed).
  const token = getCookie(c, cookieName(slug));
  const claims = token ? await verifyAssetToken(token, slug, ring) : null;
  if (!claims) {
    // Deliberately NOT branching on the result: this request is denied either way (no valid
    // cookie), and the bump exists purely to feed the per-slug/global counters that protect the
    // REDEMPTION path. Do not "fix" this into a branch — it would change nothing observable.
    await gateLimitOk(c.env.DB, "load", slug);
    return failurePage();
  }
  if (!(await recheck(c.env.DB, claims.codeId, slug))) return failurePage(); // instant revoke

  const html = getAssetHtml(slug);
  if (html === null) {
    // Valid code but missing asset module = integrity failure (bad build), NOT a normal 404
    // (spec §13). Same page to the client; loud structured alert. NEVER log the code or URL.
    console.error(JSON.stringify({ level: "error", event: "asset_module_missing", slug, codeId: claims.codeId }));
    return failurePage();
  }
  c.header("content-security-policy", ASSET_CSP); // asset CSP overrides the middleware default
  c.header("content-type", "text/html; charset=utf-8");
  return c.body(html);
});
