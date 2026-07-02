import { Hono } from "hono";
import { html } from "hono/html";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { servesTraffic } from "../lib/envgate";
import { isAuthed, startSession } from "../lib/auth/session";
import { verifyPassword } from "../lib/auth/password";
import { verifyTotp } from "../lib/auth/totp";
import { totpStore } from "../lib/db/totpStore";
import { originOk } from "../lib/http/csrf";
import { loginThrottleMs } from "../lib/ratelimit";

export const admin = new Hono<{ Bindings: Env }>();

// Environment gate (spec §8, fail closed): inert unless production (local QA opts in via
// .dev.vars ENVIRONMENT=production). Returns the SAME generic page as the gate (no fingerprint).
admin.use("/admin/*", async (c, next) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  await next();
});
admin.use("/admin", async (c, next) => {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  await next();
});

// Session guard for everything under /admin except the login page (spec §8).
admin.use("/admin/*", async (c, next) => {
  if (c.req.path === "/admin/login") return next();
  if (!(await isAuthed(c, c.env.SESSION_SECRET))) return c.redirect("/admin/login", 302);
  await next();
});
admin.use("/admin", async (c, next) => {
  if (!(await isAuthed(c, c.env.SESSION_SECRET))) return c.redirect("/admin/login", 302);
  await next();
});

const loginPage = (error?: string) => html`<!doctype html><meta charset="utf-8"><title>Sign in</title>
<form method="post" action="/admin/login">
  <input name="password" type="password" placeholder="Password" autocomplete="current-password">
  <input name="totp" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code">
  <button type="submit">Sign in</button>
  ${error ? html`<p role="alert">${error}</p>` : ""}
</form>`;

admin.get("/admin/login", (c) => c.html(loginPage()));

admin.post("/admin/login", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);

  // Throttle, never hard-lock (single admin, spec §8): an escalating delay — a correct
  // password+TOTP still succeeds under attack, just slower.
  // NOTE: the plan's literal snippet `setTimeout(r, await loginThrottleMs(...))` is a syntax error
  // (`await` inside a non-async Promise executor) — resolving the delay before constructing the
  // Promise is the same behavior with valid syntax.
  const throttleMs = await loginThrottleMs(c.env.DB);
  await new Promise((r) => setTimeout(r, throttleMs));

  const form = await c.req.formData();
  const password = String(form.get("password") ?? "");
  const totp = String(form.get("totp") ?? "");

  // Password FIRST; a TOTP step is consumed ONLY after it passes (spec §5/§8) — a wrong-password
  // attempt must never burn or probe TOTP steps. Same generic error either way.
  if (!(await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH))) {
    return c.html(loginPage("invalid credentials"), 401);
  }
  if (!(await verifyTotp(c.env.ADMIN_TOTP_SECRET, totp, totpStore(c.env.DB), Date.now()))) {
    return c.html(loginPage("invalid credentials"), 401);
  }

  await startSession(c, c.env.SESSION_SECRET);
  return c.redirect("/admin", 302);
});

// Placeholder panel body — replaced by Task 5.2. The guard above already protects it.
admin.get("/admin", (c) => c.html(html`<!doctype html><meta charset="utf-8"><title>Admin</title><h1>Admin</h1>`));
