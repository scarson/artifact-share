import { assetModules } from "../../.generated/assets-modules";

const SLUG_RE = /^[A-Za-z0-9_-]{22}$/;
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Module-map lookup. Returns null for a malformed slug or a missing module; the caller
 *  distinguishes "valid code + missing module" (an integrity alert, spec §13) from a normal miss. */
export function getAssetHtml(slug: string): string | null {
  if (!isValidSlug(slug)) return null;
  return Object.prototype.hasOwnProperty.call(assetModules, slug) ? assetModules[slug] : null;
}
