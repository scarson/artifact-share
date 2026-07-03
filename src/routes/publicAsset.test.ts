import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";
import app from "../index";
import { FIXTURE_SLUG, seedFixtureAsset } from "../test/seedAsset";
import { recordVersion, setAlias, setPublic } from "../lib/db/assetRepo";

beforeEach(() => seedFixtureAsset());

async function seedPublic(alias?: string) {
  await setPublic(env.DB, FIXTURE_SLUG, true);
  if (alias) await setAlias(env.DB, FIXTURE_SLUG, alias);
}

test("public asset: bare /a/<slug> 302s to /a/<slug>/ which serves with NO code and NO cookie; toggling off restores the gate instantly", async () => {
  await seedPublic();
  const bare = await app.request(`/a/${FIXTURE_SLUG}`, { redirect: "manual" }, env);
  expect(bare.status).toBe(302);
  expect(bare.headers.get("location")).toBe(`/a/${FIXTURE_SLUG}/`);
  const res = await app.request(`/a/${FIXTURE_SLUG}/`, {}, env);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("fixture ok");
  expect(res.headers.get("set-cookie")).toBeNull();               // public path issues nothing
  expect(res.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'"); // ASSET_CSP specifically
  await setPublic(env.DB, FIXTURE_SLUG, false);
  expect(await (await app.request(`/a/${FIXTURE_SLUG}/`, {}, env)).text()).toContain("invalid or has expired");
});

test("public bundle subresources serve without a cookie", async () => {
  await seedPublic();
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/app.css`, "body{}", { httpMetadata: { contentType: "text/css" } });
  const res = await app.request(`/a/${FIXTURE_SLUG}/app.css`, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/css");
});

test("alias: bare /<alias> 302s to /<alias>/ (relative-URL canonicalization); document + subresources serve under it", async () => {
  await seedPublic("about");
  const bare = await app.request("/about", { redirect: "manual" }, env);
  expect(bare.status).toBe(302);
  expect(bare.headers.get("location")).toBe("/about/");
  expect(await (await app.request("/about/", {}, env)).text()).toContain("fixture ok");
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/x.css`, "i{}", { httpMetadata: { contentType: "text/css" } });
  expect((await app.request("/about/x.css", {}, env)).status).toBe(200);
});

test("unknown alias, non-public alias, malformed alias → byte-identical generic failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  await setAlias(env.DB, FIXTURE_SLUG, "parked"); // NOT public
  for (const path of ["/nope", "/parked", "/UPPER", "/x%00y"]) {
    expect(await (await app.request(path, {}, env)).text()).toBe(canonicalBody);
  }
});

test("?code= on a public asset canonicalize-redirects (no cookie minted, code not consumed)", async () => {
  await seedPublic();
  const res = await app.request(`/a/${FIXTURE_SLUG}?code=whatever`, { redirect: "manual" }, env);
  expect(res.status).toBe(302);                                   // public short-circuit wins over redeem
  expect(res.headers.get("location")).toBe(`/a/${FIXTURE_SLUG}/`); // strips ?code=
  expect(res.headers.get("set-cookie")).toBeNull();
  const n = await env.DB.prepare("SELECT count(*) AS n FROM codes WHERE use_count > 0").first<{ n: number }>();
  expect(n!.n).toBe(0);
});

test("public + alias response classes carry the FULL §9 security-header set (mirror the SELF header-contract pattern)", async () => {
  await seedPublic("about");
  for (const res of [
    await app.request(`/a/${FIXTURE_SLUG}/`, {}, env),   // public 200
    await app.request("/about/", {}, env),                // alias 200
    await app.request("/no-such-alias", {}, env),         // alias failure
  ]) {
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
  }
});

test("fixed routes always win over aliases (defense in depth beyond reserved-name validation)", async () => {
  await seedPublic("about");
  expect(await (await app.request("/robots.txt", {}, env)).text()).toContain("Disallow");
  expect((await app.request("/", {}, env)).status).toBe(200); // root identity page, not an asset
});

// Seed a single-file public asset (any type) at version 2 and activate it.
async function seedSingleFile(entry: string, contentType: string, bytes = "data") {
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/2/${entry}`, bytes, { httpMetadata: { contentType } });
  await recordVersion(env.DB, FIXTURE_SLUG, 2, 1, bytes.length, true, entry);
  await setPublic(env.DB, FIXTURE_SLUG, true);
}

test("single-file public asset: a PDF serves inline with its content-type at /a/<slug>/", async () => {
  await seedSingleFile("q3.pdf", "application/pdf", "%PDF-1.4");
  const res = await app.request(`/a/${FIXTURE_SLUG}/`, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  expect(res.headers.get("content-disposition")).toBeNull(); // inline (renderable)
});

test("single-file public asset: a non-renderable type serves as an attachment download", async () => {
  await seedSingleFile("data.zip", "application/zip", "PKZIP");
  const res = await app.request(`/a/${FIXTURE_SLUG}/`, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/zip");
  expect(res.headers.get("content-disposition")).toContain("attachment");
  expect(res.headers.get("content-disposition")).toContain("data.zip");
});

test("single-file SVG serves inline but with the restrictive default CSP (no unsafe-inline — embedded script can't run)", async () => {
  await seedSingleFile("logo.svg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
  const res = await app.request(`/a/${FIXTURE_SLUG}/`, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/svg+xml");
  expect(res.headers.get("content-disposition")).toBeNull();               // inline (renderable image)
  const csp = res.headers.get("content-security-policy")!;
  expect(csp).not.toContain("unsafe-inline");                              // NOT ASSET_CSP — script neutralized
  expect(csp).toContain("frame-ancestors 'none'");                         // it's the ADMIN_CSP default
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});
