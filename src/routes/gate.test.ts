import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import { hashCode } from "../lib/codes";
import app from "../index";

const SLUG = "testasset0000000000000";
const BASE = "https://share.test";

async function seedCode(code = "integration-code-0001"): Promise<string> {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind(await hashCode(code), SLUG).run();
  return code;
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

test("happy path: ?code= → 302 (no-store, cookie) → clean URL → 200 asset with asset CSP", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
  expect(r1.headers.get("location")).toBe(`/a/${SLUG}`); // ?code= stripped
  expectFullHeaderSet(r1);
  const setCookie = r1.headers.get("set-cookie")!;
  expect(setCookie).toContain(`asset_access_${SLUG}=`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie.toLowerCase()).toContain("samesite=lax");
  expect(setCookie.toLowerCase()).toContain("max-age="); // mirrors DB cookie_exp (spec §6 step 4)
  expect(setCookie).toContain(`Path=/a/${SLUG}`);

  const cookie = setCookie.split(";")[0];
  const r2 = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } });
  expect(r2.status).toBe(200);
  expect(await r2.text()).toContain("fixture ok");
  expectFullHeaderSet(r2);
  expect(r2.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
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
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
  expect((await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } })).status).toBe(200);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch()").run();
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("redemption precedence: a present ?code= re-validates even with a cookie attached", async () => {
  const code = await seedCode();
  const r1 = await SELF.fetch(`${BASE}/a/${SLUG}?code=${code}`, { redirect: "manual" });
  const cookie = r1.headers.get("set-cookie")!.split(";")[0];
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

test("robots.txt disallows everything; root is blank; both carry the full header set", async () => {
  const robots = await SELF.fetch(`${BASE}/robots.txt`);
  expect(await robots.text()).toContain("Disallow: /");
  expectFullHeaderSet(robots);
  const root = await SELF.fetch(`${BASE}/`);
  expect(root.status).toBe(200);
  expectFullHeaderSet(root);
});

test("manifest URLs are not routable — they land on the generic page (spec §13 deny tests)", async () => {
  for (const path of ["/assets/manifest.json", "/a/manifest.json", `/a/${SLUG}/manifest.json`]) {
    const res = await SELF.fetch(`${BASE}${path}`);
    expect(await res.text()).toContain("invalid or has expired");
  }
});
