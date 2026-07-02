import * as OTPAuth from "otpauth";

export interface TotpStepStore {
  /** Returns true if `step` was newly marked (i.e., not a replay). */
  markUsed(step: number): Promise<boolean>;
}

const PERIOD = 30;

export async function verifyTotp(
  secretB32: string,
  token: string,
  store: TotpStepStore,
  nowMs: number,
): Promise<boolean> {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB32), period: PERIOD });
  const delta = totp.validate({ token, timestamp: nowMs, window: 1 }); // ±1 step (spec §8), or null
  if (delta === null) return false;
  const step = Math.floor(nowMs / 1000 / PERIOD) + delta;
  return await store.markUsed(step); // replay → false
}
