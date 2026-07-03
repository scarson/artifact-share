import { expect, test } from "vitest";
import { hasAssetsKey, hasDevBypass } from "../../../scripts/manifest-lib.mjs";

test("hasAssetsKey catches an assets config key in any position, not just line-start", () => {
  expect(hasAssetsKey(`  "assets": { "directory": "./public" }`)).toBe(true); // indented
  expect(hasAssetsKey(`{"assets":{}}`)).toBe(true);                            // minified / after brace
  expect(hasAssetsKey(`"main": "src/index.ts", "assets": {}`)).toBe(true);    // inline after comma (the evasion)
  expect(hasAssetsKey(`"assets" : {}`)).toBe(true);                            // space before colon
  expect(hasAssetsKey(`{ "name": "x", "vars": { "A": "1" } }`)).toBe(false);  // no assets key
  expect(hasAssetsKey(`// this file MUST NEVER gain an "assets" key`)).toBe(false); // invariant comment (no colon)
});

test("hasDevBypass flags ACCESS_DEV_BYPASS in a committed config, ignores an ordinary var", () => {
  expect(hasDevBypass(`"vars": { "ACCESS_DEV_BYPASS": "1" }`)).toBe(true);
  expect(hasDevBypass(`"vars": { "ENVIRONMENT": "production" }`)).toBe(false);
});
