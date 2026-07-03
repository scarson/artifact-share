-- Recoverable codes (design 2026-07-03, supersedes spec §3 D3 hash-only): AES-256-GCM ciphertext
-- "kid:iv:ct" (base64url), encrypted with the CODE_VAULT_KEY Worker-secret key ring. The HASH
-- remains the only lookup path; this column exists solely for the admin Show-link action.
-- NULL = minted pre-vault (not recoverable). NOTE: plain column add — SQLite ALTER TABLE cannot
-- take expression DEFAULTs (pitfalls doc), and none is wanted.
ALTER TABLE codes ADD COLUMN code_enc TEXT;
