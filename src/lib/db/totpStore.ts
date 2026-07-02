import type { TotpStepStore } from "../auth/totp";

/** Replay rejection backed by totp_used_steps (spec §5/§8): ONE INSERT with ON CONFLICT DO NOTHING;
 *  D1's meta.changes === 0 means the step already existed ⇒ replay ⇒ false. Fails CLOSED. */
export function totpStore(db: D1Database): TotpStepStore {
  return {
    async markUsed(step) {
      try {
        const res = await db
          .prepare("INSERT INTO totp_used_steps (step) VALUES (?1) ON CONFLICT(step) DO NOTHING")
          .bind(step).run();
        const fresh = (res.meta.changes ?? 0) > 0;
        if (fresh) {
          // Lazy prune: steps older than the ±1 acceptance window are dead weight (spec §5).
          await db.prepare("DELETE FROM totp_used_steps WHERE step < ?1").bind(step - 2).run()
            .catch(() => {});
        }
        return fresh;
      } catch {
        return false; // fail closed
      }
    },
  };
}
