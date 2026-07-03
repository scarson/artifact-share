import { expect, test } from "vitest";
import { ADMIN_CSP } from "./headers";
import { ADMIN_STYLE, PUBLIC_STYLE } from "../ui/styles";

/** CSP hash-source of an inline <style> block: base64(sha256(exact bytes)). */
async function styleHash(css: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

// The pages ship their CSS as inline <style> blocks under a CSP with NO 'unsafe-inline' — each
// block is allowlisted by its sha256 in ADMIN_CSP. If this test fails, someone edited the CSS in
// ui/styles.ts without updating the hardcoded hashes in headers.ts; the assertion message contains
// the correct value to paste in. A stale hash means the browser silently drops ALL page styles.
test("ADMIN_CSP allowlists the exact bytes of both inline style blocks", async () => {
  for (const [name, css] of [["PUBLIC_STYLE", PUBLIC_STYLE], ["ADMIN_STYLE", ADMIN_STYLE]] as const) {
    const hash = await styleHash(css);
    expect(ADMIN_CSP, `stale sha256 for ${name} — replace with 'sha256-${hash}' in headers.ts`)
      .toContain(`'sha256-${hash}'`);
  }
});

test("ADMIN_CSP never regresses to unsafe-inline styles", () => {
  expect(ADMIN_CSP).not.toContain("unsafe-inline");
});
