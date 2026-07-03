import { SELF, env } from "cloudflare:test";
import { beforeEach, expect, test, vi } from "vitest";
import { hashCode } from "../lib/codes";
import app from "../index";
import { FIXTURE_SLUG as SLUG, seedFixtureAsset } from "../test/seedAsset";

const BASE = "https://share.test";

// File-wide: the gate now serves the document from R2 and checks the asset row in D1, so every
// test needs the fixture asset present (D1 rows + its v1 index.html object). Runs after the
// setup-file's per-test D1 reset; R2 re-put is an idempotent overwrite (repairs deleted objects).
beforeEach(() => seedFixtureAsset());

async function seedCode(code = "integration-code-0001"): Promise<string> {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind(await hashCode(code), SLUG).run();
  return code;
}

/** Redeem a code and return the cookie; follows the two-step redirect to /a/<slug>/. */
async function redeemCookie(code: string): Promise<string> {
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
  expect(r1.headers.get("location")).toBe(`/a/${SLUG}/`); // trailing slash — relative refs resolve in-bundle
  return r1.headers.get("set-cookie")!.split(";")[0];
}

function expectFullHeaderSet(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("pragma")).toBe("no-cache");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
  expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
}

test("happy path: ?code= → 302 to /a/<slug>/ (cookie) → 200 document from R2 with asset CSP", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
  expect(r1.headers.get("location")).toBe(`/a/${SLUG}/`); // ?code= stripped, trailing slash
  expectFullHeaderSet(r1);
  const setCookie = r1.headers.get("set-cookie")!;
  expect(setCookie).toContain(`asset_access_${SLUG}=`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie.toLowerCase()).toContain("samesite=lax");
  expect(setCookie.toLowerCase()).toContain("max-age=");
  expect(setCookie).toContain(`Path=/a/${SLUG}`);

  const cookie = setCookie.split(";")[0];
  const r2 = await SELF.fetch(`${BASE}/a/${SLUG}/`, { headers: { cookie } });
  expect(r2.status).toBe(200);
  expect(await r2.text()).toContain("fixture ok");
  expectFullHeaderSet(r2);
  expect(r2.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
});

test("bare /a/<slug> with a valid cookie 302s to /a/<slug>/; the document + relative subresources serve there", async () => {
  const cookie = await redeemCookie(await seedCode());
  const bare = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie }, redirect: "manual" });
  expect(bare.status).toBe(302);
  expect(bare.headers.get("location")).toBe(`/a/${SLUG}/`);
  await env.ASSETS.put(`a/${SLUG}/1/css/app.css`, "body{color:red}", { httpMetadata: { contentType: "text/css" } });
  const css = await SELF.fetch(`${BASE}/a/${SLUG}/css/app.css`, { headers: { cookie } });
  expect(css.status).toBe(200);
  expect(css.headers.get("content-type")).toBe("text/css");
  expect(await css.text()).toBe("body{color:red}");
});

