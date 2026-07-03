import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { activateVersion, activeVersion, assetExists, createAsset, deleteAsset, deleteVersion, listAssets, publicAssetByAlias, publicAssetBySlug, recordVersion, setAlias, setPublic } from "./assetRepo";
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

test("setPublic toggles; publicAssetBySlug returns only public+published assets", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // not public yet
  await setPublic(env.DB, slug, true);
  expect((await publicAssetBySlug(env.DB, slug))!.active_version).toBe(1);
  await setPublic(env.DB, slug, false);
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // instant un-publish
  await setPublic(env.DB, slug, true);
  await env.DB.prepare("UPDATE assets SET active_version = NULL WHERE slug = ?1").bind(slug).run();
  expect(await publicAssetBySlug(env.DB, slug)).toBeNull();          // public but unpublished ⇒ null
});

test("setAlias validates shape, reserved names, uniqueness; publicAssetByAlias resolves", async () => {
  const a = await createAsset(env.DB, "a");
  const b = await createAsset(env.DB, "b");
  await recordVersion(env.DB, a, 1, 1, 10, true);
  await setPublic(env.DB, a, true);
  await setAlias(env.DB, a, "about");
  expect((await publicAssetByAlias(env.DB, "about"))!.slug).toBe(a);
  for (const bad of ["Admin", "a", "admin", "robots.txt", "favicon.ico", "cdn-cgi", "UPPER", "has space", "x".repeat(33), "sla/sh"]) {
    await expect(setAlias(env.DB, b, bad)).rejects.toThrow();
  }
  await expect(setAlias(env.DB, b, "about")).rejects.toThrow(/taken|UNIQUE/i); // duplicate
  await setAlias(env.DB, a, null); // clearing works
  expect(await publicAssetByAlias(env.DB, "about")).toBeNull();
});

test("alias on a NON-public asset does not resolve", async () => {
  const slug = await createAsset(env.DB, "t");
  await recordVersion(env.DB, slug, 1, 1, 10, true);
  await setAlias(env.DB, slug, "hidden");
  expect(await publicAssetByAlias(env.DB, "hidden")).toBeNull(); // alias parked, not served
});
