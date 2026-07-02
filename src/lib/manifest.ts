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
