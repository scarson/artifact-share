import { expect, test } from "vitest";
import { servesTraffic } from "./envgate";

test("servesTraffic: positive allow — production ONLY; everything else inert", () => {
  expect(servesTraffic("production")).toBe(true);
  expect(servesTraffic("development")).toBe(false);
  expect(servesTraffic("preview")).toBe(false);
  expect(servesTraffic(undefined)).toBe(false);
  expect(servesTraffic("")).toBe(false);
});
