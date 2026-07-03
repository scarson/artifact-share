import { expect, test } from "vitest";
import { originOk } from "./csrf";

const req = (h: Record<string, string>) => new Request("https://share.test/admin/login", { method: "POST", headers: h });
const PIN = "https://share.test";

test("accepts a matching Origin, rejects cross-site", () => {
  expect(originOk(req({ origin: PIN }), PIN)).toBe(true);
  expect(originOk(req({ origin: "https://evil.example" }), PIN)).toBe(false);
});
test("falls back to Referer ONLY when Origin is absent; rejects when both absent", () => {
  expect(originOk(req({ referer: `${PIN}/admin` }), PIN)).toBe(true);
  expect(originOk(req({}), PIN)).toBe(false);
});
test("a malformed PRESENT Origin is rejected even with a valid Referer (no fallback — spec §8)", () => {
  expect(originOk(req({ origin: "not a url" }), PIN)).toBe(false);
  expect(originOk(req({ origin: "not a url", referer: `${PIN}/admin` }), PIN)).toBe(false);
});
test("fails closed when PUBLIC_ORIGIN is unset", () => {
  expect(originOk(req({ origin: PIN }), undefined)).toBe(false);
});
