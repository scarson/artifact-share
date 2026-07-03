import { env } from "cloudflare:test";
import { expect, test } from "vitest";

// Pins the per-test-fresh-D1 semantics reconstructed by src/test/apply-migrations.ts (see the
// comment there for why this is necessary on @cloudflare/vitest-pool-workers >=0.13.0). If a
// future toolchain bump changes the setup file's behavior, or pool-workers regains/loses
// isolation guarantees, these two tests catch it immediately instead of letting it silently
// corrupt data in the plan's later suites (which assume every test starts from a clean DB).
//
// Order matters: vitest runs tests within a file sequentially by declaration order (this file
// has no `describe.concurrent`/`test.concurrent`), so test 2 relies on test 1 having already run.
// This also relies on vitest's default non-shuffled declaration-order sequence — `sequence.shuffle`
// must stay off (it isn't set in vitest.config.ts, and must not be enabled there).

test("1) creates a table and row that would leak into the next test without per-test reset", async () => {
  await env.DB.prepare("CREATE TABLE probe_leak (x INTEGER)").run();
  await env.DB.prepare("INSERT INTO probe_leak (x) VALUES (1)").run();

  const row = await env.DB.prepare("SELECT x FROM probe_leak").first<{ x: number }>();
  expect(row?.x).toBe(1);
});

test("2) starts from a clean, migrations-only database — probe_leak from test 1 is gone", async () => {
  const found = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'probe_leak'").first();
  expect(found).toBeNull();
});
