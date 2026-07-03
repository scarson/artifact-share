import { Hono, type Context, type Next } from "hono";
import { html } from "hono/html";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { servesTraffic } from "../lib/envgate";
import { originOk } from "../lib/http/csrf";
import { verifyAccessToken } from "../lib/auth/cfaccess";
import { findOrphans, isKnownSlug, readManifest } from "../lib/manifest";
import { createCode, listCodes, revokeCode, type ExpirySpec } from "../lib/db/adminRepo";
import { codeStatus } from "../lib/codes";

export const admin = new Hono<{ Bindings: Env }>();

// Environment gate (spec §8/§10, fail closed): admin serves ONLY in production — preview/development/
// unset ⇒ the SAME generic page as the gate (no fingerprint). Local QA opts in via .dev.vars
// ENVIRONMENT=production.
async function requireProduction(c: Context<{ Bindings: Env }>, next: Next) {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  await next();
}
admin.use("/admin", requireProduction);
admin.use("/admin/*", requireProduction);

// Admin identity — Cloudflare Access + Google SSO REPLACES the former password+TOTP (spec §8; §15 Q6
// ratified from "layer" to "replace"). Cloudflare Access authenticates the user at the edge and
// forwards a signed assertion in the Cf-Access-Jwt-Assertion header; the Worker INDEPENDENTLY
// verifies it (RS256 signature via the team JWKS, pinned issuer + audience) and confirms the email is
// the configured admin. Fails closed to the generic page on a missing/invalid/foreign assertion.
// DEV-ONLY: local `wrangler dev` has no Access edge, so ACCESS_DEV_BYPASS === "1" (set ONLY in the
// gitignored .dev.vars, NEVER in a deployed env block) skips the check. In production the var is
// undefined, so a valid Access assertion is always required.
async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.env.ACCESS_DEV_BYPASS === "1") return next();
  const email = await verifyAccessToken(c.req.header("cf-access-jwt-assertion"), {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
    adminEmail: c.env.ADMIN_EMAIL,
  });
  if (!email) return failurePage();
  await next();
}
admin.use("/admin", requireAdmin);
admin.use("/admin/*", requireAdmin);

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
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
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
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  await revokeCode(c.env.DB, String(form.get("id") ?? ""));
  return c.redirect("/admin", 302);
});
