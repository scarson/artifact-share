import { manifest } from "../../.generated/assets-manifest";

export type Manifest = Record<string, { title: string }>;

export function readManifest(): Manifest {
  return manifest;
}

/** True iff the slug is a real, published asset — used ONLY to pick the limiter bucket (spec §9).
 *  Unconditional for every well-formed slug; never branches the response. */
export function isKnownSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest, slug);
}

/** Codes whose asset_slug left the manifest (asset renamed/deleted) — flagged in the panel (spec §8). */
export function findOrphans(codes: { asset_slug: string }[], m: Manifest): string[] {
  const known = new Set(Object.keys(m));
  return [...new Set(codes.map((c) => c.asset_slug).filter((s) => !known.has(s)))];
}
