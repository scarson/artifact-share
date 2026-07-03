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

test("a zip uploads as a single .zip file (NOT auto-unpacked); Unpack converts a bundle-capable one", async () => {
  await upload("/admin/assets", { title: "Bundle" }, { name: "b.zip", bytes: zipSync({ "index.html": HTML, "app.css": strToU8("body{}") }) });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  // Default: the zip is one downloadable object; NOT unpacked.
  expect(await env.ASSETS.get(`a/${slug}/1/b.zip`)).not.toBeNull();
  expect(await env.ASSETS.get(`a/${slug}/1/app.css`)).toBeNull();
  expect((await env.DB.prepare("SELECT entry FROM asset_versions WHERE slug=?1").bind(slug).first<{ entry: string }>())!.entry).toBe("b.zip");
  // Unpack → files under a/, original preserved under orig/, entry flips to index.html.
  await ap({ slug, version: "1" }, "/admin/assets/unpack");
  expect(await env.ASSETS.get(`a/${slug}/1/app.css`)).not.toBeNull();
  expect(await env.ASSETS.get(`a/${slug}/1/b.zip`)).toBeNull();
  expect(await env.ASSETS.get(`orig/${slug}/1.zip`)).not.toBeNull();
  expect((await env.DB.prepare("SELECT entry FROM asset_versions WHERE slug=?1").bind(slug).first<{ entry: string }>())!.entry).toBe("index.html");
});

test("a zip WITHOUT a root index.html uploads fine as a single file; Unpack refuses it", async () => {
  const res = await upload("/admin/assets", { title: "data" }, { name: "data.zip", bytes: zipSync({ "a.csv": strToU8("1,2"), "b.csv": strToU8("3,4") }) });
  expect(res.status).toBe(200);
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  expect(await env.ASSETS.get(`a/${slug}/1/data.zip`)).not.toBeNull();
  const unpack = await ap({ slug, version: "1" }, "/admin/assets/unpack");
  expect(unpack.status).toBe(400);
  expect(await unpack.text()).toContain("index.html");
  expect((await env.DB.prepare("SELECT entry FROM asset_versions WHERE slug=?1").bind(slug).first<{ entry: string }>())!.entry).toBe("data.zip"); // unchanged
});

test("any file type is a single-file asset (PDF stored + served inline with its content type)", async () => {
  const res = await upload("/admin/assets", { title: "Report" }, { name: "q3.pdf", bytes: strToU8("%PDF-1.4 fake") });
  expect(res.status).toBe(200);
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  const obj = await env.ASSETS.get(`a/${slug}/1/q3.pdf`);
  expect(obj).not.toBeNull();
  expect(obj!.httpMetadata?.contentType).toBe("application/pdf");
  expect((await env.DB.prepare("SELECT entry FROM asset_versions WHERE slug=?1").bind(slug).first<{ entry: string }>())!.entry).toBe("q3.pdf");
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

test("Unpack is idempotent/self-healing — re-running after files exist re-derives from the preserved original", async () => {
  await upload("/admin/assets", { title: "Site" }, { name: "s.zip", bytes: zipSync({ "index.html": HTML, "app.css": strToU8("body{}") }) });
  const { slug } = (await env.DB.prepare("SELECT slug FROM assets").first<{ slug: string }>())!;
  expect((await ap({ slug, version: "1" }, "/admin/assets/unpack")).status).toBe(200);
  expect(await env.ASSETS.get(`orig/${slug}/1.zip`)).not.toBeNull(); // original preserved for download + re-heal
  // Simulate the post-unpack state where the entry .zip is gone (it was cleared) and unpack is
  // triggered again: it must succeed by re-reading orig/, not fail with "nothing to unpack".
  await env.DB.prepare("UPDATE asset_versions SET entry = 's.zip' WHERE slug = ?1").bind(slug).run();
  const again = await ap({ slug, version: "1" }, "/admin/assets/unpack");
  expect(again.status).toBe(200);
  expect((await env.DB.prepare("SELECT entry FROM asset_versions WHERE slug=?1").bind(slug).first<{ entry: string }>())!.entry).toBe("index.html");
  expect(await env.ASSETS.get(`a/${slug}/1/app.css`)).not.toBeNull();
});
