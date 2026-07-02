import { env } from "cloudflare:test";
import { expect, test } from "vitest";

test("codes table has code_hash and NO plaintext code column (spec §3 D3, §13)", async () => {
  const { results } = await env.DB.prepare("PRAGMA table_info(codes)").all<{ name: string }>();
  const cols = results.map((r) => r.name);
  expect(cols).toContain("code_hash");
  expect(cols).not.toContain("code");
});

test("expires_at defaults to unixepoch()+7776000 DB-side (spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES (?1, ?2)")
    .bind("h-default-test", "sluggggggggggggggggggA").run();
  const row = await env.DB.prepare(
    "SELECT expires_at - unixepoch() AS delta FROM codes WHERE code_hash = ?1",
  ).bind("h-default-test").first<{ delta: number }>();
  expect(row!.delta).toBeGreaterThan(7776000 - 60);
  expect(row!.delta).toBeLessThanOrEqual(7776000);
});

test("code_hash is UNIQUE (collision retry path is reachable, spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('dup', 's')").run();
  await expect(
    env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('dup', 's2')").run(),
  ).rejects.toThrow(/UNIQUE/i);
});

test("id is minted DB-side as 32-hex (spec §5)", async () => {
  await env.DB.prepare("INSERT INTO codes (code_hash, asset_slug) VALUES ('h-id', 's')").run();
  const row = await env.DB.prepare("SELECT id FROM codes WHERE code_hash = 'h-id'").first<{ id: string }>();
  expect(row!.id).toMatch(/^[0-9a-f]{32}$/);
});
