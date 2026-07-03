import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { deleteAssetObjects, deleteVersionObjects, readAssetFile, readOriginalZip, storeVersion } from "./store";

const F = (s: string) => new TextEncoder().encode(s);
const SLUG = "slugslugslugslugslug00";

test("storeVersion + readAssetFile round-trip with content types; version isolation", async () => {
  await storeVersion(env.ASSETS, SLUG, 1, [{ path: "index.html", bytes: F("v1"), contentType: "text/html; charset=utf-8" }], null);
  await storeVersion(env.ASSETS, SLUG, 2, [{ path: "index.html", bytes: F("v2"), contentType: "text/html; charset=utf-8" }], null);
  const v1 = await readAssetFile(env.ASSETS, SLUG, 1, "index.html");
  expect(await v1!.text()).toBe("v1");
  expect(v1!.httpMetadata?.contentType).toBe("text/html; charset=utf-8");
  expect(await (await readAssetFile(env.ASSETS, SLUG, 2, "index.html"))!.text()).toBe("v2");
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "missing.css")).toBeNull();
});

test("original zip stored under orig/ and readable; absent for single-file versions", async () => {
  await storeVersion(env.ASSETS, SLUG, 3, [{ path: "index.html", bytes: F("x"), contentType: "text/html; charset=utf-8" }], F("ZIPBYTES"));
  expect(await (await readOriginalZip(env.ASSETS, SLUG, 3))!.text()).toBe("ZIPBYTES");
  expect(await readOriginalZip(env.ASSETS, SLUG, 99)).toBeNull();
});

test("readAssetFile refuses traversal/absolute/empty paths without touching R2", async () => {
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "../1/index.html")).toBeNull();
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "/etc/passwd")).toBeNull();
  expect(await readAssetFile(env.ASSETS, SLUG, 1, "")).toBeNull();
});

test("deleteVersionObjects removes a/ + orig/ for that version only; deleteAssetObjects removes all", async () => {
  await storeVersion(env.ASSETS, SLUG, 4, [{ path: "index.html", bytes: F("a"), contentType: "text/html; charset=utf-8" }], null);
  await storeVersion(env.ASSETS, SLUG, 5, [{ path: "index.html", bytes: F("b"), contentType: "text/html; charset=utf-8" }], F("Z"));
  await deleteVersionObjects(env.ASSETS, SLUG, 5);
  expect(await readAssetFile(env.ASSETS, SLUG, 5, "index.html")).toBeNull();
  expect(await readOriginalZip(env.ASSETS, SLUG, 5)).toBeNull();
  expect(await readAssetFile(env.ASSETS, SLUG, 4, "index.html")).not.toBeNull();
  await deleteAssetObjects(env.ASSETS, SLUG);
  expect(await readAssetFile(env.ASSETS, SLUG, 4, "index.html")).toBeNull();
});
