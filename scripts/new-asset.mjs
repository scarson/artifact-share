import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const title = process.argv.slice(2).join(" ").trim() || "Untitled asset";
const slug = randomBytes(16).toString("base64url"); // 22 chars, 128-bit (spec §7)
const root = process.cwd();

const dir = path.join(root, "assets", slug);
await mkdir(dir, { recursive: true });
await writeFile(
  path.join(dir, "index.html"),
  `<!doctype html>\n<meta charset="utf-8">\n<title>${title}</title>\n<h1>${title}</h1>\n`,
);

// Record provenance so the build can reject a hand-crafted folder (spec §7 D2 backstop).
// .generated/slugs.json is COMMITTED.
const regPath = path.join(root, ".generated", "slugs.json");
await mkdir(path.dirname(regPath), { recursive: true });
let reg = [];
try { reg = JSON.parse(await readFile(regPath, "utf8")); } catch { /* first asset */ }
if (!reg.includes(slug)) reg.push(slug);
await writeFile(regPath, JSON.stringify(reg, null, 2) + "\n");

console.log("Created assets/%s/index.html and registered the slug.", slug);
console.log("Slug (opaque):", slug);
console.log("Next: edit the HTML, run 'npm run build-manifest', commit, PR.");
