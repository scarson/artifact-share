import { publicPage } from "./ui/styles";

export const FAILURE_BODY = publicPage(
  "Unavailable",
  `<span class="seal" aria-hidden="true"></span>` +
    `<h1>Link unavailable</h1>` +
    `<p>This link is invalid or has expired. If you were sent a link, please re-open it from your ` +
    `original message, or contact the sender.</p>`,
);

/** ONE canonical failure response — identical body+status for unknown-slug, wrong-code,
 *  absent/invalid/lapsed cookie, inert environments, and unknown routes. The header middleware
 *  (Task 3.3) applies the identical header set, so parity holds by construction. No conditional
 *  per-cookie messaging (validity oracle — spec §6 step 5). Styled via the hashed PUBLIC_STYLE
 *  (see ui/styles.ts) — still a single module-level constant, so byte parity is unchanged. */
export function failurePage(): Response {
  return new Response(FAILURE_BODY, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
