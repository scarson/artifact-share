// ABOUTME: Config-only CI lints (replaces build-manifest after the R2 cutover).
// ABOUTME: Enforces the two structural invariants: no assets key, no committed ACCESS_DEV_BYPASS.
import { readFileSync } from "node:fs";
import { hasAssetsKey, hasDevBypass } from "./manifest-lib.mjs";
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
if (hasAssetsKey(raw)) { console.error("FATAL: wrangler.jsonc must NEVER contain an \"assets\" key (spec §4/§7)."); process.exit(1); }
if (hasDevBypass(raw)) { console.error("FATAL: ACCESS_DEV_BYPASS must never appear in committed config (.dev.vars only)."); process.exit(1); }
console.log("config lints OK");
