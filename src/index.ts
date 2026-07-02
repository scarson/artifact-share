import { Hono } from "hono";
import type { Env } from "./env";
import { gate } from "./routes/gate";
import { ADMIN_CSP, baseHeaders } from "./lib/http/headers";
import { failurePage } from "./lib/failure";

const app = new Hono<{ Bindings: Env }>();

// Finalizing middleware (spec §9): the FULL security-header set on EVERY response class —
// redemption 302, asset 200, failure page, admin, robots, root, not-found. Handlers that set their
// own CSP (the asset 200) keep it; everything else gets the restrictive default. Uniformity here is
// what makes failure-vs-failure byte-parity hold by construction.
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(baseHeaders())) c.res.headers.set(k, v);
  if (!c.res.headers.has("content-security-policy")) {
    c.res.headers.set("content-security-policy", ADMIN_CSP);
  }
});

// Spec §9: "/" is deliberately neutral/blank — nothing to enumerate.
app.get("/", (c) => c.body(null, 200));

// Spec §9: robots.txt Disallow: / — rendered by the Worker (there are no static files).
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.route("/", gate);

// Every unknown route returns the SAME generic page (spec §13 deny tests: the manifest URLs land
// here; no route class is distinguishable from a gate failure).
app.notFound(() => failurePage());

export default app;
