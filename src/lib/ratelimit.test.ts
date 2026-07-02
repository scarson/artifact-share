import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { bumpRateLimit } from "./db/rateStore";
import { gateLimitOk, slugKey, PER_SLUG_LIMIT, loginThrottleMs } from "./ratelimit";

test("slugKey: known slugs get their own bucket; unknown collapse into ONE fixed bucket", () => {
  expect(slugKey("redeem", "known000000000000000aA", () => true)).toBe("redeem:known000000000000000aA");
  expect(slugKey("redeem", "randaaaaaaaaaaaaaaaaaa", () => false)).toBe("redeem:unknown-slug");
  expect(slugKey("redeem", "randbbbbbbbbbbbbbbbbbb", () => false)).toBe("redeem:unknown-slug");
});

test("bumpRateLimit increments atomically within a window", async () => {
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(1);
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(2);
  expect(await bumpRateLimit(env.DB, "k1", 60)).toBe(3);
});

test("bumpRateLimit resets a stale window in the same statement", async () => {
  await bumpRateLimit(env.DB, "k2", 60);
  await bumpRateLimit(env.DB, "k2", 60);
  await env.DB.prepare("UPDATE rate_limits SET window_start = unixepoch() - 120 WHERE key = 'k2'").run();
  expect(await bumpRateLimit(env.DB, "k2", 60)).toBe(1); // fresh window
});

test("stale rows are lazily pruned on a fresh-window bump (spec §5/§9)", async () => {
  await bumpRateLimit(env.DB, "old-key", 60);
  await env.DB.prepare("UPDATE rate_limits SET window_start = unixepoch() - 90000 WHERE key = 'old-key'").run();
  await bumpRateLimit(env.DB, "fresh-key", 60); // fresh window ⇒ prune runs
  const row = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits WHERE key = 'old-key'").first<{ n: number }>();
  expect(row!.n).toBe(0);
});

test("a random-slug spray does NOT create unbounded rate_limits rows (bucketed)", async () => {
  for (let i = 0; i < 50; i++) {
    const slug = `spray${String(i).padStart(17, "0")}`; // well-formed 22-char, not in manifest
    await gateLimitOk(env.DB, "redeem", slug);
  }
  const row = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits").first<{ n: number }>();
  expect(row!.n).toBeLessThanOrEqual(2); // redeem:unknown-slug + global:a — bounded cardinality
});

test("gateLimitOk denies past the per-slug limit and FAILS OPEN on DB error", async () => {
  for (let i = 0; i < PER_SLUG_LIMIT; i++) {
    expect(await gateLimitOk(env.DB, "redeem", "testasset0000000000000")).toBe(true);
  }
  expect(await gateLimitOk(env.DB, "redeem", "testasset0000000000000")).toBe(false); // limit + 1
  const throwing = { prepare() { throw new Error("down"); } } as unknown as D1Database;
  expect(await gateLimitOk(throwing, "redeem", "testasset0000000000000")).toBe(true); // fail OPEN
});

test("loginThrottleMs: first 3 attempts free, then escalates by 500ms, caps at 5000, never denies", async () => {
  // Fresh window (per-test D1 reset): first three attempts incur no delay.
  expect(await loginThrottleMs(env.DB)).toBe(0);
  expect(await loginThrottleMs(env.DB)).toBe(0);
  expect(await loginThrottleMs(env.DB)).toBe(0);
  expect(await loginThrottleMs(env.DB)).toBe(500);  // 4th
  expect(await loginThrottleMs(env.DB)).toBe(1000); // 5th
  // Drive well past the cap; the return is always a finite delay <= 5000, never a boolean/throw.
  let last = 0;
  for (let i = 0; i < 20; i++) last = await loginThrottleMs(env.DB);
  expect(last).toBe(5000); // capped — a single-admin site must never hard-lock
});

test("loginThrottleMs FAILS OPEN (returns 0, never throws) on DB error", async () => {
  const throwing = { prepare() { throw new Error("down"); } } as unknown as D1Database;
  expect(await loginThrottleMs(throwing)).toBe(0);
});
