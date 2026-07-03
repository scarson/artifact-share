/** Public-asset alias routes (design 2026-07-03 §Part C): GET /<alias> and /<alias>/<path> serve a
 *  public asset's active version WITHOUT a code. Mounted LAST in index.ts (after gate + admin), so
 *  the fixed routes (/, /robots.txt, /a/*, /admin*) always win even if reserved-name validation
 *  were somehow bypassed — defense in depth. Fail closed: any miss/error is the generic page. */
import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { failurePage } from "../lib/failure";
import { servesTraffic } from "../lib/envgate";
import { ALIAS_RE, publicAssetByAlias } from "../lib/db/assetRepo";
import { readAssetFile } from "../lib/content/store";
import { fileResponse } from "./gate";

/** Streams one file of a PUBLIC asset version. Shared by the gate's public short-circuit and the
 *  alias routes. Fail closed. */
export async function servePublicFile(env: Env, slug: string, version: number, path: string): Promise<Response> {
  const obj = await readAssetFile(env.ASSETS, slug, version, path).catch(() => null);
  if (!obj) return failurePage();
  return fileResponse(obj, path); // shared content-type + CSP-for-HTML + inline/attachment logic
}

export const publicAlias = new Hono<{ Bindings: Env }>();

async function aliasHandler(c: Context<{ Bindings: Env }, "/:alias" | "/:alias/*">): Promise<Response> {
  if (!servesTraffic(c.env.ENVIRONMENT)) return failurePage();
  // Slice the RAW path ourselves: param() returns a DECODED alias, so slicing the raw path by the
  // decoded value's length mis-slices any percent-encoded spelling. Split at the first "/" past
  // the leading one, then decode each piece (malformed % ⇒ generic page, never a 500).
  const raw = c.req.path.slice(1);
  const cut = raw.indexOf("/");
  let alias: string, sub: string;
  try {
    alias = decodeURIComponent(cut < 0 ? raw : raw.slice(0, cut));
    sub = decodeURIComponent(cut < 0 ? "" : raw.slice(cut + 1));
  } catch {
    return failurePage();
  }
  if (!ALIAS_RE.test(alias)) return failurePage();
  const hit = await publicAssetByAlias(c.env.DB, alias).catch(() => null);
  if (!hit) return failurePage();
  // Trailing-slash canonicalization (same RFC 3986 rationale as /a/:slug): a resolvable BARE alias
  // document request redirects to /<alias>/ so relative refs in bundles work.
  if (cut < 0) return new Response(null, { status: 302, headers: { location: `/${alias}/` } });
  return servePublicFile(c.env, hit.slug, hit.active_version, sub === "" ? hit.entry : sub);
}
publicAlias.get("/:alias", aliasHandler);
publicAlias.get("/:alias/*", aliasHandler);
