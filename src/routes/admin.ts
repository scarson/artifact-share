import { Hono, type Context, type Next } from "hono";
import { displayHost } from "../lib/ui/styles";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { servesTraffic } from "../lib/envgate";
import { originOk } from "../lib/http/csrf";
import { verifyAccessToken } from "../lib/auth/cfaccess";
import { createCode, getCodeEnc, listCodes, revokeCode, type ExpirySpec } from "../lib/db/adminRepo";
import { decryptCode } from "../lib/vault";
import { activateVersion, activeVersion, assetExists, createAsset, deleteAsset, deleteVersion, listAssets, nextVersion, recordVersion, setAlias, setPublic, updateVersionEntry, versionEntry } from "../lib/db/assetRepo";
import { LIMITS, UploadError, extractBundle, prepareUpload } from "../lib/content/validate";
import { deleteAssetObjects, deleteVersionObjects, preserveOriginalZip, readAssetFile, readOriginalZip, storeVersion } from "../lib/content/store";
import { panelPage } from "./adminView";

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

// AUTHORIZED admin responses override the global Referrer-Policy: no-referrer with same-origin.
// Under no-referrer the browser serializes the Origin header of the panel's own same-origin form
// POSTs as the literal "null" and omits Referer (Fetch spec), so originOk() would 403 every
// Generate/Revoke submit. same-origin restores both signals while still sending nothing cross-origin.
// Registered AFTER the guards: a guard short-circuit (the generic failure page) never reaches this,
// so denied responses keep no-referrer and stay header-identical to gate failures (spec §9 parity).
async function panelReferrerPolicy(c: Context<{ Bindings: Env }>, next: Next) {
  await next();
  c.res.headers.set("referrer-policy", "same-origin");
}
admin.use("/admin", panelReferrerPolicy);
admin.use("/admin/*", panelReferrerPolicy);

type Ctx = Context<{ Bindings: Env }>;

/** Every panel render goes through here: one query pair, one opts shape (no direct panelPage
 *  calls in routes). Mutation handlers surface failures via panelError — never a raw 500. */
async function renderPanel(c: Ctx, extra: { error?: string; link?: { url: string; heading: string } } = {}, status = 200) {
  return c.html(panelPage(
    { ...extra, host: displayHost(c.env.PUBLIC_ORIGIN) },
    await listAssets(c.env.DB),
    await listCodes(c.env.DB),
    Math.floor(Date.now() / 1000),
  ), status as 200);
}
const panelError = (c: Ctx, error: string, status = 400) => renderPanel(c, { error }, status);

// use_count is labeled "Redemptions", never "views" (spec §5). The raw code appears NOWHERE in this
// page except the one-time link after generation and the explicit Show-link action (design
// 2026-07-03 — lost link ⇒ Show link; revoke if exposure is suspected).
admin.get("/admin", async (c) => {
  return renderPanel(c);
});

