import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import app from "../index";

const BASE = "https://share.test";
const validTotp = () =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(env.ADMIN_TOTP_SECRET) }).generate();

const loginForm = (password: string, totp: string) => {
  const body = new URLSearchParams({ password, totp });
  return {
    method: "POST",
    headers: { origin: "https://share.test", "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual" as const,
  };
};

test("/admin without a session redirects to login (production env)", async () => {
  const res = await SELF.fetch(`${BASE}/admin`, { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin/login");
});

test("/admin and /admin/login are INERT on preview — BYTE-IDENTICAL to a gate failure", async () => {
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  const stripDate = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  for (const path of ["/admin", "/admin/login"]) {
    const res = await app.request(path, {}, { ...env, ENVIRONMENT: "preview" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(canonicalBody);
    expect(stripDate(res.headers)).toBe(stripDate(canonical.headers));
  }
});

test("wrong password does NOT consume a TOTP step (spec §5/§8)", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("wrong-password", validTotp()));
  expect(res.status).toBe(401);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM totp_used_steps").first<{ n: number }>();
  expect(row!.n).toBe(0); // step NOT burned
});

test("right password + wrong TOTP → generic 401, no session cookie", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", "000000"));
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(await res.text()).toContain("invalid credentials");
});

test("full login: password + valid TOTP → session cookie (HttpOnly/Strict) → /admin reachable", async () => {
  const res = await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", validTotp()));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("/admin");
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toContain("admin_session=");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie.toLowerCase()).toContain("samesite=strict");
  const cookie = setCookie.split(";")[0];
  const panel = await SELF.fetch(`${BASE}/admin`, { headers: { cookie } });
  expect(panel.status).toBe(200);
  expect(panel.headers.get("content-security-policy")).not.toContain("unsafe-inline"); // admin CSP
});

test("reusing the SAME TOTP code inside its window is rejected as replay", async () => {
  const code = validTotp();
  expect((await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", code))).status).toBe(302);
  expect((await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", code))).status).toBe(401);
});

test("admin responses carry the FULL security-header set (spec §9 — every response class)", async () => {
  for (const res of [
    await SELF.fetch(`${BASE}/admin/login`),
    await SELF.fetch(`${BASE}/admin`, { redirect: "manual" }), // the 302 class
  ]) {
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});

test("login POST with a cross-site or absent Origin is rejected (CSRF, spec §8)", async () => {
  const evil = { ...loginForm("test-password", validTotp()), headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" } };
  expect((await SELF.fetch(`${BASE}/admin/login`, evil)).status).toBe(403);
  const none = { ...loginForm("test-password", validTotp()), headers: { "content-type": "application/x-www-form-urlencoded" } };
  expect((await SELF.fetch(`${BASE}/admin/login`, none)).status).toBe(403);
});

test("login is never hard-locked: correct credentials succeed even after repeated failures (throttle, not lockout)", async () => {
  // Three wrong-password attempts (each bumps the throttle counter, none denies outright).
  for (let i = 0; i < 3; i++) {
    const bad = await SELF.fetch(`${BASE}/admin/login`, loginForm("wrong-password", "000000"));
    expect(bad.status).toBe(401);
  }
  // A correct password + valid TOTP still logs in (throttle only delays; it never locks out).
  const ok = await SELF.fetch(`${BASE}/admin/login`, loginForm("test-password", validTotp()));
  expect(ok.status).toBe(302);
  expect(ok.headers.get("location")).toContain("/admin");
  expect(ok.headers.get("set-cookie")).toContain("admin_session=");
});
