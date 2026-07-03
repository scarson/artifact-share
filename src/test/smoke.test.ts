import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("worker boots and root is a neutral identity page (owner-requested 2026-07-03; was blank)", async () => {
  const res = await SELF.fetch("https://share.test/");
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("share.test"); // wordmark = the env's own host
  expect(body).toContain("invitation"); // states invitation-only access, nothing more
  // Still nothing to enumerate (spec §9): no anchors, no asset slugs, no admin mention.
  expect(body).not.toContain("<a ");
  expect(body).not.toMatch(/admin/i);
});

test("test bindings are wired", () => {
  expect(env.ENVIRONMENT).toBe("production");
  expect(env.ASSET_COOKIE_SECRET.startsWith("k1:")).toBe(true);
});
