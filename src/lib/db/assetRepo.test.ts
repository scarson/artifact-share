import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { activateVersion, activeVersion, assetExists, createAsset, deleteAsset, deleteVersion, listAssets, recordVersion } from "./assetRepo";
import { createCode } from "./adminRepo";

test("createAsset mints a 22-char slug; recordVersion(activate) publishes; listAssets shows both", async () => {
  const slug = await createAsset(env.DB, "Q3 Report");
  expect(slug).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(await assetExists(env.DB, slug)).toBe(true);
  expect(await activeVersion(env.DB, slug)).toBeNull(); // unpublished until a version activates
  await recordVersion(env.DB, slug, 1, 3, 1234, true);
  expect(await activeVersion(env.DB, slug)).toBe(1);
  const [a] = await listAssets(env.DB);
  expect(a.title).toBe("Q3 Report");
  expect(a.versions.map((v) => v.version)).toEqual([1]);
});

test("activate flips between recorded versions; activating a missing version throws", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await recordVersion(env.DB, slug, 2, 1, 20, true);
  expect(await activeVersion(env.DB, slug)).toBe(2);
  await activateVersion(env.DB, slug, 1); // rollback
  expect(await activeVersion(env.DB, slug)).toBe(1);
  await expect(activateVersion(env.DB, slug, 9)).rejects.toThrow();
});

test("deleteVersion refuses the ACTIVE version; deletes inactive", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await recordVersion(env.DB, slug, 2, 1, 20, false);
  await expect(deleteVersion(env.DB, slug, 1)).rejects.toThrow();
  await deleteVersion(env.DB, slug, 2);
  expect((await listAssets(env.DB))[0].versions.map((v) => v.version)).toEqual([1]);
});

test("deleteAsset removes rows AND auto-revokes its codes (design: delete = kill access)", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await createCode(env.DB, slug, "victim", null, env.CODE_VAULT_KEY);
  await deleteAsset(env.DB, slug);
  expect(await assetExists(env.DB, slug)).toBe(false);
  const row = await env.DB.prepare("SELECT revoked_at FROM codes WHERE asset_slug = ?1").bind(slug).first<{ revoked_at: number | null }>();
  expect(row!.revoked_at).not.toBeNull();
});
