import { describe, expect, test } from "vitest";
import { strToU8, zipSync } from "fflate";
import { UploadError, validateUpload, type UploadLimits } from "./validate";

const html = strToU8("<!doctype html><h1>hi</h1>");
const zip = (files: Record<string, Uint8Array>) => zipSync(files);

describe("single file", () => {
  test("a .html upload becomes index.html with the html content-type", () => {
    const { files, isBundle } = validateUpload("report.html", html);
    expect(isBundle).toBe(false);
    expect(files).toEqual([{ path: "index.html", bytes: html, contentType: "text/html; charset=utf-8" }]);
  });
  test("non-html single files are rejected", () => {
    expect(() => validateUpload("report.pdf", html)).toThrow(UploadError);
  });
});

describe("zip bundles", () => {
  test("extracts entries with allowlisted content-types; requires root index.html", () => {
    const { files, isBundle } = validateUpload("b.zip", zip({ "index.html": html, "css/app.css": strToU8("body{}"), "data/x.json": strToU8("{}") }));
    expect(isBundle).toBe(true);
    expect(files.map((f) => f.path).sort()).toEqual(["css/app.css", "data/x.json", "index.html"]);
    expect(files.find((f) => f.path === "css/app.css")!.contentType).toBe("text/css");
  });
  test("missing root index.html rejected", () => {
    expect(() => validateUpload("b.zip", zip({ "nested/index.html": html }))).toThrow(/index\.html/);
  });
  test("zip-slip and absolute paths rejected", () => {
    expect(() => validateUpload("b.zip", zip({ "../evil.html": html, "index.html": html }))).toThrow(UploadError);
    expect(() => validateUpload("b.zip", zip({ "a/../../evil.html": html, "index.html": html }))).toThrow(UploadError);
    expect(() => validateUpload("b.zip", zip({ "/abs.html": html, "index.html": html }))).toThrow(UploadError);
  });
  test("macOS junk (__MACOSX/, .DS_Store) is SKIPPED silently, not a rejection", () => {
    const { files } = validateUpload("b.zip", zip({ "index.html": html, "__MACOSX/._x": strToU8("j"), ".DS_Store": strToU8("j") }));
    expect(files.map((f) => f.path)).toEqual(["index.html"]);
  });
  test("paths with spaces are allowed (URLs arrive percent-encoded)", () => {
    const { files } = validateUpload("b.zip", zip({ "index.html": html, "img/chart 1.png": strToU8("p") }));
    expect(files.map((f) => f.path).sort()).toEqual(["img/chart 1.png", "index.html"]);
  });
  test("disallowed extension rejected; directories skipped silently", () => {
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "run.exe": html }))).toThrow(/extension/);
  });
  test("ALL size/count caps throw (small injected limits exercise each branch)", () => {
    const tiny: UploadLimits = { uploadBytes: 10_000, entries: 2, fileBytes: 50, totalBytes: 60 };
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "a.txt": strToU8("x"), "b.txt": strToU8("x") }), tiny)).toThrow(/entries/);
    expect(() => validateUpload("b.zip", zip({ "index.html": html, "big.txt": strToU8("y".repeat(51)) }), tiny)).toThrow(/too large/);
    expect(() => validateUpload("b.zip", zip({ "index.html": strToU8("z".repeat(40)), "c.txt": strToU8("z".repeat(30)) }), tiny)).toThrow(/total size/);
    expect(() => validateUpload("big.html", strToU8("h".repeat(10_001)), tiny)).toThrow(/exceeds/);
  });
  test("not actually a zip → UploadError, not a crash", () => {
    expect(() => validateUpload("b.zip", strToU8("plain text"))).toThrow(UploadError);
  });
});
