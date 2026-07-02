// ONE statement — no read-then-write (lost updates). Window compared and reset on unixepoch().
const UPSERT_SQL = `
INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, unixepoch())
ON CONFLICT(key) DO UPDATE SET
  count        = CASE WHEN window_start <= unixepoch() - ?2 THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start <= unixepoch() - ?2 THEN unixepoch() ELSE window_start END
RETURNING count`;

/** Atomically bump the fixed-window counter for `key`; returns the count within the current window.
 *  Lazily prunes long-stale rows (spec §5/§9 — indexed window_start) on fresh-window bumps only,
 *  so steady-state traffic pays no extra write. Prune failures are ignored (limiter fails open). */
export async function bumpRateLimit(db: D1Database, key: string, windowSec: number): Promise<number> {
  const row = await db.prepare(UPSERT_SQL).bind(key, windowSec).first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count === 1) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < unixepoch() - 86400").run()
      .catch(() => {});
  }
  return count;
}
