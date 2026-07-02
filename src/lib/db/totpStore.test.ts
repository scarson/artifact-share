import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { totpStore } from "./totpStore";

test("first use of a step is accepted; the same step again is a replay (meta.changes === 0)", async () => {
  const store = totpStore(env.DB);
  expect(await store.markUsed(1000)).toBe(true);
  expect(await store.markUsed(1000)).toBe(false);
});

test("prunes steps older than the acceptance window", async () => {
  const store = totpStore(env.DB);
  await store.markUsed(1000);
  await store.markUsed(1010);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM totp_used_steps WHERE step = 1000")
    .first<{ n: number }>();
  expect(row!.n).toBe(0); // 1000 < 1010 - 2 ⇒ pruned
});

test("fails closed when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("down"); } } as unknown as D1Database;
  expect(await totpStore(throwing).markUsed(1)).toBe(false);
});
