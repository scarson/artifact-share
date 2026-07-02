import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { redeem, recheck } from "./gate";
import { hashCode } from "./codes";

const SLUG = "seedslug000000000000AA";

async function seed(opts: { expiresDelta?: number; revoked?: boolean } = {}): Promise<string> {
  const code = "test-code-aaaaaaaaaaaa";
  const expiresSql = opts.expiresDelta !== undefined ? `unixepoch() + ${opts.expiresDelta}` : "unixepoch() + 7776000";
  await env.DB.prepare(
    `INSERT INTO codes (code_hash, asset_slug, expires_at, revoked_at)
     VALUES (?1, ?2, ${expiresSql}, ${opts.revoked ? "unixepoch()" : "NULL"})`,
  ).bind(await hashCode(code), SLUG).run();
  return code;
}

test("redeem returns codeId + DB-time iat/cookieExp and increments use_count", async () => {
  const code = await seed();
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(res?.codeId).toMatch(/^[0-9a-f]{32}$/);
  expect(res!.cookieExpSec).toBe(res!.iatSec + 86400); // 24h < 90d ⇒ min() picks iat+86400
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(1);
});

test("redeem returns null for wrong slug and records NO usage", async () => {
  const code = await seed();
  expect(await redeem(env.DB, await hashCode(code), "otherslug0000000000000")).toBeNull();
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(0);
});

test("redeem returns null for a revoked code", async () => {
  const code = await seed({ revoked: true });
  expect(await redeem(env.DB, await hashCode(code), SLUG)).toBeNull();
});

test("redeem returns null for an expired code (DB-time comparison)", async () => {
  const code = await seed({ expiresDelta: -1 });
  expect(await redeem(env.DB, await hashCode(code), SLUG)).toBeNull();
});

test("cookieExp is capped by a soon-expiring code (min(now+24h, expires_at))", async () => {
  const code = await seed({ expiresDelta: 3600 }); // ~1h left
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(res!.cookieExpSec - res!.iatSec).toBeLessThanOrEqual(3600);
});

test("sequential redemptions never lose use_count (atomic upsert-style increment)", async () => {
  const code = await seed();
  const h = await hashCode(code);
  await redeem(env.DB, h, SLUG);
  await redeem(env.DB, h, SLUG);
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(2);
});

test("CONCURRENT redemptions do not lose use_count (single-writer atomic statement, spec §13)", async () => {
  const code = await seed();
  const h = await hashCode(code);
  await Promise.all(Array.from({ length: 5 }, () => redeem(env.DB, h, SLUG)));
  const row = await env.DB.prepare("SELECT use_count FROM codes").first<{ use_count: number }>();
  expect(row!.use_count).toBe(5);
});

test("recheck true for valid, false immediately after revoke (instant revocation)", async () => {
  const code = await seed();
  const res = await redeem(env.DB, await hashCode(code), SLUG);
  expect(await recheck(env.DB, res!.codeId, SLUG)).toBe(true);
  await env.DB.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE id = ?1").bind(res!.codeId).run();
  expect(await recheck(env.DB, res!.codeId, SLUG)).toBe(false);
});

test("recheck FAILS CLOSED when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  expect(await recheck(throwing, "id1", SLUG)).toBe(false);
});

test("redeem THROWS (fail closed at the caller) when the DB throws", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  await expect(redeem(throwing, "h", SLUG)).rejects.toThrow();
});
