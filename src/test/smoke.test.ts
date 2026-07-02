import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("worker boots and root is a blank 200", async () => {
  const res = await SELF.fetch("https://share.test/");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
});

test("test bindings are wired", () => {
  expect(env.ENVIRONMENT).toBe("production");
  expect(env.SESSION_SECRET.startsWith("k1:")).toBe(true);
});
