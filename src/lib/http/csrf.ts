function originOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/** True iff this state-changing request is same-origin with PUBLIC_ORIGIN (spec §8 — pinned origin,
 *  NOT the request's own Host). A PRESENT Origin decides alone — a malformed Origin is a REJECT,
 *  never a fallback; only an ABSENT Origin falls back to a Referer same-origin check;
 *  missing-both ⇒ reject. Sec-Fetch-Site is corroboration only (unused). */
export function originOk(req: Request, publicOrigin: string | undefined): boolean {
  if (!publicOrigin) return false; // misconfig → fail closed
  const originHeader = req.headers.get("origin");
  if (originHeader !== null) return originOf(originHeader) === publicOrigin;
  const referer = originOf(req.headers.get("referer"));
  return referer !== null && referer === publicOrigin;
}
