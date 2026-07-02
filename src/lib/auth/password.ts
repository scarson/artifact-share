import { argon2id } from "@noble/hashes/argon2.js";

// Pinned OWASP argon2id params (spec §8): 19 MiB memory, 2 iterations, parallelism 1 (the Worker
// isolate is single-threaded — higher parallelism buys nothing). Do NOT accept library defaults.
// DEVIATION (spec §8): the design named hash-wasm, but hash-wasm compiles its WASM at runtime via
// WebAssembly.compile(bytes), which workerd forbids ("Wasm code generation disallowed by embedder").
// @noble/hashes argon2id is pure JS, runs on Workers, and is byte-for-byte identical to hash-wasm at
// these params, so PHC hashes interoperate with any standard argon2id tooling. See the plan Deviations.
const M = 19456; // memory cost, KiB
const T = 2; // time cost, iterations
const P = 1; // parallelism
const DK_LEN = 32; // output bytes
const VERSION = 0x13; // argon2 v=19

/** Standard base64 (NOT url-safe — argon2 PHC uses +/), padding stripped. */
function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/=+$/, "");
}

/** Decode standard base64 (PHC salt/hash segments) → bytes. */
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time comparison (do not early-return on first mismatch). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = argon2id(password, salt, { t: T, m: M, p: P, dkLen: DK_LEN, version: VERSION });
  return `$argon2id$v=${VERSION}$m=${M},t=${T},p=${P}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("$argon2id$")) return false; // reject fast-hash/argon2i/malformed outright
  try {
    // PHC layout: ["", "argon2id", "v=19", "m=..,t=..,p=..", <b64 salt>, <b64 hash>]
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const vMatch = /^v=(\d+)$/.exec(parts[2]);
    const pMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3]);
    if (!vMatch || !pMatch) return false;
    const version = Number(vMatch[1]);
    const m = Number(pMatch[1]);
    const t = Number(pMatch[2]);
    const p = Number(pMatch[3]);
    const salt = unb64(parts[4]);
    const expected = unb64(parts[5]);
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = argon2id(password, salt, { t, m, p, dkLen: expected.length, version });
    return timingSafeEqual(derived, expected);
  } catch {
    return false; // malformed hash → reject, never throw
  }
}
