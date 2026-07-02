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
import { findOrphans, isKnownSlug, readManifest } from "../lib/manifest";
import { createCode, listCodes, revokeCode, type ExpirySpec } from "../lib/db/adminRepo";
import { codeStatus } from "../lib/codes";

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

function panelPage(opts: { oneTimeLink?: string; error?: string }, codesRows: Awaited<ReturnType<typeof listCodes>>, nowSec: number) {
  const manifest = readManifest();
  const orphans = new Set(findOrphans(codesRows, manifest));
  return html`<!doctype html><meta charset="utf-8"><title>Admin</title>
<h1>Assets &amp; codes</h1>
${opts.error ? html`<p role="alert">${opts.error}</p>` : ""}
${opts.oneTimeLink
  ? html`<p role="status"><strong>Copy this link now — it will NOT be shown again:</strong> <code>${opts.oneTimeLink}</code></p>`
  : ""}
<h2>Generate code</h2>
<form method="post" action="/admin/codes">
  <select name="slug">
    ${Object.entries(manifest).map(([slug, m]) => html`<option value="${slug}">${m.title} (${slug})</option>`)}
  </select>
  <input name="label" placeholder="Recipient label">
  <input name="days" inputmode="numeric" placeholder="Expiry days (blank = 90)">
  <input name="date" type="date" aria-label="Absolute expiry date (overrides days)">
  <button type="submit">Generate</button>
</form>
<h2>Codes</h2>
<table>
  <thead><tr><th>Label</th><th>Asset</th><th>Status</th><th>Last used</th><th>Redemptions</th><th></th></tr></thead>
  <tbody>
    ${codesRows.map((c) => html`<tr>
      <td>${c.label}${orphans.has(c.asset_slug) ? " ⚠ orphaned" : ""}</td>
      <td>${manifest[c.asset_slug]?.title ?? c.asset_slug}</td>
      <td>${codeStatus(c, nowSec)}</td>
      <td>${c.last_used_at !== null ? new Date(c.last_used_at * 1000).toISOString() : "—"}</td>
      <td>${c.use_count}</td>
      <td><form method="post" action="/admin/revoke"><input type="hidden" name="id" value="${c.id}"><button type="submit" ${c.revoked_at !== null ? "disabled" : ""}>Revoke</button></form></td>
    </tr>`)}
  </tbody>
</table>`;
}

// use_count is labeled "Redemptions", never "views" (spec §5). The raw code appears NOWHERE in this
// page except the one-time link immediately after generation — lost link ⇒ revoke + reissue (spec §8).
admin.get("/admin", async (c) => {
  return c.html(panelPage({}, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)));
});

admin.post("/admin/codes", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  // Do NOT trust the posted slug — a forged POST could target any string; it MUST be a real,
  // published asset (spec §7 provenance boundary).
  if (!isKnownSlug(slug)) {
    return c.html(panelPage({ error: "unknown asset" }, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)), 400);
  }
  const label = String(form.get("label") ?? "");
  const dateRaw = String(form.get("date") ?? "").trim(); // absolute date — wins if present
  const daysRaw = String(form.get("days") ?? "").trim(); // duration in days (computed DB-side)
  // Invalid input is a 400, NEVER a silent fall-through to the 90-day default (an admin who typed
  // an expiry must get that expiry or an error). Days must be a positive INTEGER — a fractional
  // value would store a non-integer epoch in the INTEGER column.
  let expiry: ExpirySpec = null;
  const badInput = (msg: string) =>
    c.html(panelPage({ error: msg }, [], Math.floor(Date.now() / 1000)), 400);
  if (dateRaw) {
    // Strict shape + round-trip: Date.parse NORMALIZES impossible dates (2026-02-31 → March) —
    // reject anything that doesn't survive the round trip unchanged.
    const ms = Date.parse(`${dateRaw}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(ms)
      || new Date(ms).toISOString().slice(0, 10) !== dateRaw) {
      return badInput("invalid expiry date");
    }
    expiry = { atSec: Math.floor(ms / 1000) };
  } else if (daysRaw) {
    if (!/^\d+$/.test(daysRaw) || Number(daysRaw) <= 0) return badInput("expiry days must be a positive integer");
    expiry = { days: Number(daysRaw) };
  }
  const code = await createCode(c.env.DB, slug, label, expiry);
  // Show ONCE (spec §8, §3 D3): the raw code is not persisted and cannot be recovered.
  const oneTimeLink = `${c.env.PUBLIC_ORIGIN}/a/${slug}?code=${code}`;
  return c.html(panelPage({ oneTimeLink }, await listCodes(c.env.DB), Math.floor(Date.now() / 1000)));
});

admin.post("/admin/revoke", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.html(loginPage("bad origin"), 403);
  const form = await c.req.formData();
  await revokeCode(c.env.DB, String(form.get("id") ?? ""));
  return c.redirect("/admin", 302);
});
