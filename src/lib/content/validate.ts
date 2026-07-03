/** Upload validation (design 2026-07-03 §3, generalized 2026-07-04 §Part D). Admin-only surface
 *  (Access-gated), but zip contents are still parsed defensively: path traversal, caps, extension
 *  allowlist. Caps sized for the ~128 MB Worker isolate (unzipSync inflates in memory) — a
 *  deliberate reduction from the design doc's illustrative numbers (plan Task B4 deviation). */
import { unzipSync } from "fflate";

export interface UploadLimits {
  uploadBytes: number; entries: number; fileBytes: number; totalBytes: number;
}
export const LIMITS: UploadLimits = {
  uploadBytes: 20 * 2 ** 20,   // the file field itself (any file or a zip)
  entries: 200,
  fileBytes: 20 * 2 ** 20,     // any single uncompressed file in a bundle
  totalBytes: 60 * 2 ** 20,    // sum of a bundle's uncompressed files
};

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css",
  js: "text/javascript", mjs: "text/javascript", json: "application/json", map: "application/json",
  csv: "text/csv", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff2: "font/woff2",
  pdf: "application/pdf", zip: "application/zip",
};

/** Types the browser renders as a page — served inline. Everything else downloads (attachment). */
const INLINE_TYPES = new Set([
  "text/html; charset=utf-8", "application/pdf", "image/png", "image/jpeg", "image/gif",
  "image/webp", "image/avif", "image/svg+xml", "image/x-icon", "text/plain; charset=utf-8",
]);

/** Content-types a BUNDLE (unpacked, browsable) may contain — the strict allowlist. A single-file
 *  asset is looser: an unknown extension is stored as an octet-stream download. */
function ext(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}
export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[ext(name)] ?? "application/octet-stream";
}
export function isInlineType(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}

export class UploadError extends Error {} // message is admin-facing (rendered in the panel alert)

export interface UploadFile { path: string; bytes: Uint8Array; contentType: string }

/** A single-file upload descriptor (any type; a zip stored whole is one of these). */
export interface PreparedFile { entry: string; bytes: Uint8Array; contentType: string; bundleCapable: boolean }

/** Collapse a client filename to one safe path segment: basename only, safe chars, no leading dots. */
function safeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length ? cleaned : "file";
}

/** Prepare ANY uploaded file as a single stored object. A zip is stored whole (a download) and
 *  flagged `bundleCapable` when it is a valid browsable bundle (has a root index.html), which is
 *  what lets the admin later choose to Unpack it. Never auto-unpacks. */
export function prepareUpload(filename: string, data: Uint8Array, limits: UploadLimits = LIMITS): PreparedFile {
  if (data.length === 0) throw new UploadError("empty file");
  if (data.length > limits.uploadBytes) throw new UploadError(`upload exceeds ${limits.uploadBytes / 2 ** 20} MB`);
  const entry = safeFilename(filename);
  if (ext(filename) === "zip") {
    let bundleCapable = false;
    try {
      extractBundle(data, limits); // succeeds only if it's a valid bundle with a root index.html
      bundleCapable = true;
    } catch {
      bundleCapable = false; // still a perfectly good single-file .zip download
    }
    return { entry, bytes: data, contentType: "application/zip", bundleCapable };
  }
  return { entry, bytes: data, contentType: contentTypeFor(filename), bundleCapable: false };
}

/** Junk that real-world zips (especially macOS Archive Utility) always contain — SKIP silently,
 *  never fail the whole upload over them. Dotfiles/dot-dirs also skip (never intentional content). */
function isJunk(p: string): boolean {
  return p.startsWith("__MACOSX/") || /(^|\/)\./.test(p);
}

/** Absolute paths, ".." SEGMENTS, and control chars REJECT (hostile shape — checked BEFORE the junk
 *  skip so `../x` can't be laundered as a dot-entry). Spaces are legal (URLs arrive %-encoded). */
function assertSafePath(p: string): void {
  if (p.startsWith("/") || p.split("/").includes("..") || /[\x00-\x1f]/.test(p)) {
    throw new UploadError(`unsafe path in zip: ${p}`);
  }
}

/** Unzip and validate a browsable bundle: caps enforced pre-inflation, path traversal rejected,
 *  content-type allowlist, a root index.html required. Used by prepareUpload's bundle-capable
 *  probe AND by the Unpack action. Throws UploadError on anything invalid. */
export function extractBundle(data: Uint8Array, limits: UploadLimits = LIMITS): UploadFile[] {
  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    entries = unzipSync(data, {
      filter: (f) => {
        if (++count > limits.entries) throw new UploadError(`zip has too many entries (max ${limits.entries})`);
        if (f.originalSize > limits.fileBytes) throw new UploadError(`file too large in zip: ${f.name}`);
        total += f.originalSize;
        if (total > limits.totalBytes) throw new UploadError("zip contents exceed the total size cap");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("not a readable zip file");
  }

  const files: UploadFile[] = [];
  const seen = new Set<string>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;   // directory entry
    const path = name.replace(/\\/g, "/");
    assertSafePath(path);               // hostile shapes reject FIRST (never silently skipped)
    if (isJunk(path)) continue;         // macOS junk / dotfiles: skip, don't fail
    if (seen.has(path)) throw new UploadError(`duplicate path in zip: ${path}`);
    const ct = CONTENT_TYPES[ext(path)];
    if (!ct) throw new UploadError(`disallowed file extension: ${path}`);
    seen.add(path);
    files.push({ path, bytes, contentType: ct });
  }
  if (!seen.has("index.html")) throw new UploadError("bundle must contain a root index.html");
  return files;
}
