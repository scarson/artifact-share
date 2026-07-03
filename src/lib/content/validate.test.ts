import { describe, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { UploadError, contentTypeFor, extractBundle, isInlineType, prepareUpload, type UploadLimits } from "./validate";

const html = strToU8("<!doctype html><h1>hi</h1>");
const zip = (files: Record<string, Uint8Array>) => zipSync(files);

describe("prepareUpload — single files of any type", () => {
  test("a .html file is a single file served at its own name", () => {
    const r = prepareUpload("report.html", html);
    expect(r).toMatchObject({ entry: "report.html", contentType: "text/html; charset=utf-8", bundleCapable: false });
    expect(r.bytes).toBe(html);
  });
  test("a PDF is accepted with its content type", () => {
    const r = prepareUpload("q3.pdf", strToU8("%PDF-1.4"));
    expect(r).toMatchObject({ entry: "q3.pdf", contentType: "application/pdf", bundleCapable: false });
  });
  test("an unknown extension is stored as an octet-stream download", () => {
    const r = prepareUpload("data.parquet", strToU8("PAR1"));
    expect(r.contentType).toBe("application/octet-stream");
  });
  test("filenames are sanitized to a safe single segment", () => {
    expect(prepareUpload("../../etc/passwd", strToU8("x")).entry).toBe("passwd");
    expect(prepareUpload("a b/c d.png", strToU8("x")).entry).toBe("c_d.png");
    expect(prepareUpload(".hidden", strToU8("x")).entry).toBe("hidden");
  });
  test("empty file and oversize are rejected", () => {
    expect(() => prepareUpload("x.pdf", strToU8(""))).toThrow(UploadError);
    const tiny: UploadLimits = { uploadBytes: 4, entries: 200, fileBytes: 4, totalBytes: 4 };
    expect(() => prepareUpload("x.pdf", strToU8("toolong"), tiny)).toThrow(/exceeds/);
  });
});

describe("prepareUpload — zips default to a single-file download", () => {
  test("a zip is a single .zip file, and bundleCapable when it has a root index.html", () => {
    const r = prepareUpload("site.zip", zip({ "index.html": html, "app.css": strToU8("body{}") }));
    expect(r).toMatchObject({ entry: "site.zip", contentType: "application/zip", bundleCapable: true });
  });
  test("a zip WITHOUT a root index.html is a single file, not bundle-capable", () => {
    const r = prepareUpload("data.zip", zip({ "a.csv": strToU8("1,2"), "b.csv": strToU8("3,4") }));
    expect(r).toMatchObject({ entry: "data.zip", contentType: "application/zip", bundleCapable: false });
  });
  test("a corrupt zip is still storable as a single file (just not bundle-capable)", () => {
    const r = prepareUpload("x.zip", strToU8("not really a zip"));
    expect(r.bundleCapable).toBe(false);
    expect(r.entry).toBe("x.zip");
  });
});

describe("extractBundle — the Unpack action's validator", () => {
  test("extracts entries, requires root index.html, allowlists content-types", () => {
    const files = extractBundle(zip({ "index.html": html, "css/app.css": strToU8("body{}") }));
    expect(files.map((f) => f.path).sort()).toEqual(["css/app.css", "index.html"]);
    expect(files.find((f) => f.path === "css/app.css")!.contentType).toBe("text/css");
  });
  test("missing root index.html rejected", () => {
    expect(() => extractBundle(zip({ "nested/index.html": html }))).toThrow(/index\.html/);
  });
  test("zip-slip / absolute rejected before junk-skip; macOS junk skipped; spaces allowed", () => {
    expect(() => extractBundle(zip({ "../evil.html": html, "index.html": html }))).toThrow(UploadError);
    expect(() => extractBundle(zip({ "a/../../evil": html, "index.html": html }))).toThrow(UploadError);
    const files = extractBundle(zip({ "index.html": html, "__MACOSX/._x": strToU8("j"), ".DS_Store": strToU8("j"), "img/c 1.png": strToU8("p") }));
    expect(files.map((f) => f.path).sort()).toEqual(["img/c 1.png", "index.html"]);
  });
  test("disallowed extension in a bundle rejected; ALL caps enforced pre-inflation", () => {
    expect(() => extractBundle(zip({ "index.html": html, "run.exe": html }))).toThrow(/extension/);
    const tiny: UploadLimits = { uploadBytes: 10_000, entries: 2, fileBytes: 50, totalBytes: 60 };
    expect(() => extractBundle(zip({ "index.html": html, "a.txt": strToU8("x"), "b.txt": strToU8("x") }), tiny)).toThrow(/entries/);
    expect(() => extractBundle(zip({ "index.html": html, "big.txt": strToU8("y".repeat(51)) }), tiny)).toThrow(/too large/);
  });
  test("not a readable zip → UploadError", () => {
    expect(() => extractBundle(strToU8("plain text"))).toThrow(UploadError);
  });
});

describe("content-type helpers", () => {
  test("contentTypeFor maps known extensions and falls back to octet-stream", () => {
    expect(contentTypeFor("a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("a.PDF")).toBe("application/pdf"); // case-insensitive
    expect(contentTypeFor("a.unknownext")).toBe("application/octet-stream");
  });
  test("isInlineType: renderable types inline, archives/unknown download", () => {
    for (const ct of ["text/html; charset=utf-8", "application/pdf", "image/png", "image/svg+xml", "text/plain; charset=utf-8"]) {
      expect(isInlineType(ct)).toBe(true);
    }
    for (const ct of ["application/zip", "application/octet-stream", "text/csv"]) {
      expect(isInlineType(ct)).toBe(false);
    }
  });
});
