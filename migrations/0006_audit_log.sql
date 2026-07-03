-- Admin-action audit log (design 2026-07-04 §Part E). Every admin MUTATION appends one row so the
-- single admin has a durable "who/when/what" trail beyond the side effects on the codes/assets
-- rows. INVARIANT: NEVER store a raw access code or a full share URL here — only the code id, the
-- asset slug, and a human summary (label/title/toggle state). Time via unixepoch() (single source).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,                       -- rowid alias, auto-incrementing
  at INTEGER NOT NULL DEFAULT (unixepoch()),
  action TEXT NOT NULL,                         -- e.g. mint_code, revoke_code, upload_asset, unpack
  target TEXT,                                  -- the acted-on slug or code id (never a raw code)
  detail TEXT                                   -- short human summary (never a raw code or URL)
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
