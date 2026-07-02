import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./password";

test("verifies a correct password and rejects a wrong one", async () => {
  const h = await hashPassword("correct horse");
  expect(h.startsWith("$argon2id$")).toBe(true); // PHC-encoded argon2id
  expect(h).toContain("m=19456,t=2,p=1"); // pinned OWASP params (spec §8)
  expect(await verifyPassword("correct horse", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});

test("rejects a malformed or fast-hash value without throwing", async () => {
  expect(await verifyPassword("x", "garbage")).toBe(false);
  expect(await verifyPassword("x", "5f4dcc3b5aa765d61d8327deb882cf99")).toBe(false); // md5-shaped
  expect(await verifyPassword("x", "$argon2i$v=19$m=16,t=1,p=1$AAAAAAAAAAAAAAAA$AAAA")).toBe(false); // not argon2id
});

// --- additions beyond the plan (guard the deviation) ---
test("verifies a PHC hash produced OUT OF BAND at the pinned params (byte-compat / bootstrap interop)", async () => {
  // Generated independently (fixed salt=0x07*16, password "test-password", m=19456,t=2,p=1,dkLen=32).
  // Proves the Node bootstrap script's output verifies in-Worker regardless of who produced it.
  const phc = "$argon2id$v=19$m=19456,t=2,p=1$BwcHBwcHBwcHBwcHBwcHBw$8G7gODsx5k4JALo/Ga1qMbXFgxIsvsRCeYK9XA9Rr5M";
  expect(await verifyPassword("test-password", phc)).toBe(true);
  expect(await verifyPassword("wrong-password", phc)).toBe(false);
});

test("rejects structurally-broken PHC strings without throwing", async () => {
  expect(await verifyPassword("x", "$argon2id$")).toBe(false); // truncated
  expect(await verifyPassword("x", "$argon2id$v=19$m=19456,t=2,p=1$$")).toBe(false); // empty salt+hash
  expect(await verifyPassword("x", "$argon2id$v=19$bad$c2FsdA$aGFzaA")).toBe(false); // unparseable params
});
