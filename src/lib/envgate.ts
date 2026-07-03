/** Positive allow (fail closed, spec §8/§10): ONLY `production` serves traffic — preview, unset,
 *  development, or any future env name is INERT (generic page). Local QA opts in EXPLICITLY by
 *  setting ENVIRONMENT=production in .dev.vars, which is safe because local `wrangler dev`
 *  bindings point at the local D1 file (never remote). One serving environment means a
 *  mis-deployed non-prod Worker can never serve confidential content, whatever DB it is bound
 *  to — the `meta` environment marker (migration 0001) remains as an OPERATOR verification signal
 *  (Tasks 7.1/7.4), not a runtime branch. */
export function servesTraffic(environment: string | undefined): boolean {
  return environment === "production";
}
