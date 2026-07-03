import { generateCode, hashCode, type CodeRow } from "../codes";
import { encryptCode } from "../vault";

/** Expiry override (spec §5/§8): a duration in days (computed DB-side — single time source) OR an
 *  absolute epoch-seconds instant OR null (⇒ the DB column default of unixepoch()+90d). */
export type ExpirySpec = { days: number } | { atSec: number } | null;

export async function listCodes(db: D1Database): Promise<CodeRow[]> {
  // LEFT JOIN: asset_title === null flags an orphaned code (its asset was deleted) — the panel
  // renders the warning from this, replacing the old manifest-based findOrphans.
  const { results } = await db.prepare(
    "SELECT codes.*, assets.title AS asset_title FROM codes LEFT JOIN assets ON assets.slug = codes.asset_slug ORDER BY codes.created_at DESC",
  ).all<CodeRow>();
  return results;
}

/** Mint a code. Stores SHA-256(code) for lookup PLUS an AES-GCM ciphertext (code_enc) so the
 *  admin can re-show the link (design 2026-07-03 — amends spec §3 D3); the raw code is still
 *  returned ONCE for show-once display and never stored in the clear. encryptCode throws on a
 *  misconfigured ring — better a loud mint failure than silently unrecoverable codes. Retries on
 *  the astronomically unlikely hash collision, revealing nothing about it (spec §5). `gen`
 *  injectable for the collision test only. */
export async function createCode(
  db: D1Database,
  assetSlug: string,
  label: string,
  expiry: ExpirySpec,
  vaultRing: string,
  gen: () => string = generateCode,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = gen();
    const hash = await hashCode(code);
    const enc = await encryptCode(code, vaultRing);
    try {
      if (expiry && "days" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at, code_enc) VALUES (?1, ?2, ?3, unixepoch() + ?4 * 86400, ?5)",
        ).bind(hash, assetSlug, label, expiry.days, enc).run();
      } else if (expiry && "atSec" in expiry) {
        await db.prepare(
          "INSERT INTO codes (code_hash, asset_slug, label, expires_at, code_enc) VALUES (?1, ?2, ?3, ?4, ?5)",
        ).bind(hash, assetSlug, label, expiry.atSec, enc).run();
      } else {
        // Omit expires_at → the DB-side 90-day default applies (spec §5).
        await db.prepare("INSERT INTO codes (code_hash, asset_slug, label, code_enc) VALUES (?1, ?2, ?3, ?4)")
          .bind(hash, assetSlug, label, enc).run();
      }
      return code;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("could not generate a unique code");
}

/** Vault lookup for the admin Show-link action — the ONLY reader of code_enc. */
export async function getCodeEnc(
  db: D1Database,
  id: string,
): Promise<{ code_enc: string | null; asset_slug: string; label: string } | null> {
  return await db.prepare("SELECT code_enc, asset_slug, label FROM codes WHERE id = ?1")
    .bind(id).first<{ code_enc: string | null; asset_slug: string; label: string }>();
}

export async function revokeCode(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE codes SET revoked_at = unixepoch() WHERE id = ?1").bind(id).run(); // DB time
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message);
}
