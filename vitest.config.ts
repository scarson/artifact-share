import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// DEVIATION from the plan's literal file contents (see docs/pitfalls + Task 0.3 report): the
// installed @cloudflare/vitest-pool-workers is 0.17.0 (Vitest 4), which replaced
// `defineWorkersConfig`/`defineWorkersProject` (from a now-removed "/config" subpath) with a
// `cloudflareTest()` Vite plugin exported from the package root, per Cloudflare's official
// "Migrate from Vitest 3 to Vitest 4" guide. `readD1Migrations` now lives on the same root
// entrypoint. The plan's bindings, migrations wiring, and comments are preserved as-is below —
// only the config *shape* changed (options that were `test.poolOptions.workers.*` are now passed
// directly to `cloudflareTest()`).
export default defineConfig(async () => {
  // ESM config ("type": "module") — __dirname does not exist here; derive from import.meta.url.
  const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));
  return {
    test: {
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
      // argon2id is memory-hard by design (~250ms/hash); the admin login-flow tests run several
      // per test and, under the concurrent worker pool, can exceed Vitest's 5s default. Give the
      // KDF room so CI (the deploy gate) doesn't red on cost, not correctness. This does NOT weaken
      // any assertion — it only lengthens the wall-clock budget.
      testTimeout: 30000
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // NOTE: `isolatedStorage`/`singleWorker` were removed in the v0.13.0 (Vitest 4) rearchitecture.
        // Storage isolation is now per TEST FILE (not per test), matching Vitest's own isolation model —
        // this still satisfies the load-bearing requirement that tests seeding fixed hashes/rows get a
        // fresh D1 (migrations re-apply via the setup file below). The beforeEach hook in
        // src/test/apply-migrations.ts restores per-test semantics on top of this per-file isolation, so
        // the one remaining constraint is: don't use `test.concurrent`/`describe.concurrent` within a
        // file, since concurrent tests interleave and would race that shared reset.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Tests exercise the PRODUCTION code paths by default (gate+admin serve). Env-variant
            // behavior (preview-inert) is tested via app.request(path, init, envOverride).
            ENVIRONMENT: "production",
            PUBLIC_ORIGIN: "https://share.test",
            SESSION_SECRET: "k1:test-session-secret-do-not-use-in-prod-0000000000",
            ASSET_COOKIE_SECRET: "k1:test-asset-secret-do-not-use-in-prod-00000000000",
            ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
            // REAL argon2id PHC hash (Task 4.1 Step 6) of the literal test password "test-password",
            // generated via `node scripts/hash-password.mjs test-password` (@noble/hashes argon2id,
            // pinned params m=19456,t=2,p=1). Login-flow tests verify against this value — see
            // docs/pitfalls/testing-pitfalls.md.
            ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$TMPKUmUqqMH1LgIT0xGKrw$Q6OBbtpZyIuY3mM6TIlKaf3Hr8P1wpf5NLD6xgz98IE",
            // Cloudflare Access config for admin-auth tests (cfaccess module). Not wired into any
            // route yet — this task is purely additive. Deliberately no ACCESS_DEV_BYPASS here:
            // tests must exercise real Access enforcement, not the local-dev bypass.
            ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
            ACCESS_AUD: "test-aud-tag",
            ADMIN_EMAIL: "admin@share.test"
          }
        }
      })
    ]
  };
});
