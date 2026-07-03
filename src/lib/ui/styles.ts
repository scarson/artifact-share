/** Shared visual system for the Worker's own HTML surfaces (root, failure page, admin panel).
 *
 *  Constraints this design lives inside (spec §9 + PRODUCT.md):
 *  - Strict CSP, no external resources: system font stacks only, no webfonts, no CDN anything.
 *  - No 'unsafe-inline': each <style> block below is allowlisted by its sha256 hash in ADMIN_CSP
 *    (see headers.ts). csp.test.ts recomputes the hashes — editing CSS here without updating the
 *    hashes fails that test with the correct values printed.
 *  - The failure page must stay ONE constant (byte parity across every failure class), so its
 *    style is a constant too, shared with the root page (PUBLIC_STYLE → one hash for both).
 *  - Public pages adapt to the visitor's scheme; the ADMIN panel is always dark (owner
 *    preference). Reduced motion honored; WCAG AA contrast in both palettes.
 *
 *  Identity: one deep crimson accent ("the seal") on calm neutral surfaces — used for the brand
 *  mark, the primary action, and revocation state. Never decoration.
 */

/** The two palettes, kept as single strings so light/dark and public/admin cannot drift apart.
 *  PUBLIC pages adapt to the visitor's scheme; the ADMIN panel is ALWAYS dark (owner preference,
 *  2026-07-03) — LIGHT_VARS simply never ships in ADMIN_STYLE. */
const LIGHT_VARS = `--bg:oklch(98.5% .004 27);--surface:oklch(96.5% .005 27);--ink:oklch(24% .012 27);
--muted:oklch(44% .015 27);--line:oklch(89% .008 27);
--seal:oklch(50% .185 27);--seal-text:oklch(46% .18 27);
--btn:oklch(47% .18 27);--btn-hover:oklch(42% .17 27);--faint:oklch(52% .012 27);
--ok:oklch(52% .13 150);`;
const DARK_VARS = `--bg:oklch(17% .009 27);--surface:oklch(21.5% .011 27);--ink:oklch(92.5% .006 27);
--muted:oklch(71% .012 27);--line:oklch(30% .012 27);
--seal:oklch(60% .17 27);--seal-text:oklch(70% .15 27);
--btn:oklch(45% .16 27);--btn-hover:oklch(50% .17 27);--faint:oklch(65% .01 27);
--ok:oklch(72% .13 150);`;

