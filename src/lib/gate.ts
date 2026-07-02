export type Redeemed = { codeId: string; iatSec: number; cookieExpSec: number };

const D1_TIMEOUT_MS = 5000;

/** Race a READ-ONLY D1 call against a short timeout so a blip fails FAST — and therefore CLOSED
 *  at the caller — instead of hanging (spec §3/§6). Do NOT use this on writes: the timer cannot
 *  cancel the statement, so a timed-out-but-later-committed write would break "never write usage
 *  without issuing access" (spec §6 step 4). */
async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("d1 timeout")), D1_TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Spec §6 step 4 — spike-verified on remote D1 (Task 1.1). ONE statement: validate + record usage +
// compute iat/cookie_exp on DB time. code_hash is UNIQUE ⇒ touches ≤1 row in one step.
const REDEEM_SQL = `
UPDATE codes
SET use_count = use_count + 1, last_used_at = unixepoch()
WHERE code_hash = ?1 AND revoked_at IS NULL AND expires_at > unixepoch() AND asset_slug = ?2
RETURNING id, unixepoch() AS iat, min(unixepoch() + 86400, expires_at) AS cookie_exp`;

/** Redemption: a returned row means the code was valid AND usage was recorded atomically; null =
 *  failure. THROWS on DB error — the route maps a throw to the generic failure (no cookie). NOT
 *  app-timed (see withTimeout doc): we await the write's real outcome so access and usage can
 *  never diverge. */
export async function redeem(db: D1Database, codeHash: string, slug: string): Promise<Redeemed | null> {
  const { results } = await db
    .prepare(REDEEM_SQL)
    .bind(codeHash, slug)
    .all<{ id: string; iat: number; cookie_exp: number }>();
  const r = results[0];
  return r ? { codeId: r.id, iatSec: r.iat, cookieExpSec: r.cookie_exp } : null;
}

/** Per-load recheck (spec §6 step 5): still valid at DB unixepoch()? FAILS CLOSED on any DB error —
 *  never serve from the cookie alone. */
export async function recheck(db: D1Database, codeId: string, slug: string): Promise<boolean> {
  try {
    const row = await withTimeout(
      db.prepare(
        "SELECT 1 AS ok FROM codes WHERE id = ?1 AND asset_slug = ?2 AND revoked_at IS NULL AND expires_at > unixepoch() LIMIT 1",
      ).bind(codeId, slug).first<{ ok: number }>(),
    );
    return row !== null;
  } catch {
    return false; // fail closed — see docs/pitfalls/implementation-pitfalls.md
  }
}
