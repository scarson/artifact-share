/** D1 metadata for the asset manager (design 2026-07-03 §3): assets + immutable numbered versions
 *  with an explicit active pointer. Bytes live in R2 (content/store.ts); this module never touches
 *  them. All reads used by the gate fail closed via null. */
import { generateSlug } from "../codes";

export interface AssetVersionRow { slug: string; version: number; created_at: number; file_count: number; total_bytes: number }
export interface AssetRow { slug: string; title: string; active_version: number | null; is_public: number; public_alias: string | null; created_at: number; updated_at: number }

export async function createAsset(db: D1Database, title: string, gen: () => string = generateSlug): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = gen();
    try {
      await db.prepare("INSERT INTO assets (slug, title) VALUES (?1, ?2)").bind(slug, title).run();
      return slug;
    } catch (e) {
      if (e instanceof Error && /UNIQUE|PRIMARY/i.test(e.message) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique slug");
}

export async function assetExists(db: D1Database, slug: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM assets WHERE slug = ?1").bind(slug).first()) !== null;
}

export async function activeVersion(db: D1Database, slug: string): Promise<number | null> {
  const row = await db.prepare("SELECT active_version FROM assets WHERE slug = ?1").bind(slug).first<{ active_version: number | null }>();
  return row ? row.active_version : null; // missing asset and unpublished asset both ⇒ null (fail closed)
}

export async function listAssets(db: D1Database): Promise<(AssetRow & { versions: AssetVersionRow[] })[]> {
  const assets = (await db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all<AssetRow>()).results;
  const versions = (await db.prepare("SELECT * FROM asset_versions ORDER BY version DESC").all<AssetVersionRow>()).results;
  return assets.map((a) => ({ ...a, versions: versions.filter((v) => v.slug === a.slug) }));
}

export async function nextVersion(db: D1Database, slug: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM asset_versions WHERE slug = ?1").bind(slug).first<{ v: number }>();
  return row!.v;
}

/** Insert the version row and (optionally) flip the active pointer — one atomic batch. */
export async function recordVersion(db: D1Database, slug: string, version: number, fileCount: number, totalBytes: number, activate: boolean): Promise<void> {
  const stmts = [
    db.prepare("INSERT INTO asset_versions (slug, version, file_count, total_bytes) VALUES (?1, ?2, ?3, ?4)").bind(slug, version, fileCount, totalBytes),
  ];
  if (activate) stmts.push(db.prepare("UPDATE assets SET active_version = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, version));
  await db.batch(stmts);
}

export async function activateVersion(db: D1Database, slug: string, version: number): Promise<void> {
  const exists = await db.prepare("SELECT 1 FROM asset_versions WHERE slug = ?1 AND version = ?2").bind(slug, version).first();
  if (!exists) throw new Error("no such version");
  await db.prepare("UPDATE assets SET active_version = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, version).run();
}

export async function deleteVersion(db: D1Database, slug: string, version: number): Promise<void> {
  const row = await db.prepare("SELECT active_version FROM assets WHERE slug = ?1").bind(slug).first<{ active_version: number | null }>();
  if (row?.active_version === version) throw new Error("cannot delete the active version");
  await db.prepare("DELETE FROM asset_versions WHERE slug = ?1 AND version = ?2").bind(slug, version).run();
}

// ── Public assets + aliases (design 2026-07-03 §Part C) ──────────────────────────────────────
export const ALIAS_RE = /^[a-z0-9-]{1,32}$/;
// "a"/"admin" collide with app routes; robots/favicon are well-known; cdn-cgi is Cloudflare-reserved.
export const RESERVED_ALIASES = new Set(["a", "admin", "robots.txt", "favicon.ico", "cdn-cgi"]);

export async function setPublic(db: D1Database, slug: string, isPublic: boolean): Promise<void> {
  await db.prepare("UPDATE assets SET is_public = ?2, updated_at = unixepoch() WHERE slug = ?1")
    .bind(slug, isPublic ? 1 : 0).run();
}

export async function setAlias(db: D1Database, slug: string, alias: string | null): Promise<void> {
  if (alias !== null) {
    if (!ALIAS_RE.test(alias) || RESERVED_ALIASES.has(alias)) throw new Error("invalid or reserved alias");
    try {
      await db.prepare("UPDATE assets SET public_alias = ?2, updated_at = unixepoch() WHERE slug = ?1").bind(slug, alias).run();
    } catch (e) {
      if (e instanceof Error && /UNIQUE/i.test(e.message)) throw new Error("alias already taken");
      throw e;
    }
    return;
  }
  await db.prepare("UPDATE assets SET public_alias = NULL, updated_at = unixepoch() WHERE slug = ?1").bind(slug).run();
}

/** Public + published only — the single oracle both public serve paths use (fail closed on null). */
export async function publicAssetBySlug(db: D1Database, slug: string): Promise<{ active_version: number } | null> {
  return await db.prepare(
    "SELECT active_version FROM assets WHERE slug = ?1 AND is_public = 1 AND active_version IS NOT NULL",
  ).bind(slug).first<{ active_version: number }>();
}

export async function publicAssetByAlias(db: D1Database, alias: string): Promise<{ slug: string; active_version: number } | null> {
  return await db.prepare(
    "SELECT slug, active_version FROM assets WHERE public_alias = ?1 AND is_public = 1 AND active_version IS NOT NULL",
  ).bind(alias).first<{ slug: string; active_version: number }>();
}

/** Delete = kill access: revoke every code for the slug, drop version rows, drop the asset. */
export async function deleteAsset(db: D1Database, slug: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE asset_slug = ?1 AND revoked_at IS NULL").bind(slug),
    db.prepare("DELETE FROM asset_versions WHERE slug = ?1").bind(slug),
    db.prepare("DELETE FROM assets WHERE slug = ?1").bind(slug),
  ]);
}
