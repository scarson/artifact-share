/** Integrity alerting (design 2026-07-04 §Part E). Two channels, both carrying ONLY safe fields
 *  (event/slug/version/codeId — NEVER a raw access code or share URL, spec §3 D4 / §8 log hygiene):
 *   1. console.error — surfaces in Workers Logs / `wrangler tail` IF observability is enabled.
 *   2. an optional HTTPS webhook (ALERT_WEBHOOK_URL) the Worker POSTs directly — content-aware and
 *      independent of platform logging, so it works even with observability off. Best-effort: a
 *      webhook failure never affects the (already fail-closed) response. */

export interface IntegrityAlert { event: string; slug: string; version: number; codeId: string }

/** The exact JSON body sent to the webhook / logged. Pure + tested to prove no secret leaks in. */
export function alertBody(a: IntegrityAlert): string {
  return JSON.stringify({ level: "error", ...a });
}

/** Fire the alert. `waitUntil`, when provided, dispatches the webhook without blocking the response;
 *  without it (e.g. some test contexts) the webhook is skipped — the console.error still fires. */
export function reportIntegrity(
  env: { ALERT_WEBHOOK_URL?: string },
  a: IntegrityAlert,
  waitUntil?: (p: Promise<unknown>) => void,
): void {
  const body = alertBody(a);
  console.error(body);
  if (env.ALERT_WEBHOOK_URL && waitUntil) {
    waitUntil(
      fetch(env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body })
        .catch(() => {}), // best-effort: never surface a webhook failure into the request path
    );
  }
}
