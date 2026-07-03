import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("worker boots and root is a neutral identity page with a single About link (owner-requested)", async () => {
  const res = await SELF.fetch("https://share.test/");
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("share.test"); // wordmark = the env's own host
  expect(body).toContain("invitation"); // states invitation-only access
  expect(body).toContain('href="/about"'); // the one deliberate link — the public About page
  // Still nothing PRIVATE to enumerate (spec §9): no asset slugs, no admin mention, only /about.
  expect(body).not.toMatch(/admin/i);
  expect((body.match(/<a /g) ?? []).length).toBe(1); // exactly one link, and it's /about
});

test("test bindings are wired", () => {
  expect(env.ENVIRONMENT).toBe("production");
  expect(env.ASSET_COOKIE_SECRET.startsWith("k1:")).toBe(true);
});
