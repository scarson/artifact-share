export const FAILURE_BODY =
  "<!doctype html><meta charset=utf-8><title>Unavailable</title>" +
  "<p>This link is invalid or has expired. If you were sent a link, please re-open it from your " +
  "original message, or contact the sender.</p>";

/** ONE canonical failure response — identical body+status for unknown-slug, wrong-code,
 *  absent/invalid/lapsed cookie, inert environments, and unknown routes. The header middleware
 *  (Task 3.3) applies the identical header set, so parity holds by construction. No conditional
 *  per-cookie messaging (validity oracle — spec §6 step 5). */
export function failurePage(): Response {
  return new Response(FAILURE_BODY, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
