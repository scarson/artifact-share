import { generateCode, hashCode, type CodeRow } from "../codes";

/** Expiry override (spec §5/§8): a duration in days (computed DB-side — single time source) OR an
 *  absolute epoch-seconds instant OR null (⇒ the DB column default of unixepoch()+90d). */
export type ExpirySpec = { days: number } | { atSec: number } | null;

export async function listCodes(db: D1Database): Promise<CodeRow[]> {
  const { results } = await db.prepare("SELECT * FROM codes ORDER BY created_at DESC").all<CodeRow>();
  return results;
}

/** Mint a code. Stores ONLY SHA-256(code); returns the RAW code ONCE for show-once display
 *  (spec §8) — never persisted, never recoverable. Retries on the astronomically unlikely hash
 *  collision, revealing nothing about it (spec §5). `gen` injectable for the collision test only. */
export async function createCode(
  db: D1Database,
  assetSlug: string,
  label: string,
  expiry: ExpirySpec,
  gen: () => string = generateCode,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = gen();
    const hash = await hashCode(code);
    try {
      if (expiry && "days" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at) VALUES (?1, ?2, ?3, unixepoch() + ?4 * 86400)",
        ).bind(hash, assetSlug, label, expiry.days).run();
      } else if (expiry && "atSec" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at) VALUES (?1, ?2, ?3, ?4)",
        ).bind(hash, assetSlug, label, expiry.atSec).run();
      } else {
        // Omit expires_at → the DB-side 90-day default applies (spec §5).
        await db.prepare("INSERT INTO codes (code_hash, asset_slug, label) VALUES (?1, ?2, ?3)")
          .bind(hash, assetSlug, label).run();
      }
      return code;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique code");
}

export async function revokeCode(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE id = ?1").bind(id).run(); // DB time
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message);
}
