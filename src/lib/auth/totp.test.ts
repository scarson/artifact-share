import { expect, test, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { verifyTotp } from "./totp";

const secret = "JBSWY3DPEHPK3PXP";
const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
const at = 1_700_000_000_000; // fixed epoch ms
const token = totp.generate({ timestamp: at });

function fakeStore() {
  const used = new Set<number>();
  return { markUsed: vi.fn(async (s: number) => (used.has(s) ? false : (used.add(s), true))) };
}

test("accepts a valid code and marks the step used", async () => {
  expect(await verifyTotp(secret, token, fakeStore(), at)).toBe(true);
});
test("rejects a replay of the same step", async () => {
  const store = fakeStore();
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
  expect(await verifyTotp(secret, token, store, at)).toBe(false); // replay
});
test("rejects a wrong code without touching the store", async () => {
  const store = fakeStore();
  expect(await verifyTotp(secret, "000000", store, at)).toBe(false);
  expect(store.markUsed).not.toHaveBeenCalled();
});
test("accepts a previous-step code (±1) and consumes the MATCHED step, not the current one", async () => {
  const store = fakeStore();
  const currentStep = Math.floor(at / 1000 / 30);
  const prev = totp.generate({ timestamp: at - 30_000 });
  expect(await verifyTotp(secret, prev, store, at)).toBe(true);
  expect(store.markUsed).toHaveBeenCalledWith(currentStep - 1); // the MATCHED (previous) step
  expect(await verifyTotp(secret, prev, store, at)).toBe(false); // replay of that step
  // The CURRENT step was not burned by the previous-step login:
  expect(await verifyTotp(secret, token, store, at)).toBe(true);
});
test("rejects a code two steps away (outside ±1)", async () => {
  expect(await verifyTotp(secret, totp.generate({ timestamp: at - 60_000 }), fakeStore(), at)).toBe(false);
});
