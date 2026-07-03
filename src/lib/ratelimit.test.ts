import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { bumpRateLimit } from "./db/rateStore";
import { gateLimitOk, slugKey, PER_SLUG_LIMIT } from "./ratelimit";
import { createAsset } from "./db/assetRepo";

test("slugKey: known slugs get their own bucket; unknown collapse into ONE fixed bucket", () => {
  expect(slugKey("redeem", "known000000000000000aA", true)).toBe("redeem:known000000000000000aA");
  expect(slugKey("redeem", "randaaaaaaaaaaaaaaaaaa", false)).toBe("redeem:unknown-slug");
  expect(slugKey("redeem", "randbbbbbbbbbbbbbbbbbb", false)).toBe("redeem:unknown-slug");
});

test("gateLimitOk keys a REAL (D1-existing) slug to its own bucket", async () => {
  const slug = await createAsset(env.DB, "limited");
  await gateLimitOk(env.DB, "redeem", slug);
  const row = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits WHERE key = ?1").bind(`redeem:${slug}`).first<{ n: number }>();
  expect(row!.n).toBe(1); // proves per-slug keying post-rewire (not the unknown-slug bucket)
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
