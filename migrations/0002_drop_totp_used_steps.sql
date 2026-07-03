-- Admin auth moved from password+TOTP to Cloudflare Access + Google SSO (2026-07-03, spec §8/§15 Q6).
-- totp_used_steps backed the TOTP replay-rejection (src/lib/db/totpStore.ts), which was deleted with
-- the rest of the password/TOTP path. Nothing in the current code reads or writes this table
-- (git-grep clean under src/), so drop the now-unused table. Forward-only: the current code and the
-- immediately-prior version both run without it, so this stays schema-compatible one release back.
DROP TABLE IF EXISTS totp_used_steps;
