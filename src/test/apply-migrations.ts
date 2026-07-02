import { applyD1Migrations, env } from "cloudflare:test";

// Applies all migrations/*.sql to the isolated per-test-file local D1 before each test file runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
