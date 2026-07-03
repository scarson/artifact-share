-- General file sharing (design 2026-07-04 §Part D): the object served as an asset version's
-- document. 'index.html' for HTML bundles; the stored filename for single-file assets (a PDF, an
-- image, a kept-as-single .zip). NULL on rows written before this migration means 'index.html'
-- (back-compat). Plain column add — SQLite ALTER TABLE cannot take expression DEFAULTs (pitfalls).
ALTER TABLE asset_versions ADD COLUMN entry TEXT;
