/** Code vault (design 2026-07-03): AES-256-GCM encryption of raw share codes so the ADMIN can
 *  re-show a sent link. Key ring format: "kid:<standard base64 of exactly 32 bytes>[,kid:<b64>…]"
 *  (e.g. `openssl rand -base64 32`), FIRST entry encrypts, every entry may decrypt (rotation).
 *  Ciphertext: "kid:<ivB64u>:<ctB64u>". decryptCode fails CLOSED to null (renders as "not
 *  recoverable"); encryptCode fails LOUD — a misconfigured ring must not silently mint
 *  unrecoverable codes. */

function b64uEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importRing(ring: string): Promise<Map<string, CryptoKey>> {
  const out = new Map<string, CryptoKey>();
  for (const part of ring.split(",")) {
    const i = part.indexOf(":");
    if (i < 1) throw new Error("CODE_VAULT_KEY: malformed ring entry");
    const raw = Uint8Array.from(atob(part.slice(i + 1)), (c) => c.charCodeAt(0));
    if (raw.length !== 32) throw new Error("CODE_VAULT_KEY: keys must be 32 bytes");
    const kid = part.slice(0, i);
    // A duplicate kid would silently shadow the earlier key and quietly lose every code minted
    // under it — the exact silent-loss failure this module refuses to allow.
    if (out.has(kid)) throw new Error("CODE_VAULT_KEY: duplicate kid in ring");
    out.set(kid, await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  if (out.size === 0) throw new Error("CODE_VAULT_KEY: empty ring");
  return out;
}

export async function encryptCode(code: string, ring: string): Promise<string> {
  const keys = await importRing(ring);
  const [kid, key] = keys.entries().next().value as [string, CryptoKey];
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(code));
  return `${kid}:${b64uEncode(iv)}:${b64uEncode(new Uint8Array(ct))}`;
}

export async function decryptCode(enc: string | null, ring: string): Promise<string | null> {
  if (!enc) return null;
  try {
    const parts = enc.split(":");
    if (parts.length !== 3) return null;
    const key = (await importRing(ring)).get(parts[0]);
    if (!key) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64uDecode(parts[1]) as BufferSource },
      key,
      b64uDecode(parts[2]) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // fail closed: shows as "not recoverable", never throws into a page render
  }
}
