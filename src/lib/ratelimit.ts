import { bumpRateLimit } from "./db/rateStore";
import { isKnownSlug } from "./manifest";

export const WINDOW_SEC = 60;
export const PER_SLUG_LIMIT = 20;
export const GLOBAL_LIMIT = 2000; // high-water circuit-breaker across all unauthenticated /a/* traffic

/** Bucket key (spec §9): known-manifest slugs get their own bucket; well-formed-but-unknown slugs
 *  collapse into ONE fixed key. The manifest lookup is unconditional for every well-formed slug and
 *  only selects a KEY — it never branches the response (timing-uniformity, spec §6 step 3). */
export function slugKey(
  kind: "redeem" | "load",
  slug: string,
  known: (s: string) => boolean = isKnownSlug,
): string {
  return known(slug) ? `${kind}:${slug}` : `${kind}:unknown-slug`;
}

/** Limiter for UNAUTHENTICATED /a/* traffic (redemptions + no-valid-cookie loads). Per-slug bucket
 *  AND global circuit-breaker. Fails OPEN — defense-in-depth only; the atomic redeem/recheck is the
 *  load-bearing fail-closed control. The route never calls this for a signature-valid-cookie load,
 *  so authenticated viewers are never limited (limiter-exempt ≠ authorization-exempt). */
export async function gateLimitOk(db: D1Database, kind: "redeem" | "load", slug: string): Promise<boolean> {
  try {
    const [perSlug, global] = await Promise.all([
      bumpRateLimit(db, slugKey(kind, slug), WINDOW_SEC),
      bumpRateLimit(db, "global:a", WINDOW_SEC),
    ]);
    return perSlug <= PER_SLUG_LIMIT && global <= GLOBAL_LIMIT;
  } catch {
    return true; // FAIL OPEN — intentional (spec §9)
  }
}

/** Malformed-slug traffic: a fixed bucket (never the bad slug as a key, never a manifest lookup)
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