admin.post("/admin/codes", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  // Do NOT trust the posted slug — a forged POST could target any string; it MUST be a real
  // asset (spec §7 provenance boundary, now D1-backed).
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  const label = String(form.get("label") ?? "");
  const dateRaw = String(form.get("date") ?? "").trim(); // absolute date — wins if present
  const daysRaw = String(form.get("days") ?? "").trim(); // duration in days (computed DB-side)
  // Invalid input is a 400, NEVER a silent fall-through to the 90-day default (an admin who typed
  // an expiry must get that expiry or an error). Days must be a positive INTEGER — a fractional
  // value would store a non-integer epoch in the INTEGER column.
  let expiry: ExpirySpec = null;
  if (dateRaw) {
    // Strict shape + round-trip: Date.parse NORMALIZES impossible dates (2026-02-31 → March) —
    // reject anything that doesn't survive the round trip unchanged.
    const ms = Date.parse(`${dateRaw}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(ms)
      || new Date(ms).toISOString().slice(0, 10) !== dateRaw) {
      return panelError(c, "invalid expiry date");
    }
    expiry = { atSec: Math.floor(ms / 1000) };
  } else if (daysRaw) {
    if (!/^\d+$/.test(daysRaw) || Number(daysRaw) <= 0) return panelError(c, "expiry days must be a positive integer");
    expiry = { days: Number(daysRaw) };
  }
  const code = await createCode(c.env.DB, slug, label, expiry, c.env.CODE_VAULT_KEY);
  // Show ONCE (spec §8, §3 D3 as amended): the raw code is recoverable ONLY via Show link.
  const link = {
    url: `${c.env.PUBLIC_ORIGIN}/a/${slug}?code=${code}`,
    heading: "Copy this link now — it will NOT be shown again:",
  };
  return renderPanel(c, { link });
});

admin.post("/admin/revoke", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  await revokeCode(c.env.DB, String(form.get("id") ?? ""));
  return c.redirect("/admin", 302);
});

// Show link (design 2026-07-03, amends spec §3 D3): decrypt code_enc via the CODE_VAULT_KEY ring
// and re-render the panel with the recovered URL in the copy row. Explicit action only — the raw
// code appears in no other response. Pre-vault rows (code_enc NULL) and decrypt failures render
// calm, DISTINCT messages (decryptCode fails closed to null; silent fleet-wide key loss must be
// operator-visible).
admin.post("/admin/show", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const row = await getCodeEnc(c.env.DB, String(form.get("id") ?? ""));
  if (!row) return panelError(c, "unknown code");
  const rawCode = await decryptCode(row.code_enc, c.env.CODE_VAULT_KEY);
  if (rawCode === null) {
    const error = row.code_enc === null
      ? `"${row.label}" is not recoverable (minted before the vault)`
      : `"${row.label}" failed to decrypt — check the CODE_VAULT_KEY ring (was a key rotated out?)`;
    return renderPanel(c, { error });
  }
  const link = { url: `${c.env.PUBLIC_ORIGIN}/a/${row.asset_slug}?code=${rawCode}`, heading: `Link for ${row.label}:` };
  return renderPanel(c, { link });
});

/** workers-types types FormData.get as string|null, but a multipart file field arrives as File at
 *  runtime. Assert the runtime union, then narrow to a non-empty File or null. */
function formFile(form: FormData): File | null {
  const f = form.get("file") as unknown as File | string | null;
  return typeof f === "string" || f === null || f.size === 0 ? null : f;
}

/** Store an uploaded file as a single object (design Part D): any type is stored whole and served
 *  at the version's document URL; a zip is stored as a single .zip download (never auto-unpacked —
 *  the Unpack action converts a bundle-capable one on request). Returns the entry filename. */
async function storeUploadedFile(env: Env, slug: string, version: number, file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const prepared = prepareUpload(file.name, data); // throws UploadError on empty/oversize
  await storeVersion(env.ASSETS, slug, version, [{ path: prepared.entry, bytes: prepared.bytes, contentType: prepared.contentType }], null);
  return prepared.entry;
}

admin.post("/admin/assets", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim();
  const file = formFile(form);
  if (!title || !file) return panelError(c, "title and file are required");
  if (file.size > LIMITS.uploadBytes) return panelError(c, "file too large");
  try {
    const slug = await createAsset(c.env.DB, title);
    const entry = await storeUploadedFile(c.env, slug, 1, file);
    await recordVersion(c.env.DB, slug, 1, 1, file.size, true, entry);
  } catch (e) {
    if (e instanceof UploadError) return panelError(c, e.message);
    return panelError(c, e instanceof Error ? e.message : "upload failed", 500);
  }
  return renderPanel(c);
});

admin.post("/admin/assets/version", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  const file = formFile(form);
  if (!file) return panelError(c, "file is required");
  if (file.size > LIMITS.uploadBytes) return panelError(c, "file too large");
  try {
    const version = await nextVersion(c.env.DB, slug);
    const entry = await storeUploadedFile(c.env, slug, version, file);
    // Checkbox absence is meaningful: no `draft` field ⇒ activate immediately.
    await recordVersion(c.env.DB, slug, version, 1, file.size, form.get("draft") !== "1", entry);
  } catch (e) {
    if (e instanceof UploadError) return panelError(c, e.message);
    return panelError(c, e instanceof Error ? e.message : "upload failed", 500);
  }
  return renderPanel(c);
});

// Unpack a single-file .zip version into a browsable bundle (design Part D — the persistent
// confirmation the admin opts into; declining is simply not clicking). Reads the stored .zip,
// validates it as a bundle, preserves the original under orig/ for download, rewrites the version
// prefix with the unpacked files, and repoints the version's entry to index.html.
admin.post("/admin/assets/unpack", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  const version = Number(form.get("version"));
  const entry = await versionEntry(c.env.DB, slug, version);
  if (entry === null) return panelError(c, "unknown version");
  // Source the zip from orig/ FIRST, falling back to the stored entry. orig/ is written before the
  // destructive store below, so a re-run after a partial failure (files written, entry not yet
  // repointed) self-heals instead of dead-ending at "nothing to unpack".
  const src = (await readOriginalZip(c.env.ASSETS, slug, version).catch(() => null))
    ?? (await readAssetFile(c.env.ASSETS, slug, version, entry).catch(() => null));
  if (!src) return panelError(c, "nothing to unpack");
  const zipBytes = new Uint8Array(await src.arrayBuffer());
  let files: ReturnType<typeof extractBundle>;
  try {
    files = extractBundle(zipBytes);
  } catch (e) {
    return panelError(c, e instanceof UploadError ? e.message : "not a browsable bundle");
  }
  try {
    await preserveOriginalZip(c.env.ASSETS, slug, version, zipBytes); // keep for Download + re-heal, BEFORE the clean-slate store
    await storeVersion(c.env.ASSETS, slug, version, files, null);     // clears the .zip, writes files
    await updateVersionEntry(c.env.DB, slug, version, "index.html", files.length, files.reduce((n, f) => n + f.bytes.length, 0));
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "unpack failed", 500);
  }
  return renderPanel(c);
});

admin.post("/admin/assets/activate", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  try {
    await activateVersion(c.env.DB, String(form.get("slug") ?? ""), Number(form.get("version")));
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "failed");
  }
  return renderPanel(c);
});

admin.post("/admin/assets/delete-version", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  const version = Number(form.get("version"));
  try {
    await deleteVersion(c.env.DB, slug, version); // refuses the active version
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "failed");
  }
  await deleteVersionObjects(c.env.ASSETS, slug, version);
  return renderPanel(c);
});

admin.post("/admin/assets/delete", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (form.get("confirm") !== "1") return panelError(c, "check the confirmation box to delete an asset");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  try {
    await deleteAsset(c.env.DB, slug);            // D1 first: revokes codes + drops rows (kill access)
    await deleteAssetObjects(c.env.ASSETS, slug); // then objects; a partial R2 failure leaves only unreferenced garbage
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "failed", 500);
  }
  return renderPanel(c);
});

admin.post("/admin/assets/public", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  await setPublic(c.env.DB, slug, form.get("public") === "1"); // checkbox absent ⇒ make private
  return renderPanel(c);
});

admin.post("/admin/assets/alias", async (c) => {
  if (!originOk(c.req.raw, c.env.PUBLIC_ORIGIN)) return c.text("forbidden", 403);
  const form = await c.req.formData();
  const slug = String(form.get("slug") ?? "");
  if (!(await assetExists(c.env.DB, slug))) return panelError(c, "unknown asset");
  const alias = String(form.get("alias") ?? "").trim();
  try {
    await setAlias(c.env.DB, slug, alias === "" ? null : alias);
  } catch (e) {
    return panelError(c, e instanceof Error ? e.message : "invalid alias");
  }
  return renderPanel(c);
});

// Admin-only download (GET, read-only — no originOk): an UNPACKED bundle streams the preserved
// original zip from orig/; any other asset streams its document entry (the single file, or the
// index.html of a non-unpacked upload). Always an attachment.
admin.get("/admin/assets/download", async (c) => {
  const slug = c.req.query("slug") ?? "";
  const v = Number(c.req.query("v") ?? NaN) || (await activeVersion(c.env.DB, slug));
  if (!v) return failurePage();
  const orig = await readOriginalZip(c.env.ASSETS, slug, v);
  if (orig) {
    c.header("content-type", "application/zip");
    c.header("content-disposition", `attachment; filename="${slug}-v${v}.zip"`);
    return c.body(orig.body);
  }
  const entry = await versionEntry(c.env.DB, slug, v);
  const body = entry ? await readAssetFile(c.env.ASSETS, slug, v, entry) : null;
  if (!body || !entry) return failurePage();
  c.header("content-type", body.httpMetadata?.contentType ?? "application/octet-stream");
  c.header("content-disposition", `attachment; filename="${slug}-v${v}-${entry.replace(/["\\]/g, "_")}"`);
  return c.body(body.body);
});
