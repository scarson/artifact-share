import { describe, expect, test } from "vitest";
import { decryptCode, encryptCode } from "./vault";

const KEY_A = "k1:" + btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_B = "k2:" + btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("code vault", () => {
  test("round-trips a code under the primary key", async () => {
    const enc = await encryptCode("PERKAi19siR7mTTLen3cvA", KEY_A);
    expect(enc.startsWith("k1:")).toBe(true);
    expect(await decryptCode(enc, KEY_A)).toBe("PERKAi19siR7mTTLen3cvA");
  });
  test("two encryptions of the same code differ (fresh IV each time)", async () => {
    expect(await encryptCode("same", KEY_A)).not.toBe(await encryptCode("same", KEY_A));
  });
  test("rotation: old-kid ciphertext decrypts when its key is anywhere in the ring", async () => {
    const enc = await encryptCode("rotate-me", KEY_A); // k1
    expect(await decryptCode(enc, `${KEY_B},${KEY_A}`)).toBe("rotate-me"); // k2 now primary
  });
  test("fails closed to null: wrong key, unknown kid, tampered ct, malformed, NULL input", async () => {
    const enc = await encryptCode("x", KEY_A);
    expect(await decryptCode(enc, KEY_B)).toBeNull();                       // unknown kid k1
    const [kid, iv, ct] = enc.split(":");
    const flipped = ct.slice(0, -2) + (ct.slice(-2) === "AA" ? "BB" : "AA");
    expect(await decryptCode(`${kid}:${iv}:${flipped}`, KEY_A)).toBeNull(); // GCM auth fails
    expect(await decryptCode("garbage", KEY_A)).toBeNull();
    expect(await decryptCode(null, KEY_A)).toBeNull();                      // pre-vault row
  });
  test("malformed RING throws loudly on encrypt (misconfig must not silently mint unrecoverable codes)", async () => {
    await expect(encryptCode("x", "not-a-ring")).rejects.toThrow();
    await expect(encryptCode("x", "k1:" + btoa("short"))).rejects.toThrow(); // key must be 32 bytes
  });
});
