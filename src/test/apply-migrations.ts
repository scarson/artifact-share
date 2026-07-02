import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

// DEVIATION from the plan's literal setup-file contents (see docs/pitfalls + Task 0.3 report):
// @cloudflare/vitest-pool-workers >=0.13.0 removed `isolatedStorage`, so local D1/KV/R2 storage
// is now isolated per TEST FILE, not per TEST — every test in a file now shares one SQLite
// instance for env.DB. The plan's later test suites (dozens of files) are written against
// per-test-fresh-D1 semantics: multiple tests within one file re-seed the same UNIQUE
// `code_hash` values and assert on whole-table counts like `SELECT count(*) FROM codes`, which
// would collide or drift under per-file-only isolation.
//
// To keep those suites correct without rewriting them, this setup file reconstructs
// per-test-fresh-D1 semantics itself: before every test, drop every user table (and view) in
// env.DB, then re-apply migrations from scratch. This is slower than native `isolatedStorage`
// (which snapshotted/restored underlying storage) but is semantically equivalent for the plan's
// purposes, and is pinned by src/test/isolation.test.ts so a future toolchain bump that changes
// this behavior is caught immediately instead of silently corrupting test data.
beforeEach(async () => {
  const objects = await env.DB.prepare(
    `SELECT name, type FROM sqlite_master
     WHERE type IN ('table', 'view')
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE '_cf_%'`
  ).all<{ name: string; type: "table" | "view" }>();

  const names = objects.results.map((o) => o.name);

  try {
    if (objects.results.length > 0) {
      // Quote (and escape embedded quotes in) each identifier to safely handle any table/view
      // name sqlite_master returns. `d1_migrations` (migration bookkeeping) matches this query
      // too and is intentionally included so migrations re-apply cleanly below.
      //
      // All drops run as ONE env.DB.batch() call, in a single transaction, with
      // `PRAGMA defer_foreign_keys = ON` as the first statement. D1 enforces foreign keys by
      // default, so dropping tables one-by-one (in sqlite_master's arbitrary order) can fail
      // when a table is dropped before the tables that reference it. Deferring FK checks to
      // commit means every DROP in the batch has already happened by the time constraints are
      // (re-)checked, so drop order stops mattering — this removes the FK-ordering hazard AND
      // the O(n) sequential round trips of issuing one prepare().run() per object.
      const statements = [
        env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
        ...objects.results.map(({ name, type }) => {
          const escaped = name.replace(/"/g, '""');
          return env.DB.prepare(`DROP ${type.toUpperCase()} IF EXISTS "${escaped}"`);
        })
      ];

      // Dropping a table implicitly drops its indexes, so no separate index cleanup is needed.
      await env.DB.batch(statements);
    }

    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to reset local D1 before test (dropping ${names.join(", ")}): ${message}`,
      { cause: error }
    );
  }
});
