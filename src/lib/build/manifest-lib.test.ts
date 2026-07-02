import { expect, test } from "vitest";
import { extractTitle, externalOriginHits, validateSlug, firstDuplicate, hasAssetsKey } from "../../../scripts/manifest-lib.mjs";

test("extractTitle reads <title>, falls back to slug", () => {
  expect(extractTitle("<title>Hi</title>", "slug00000000000000000a")).toBe("Hi");
  expect(extractTitle("<h1>no title</h1>", "slug00000000000000000b")).toBe("slug00000000000000000b");
});

test("externalOriginHits flags the broadened surface, ignores data:/relative", () => {
  expect(externalOriginHits(`<script src="https://cdn.example/x.js"></script>`)).toContain("src/href");
  expect(externalOriginHits(`<img srcset="https://cdn/x.png 1x">`)).toContain("srcset");
  expect(externalOriginHits(`<style>@import url(https://f/x.css);</style>`)).toContain("css @import");
  expect(externalOriginHits(`<div style="background:url('https://e/x.png')">`)).toContain("css url()");
  expect(externalOriginHits(`<svg><use href="https://e/s.svg#i"/></svg>`)).toContain("svg <use>");
  expect(externalOriginHits(`<meta http-equiv="refresh" content="0;url=https://evil/">`)).toContain("meta refresh");
  expect(externalOriginHits(`<img src="data:image/png;base64,AAAA"><a href="/rel">x</a>`)).toEqual([]);
});

test("validateSlug requires 22 base64url chars", () => {
  expect(validateSlug("A7fK9dZ2qR3sT1uV5wXyB0")).toBe(true);
  expect(validateSlug("acme-corp")).toBe(false);
});

test("firstDuplicate finds a repeated registry entry", () => {
  expect(firstDuplicate(["a", "b", "a"])).toBe("a");
  expect(firstDuplicate(["a", "b"])).toBeNull();
});

test("hasAssetsKey catches an assets config key in any position, not just line-start", () => {
  expect(hasAssetsKey(`  "assets": { "directory": "./public" }`)).toBe(true); // indented
  expect(hasAssetsKey(`{"assets":{}}`)).toBe(true);                            // minified / after brace
  expect(hasAssetsKey(`"main": "src/index.ts", "assets": {}`)).toBe(true);    // inline after comma (the evasion)
  expect(hasAssetsKey(`"assets" : {}`)).toBe(true);                            // space before colon
  expect(hasAssetsKey(`{ "name": "x", "vars": { "A": "1" } }`)).toBe(false);  // no assets key
  expect(hasAssetsKey(`// this file MUST NEVER gain an "assets" key`)).toBe(false); // invariant comment (no colon)
});
