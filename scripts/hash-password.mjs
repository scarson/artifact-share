import { argon2id } from "@noble/hashes/argon2.js";
import { randomBytes } from "node:crypto";

const pw = process.argv[2];
if (!pw) { console.error("usage: npm run hash-password -- <password>"); process.exit(1); }
const salt = new Uint8Array(randomBytes(16));
const hash = argon2id(pw, salt, { t: 2, m: 19456, p: 1, dkLen: 32, version: 0x13 });
const b64 = (bytes) => Buffer.from(bytes).toString("base64").replace(/=+$/, ""); // standard base64, no pad
console.log(`$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(hash)}`);
console.log("\nSet it with: npx wrangler secret put ADMIN_PASSWORD_HASH --env production");
