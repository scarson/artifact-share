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

test("codes.code_enc exists, TEXT, nullable (migration 0003)", async () => {
  const cols = (await env.DB.prepare("PRAGMA table_info(codes)").all<{ name: string; type: string; notnull: number }>()).results;
  const enc = cols.find((c) => c.name === "code_enc");
  expect(enc).toBeDefined();
  expect(enc!.type).toBe("TEXT");
  expect(enc!.notnull).toBe(0); // pre-vault rows stay NULL = "not recoverable"
});

test("assets + asset_versions exist with expected columns (migration 0004)", async () => {
  const acols = (await env.DB.prepare("PRAGMA table_info(assets)").all<{ name: string }>()).results.map((c) => c.name);
  expect(acols).toEqual(expect.arrayContaining(["slug", "title", "active_version", "is_public", "public_alias", "created_at", "updated_at"]));
  const vcols = (await env.DB.prepare("PRAGMA table_info(asset_versions)").all<{ name: string }>()).results.map((c) => c.name);
  expect(vcols).toEqual(expect.arrayContaining(["slug", "version", "created_at", "file_count", "total_bytes"]));
});

test("asset_versions.entry exists, TEXT, nullable (migration 0005)", async () => {
  const cols = (await env.DB.prepare("PRAGMA table_info(asset_versions)").all<{ name: string; type: string; notnull: number }>()).results;
  const entry = cols.find((c) => c.name === "entry");
  expect(entry).toBeDefined();
  expect(entry!.type).toBe("TEXT");
  expect(entry!.notnull).toBe(0); // legacy rows NULL ⇒ treated as index.html
});

test("audit_log exists with expected columns (migration 0006)", async () => {
  const cols = (await env.DB.prepare("PRAGMA table_info(audit_log)").all<{ name: string }>()).results.map((c) => c.name);
  expect(cols).toEqual(expect.arrayContaining(["id", "at", "action", "target", "detail"]));
});
