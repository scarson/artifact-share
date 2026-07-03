/** Upload validation (design 2026-07-03 §3). Admin-only surface (Access-gated), but zip contents
 *  are still parsed defensively: path traversal, caps, extension allowlist. Caps sized for the
 *  ~128 MB Worker isolate (unzipSync inflates in memory) — a deliberate reduction from the design
 *  doc's illustrative numbers, recorded in the plan's Task B4 deviation note. */
import { unzipSync } from "fflate";

export interface UploadLimits {
  uploadBytes: number; entries: number; fileBytes: number; totalBytes: number;
}
export const LIMITS: UploadLimits = {
  uploadBytes: 20 * 2 ** 20,   // the file field itself (html or zip)
  entries: 200,
  fileBytes: 20 * 2 ** 20,     // any single uncompressed file
  totalBytes: 60 * 2 ** 20,    // sum of uncompressed files
};

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", map: "application/json", csv: "text/csv", txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff2: "font/woff2", pdf: "application/pdf",
};

export class UploadError extends Error {} // message is admin-facing (rendered in the panel alert)

export interface UploadFile { path: string; bytes: Uint8Array; contentType: string }

function typeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const ct = CONTENT_TYPES[ext];
  if (!ct) throw new UploadError(`disallowed file extension: ${path}`);
  return ct;
}

/** Junk that real-world zips (especially macOS Archive Utility) always contain — SKIP silently,
 *  never fail the whole upload over them. Dotfiles/dot-dirs also skip (never intentional content). */
function isJunk(p: string): boolean {
  return p.startsWith("__MACOSX/") || /(^|\/)\./.test(p);
}

/** Absolute paths, ".." SEGMENTS, and control chars REJECT (hostile shape — checked BEFORE the
 *  junk skip so `../x` can't be silently laundered as a dot-entry). Spaces are legal —
 *  subresource URLs arrive percent-encoded and are decoded before lookup. */
function assertSafePath(p: string): void {
  if (p.startsWith("/") || p.split("/").includes("..") || /[\x00-\x1f]/.test(p)) {
    throw new UploadError(`unsafe path in zip: ${p}`);
  }
}

/** `limits` is injectable FOR TESTS ONLY (small values exercise every cap throw); production
 *  call sites always use the default. */
export function validateUpload(filename: string, data: Uint8Array, limits: UploadLimits = LIMITS): { files: UploadFile[]; isBundle: boolean } {
  if (data.length > limits.uploadBytes) throw new UploadError(`upload exceeds ${limits.uploadBytes / 2 ** 20} MB`);
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    if (data.length === 0) throw new UploadError("empty file");
    return { files: [{ path: "index.html", bytes: data, contentType: CONTENT_TYPES.html }], isBundle: false };
  }
  if (!lower.endsWith(".zip")) throw new UploadError("upload a single .html file or a .zip bundle");

  let entries: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    entries = unzipSync(data, {
      // ALL THREE caps enforce inside the filter — i.e. BEFORE/DURING decompression — so a
      // hostile zip is rejected without inflating everything first.
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
    seen.add(path);
    files.push({ path, bytes, contentType: typeFor(path) });
  }
  if (!seen.has("index.html")) throw new UploadError("bundle must contain a root index.html");
  return { files, isBundle: true };
}
