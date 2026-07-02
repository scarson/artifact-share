import { expect, test } from "vitest";
import { generateCode, generateSlug, hashCode } from "./codes";

test("generateCode is 22 base64url chars (128-bit)", () => {
  expect(generateCode()).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("generateCode is unique across calls", () => {
  const set = new Set(Array.from({ length: 1000 }, () => generateCode()));
  expect(set.size).toBe(1000);
});

test("generateSlug is 22 base64url chars", () => {
  expect(generateSlug()).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("hashCode is deterministic 64-hex SHA-256 and differs per code", async () => {
  const h = await hashCode("abc");
  // Known SHA-256("abc") — pins the algorithm, not just the shape.
  expect(h).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(await hashCode("abd")).not.toBe(h);
});
