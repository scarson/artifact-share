/** Test seed for the fixture asset: D1 rows + its v1 index.html in R2. NOTE: the per-test reset
 *  (apply-migrations.ts) covers D1 ONLY — R2 persists across tests within a file, so the R2 put
 *  here is an idempotent overwrite, which also repairs objects a prior test deleted. */
import { env } from "cloudflare:test";

export const FIXTURE_SLUG = "testasset0000000000000";

export async function seedFixtureAsset(html = "<!doctype html><p>fixture ok</p>"): Promise<void> {
  // INSERT OR IGNORE: file-wide beforeEach seeding + tests composing helpers that seed again must
  // not hit a PK violation.
  await env.DB.prepare("INSERT OR IGNORE INTO assets (slug, title, active_version) VALUES (?1, 'Test Fixture', 1)").bind(FIXTURE_SLUG).run();
  await env.DB.prepare("INSERT OR IGNORE INTO asset_versions (slug, version, file_count, total_bytes) VALUES (?1, 1, 1, ?2)").bind(FIXTURE_SLUG, html.length).run();
  await env.ASSETS.put(`a/${FIXTURE_SLUG}/1/index.html`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
}