test("revocation is instant on subresources too (cookie re-checked per request)", async () => {
  const cookie = await redeemCookie(await seedCode());
  await env.ASSETS.put(`a/${SLUG}/1/x.css`, "i{}", { httpMetadata: { contentType: "text/css" } });
  expect((await SELF.fetch(`${BASE}/a/${SLUG}/x.css`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}/x.css`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("subresource without a cookie, with encoded traversal, or missing → byte-identical generic failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  const cookie = await redeemCookie(await seedCode());
  for (const req of [
    app.request(`/a/${SLUG}/x.css`, {}, env),                                            // no cookie
    app.request(`/a/${SLUG}/%2e%2e%2f1%2findex.html`, { headers: { cookie } }, env),     // encoded ../
    app.request(`/a/${SLUG}/nope.css`, { headers: { cookie } }, env),                    // missing object
  ]) expect(await (await req).text()).toBe(canonicalBody);
});

test("failure parity: unknown-slug and wrong-code responses are byte-identical", async () => {
  await seedCode();
  const unknown = await SELF.fetch(`${BASE}/a/unknownslug00000000000?code=x`);
  const wrong = await SELF.fetch(`${BASE}/a/${SLUG}?code=wrong-code`);
  expect(unknown.status).toBe(200);
  expect(wrong.status).toBe(200);
  expect(await unknown.text()).toBe(await wrong.text());
  const strip = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  expect(strip(unknown.headers)).toBe(strip(wrong.headers));
  expectFullHeaderSet(unknown);
});

test("no-cookie and garbage-cookie clean loads return the same generic page", async () => {
  const none = await SELF.fetch(`${BASE}/a/${SLUG}`);
  const garbage = await SELF.fetch(`${BASE}/a/${SLUG}`, {
    headers: { cookie: `asset_access_${SLUG}=garbage` },
  });
  expect(await none.text()).toBe(await garbage.text());
  expect(none.status).toBe(200);
});

test("revoked code is denied on the NEXT load (instant revocation via recheck)", async () => {
  const cookie = await redeemCookie(await seedCode());
  expect((await SELF.fetch(`${BASE}/a/${SLUG}/`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}/`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("redemption precedence: a present ?code= re-validates even with a cookie attached", async () => {
  const cookie = await redeemCookie(await seedCode());
  // Wrong code + valid cookie ⇒ redemption path runs and FAILS (cookie is ignored, spec §6 step 2).
  const res = await SELF.fetch(`${BASE}/a/${SLUG}?code=wrong`, { headers: { cookie }, redirect: "manual" });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("invalid or has expired");
});

test("malformed/traversal slugs are rejected before any DB access", async () => {
  for (const bad of ["..%2f..%2fetc", "short", "waytoolongslug0000000000000000"]) {
    const res = await SELF.fetch(`${BASE}/a/${bad}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("invalid or has expired");
  }
});

test("malformed slugs are denied even when the DB is down (shape check precedes any load-bearing DB use)", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  const res = await app.request("/a/..%2f..%2fetc", {}, { ...env, DB: throwing });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("invalid or has expired"); // limiter fails OPEN; response identical
});

test("preview environment is INERT for /a/* — BYTE-IDENTICAL to a wrong-code failure", async () => {
  const code = await seedCode();
  const canonical = await app.request(`/a/${SLUG}?code=wrong-code`, {}, env);
  const preview = await app.request(`/a/${SLUG}?code=${code}`, {}, { ...env, ENVIRONMENT: "preview" });
  expect(preview.status).toBe(200);
  expect(await preview.text()).toBe(await canonical.text());
  const stripDate = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  expect(stripDate(preview.headers)).toBe(stripDate(canonical.headers));
  expect(preview.headers.get("set-cookie")).toBeNull(); // no cookie issued off-production
});

test("robots.txt disallows everything; root carries the full header set", async () => {
  const robots = await SELF.fetch(`${BASE}/robots.txt`);
  expect(await robots.text()).toContain("Disallow: /");
  expectFullHeaderSet(robots);
  const root = await SELF.fetch(`${BASE}/`);
  expect(root.status).toBe(200);
  expectFullHeaderSet(root);
});

test("a signature-valid-cookie load is limiter-EXEMPT but still DB-rechecked", async () => {
  const cookie = await redeemCookie(await seedCode());
  // Exhaust the per-slug load bucket with unauthenticated (cookie-less) loads…
  for (let i = 0; i < 25; i++) await SELF.fetch(`${BASE}/a/${SLUG}/`);
  // …the cookie-holder still gets through (exempt), because the route never calls the limiter for
  // a signature-valid cookie — but revocation still bites (authorization is never skipped):
  expect((await SELF.fetch(`${BASE}/a/${SLUG}/`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}/`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("a VALID signed cookie with D1 down is DENIED at the route (fail closed, spec §6 step 5)", async () => {
  const cookie = await redeemCookie(await seedCode());
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  const res = await app.request(`/a/${SLUG}/`, { headers: { cookie } }, { ...env, DB: throwing });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("invalid or has expired");
  expect(body).not.toContain("fixture ok"); // never served from the cookie alone
});

test("unpublished asset (active_version NULL): valid code redeems to the generic page, NO integrity alert, NO cookie", async () => {
  await env.DB.prepare("UPDATE assets SET active_version = NULL WHERE slug = ?1").bind(SLUG).run();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await app.request(`/a/${SLUG}?code=${await seedCode()}`, { redirect: "manual" }, env);
  expect(res.status).toBe(200); // failure page, not a redirect
  expect(await res.text()).toContain("invalid or has expired");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(spy).not.toHaveBeenCalled(); // unpublished is silent, not an integrity failure
  spy.mockRestore();
});

test("integrity alert: active version set but the R2 object is missing → generic page + structured error log + NO cookie (spec §13)", async () => {
  await env.ASSETS.delete(`a/${SLUG}/1/index.html`);
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await app.request(`/a/${SLUG}?code=${await seedCode()}`, { redirect: "manual" }, env);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("invalid or has expired");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(spy.mock.calls.some(([m]) => typeof m === "string" && m.includes('"asset_object_missing"'))).toBe(true);
  spy.mockRestore();
});
