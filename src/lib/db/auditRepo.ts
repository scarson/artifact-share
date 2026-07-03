/** Admin-action audit log (design 2026-07-04 §Part E). One append per admin mutation, plus a
 *  read for the panel's Activity section. INVARIANT: callers pass only non-secret identifiers —
 *  a code id, an asset slug, a label/title/toggle summary. NEVER a raw access code or share URL.
 *  writeAudit is best-effort: an audit-write failure must not break the admin action it records
 *  (the codes/assets rows are the source of truth); it swallows errors after logging a marker. */

export type AuditAction =
  | "mint_code" | "revoke_code" | "show_link"
  | "upload_asset" | "new_version" | "activate" | "delete_version" | "delete_asset"
  | "set_public" | "set_alias" | "unpack";

export interface AuditRow { id: number; at: number; action: string; target: string | null; detail: string | null }

export async function writeAudit(db: D1Database, action: AuditAction, target: string | null = null, detail: string | null = null): Promise<void> {
  try {
    await db.prepare("INSERT INTO audit_log (action, target, detail) VALUES (?1, ?2, ?3)").bind(action, target, detail).run();
  } catch {
    // Best-effort: never let an audit-write failure surface as a failed admin action. Log a
    // non-sensitive marker so the drop is visible in Workers Logs (if enabled).
    console.error(JSON.stringify({ level: "error", event: "audit_write_failed", action }));
  }
}

export async function listAudit(db: D1Database, limit = 50): Promise<AuditRow[]> {
  const { results } = await db.prepare("SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?1").bind(limit).all<AuditRow>();
  return results;
}
