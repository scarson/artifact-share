import { env } from "cloudflare:test";
import { expect, test, vi } from "vitest";
import { listAudit, writeAudit } from "./auditRepo";

test("writeAudit appends rows; listAudit returns them newest-first, capped", async () => {
  await writeAudit(env.DB, "mint_code", "slug000000000000000001", "Acme CFO");
  await writeAudit(env.DB, "set_public", "slug000000000000000001", "public=on");
  await writeAudit(env.DB, "delete_asset", "slug000000000000000001", "Q3 Deck");
  const rows = await listAudit(env.DB, 2);
  expect(rows).toHaveLength(2);                       // capped
  expect(rows[0].action).toBe("delete_asset");        // newest first
  expect(rows[0].detail).toBe("Q3 Deck");
  expect(rows[1].action).toBe("set_public");
});

test("writeAudit is best-effort — a DB failure never throws (audit must not break the action)", async () => {
  const throwing = { prepare() { throw new Error("db down"); } } as unknown as D1Database;
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(writeAudit(throwing, "revoke_code", "codeid")).resolves.toBeUndefined();
  expect(spy.mock.calls.some(([m]) => typeof m === "string" && m.includes("audit_write_failed"))).toBe(true);
  spy.mockRestore();
});
