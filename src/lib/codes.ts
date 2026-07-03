function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 16 CSPRNG bytes → base64url → 22 chars, 128-bit (spec §5, §7). */
function token128(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export const generateCode = token128;
export const generateSlug = token128;

/** SHA-256(code) hex. Only the HASH is ever stored/looked-up — never the raw code (spec §3 D3, §5). */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Row shape of the `codes` table as D1 returns it (snake_case, INTEGER epoch seconds).
 *  Has `code_hash`, NEVER a raw `code` (spec §3 D3). */
export interface CodeRow {
  id: string;
  code_hash: string;
  asset_slug: string;
  label: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  use_count: number;
}

/** DISPLAY status for the admin panel ONLY — NOT an authorization check. Real validity is enforced
 *  in SQL on unixepoch() (spec §5/§6; Tasks 1.1/3.1). Reused by the admin page (Task 5.2). */
export function codeStatus(
  row: Pick<CodeRow, "revoked_at" | "expires_at">,
  nowSec: number,
): "active" | "expired" | "revoked" {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at <= nowSec) return "expired";
  return "active";
}
