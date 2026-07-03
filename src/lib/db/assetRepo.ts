/** D1 metadata for the asset manager (design 2026-07-03 §3): assets + immutable numbered versions
 *  with an explicit active pointer. Bytes live in R2 (content/store.ts); this module never touches
 *  them. All reads used by the gate fail closed via null. */
import { generateSlug } from "../codes";

export interface AssetVersionRow { slug: string; version: number; created_at: number; file_count: number; total_bytes: number; entry: string | null }
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

/** The active version number AND the object to serve as its document (entry; NULL ⇒ 'index.html'
 *  for legacy rows). One indexed join; null when unknown or unpublished (fail closed). */
export async function activeVersionEntry(db: D1Database, slug: string): Promise<{ version: number; entry: string } | null> {
  const row = await db.prepare(
    "SELECT a.active_version AS version, v.entry AS entry FROM assets a JOIN asset_versions v ON v.slug = a.slug AND v.version = a.active_version WHERE a.slug = ?1",
  ).bind(slug).first<{ version: number; entry: string | null }>();
  return row ? { version: row.version, entry: row.entry ?? "index.html" } : null;
}

/** The entry filename of a specific version (NULL ⇒ 'index.html'); null if the version is missing. */
export async function versionEntry(db: D1Database, slug: string, version: number): Promise<string | null> {
  const row = await db.prepare("SELECT entry FROM asset_versions WHERE slug = ?1 AND version = ?2").bind(slug, version).first<{ entry: string | null }>();
  return row ? (row.entry ?? "index.html") : null;
}

/** Repoint a version's entry (used by the Unpack action after it rewrites the R2 prefix). */
export async function updateVersionEntry(db: D1Database, slug: string, version: number, entry: string, fileCount: number, totalBytes: number): Promise<void> {
  await db.prepare("UPDATE asset_versions SET entry = ?3, file_count = ?4, total_bytes = ?5 WHERE slug = ?1 AND version = ?2")
    .bind(slug, version, entry, fileCount, totalBytes).run();
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
export async function recordVersion(db: D1Database, slug: string, version: number, fileCount: number, totalBytes: number, activate: boolean, entry: string): Promise<void> {
  const stmts = [
    db.prepare("INSERT INTO asset_versions (slug, version, file_count, total_bytes, entry) VALUES (?1, ?2, ?3, ?4, ?5)").bind(slug, version, fileCount, totalBytes, entry),
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
export async function publicAssetBySlug(db: D1Database, slug: string): Promise<{ active_version: number; entry: string } | null> {
  const row = await db.prepare(
    "SELECT a.active_version AS active_version, v.entry AS entry FROM assets a JOIN asset_versions v ON v.slug = a.slug AND v.version = a.active_version WHERE a.slug = ?1 AND a.is_public = 1 AND a.active_version IS NOT NULL",
  ).bind(slug).first<{ active_version: number; entry: string | null }>();
  return row ? { active_version: row.active_version, entry: row.entry ?? "index.html" } : null;
}

export async function publicAssetByAlias(db: D1Database, alias: string): Promise<{ slug: string; active_version: number; entry: string } | null> {
  const row = await db.prepare(
    "SELECT a.slug AS slug, a.active_version AS active_version, v.entry AS entry FROM assets a JOIN asset_versions v ON v.slug = a.slug AND v.version = a.active_version WHERE a.public_alias = ?1 AND a.is_public = 1 AND a.active_version IS NOT NULL",
  ).bind(alias).first<{ slug: string; active_version: number; entry: string | null }>();
  return row ? { slug: row.slug, active_version: row.active_version, entry: row.entry ?? "index.html" } : null;
}

/** Delete = kill access: revoke every code for the slug, drop version rows, drop the asset. */
export async function deleteAsset(db: D1Database, slug: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE asset_slug = ?1 AND revoked_at IS NULL").bind(slug),
    db.prepare("DELETE FROM asset_versions WHERE slug = ?1").bind(slug),
    db.prepare("DELETE FROM assets WHERE slug = ?1").bind(slug),
  ]);
}
