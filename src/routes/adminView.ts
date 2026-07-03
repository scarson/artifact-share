/** Admin panel rendering (extracted from admin.ts so routes and markup stay reviewable apart).
 *  Pure functions: no DB, no env access beyond the values passed in. ADMIN_STYLE/ADMIN_SCRIPT are
 *  inserted with raw() — their bytes must stay EXACTLY the exported constants, or the sha256
 *  hashes allowlisted in ADMIN_CSP (headers.ts) no longer match and the browser drops them. */
import { html, raw } from "hono/html";
import { ADMIN_SCRIPT, ADMIN_STYLE, FAVICON } from "../lib/ui/styles";
import type { listAssets } from "../lib/db/assetRepo";
import type { listCodes } from "../lib/db/adminRepo";
import { codeStatus } from "../lib/codes";

export interface PanelOpts {
  link?: { url: string; heading: string };
  error?: string;
  host: string;
}
type Assets = Awaited<ReturnType<typeof listAssets>>;
type Codes = Awaited<ReturnType<typeof listCodes>>;

/** "2026-07-03 05:12 UTC" — compact, unambiguous, tabular-friendly. */
function fmtUtc(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function assetsSection(assets: Assets) {
  return html`<section>
<h2>Assets</h2>
<form method="post" action="/admin/assets" enctype="multipart/form-data" class="generate">
  <div class="field"><label for="a-title">Title</label><input id="a-title" name="title" placeholder="e.g. Q3 Board Deck"></div>
  <div class="field"><label for="a-file">File <span class="hint">· .html or .zip bundle</span></label><input id="a-file" name="file" type="file" accept=".html,.htm,.zip"></div>
  <button type="submit" class="primary">Upload new asset</button>
</form>
${assets.length > 0
  ? html`<form method="post" action="/admin/assets/version" enctype="multipart/form-data" class="generate">
  <div class="field"><label for="v-slug">New version of</label><select id="v-slug" name="slug">
    ${assets.map((a) => html`<option value="${a.slug}">${a.title} (${a.slug})</option>`)}
  </select></div>
  <div class="field"><label for="v-file">File</label><input id="v-file" name="file" type="file" accept=".html,.htm,.zip"></div>
  <div class="field check"><label><input type="checkbox" name="draft" value="1"> Upload as draft — don't activate</label></div>
  <button type="submit" class="primary">Upload version</button>
</form>
<div class="table-scroll">
<table>
  <thead><tr><th>Title</th><th>Slug</th><th>Active</th><th>Versions</th><th></th></tr></thead>
  <tbody>
    ${assets.map((a) => html`<tr>
      <td>${a.title}</td>
      <td><code>${a.slug}</code></td>
      <td>${a.active_version !== null ? html`v${a.active_version}` : html`<span class="muted">unpublished</span>`}</td>
      <td class="versions">${a.versions.map((v) => html`<span class="ver">v${v.version}
        ${v.version !== a.active_version ? html`<form method="post" action="/admin/assets/activate"><input type="hidden" name="slug" value="${a.slug}"><input type="hidden" name="version" value="${v.version}"><button type="submit" class="revoke">Activate</button></form>` : ""}
        <a class="revoke dl" href="/admin/assets/download?slug=${a.slug}&v=${v.version}">Download</a>
        ${v.version !== a.active_version ? html`<form method="post" action="/admin/assets/delete-version"><input type="hidden" name="slug" value="${a.slug}"><input type="hidden" name="version" value="${v.version}"><button type="submit" class="revoke">Delete</button></form>` : ""}
      </span>`)}</td>
      <td><form method="post" action="/admin/assets/delete" class="del"><input type="hidden" name="slug" value="${a.slug}"><label><input type="checkbox" name="confirm" value="1"> sure?</label><button type="submit" class="revoke">Delete asset</button></form></td>
    </tr>`)}
  </tbody>
</table>
</div>`
  : html`<p class="empty">No assets yet — upload an HTML file or zip bundle above.</p>`}
</section>`;
}

export function panelPage(opts: PanelOpts, assets: Assets, codesRows: Codes, nowSec: number) {
  return html`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Admin · ${opts.host}</title><link rel="icon" href="${FAVICON}"><style>${raw(ADMIN_STYLE)}</style>
<div class="wrap">
<header class="site"><span class="seal" aria-hidden="true"></span><span class="brand">${opts.host}</span><span class="crumb">Admin</span></header>
<h1>Assets &amp; codes</h1>
${opts.error ? html`<p role="alert" class="alert">${opts.error}</p>` : ""}
${opts.link
  ? html`<div role="status" class="notice"><strong>${opts.link.heading}</strong><div class="linkrow"><code id="onetime-link">${opts.link.url}</code><button type="button" class="copy" data-copy="onetime-link">Copy</button></div></div>`
  : ""}
${assetsSection(assets)}
<section>
<h2>Generate code</h2>
<form method="post" action="/admin/codes" class="generate">
  <div class="field"><label for="f-slug">Asset</label><select id="f-slug" name="slug">
    ${assets.map((a) => html`<option value="${a.slug}">${a.title} (${a.slug})</option>`)}
  </select></div>
  <div class="field"><label for="f-label">Recipient label</label><input id="f-label" name="label" placeholder="e.g. Acme CFO"></div>
  <div class="field"><label for="f-days">Expiry days</label><input id="f-days" name="days" inputmode="numeric" placeholder="90" title="Blank = 90 days"></div>
  <div class="field"><label for="f-date">Or exact date</label><input id="f-date" name="date" type="date"></div>
  <button type="submit" class="primary">Generate</button>
</form>
</section>
<section>
<h2>Codes</h2>
<div class="table-scroll">
<table>
  <thead><tr><th>Label</th><th>Asset</th><th>Status</th><th>Last used</th><th>Redemptions</th><th></th><th></th></tr></thead>
  <tbody>
    ${codesRows.length === 0
      ? html`<tr><td colspan="7" class="empty">No codes yet — generate one above to share an asset with a recipient.</td></tr>`
      : codesRows.map((c) => html`<tr>
      <td>${c.label}${c.asset_title === null ? html` <span class="warn">⚠ orphaned</span>` : ""}</td>
      <td>${c.asset_title ?? c.asset_slug}</td>
      <td><span class="status ${codeStatus(c, nowSec)}">${codeStatus(c, nowSec)}</span></td>
      <td>${c.last_used_at !== null ? fmtUtc(c.last_used_at) : html`<span class="muted">—</span>`}</td>
      <td class="num">${c.use_count}</td>
      <td><form method="post" action="/admin/show"><input type="hidden" name="id" value="${c.id}"><button type="submit" class="revoke">Show link</button></form></td>
      <td><form method="post" action="/admin/revoke"><input type="hidden" name="id" value="${c.id}"><button type="submit" class="revoke" ${c.revoked_at !== null ? "disabled" : ""}>Revoke</button></form></td>
    </tr>`)}
  </tbody>
</table>
</div>
</section>
</div>
<script>${raw(ADMIN_SCRIPT)}</script>`;
}
