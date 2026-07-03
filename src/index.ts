import { Hono } from "hono";
import type { Env } from "./env";
import { gate } from "./routes/gate";
import { admin } from "./routes/admin";
import { ADMIN_CSP, baseHeaders } from "./lib/http/headers";
import { failurePage } from "./lib/failure";
import { displayHost, publicPage } from "./lib/ui/styles";

const app = new Hono<{ Bindings: Env }>();

// Finalizing middleware (spec §9): the FULL security-header set on EVERY response class —
// redemption 302, asset 200, failure page, admin, robots, root, not-found. Handlers that set their
// own CSP (the asset 200) keep it; everything else gets the restrictive default. Uniformity here is
// what makes failure-vs-failure byte-parity hold by construction.
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(baseHeaders())) {
    // referrer-policy is respected-if-set (like CSP below): the authorized admin panel MUST override
    // no-referrer to same-origin, or the browser serializes the Origin header of the panel's own
    // same-origin form POSTs as "null" (Fetch spec) and the CSRF check rejects every submit.
    if (k === "referrer-policy" && c.res.headers.has(k)) continue;
    c.res.headers.set(k, v);
  }
  if (!c.res.headers.has("content-security-policy")) {
    c.res.headers.set("content-security-policy", ADMIN_CSP);
  }
});

// Spec §9: "/" is deliberately neutral — nothing to enumerate. Owner-requested (2026-07-03): a
// minimal identity page instead of a blank 200. It names the host and states invitation-only
// access; no links, no listings, nothing that invites probing.
app.get("/", (c) => {
  const host = displayHost(c.env.PUBLIC_ORIGIN);
  return c.html(publicPage(
    host,
    `<span class="seal" aria-hidden="true"></span>` +
      `<h1>${host}</h1>` +
      `<p>A private space for shared work. Access is by invitation only.</p>`,
  ));
});

// Spec §9: robots.txt Disallow: / — rendered by the Worker (there are no static files).
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.route("/", gate);
app.route("/", admin);

// Every unknown route returns the SAME generic page (spec §13 deny tests: the manifest URLs land
// here; no route class is distinguishable from a gate failure).
app.notFound(() => failurePage());

export default app;
