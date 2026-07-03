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
      // Crypto in the tests (RSA keypair generation for the Cloudflare Access JWT tests, jose
      // sign/verify) can be slow under the concurrent worker pool and occasionally exceed Vitest's
      // 5s default. Give a generous per-test budget so CI (the deploy gate) reds on correctness, not
      // cost. Does NOT weaken any assertion — only lengthens the wall-clock budget.
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
            ASSET_COOKIE_SECRET: "k1:test-asset-secret-do-not-use-in-prod-00000000000",
            // Vault ring (recoverable codes): STANDARD base64 of exactly 32 bytes (here: zeros).
            CODE_VAULT_KEY: "k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            // Cloudflare Access config for admin-auth tests (cfaccess module). ACCESS_DEV_BYPASS is
            // pinned OFF ("0" — only the exact string "1" enables it) because the pool also loads
            // .dev.vars, where SETUP.md tells developers to set ACCESS_DEV_BYPASS=1 for local QA;
            // without this pin an existing .dev.vars silently disables Access enforcement and the
            // deny-by-default tests fail. Tests must exercise real Access enforcement.
            ACCESS_DEV_BYPASS: "0",
            ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
            ACCESS_AUD: "test-aud-tag",
            ADMIN_EMAIL: "admin@share.test"
          }
        }
      })
    ]
  };
});
