/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Env as WorkerEnv } from "../env";

// DEVIATION from the plan's literal file contents: in the installed @cloudflare/vitest-pool-workers
// (0.17.0, Vitest 4), `cloudflare:test`'s `env` export is typed as the global `Cloudflare.Env`
// namespace interface (see node_modules/@cloudflare/workers-types — "A project should have a
// declaration like this"), not a `ProvidedEnv` interface on `cloudflare:test` (that interface no
// longer exists in this version). Augmenting `Cloudflare.Env` is the current documented pattern and
// is consumed by both `cloudflare:test`'s `env` and `cloudflare:workers`'s `env`.
// This file has top-level imports, making it a module — so the ambient `Cloudflare` namespace
// augmentation must be wrapped in `declare global` to merge into the global scope instead of being
// scoped to this module.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
