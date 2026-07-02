import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import * as OTPAuth from "otpauth";

const BASE = "https://share.test";
const SLUG = "testasset0000000000000";

async function loginCookie(): Promise<string> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env.ADMIN_TOTP_SECRET) }).generate();
  const res = await SELF.fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "test-password", totp }).toString(),
    redirect: "manual",
  });
  return res.headers.get("set-cookie")!.split(";")[0];
}

function post(path: string, cookie: string, fields: Record<string, string>) {
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { origin: BASE, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

test("generate → one-time link shown once; the codes list NEVER contains a raw code", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: SLUG, label: "Acme CFO", days: "", date: "" });
  const body = await res.text();
  const m = body.match(/\?code=([A-Za-z0-9_-]{22})/);
  expect(m).not.toBeNull(); // link shown once, with PUBLIC_ORIGIN + 22-char code
  expect(body).toContain(env.PUBLIC_ORIGIN);
  // Reload the panel: the raw code must appear NOWHERE (hash-only at rest, spec §8).
  const panel = await (await SELF.fetch(`${BASE}/admin`, { headers: { cookie } })).text();
  expect(panel).not.toContain(m![1]);
  expect(panel).toContain("Redemptions"); // labeled redemptions, not views (spec §5)
  expect(panel).toContain("Acme CFO");
});

test("the minted link actually redeems through the gate", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: SLUG, label: "e2e", days: "", date: "" });
  const link = (await res.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await SELF.fetch(`${BASE}${link}`, { redirect: "manual" });
  expect(r1.status).toBe(302);
});

test("invalid expiry input is a 400, never a silent 90-day default", async () => {
  const cookie = await loginCookie();
  for (const fields of [
    { slug: SLUG, label: "x", days: "1.5", date: "" },
    { slug: SLUG, label: "x", days: "0", date: "" },
    { slug: SLUG, label: "x", days: "-3", date: "" },
    { slug: SLUG, label: "x", days: "", date: "not-a-date" },
    { slug: SLUG, label: "x", days: "", date: "2026-02-31" }, // normalizes to March — must be rejected
  ]) {
    const res = await post("/admin/codes", cookie, fields);
    expect(res.status).toBe(400);
  }
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0); // nothing was minted
});

test("a forged POST with an unknown slug is rejected (provenance boundary, spec §7)", async () => {
  const cookie = await loginCookie();
  const res = await post("/admin/codes", cookie, { slug: "AcmeCorpQ4BoardDeck00A", label: "x", days: "", date: "" });
  expect(res.status).toBe(400);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("revoke from the panel makes the gate deny on the next load", async () => {
  const cookie = await loginCookie();
  const created = await post("/admin/codes", cookie, { slug: SLUG, label: "r", days: "", date: "" });
  const link = (await created.text()).match(/(\/a\/[A-Za-z0-9_-]{22}\?code=[A-Za-z0-9_-]{22})/)![1];
  const r1 = await SELF.fetch(`${BASE}${link}`, { redirect: "manual" });
  const assetCookie = r1.headers.get("set-cookie")!.split(";")[0];
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  await post("/admin/revoke", cookie, { id });
  const denied = await SELF.fetch(`${BASE}/a/${SLUG}`, { headers: { cookie: assetCookie } });
  expect(await denied.text()).toContain("invalid or has expired");
});

test("panel mutations without a session are unreachable (redirect to login)", async () => {
  const res = await SELF.fetch(`${BASE}/admin/codes`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ slug: SLUG, label: "x" }).toString(),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin/login");
});
