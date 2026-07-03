// ABOUTME: Config-lint helpers for wrangler.jsonc (used by scripts/lint-config.mjs + its test).
// ABOUTME: The former manifest/title/slug helpers were retired with the R2 asset-manager cutover.

export function hasAssetsKey(wranglerRaw) {
  return /(^|[\s{,])"assets"\s*:/.test(wranglerRaw);
}

export function hasDevBypass(wranglerRaw) {
  return /ACCESS_DEV_BYPASS/.test(wranglerRaw);
}
