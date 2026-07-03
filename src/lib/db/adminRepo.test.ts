import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { createCode, getCodeEnc, listCodes, revokeCode } from "./adminRepo";
import { decryptCode } from "../vault";
import { hashCode } from "../codes";

const SLUG = "testasset0000000000000";

test("createCode stores ONLY the hash; default expiry comes from the DB (≈90d)", async () => {
  const code = await createCode(env.DB, "sluga0000000000000000A", "Acme CFO", null, env.CODE_VAULT_KEY);
  expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
  const row = await env.DB.prepare(
    "SELECT code_hash, expires_at - unixepoch() AS delta, label FROM codes",
  ).first<{ code_hash: string; delta: number; label: string }>();
  expect(row!.code_hash).toBe(await hashCode(code)); // hash at rest, raw code only in the return value
  expect(row!.delta).toBeGreaterThan(7776000 - 60);
  expect(row!.label).toBe("Acme CFO");
});

test("duration expiry is computed DB-side (days → unixepoch()+days*86400)", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { days: 7 }, env.CODE_VAULT_KEY);
  const row = await env.DB.prepare("SELECT expires_at - unixepoch() AS delta FROM codes").first<{ delta: number }>();
  expect(row!.delta).toBeGreaterThan(7 * 86400 - 60);
  expect(row!.delta).toBeLessThanOrEqual(7 * 86400);
});

test("absolute expiry is stored as given", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", { atSec: 2_000_000_000 }, env.CODE_VAULT_KEY);
  const row = await env.DB.prepare("SELECT expires_at FROM codes").first<{ expires_at: number }>();
  expect(row!.expires_at).toBe(2_000_000_000);
});

test("collision retry: a colliding first candidate is silently retried", async () => {
  const first = await createCode(env.DB, "sluga0000000000000000A", "", null, env.CODE_VAULT_KEY);
  const candidates = [first, "freshcode000000000000B"]; // first collides, second unique
  const code = await createCode(env.DB, "sluga0000000000000000A", "", null, env.CODE_VAULT_KEY, () => candidates.shift()!);
  expect(code).toBe("freshcode000000000000B");
  const row = await env.DB.prepare("SELECT count(*) AS n FROM codes").first<{ n: number }>();
  expect(row!.n).toBe(2);
});

test("revokeCode sets revoked_at on DB time", async () => {
  await createCode(env.DB, "sluga0000000000000000A", "", null, env.CODE_VAULT_KEY);
  const { id } = (await listCodes(env.DB))[0];
  await revokeCode(env.DB, id);
  const row = await env.DB.prepare("SELECT revoked_at FROM codes WHERE id = ?1").bind(id).first<{ revoked_at: number | null }>();
  expect(row!.revoked_at).not.toBeNull();
});

test("createCode stores code_enc decryptable back to the returned raw code (all 3 expiry branches)", async () => {
  for (const expiry of [null, { days: 5 }, { atSec: 4102444800 }] as const) {
    const raw = await createCode(env.DB, SLUG, "enc-test", expiry, env.CODE_VAULT_KEY);
    const row = await env.DB.prepare("SELECT code_enc FROM codes WHERE code_hash = ?1")
      .bind(await hashCode(raw)).first<{ code_enc: string | null }>();
    expect(row!.code_enc).not.toBeNull();
    expect(await decryptCode(row!.code_enc, env.CODE_VAULT_KEY)).toBe(raw);
  }
});

test("getCodeEnc returns enc+slug+label by id; null for unknown id", async () => {
  const raw = await createCode(env.DB, SLUG, "Nels", null, env.CODE_VAULT_KEY);
  const { id } = (await env.DB.prepare("SELECT id FROM codes").first<{ id: string }>())!;
  const got = await getCodeEnc(env.DB, id);
  expect(got!.asset_slug).toBe(SLUG);
  expect(got!.label).toBe("Nels");
  expect(await decryptCode(got!.code_enc, env.CODE_VAULT_KEY)).toBe(raw);
  expect(await getCodeEnc(env.DB, "nope")).toBeNull();
});
