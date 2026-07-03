import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import app from "../index";

const BASE = "https://share.test";
const AUTH = { ...env, ACCESS_DEV_BYPASS: "1" };

function upload(path: string, fields: Record<string, string>, file: { name: string; bytes: Uint8Array }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([file.bytes as unknown as ArrayBuffer], file.name));
  return app.request(path, { method: "POST", headers: { origin: BASE }, body: form }, AUTH);
}
function ap(fields: Record<string, string>, path: string) {
  return app.request(path, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }, AUTH);
}
const HTML = strToU8("<!doctype html><h1>up</h1>");

test("upload single html → asset created, v1 active, appears in panel with title", async () => {
  const res = await upload("/admin/assets", { title: "Board Deck" }, { name: "deck.html", bytes: HTML });
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(body).toContain("Board Deck");
  const a = await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>();
  expect(a!.active_version).toBe(1);
});

test("upload zip bundle → files stored under a/<slug>/1/, original under orig/", async () => {
  await upload("/admin/assets", { title: "Bundle" }, { name: "b.zip", bytes: zipSync({ "index.html": HTML, "app.css": strToU8("body{}") }) });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  expect(await env.ASSETS.get(`a/${slug}/1/app.css`)).not.toBeNull();
  expect(await env.ASSETS.get(`orig/${slug}/1.zip`)).not.toBeNull();
});

test("invalid upload (no index.html in zip) → 400 with the validator's message, nothing persisted", async () => {
  const res = await upload("/admin/assets", { title: "bad" }, { name: "b.zip", bytes: zipSync({ "readme.txt": HTML }) });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("index.html");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM assets").first<{ n: number }>()).toMatchObject({ n: 0 });
});

test("new version + activate/rollback + download + delete flows", async () => {
  await upload("/admin/assets", { title: "t" }, { name: "a.html", bytes: HTML });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  await upload("/admin/assets/version", { slug }, { name: "b.html", bytes: strToU8("<!doctype html>v2") });
  expect((await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>())!.active_version).toBe(2);
  await ap({ slug, version: "1" }, "/admin/assets/activate"); // rollback
  expect((await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>())!.active_version).toBe(1);
  const dl = await app.request(`/admin/assets/download?slug=${slug}`, {}, AUTH);
  expect(dl.headers.get("content-disposition")).toContain(`${slug}-v1`);
  await ap({ slug, version: "2" }, "/admin/assets/delete-version");
  expect(await env.ASSETS.get(`a/${slug}/2/index.html`)).toBeNull();
  await ap({ slug, confirm: "1" }, "/admin/assets/delete");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM assets").first<{ n: number }>()).toMatchObject({ n: 0 });
  expect(await env.ASSETS.get(`a/${slug}/1/index.html`)).toBeNull();
});

test("draft upload does NOT activate; deleting the ACTIVE version is refused via the route", async () => {
  await upload("/admin/assets", { title: "d" }, { name: "a.html", bytes: HTML });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  await upload("/admin/assets/version", { slug, draft: "1" }, { name: "b.html", bytes: strToU8("<!doctype html>v2") });
  expect((await env.DB.prepare("SELECT active_version FROM assets").first<{ active_version: number }>())!.active_version).toBe(1);
  const res = await ap({ slug, version: "1" }, "/admin/assets/delete-version");
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("active");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM asset_versions WHERE version = 1").first<{ n: number }>()).toMatchObject({ n: 1 });
});

test("delete without the confirm checkbox is refused", async () => {
  await upload("/admin/assets", { title: "keep" }, { name: "a.html", bytes: HTML });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  const res = await ap({ slug }, "/admin/assets/delete");
  expect(res.status).toBe(400);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM assets").first<{ n: number }>()).toMatchObject({ n: 1 });
});

test("asset mutations enforce CSRF and admin auth like every other admin mutation", async () => {
  const forged = await app.request("/admin/assets", { method: "POST", headers: { origin: "https://evil.example" }, body: new FormData() }, AUTH);
  expect(forged.status).toBe(403);
  const unauth = await app.request("/admin/assets", { method: "POST", headers: { origin: BASE }, body: new FormData() }, env);
  expect(await unauth.text()).toContain("invalid or has expired");
});

test("public toggle + alias via POST; reserved alias rejected; CSRF enforced", async () => {
  await upload("/admin/assets", { title: "pub" }, { name: "a.html", bytes: HTML });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  await ap({ slug, public: "1" }, "/admin/assets/public");
  expect((await env.DB.prepare("SELECT is_public FROM assets").first<{ is_public: number }>())!.is_public).toBe(1);
  await ap({ slug, alias: "docs" }, "/admin/assets/alias");
  expect((await env.DB.prepare("SELECT public_alias FROM assets").first<{ public_alias: string }>())!.public_alias).toBe("docs");
  const bad = await ap({ slug, alias: "admin" }, "/admin/assets/alias"); // reserved
  expect(bad.status).toBe(400);
  expect((await env.DB.prepare("SELECT public_alias FROM assets").first<{ public_alias: string }>())!.public_alias).toBe("docs"); // unchanged
  const forged = await app.request("/admin/assets/public", { method: "POST", headers: { origin: "https://evil.example" }, body: new URLSearchParams({ slug, public: "1" }).toString() }, AUTH);
  expect(forged.status).toBe(403);
});
