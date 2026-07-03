import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import app from "../index";

const BASE = "https://share.test";
const SLUG = "testasset0000000000000";
const AUTH = { ...env, ACCESS_DEV_BYPASS: "1" }; // authorized admin (local-dev bypass)

// Panel BEHAVIOR, now authorized via the dev bypass instead of a password+TOTP session cookie. Admin
// calls use AUTH/apost; redemptions go through the public gate with plain `env`. Mint writes to
// env.DB; AUTH.DB === env.DB (spread), so the gate reads the same DB the panel wrote.
function apost(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  }, AUTH);
}

test("generate → one-time link shown once; the codes list NEVER contains a raw code", async () => {
  const res = await apost("/admin/codes", { slug: SLUG, label: "Acme CFO", days: "", date: "" });
  const body = await res.text();
  const m = body.match(/\?code=([A-Za-z0-9_-]{22})/);
  expect(m).not.toBeNull(); // link shown once, with PUBLIC_ORIGIN + 22-char code
  expect(body).toContain(env.PUBLIC_ORIGIN);
  // Reload the panel: the raw code must appear NOWHERE (hash-only at rest, spec §8).
  const panel = await (await app.request("/admin", {}, AUTH)).text();
  expect(panel).not.toContain(m![1]);
  expect(panel).toContain("Redemptions"); // labeled redemptions, not views (spec §5)
  expect(panel).toContain("Acme CFO");
});

test("the minted link actually redeems through the gate", async () => {
  const res = await apost("/admin/codes", { slug: SLUG, label: "e2e", days: "", date: "" });
  const link = (await res.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await app.request(link, { redirect: "manual" }, env);
  expect(r1.status).toBe(302);
});

test("invalid expiry input is a 400, never a silent 90-day default", async () => {
  for (const fields of [
    { slug: SLUG, label: "x", days: "1.5", date: "" },
    { slug: SLUG, label: "x", days: "0", date: "" },
    { slug: SLUG, label: "x", days: "-3", date: "" },
    { slug: SLUG, label: "x", days: "", date: "not-a-date" },
    { slug: SLUG, label: "x", days: "", date: "2026-02-31" }, // normalizes to March — must be rejected
  ]) {
    const res = await apost("/admin/codes", fields);
    expect(res.status).toBe(400);
  }
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0); // nothing was minted
});

test("a forged POST with an unknown slug is rejected (provenance boundary, spec §7)", async () => {
  const res = await apost("/admin/codes", { slug: "AcmeCorpQ4BoardDeck00A", label: "x", days: "", date: "" });
  expect(res.status).toBe(400);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("revoke from the panel makes the gate deny on the next load", async () => {
  const created = await apost("/admin/codes", { slug: SLUG, label: "r", days: "", date: "" });
  const link = (await created.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await app.request(link, { redirect: "manual" }, env);
  const assetCookie = r1.headers.get("set-cookie")!.split(";")[0];
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  await apost("/admin/revoke", { id });
  const denied = await app.request(`/a/${SLUG}`, { headers: { cookie: assetCookie } }, env);
  expect(await denied.text()).toContain("invalid or has expired");
});

test("mutations without authorization are denied (no bypass, no Access token)", async () => {
  const res = await app.request("/admin/codes", {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: SLUG, label: "x" }).toString(),
  }, env); // plain env: NO bypass, no Access assertion
  expect(await res.text()).toContain("invalid or has expired"); // generic failure, not the panel
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0); // nothing minted
});

test("CSRF on the authorized mutation: a cross-site Origin is rejected (spec §8)", async () => {
  const res = await apost("/admin/codes", { slug: SLUG, label: "x", days: "", date: "" }, { origin: "https://evil.example" });
  expect(res.status).toBe(403);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("CSRF: the literal Origin \"null\" stays rejected (sandboxed iframes and no-referrer documents send it)", async () => {
  const res = await apost("/admin/codes", { slug: SLUG, label: "x", days: "", date: "" }, { origin: "null" });
  expect(res.status).toBe(403);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

// The POST response re-renders the panel (one-time link + the form) — it is itself the document the
// admin submits from next, so it needs the same Referrer-Policy carve-out as GET /admin.
test("panel-rendering responses carry Referrer-Policy: same-origin (GET and POST alike)", async () => {
  const get = await app.request("/admin", {}, AUTH);
  expect(get.headers.get("referrer-policy")).toBe("same-origin");
  const post = await apost("/admin/codes", { slug: SLUG, label: "rp", days: "", date: "" });
  expect(post.headers.get("referrer-policy")).toBe("same-origin");
});
