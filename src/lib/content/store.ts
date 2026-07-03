/** R2 object operations for the asset manager (design 2026-07-03 §3). Layout: served tree
 *  a/<slug>/<version>/<path>; originals orig/<slug>/<version>.zip — orig/ is OUTSIDE the
 *  gate-served tree, reachable only via the admin download route. Reads fail closed via null. */
import type { UploadFile } from "./validate";

const filePrefix = (slug: string, v: number) => `a/${slug}/${v}/`;
const origKey = (slug: string, v: number) => `orig/${slug}/${v}.zip`;

/** Mirrors validate.ts assertSafePath: absolute paths + ".." segments + control chars rejected;
 *  spaces are legal (subresource URLs arrive percent-encoded). Empty = no object. */
function safePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..") && !/[\x00-\x1f]/.test(path);
}

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function storeVersion(bucket: R2Bucket, slug: string, version: number, files: UploadFile[], originalZip: Uint8Array | null): Promise<void> {
  // Clean slate first: version numbers can be reused after a delete (nextVersion is MAX+1), and a
  // prior partial-delete could have left stale objects at this prefix. Clearing guarantees the new
  // version is exactly `files`, never a mix.
  await deletePrefix(bucket, filePrefix(slug, version));
  for (const f of files) {
    await bucket.put(filePrefix(slug, version) + f.path, f.bytes, {
      httpMetadata: { contentType: f.contentType },
      customMetadata: { sha256: await sha256hex(f.bytes) },
    });
  }
  if (originalZip) {
    await bucket.put(origKey(slug, version), originalZip, { httpMetadata: { contentType: "application/zip" } });
  }
}

export async function readAssetFile(bucket: R2Bucket, slug: string, version: number, path: string): Promise<R2ObjectBody | null> {
  if (!safePath(path)) return null;
  return await bucket.get(filePrefix(slug, version) + path);
}

export async function readOriginalZip(bucket: R2Bucket, slug: string, version: number): Promise<R2ObjectBody | null> {
  return await bucket.get(origKey(slug, version));
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteVersionObjects(bucket: R2Bucket, slug: string, version: number): Promise<void> {
  await deletePrefix(bucket, filePrefix(slug, version));
  await bucket.delete(origKey(slug, version));
}

export async function deleteAssetObjects(bucket: R2Bucket, slug: string): Promise<void> {
  await deletePrefix(bucket, `a/${slug}/`);
  await deletePrefix(bucket, `orig/${slug}/`);
}
