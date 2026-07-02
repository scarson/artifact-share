export function extractTitle(html, fallback) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** Best-effort ADVISORY scan (spec §7): reports external-origin surfaces present. CSP is the real
 *  boundary — this cannot catch runtime-constructed URLs. Broaden here; never trust it fully. */
export function externalOriginHits(html) {
  const hits = [];
  const add = (re, what) => { if (re.test(html)) hits.push(what); };
  add(/(?:src|href)\s*=\s*["']https?:\/\//i, "src/href");
  add(/srcset\s*=\s*["'][^"']*https?:\/\//i, "srcset");
  add(/@import\s+(?:url\()?\s*["']?\s*https?:\/\//i, "css @import");
  add(/url\(\s*["']?\s*https?:\/\//i, "css url()");
  add(/<use\b[^>]*\bhref\s*=\s*["']https?:\/\//i, "svg <use>");
  add(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*https?:\/\//i, "meta refresh");
  return hits;
}

export function validateSlug(slug) {
  return /^[A-Za-z0-9_-]{22}$/.test(slug);
}

export function firstDuplicate(list) {
  const seen = new Set();
  for (const x of list) { if (seen.has(x)) return x; seen.add(x); }
  return null;
}

/** True iff wrangler.jsonc contains an `assets` config key (spec §4/§7 — the platform must never
 *  serve this site's files). Matches a quoted `"assets":` key in ANY position (line-start, after a
 *  brace/comma, inline) — NOT only at line-start, which a compacted/inline config would evade. The
 *  `(^|[\s{,])` prefix requires the token to be in JSON key position, so it does not match the word
 *  "assets" inside a string value or the invariant comment (`"assets" key`, no colon). */
export function hasAssetsKey(wranglerRaw) {
  return /(^|[\s{,])"assets"\s*:/.test(wranglerRaw);
}
