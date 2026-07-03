import { bumpRateLimit } from "./db/rateStore";
import { assetExists } from "./db/assetRepo";

export const WINDOW_SEC = 60;
export const PER_SLUG_LIMIT = 20;
export const GLOBAL_LIMIT = 2000; // high-water circuit-breaker across all unauthenticated /a/* traffic

/** Bucket key (spec §9): a real (D1-existing) slug gets its own bucket; a well-formed-but-unknown
 *  slug collapses into ONE fixed key. `known` is the boolean answer, resolved unconditionally for
 *  every well-formed slug by the caller — it only selects a KEY, never branches the response
 *  (timing-uniformity, spec §6 step 3). */
export function slugKey(kind: "redeem" | "load", slug: string, known: boolean): string {
  return known ? `${kind}:${slug}` : `${kind}:unknown-slug`;
}

/** Limiter for UNAUTHENTICATED /a/* traffic (redemptions + no-valid-cookie loads). Per-slug bucket
 *  AND global circuit-breaker. Fails OPEN — defense-in-depth only; the atomic redeem/recheck is the
 *  load-bearing fail-closed control. The route never calls this for a signature-valid-cookie load,
 *  so authenticated viewers are never limited (limiter-exempt ≠ authorization-exempt). The
 *  assetExists lookup lives INSIDE the fail-open try — a DB hiccup can't wedge the gate. */
export async function gateLimitOk(db: D1Database, kind: "redeem" | "load", slug: string): Promise<boolean> {
  try {
    const known = await assetExists(db, slug); // keying only — never branches the response (spec §9/§6)
    const [perSlug, global] = await Promise.all([
      bumpRateLimit(db, slugKey(kind, slug, known), WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return perSlug <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // FAIL OPEN — intentional (spec §9)
  }
}

/** Malformed-slug traffic: a fixed bucket (never the bad slug as a key, never an asset lookup)
 *  that still feeds the global circuit-breaker (spec §9). */
export async function badShapeLimitOk(db: D1Database): Promise<boolean> {
  try {
    const [bad, global] = await Promise.all([
      bumpRateLimit(db, "bad-shape", WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return bad <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // fail open
  }
}
