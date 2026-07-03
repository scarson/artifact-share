-- codes: the entire access-control state. NO plaintext code column — code_hash only (spec §3 D3).
CREATE TABLE codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code_hash TEXT NOT NULL UNIQUE,
  asset_slug TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Single trusted time source: 90-day default computed BY THE DB (spec §5). 7776000 = 90 days.
  expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 7776000),
  revoked_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

-- TOTP replay rejection (spec §5/§8): PK conflict = replay. Pruned lazily.
CREATE TABLE totp_used_steps (
  step INTEGER PRIMARY KEY,
  used_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Rate limiter windows (spec §5/§9): atomic upserts; window compared on unixepoch().
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX rate_limits_window_start_idx ON rate_limits(window_start);

-- Environment marker (spec §10/§13): the mis-pointed-database_id guard reads this. Seeded
-- 'development'; the Task 7.1 runbook UPDATEs it per environment after the first remote apply.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('environment', 'development');
