import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createCode, listCodes, revokeCode } from "./adminRepo";
import { hashCode } from "../codes";

test("createCode stores ONLY the hash; default expiry comes from the DB (≈90d)", async () => {
  const code = await createCode(env.DB, "sluga0000000000000000A", "Acme CFO", null);
  expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at - unixepoch() AS delta, label FROM codes",
  ).first<{ code_hash: string; delta: number; label: string }>();
  expect(row!.code_hash).toBe(await hashCode(code)); // hash at rest, raw code only in the return value
  expect(row!.delta).toBeGreaterThan(7776000 - 60);
  expect(row!.label).toBe("Acme CFO");
});

test("duration expiry is computed DB-side (days → unixepoch()+days*86400)", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { days: 7 });
  const row = await env.DB.prepare("SELECT expires_at - unixepoch() AS delta FROM codes").first<{ delta: number }>();
  expect(row!.delta).toBeGreaterThan(7 * 86400 - 60);
  expect(row!.delta).toBeLessThanOrEqual(7 * 86400);
});

test("absolute expiry is stored as given", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { atSec: 2_000_000_000 });
  const row = await env.DB.prepare("SELECT expires_at FROM codes").first<{ expires_at: number }>();
  expect(row!.expires_at).toBe(2_000_000_000);
});

test("collision retry: a colliding first candidate is silently retried", async () => {
  const first = await createCode(env.DB, "sluga0000000000000000A", "", null);
  const candidates = [first, "freshcode000000000000B"]; // first collides, second unique
  const code = await createCode(env.DB, "sluga0000000000000000A", "", null, () => candidates.shift()!);
  expect(code).toBe("freshcode000000000000B");
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(2);
});

test("revokeCode sets revoked_at on DB time", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", null);
  const { id } = (await listCodes(env.DB))[0];
  await revokeCode(env.DB, id);
  const row = await env.DB.prepare("SELECT revoked_at FROM codes WHERE id = ?1").bind(id).first<{ revoked_at: number | null }>();
  expect(row!.revoked_at).not.toBeNull();
});