/** Element rules shared by every surface (appended after whichever token block). */
const BASE_RULES = `*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
-webkit-font-smoothing:antialiased}
.seal{width:.625rem;height:.625rem;border-radius:50%;background:var(--seal);display:inline-block;flex:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

/** Scheme-adaptive tokens (public pages). */
const TOKENS = `:root{color-scheme:light dark;
${LIGHT_VARS}}
@media (prefers-color-scheme:dark){:root{
${DARK_VARS}}}
${BASE_RULES}`;

/** Dark-only tokens (admin panel — always dark regardless of OS scheme). */
const ADMIN_TOKENS = `:root{color-scheme:dark;
${DARK_VARS}}
${BASE_RULES}`;

/** Root + failure page: a single quiet centered column. One hash covers both surfaces. */
export const PUBLIC_STYLE = `${TOKENS}
html,body{height:100%}
body{display:grid;place-items:center;padding:1.5rem;text-align:center}
main{max-width:26rem}
main .seal{margin-bottom:1.25rem}
h1{font-size:1.0625rem;font-weight:600;letter-spacing:.01em;margin:0 0 .625rem;text-wrap:balance}
p{margin:0;color:var(--muted);font-size:.9375rem;text-wrap:pretty}`;

/** Admin panel. */
export const ADMIN_STYLE = `${ADMIN_TOKENS}
.wrap{max-width:56rem;margin:0 auto;padding:1.75rem 1.5rem 4rem}
.site{display:flex;align-items:center;gap:.625rem;padding-bottom:1.125rem;
border-bottom:1px solid var(--line);margin-bottom:2.25rem;font-size:.9375rem}
.site .brand{font-weight:600}
.site .crumb{color:var(--muted)}
.site .crumb::before{content:"/";margin-right:.625rem;color:var(--line)}
h1{font-size:1.375rem;font-weight:650;letter-spacing:-.01em;margin:0 0 1.75rem;text-wrap:balance}
h2{font-size:.9375rem;font-weight:600;margin:0 0 1rem}
section+section{margin-top:2.75rem}
.generate{display:grid;grid-template-columns:minmax(11rem,1.3fr) 1fr .65fr .9fr auto;
gap:.875rem;align-items:end}
.field label{display:block;font-size:.8125rem;font-weight:500;color:var(--muted);
margin-bottom:.375rem}
.field .hint{font-weight:400;color:var(--faint)}
input,select{width:100%;padding:.5rem .625rem;border:1px solid var(--line);border-radius:.5rem;
background:var(--surface);color:var(--ink);font:inherit;font-size:1rem;height:2.75rem}
input::placeholder{color:var(--faint)}
input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{
outline:2px solid var(--seal);outline-offset:1px}
button{font:inherit;cursor:pointer}
.primary{height:2.75rem;padding:0 1.25rem;border:0;border-radius:.5rem;
background:var(--btn);color:#fff;font-weight:600;font-size:.9375rem;
transition:background .15s ease}
.primary:hover{background:var(--btn-hover)}
.primary:active{transform:translateY(1px)}
.notice,.alert{border-radius:.625rem;padding:.875rem 1rem;margin:0 0 1.75rem;
font-size:.9375rem;overflow-wrap:anywhere}
.notice{border:1px solid oklch(from var(--seal) l c h/.35);background:oklch(from var(--seal) l c h/.07);
animation:appear .25s ease-out}
.notice strong{display:block;margin-bottom:.5rem}
.linkrow{display:flex;gap:.5rem;align-items:stretch}
.linkrow code{flex:1;min-width:0;display:block;background:var(--bg);border:1px solid var(--line);
border-radius:.5rem;padding:.625rem .75rem;overflow-x:auto;white-space:nowrap;user-select:all}
.copy{flex:none;min-width:4.5rem;padding:0 .875rem;border:1px solid var(--line);border-radius:.5rem;
background:var(--surface);color:var(--ink);font-size:.875rem;font-weight:500;
transition:border-color .15s ease,color .15s ease}
.copy:hover{border-color:var(--seal);color:var(--seal-text)}
.copy.copied{border-color:var(--ok);color:var(--ok)}
.alert{border:1px solid oklch(from var(--seal) l c h/.45);color:var(--seal-text);font-weight:500}
@keyframes appear{from{opacity:0;translate:0 -2px}}
.table-scroll{overflow-x:auto;margin:0 -1.5rem;padding:0 1.5rem}
table{width:100%;min-width:640px;border-collapse:collapse;font-size:.9375rem;
font-variant-numeric:tabular-nums}
th{text-align:left;font-size:.75rem;font-weight:600;color:var(--muted);
padding:.5rem .75rem;border-bottom:1px solid var(--line)}
td{padding:.6875rem .75rem;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{padding-left:0}
th:last-child,td:last-child{padding-right:0;text-align:right}
td.num{font-variant-numeric:tabular-nums}
tbody tr:hover{background:var(--surface)}
.muted{color:var(--muted)}
.status{display:inline-flex;align-items:center;gap:.4375rem;white-space:nowrap}
.status::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:var(--muted)}
.status.active::before{background:var(--ok)}
.status.revoked::before{background:var(--seal)}
.status.revoked,.status.expired{color:var(--muted)}
.warn{color:var(--seal-text);font-size:.8125rem;white-space:nowrap}
.revoke{padding:.3125rem .75rem;border:1px solid var(--line);border-radius:.5rem;
background:transparent;color:var(--ink);font-size:.8125rem;
transition:border-color .15s ease,color .15s ease}
.revoke:hover:not(:disabled){border-color:var(--seal);color:var(--seal-text)}
.revoke:disabled{opacity:.4;cursor:default}
.empty{color:var(--muted);text-align:center;padding:2.25rem 1rem}
.generate+.generate{margin-top:1rem}
input[type="file"]{padding:.4375rem .625rem}
input[type="checkbox"]{width:auto;height:auto;accent-color:var(--seal)}
.field.check label{display:flex;align-items:center;gap:.5rem;font-size:.875rem;color:var(--muted);
margin:0;height:2.75rem}
.versions{display:flex;flex-wrap:wrap;gap:.75rem;max-width:22rem}
.ver{display:inline-flex;align-items:center;gap:.375rem;white-space:nowrap}
.ver form{display:inline}
a.dl{display:inline-block;padding:.3125rem .75rem;border:1px solid var(--line);border-radius:.5rem;
color:var(--ink);font-size:.8125rem;text-decoration:none;
transition:border-color .15s ease,color .15s ease}
a.dl:hover{border-color:var(--seal);color:var(--seal-text)}
.del{display:flex;align-items:center;gap:.5rem;justify-content:flex-end}
.del label{display:flex;align-items:center;gap:.25rem;font-size:.75rem;color:var(--muted);white-space:nowrap}
@media (max-width:720px){.generate{grid-template-columns:1fr 1fr}
.generate .primary{grid-column:1/-1;justify-self:start;padding:0 1.5rem}}
@media (max-width:460px){.generate{grid-template-columns:1fr}}`;

/** The panel's ONLY JavaScript: the one-time-link Copy button. Inline <script>, allowlisted by
 *  sha256 in ADMIN_CSP exactly like the styles (csp.test.ts guards the hash). Clipboard API needs
 *  a secure context (https/localhost — both true here); on failure it falls back to selecting the
 *  link text so a manual copy still works. */
export const ADMIN_SCRIPT = `document.addEventListener("click",async(e)=>{
const b=e.target.closest("[data-copy]");if(!b)return;
const el=document.getElementById(b.getAttribute("data-copy"));if(!el)return;
try{await navigator.clipboard.writeText(el.textContent);
b.textContent="Copied";b.classList.add("copied");
setTimeout(()=>{b.textContent="Copy";b.classList.remove("copied")},1600);}
catch{getSelection().selectAllChildren(el);}});`;

/** Inline SVG favicon (data: URI — ADMIN_CSP allows img-src data:). The seal, nothing else.
 *  #a63a2b ≈ oklch(50% .185 27). */
export const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
  "%3Ccircle cx='8' cy='8' r='6' fill='%23a63a2b'/%3E%3C/svg%3E";

/** Host shown as the wordmark, derived from the env's canonical origin. Fail-soft: a malformed
 *  PUBLIC_ORIGIN must not 500 a page render (originOk fails closed separately). */
export function displayHost(publicOrigin: string): string {
  try {
    return new URL(publicOrigin).host;
  } catch {
    return "private sharing";
  }
}

/** Shared head for the two PUBLIC pages (root, failure) — one place so their bytes stay in step. */
export function publicPage(title: string, mainHtml: string): string {
  return (
    `<!doctype html><html lang="en"><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title>` +
    `<link rel="icon" href="${FAVICON}">` +
    `<style>${PUBLIC_STYLE}</style>` +
    `<main>${mainHtml}</main>`
  );
}
