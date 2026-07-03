-- Asset manager (design 2026-07-03, supersedes the build-time module manifest): metadata in D1,
-- bytes in the private R2 bucket under a/<slug>/<version>/… . active_version NULL = unpublished
-- (gate fails closed). is_public/public_alias (design §Part C): 1 = viewable without a code;
-- alias = optional friendly route, served only while public. Time via unixepoch() — D1 is the
-- single time source.
CREATE TABLE assets (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  active_version INTEGER,
  is_public INTEGER NOT NULL DEFAULT 0,
  public_alias TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE asset_versions (
  slug TEXT NOT NULL REFERENCES assets(slug),
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  PRIMARY KEY (slug, version)
);
