import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import app from "../index";

// Cloudflare Access + Google SSO REPLACES the former password+TOTP (spec §8; §15 Q6). These tests
// cover the GUARD WIRING only: deny-by-default, the strict local-dev bypass, the env gate winning
// over everything, and the §9 security-header set. The real token verifier (RS256 signature vs. the
// team JWKS, iss/aud pinning, email allowlist) is exercised in cfaccess.test.ts with injected keys —
// we must NOT send a garbage token through the real verifier here, as that triggers an outbound JWKS
// fetch and there is no network in the workerd test pool.
//
// The global `env` has ENVIRONMENT=production and NO ACCESS_DEV_BYPASS, so it exercises real
// enforcement (deny-by-default). We opt into the authorized state per test by spreading a bypass on.

test("denied without an Access assertion (production, no bypass) — fail closed by default", async () => {
  const res = await app.request("/admin", {}, env);
  const body = await res.text();
  expect(res.status).toBe(200); // the generic failure page is 200 (no fingerprint)
  expect(body).toContain("invalid or has expired"); // the generic failure page
  expect(body).not.toContain("Assets"); // NOT the panel
});

test("authorized via the dev bypass renders the panel", async () => {
  const res = await app.request("/admin", {}, { ...env, ACCESS_DEV_BYPASS: "1" });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain("Assets"); // the panel heading "Assets & codes"
  expect(body).toContain("Redemptions"); // the panel table column
});

test("the dev bypass is STRICT — only the exact string \"1\" bypasses", async () => {
  // A stray/misset value (a truthy-looking string, an empty string, "0") must NOT open admin.
  for (const value of ["0", "", "true"]) {
    const res = await app.request("/admin", {}, { ...env, ACCESS_DEV_BYPASS: value });
    const body = await res.text();
    expect(body).toContain("invalid or has expired"); // denied
    expect(body).not.toContain("Assets"); // NOT the panel
  }
});

test("/admin and /admin/codes are INERT on preview — BYTE-IDENTICAL to a gate failure (env gate wins even with bypass on)", async () => {
  // Canonical gate-failure body/headers, minted through the public gate on the global (production) env.
  const canonical = await app.request("/a/unknownslug00000000000?code=x", {}, env);
  const canonicalBody = await canonical.text();
  const stripDate = (h: Headers) => JSON.stringify([...h].filter(([k]) => k !== "date").sort());
  // Bypass is set to prove the ENVIRONMENT gate (which runs BEFORE requireAdmin) makes preview inert
  // regardless of the admin bypass.
  for (const path of ["/admin", "/admin/codes"]) {
    const res = await app.request(path, {}, { ...env, ENVIRONMENT: "preview", ACCESS_DEV_BYPASS: "1" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(canonicalBody);
    expect(stripDate(res.headers)).toBe(stripDate(canonical.headers));
  }
});

test("admin responses carry the FULL security-header set (spec §9 — authorized panel AND denied page)", async () => {
  for (const res of [
    await app.request("/admin", {}, { ...env, ACCESS_DEV_BYPASS: "1" }), // authorized panel
    await app.request("/admin", {}, env), // denied (generic failure page)
  ]) {
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=63072000");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});

// REGRESSION (live bug, 2026-07-03): the panel MUST NOT be served under Referrer-Policy: no-referrer.
// Per the Fetch spec, a document whose referrer policy is "no-referrer" makes the browser serialize
// the Origin header of its same-origin form POSTs as the literal "null" (and omit Referer entirely),
// so originOk() 403'd every legitimate Generate/Revoke submit in a real browser. "same-origin"
// restores the real Origin/Referer on same-origin requests while still sending nothing cross-origin.
test("the AUTHORIZED panel is served with Referrer-Policy: same-origin (no-referrer breaks its own form POSTs)", async () => {
  const panel = await app.request("/admin", {}, { ...env, ACCESS_DEV_BYPASS: "1" });
  expect(panel.headers.get("referrer-policy")).toBe("same-origin");
});

test("DENIED admin responses keep the global no-referrer — header-identical to a gate failure", async () => {
  const denied = await app.request("/admin", {}, env);
  expect(denied.headers.get("referrer-policy")).toBe("no-referrer");
});
