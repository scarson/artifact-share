import * as OTPAuth from "otpauth";

const secret = new OTPAuth.Secret({ size: 20 });
const totp = new OTPAuth.TOTP({ issuer: "artifact-share", label: "admin", secret });
console.log("Secret (set with: npx wrangler secret put ADMIN_TOTP_SECRET --env production):");
console.log(secret.base32);
console.log("\nScan this otpauth URI (recovery = re-run this script, re-put, re-scan):");
console.log(totp.toString());
