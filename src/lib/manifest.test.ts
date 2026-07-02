import { expect, test } from "vitest";
import { findOrphans, isKnownSlug } from "./manifest";

test("flags codes whose slug is not in the manifest", () => {
  const manifest = { aaaaaaaaaaaaaaaaaaaaaa: { title: "A" } };
  const codes = [{ asset_slug: "aaaaaaaaaaaaaaaaaaaaaa" }, { asset_slug: "bbbbbbbbbbbbbbbbbbbbbb" }];
  expect(findOrphans(codes, manifest)).toEqual(["bbbbbbbbbbbbbbbbbbbbbb"]);
});

test("isKnownSlug reflects the generated manifest (fixture present)", () => {
  expect(isKnownSlug("testasset0000000000000")).toBe(true);
  expect(isKnownSlug("nopenopenopenopenopeno")).toBe(false);
});
