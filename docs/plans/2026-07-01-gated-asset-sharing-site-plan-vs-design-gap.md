# Plan ↔ Revised-Design Gap Assessment

**Assessed:** 2026-07-02
**Plan:** [`docs/plans/2026-07-01-gated-asset-sharing-site-plan.md`](2026-07-01-gated-asset-sharing-site-plan.md) (written against the *original* design)
**Authoritative spec:** [`docs/design/…-design.REVISED.md`](../design/2026-07-01-gated-asset-sharing-site-design.REVISED.md) (hardened by a 6-round adversarial security review *after* the plan was written)
**Also:** original design [`…-design.md`](../design/2026-07-01-gated-asset-sharing-site-design.md), design-review report [`…-design.REVIEW.md`](../design/2026-07-01-gated-asset-sharing-site-design.REVIEW.md)

---

## Verdict

The plan is well-structured, TDD-disciplined, and internally consistent — but it was authored against the **pre-hardening** design and never re-synchronized. An executor who follows it verbatim will faithfully rebuild the *original* model and, in doing so, **re-introduce nearly every issue the design review fixed** and add a few plan-only bugs. **53 gaps** were found and each verified against the file text.

**The root cause is a single meta-defect that produces most of the rest:** the plan's Conventions block points `spec §N` references at `docs/superpowers/specs/2026-07-01-gated-asset-sharing-site-design.md` — a path that **does not exist in this repo** and, even by name, is the **original, not the `.REVISED.` file**. Every inline "spec §N" citation and the final self-review's coverage map therefore resolve to the superseded model. Fixing the pointer is step zero; the rest is re-deriving the affected tasks.

| Severity | Count | Meaning |
|---|---|---|
| 🔴 High | 12 | Broken security invariant or silent confidential exposure |
| 🟠 Medium | 24 | Weakened control, consistency/correctness bug, or missing required test |
| 🟡 Low | 17 | Clarity, ops-hygiene, dead code, or a surfaced owner-decision |

Categories: 24 conflicts (plan does something the revised design now forbids/replaces), 15 missing mechanisms, 6 test-gaps, 7 meta/stale-reference, 3 §15 owner decisions.

> **On method & honesty (read this).** This assessment was produced by a multi-agent workflow: 6 Opus finders over both documents → Sonnet merge → per-finding adversarial verification → a Fable completeness critic. During review I discovered the *verification* layer was partially broken — ~30 of the verifier subagents received their document inputs as the literal string "undefined," never read the files, and either defaulted to "real=true" or wrongly "refuted" a finding (one verifier even reviewed an unrelated repo on disk). I did **not** trust those verdicts. Every finding below was **re-grounded directly against the file text** (grep/character-count/line citations) in the main loop before inclusion. The four findings the broken verifiers "refuted" turned out to be real and are reinstated (marked ⟲) — including a concrete arithmetic bug the spike phase depends on.

---

## Master table

IDs are `<theme>-<n>`. "Plan" = task/identifier; "§" = revised-design section.

| ID | Sev | Gap | Plan | § |
|---|---|---|---|---|
| **CODE-1** | 🔴 | Raw access code stored/looked-up/displayed in plaintext, not `code_hash = SHA-256(code)` | 2.1, 3.2, 5.1, 5.2 | §5, §3 D3, §6.4, §8, §13 |
| **CODE-2** | 🟠 | Show-once code display unplanned — `createCodeAction` discards the minted code; only source of a link is the (plaintext) table | 5.2 | §8, §3 D3, §5 |
| **TIME-1** | 🔴 | Redemption is check-then-write (findByCode→isCodeValid→recordUsage), not one atomic conditional `UPDATE … RETURNING` | 3.1, 3.2 | §6.4, §13 |
| **TIME-2** | 🟠 | 90-day default computed in JS, not a DB-side column default | 2.1, 2.3, 5.1 | §5 |
| **TIME-3** | 🟠 | Validity/expiry/usage use serverless `new Date()`, not DB `now()` (single-time-source) | 2.3/3.1/3.2/5.1 | §5, §6.4 |
| **TIME-4** | 🟠 | Cookie expiry is a fixed 24h JS TTL, never capped by `LEAST(now()+24h, expires_at)` | 3.2, 2.4 | §6.4, §8 |
| **TIME-5** | 🟠 | Uniform-failure-path timing broken (raw-code lookup + no atomic UPDATE ⇒ no constant-work lookup) | 3.1, 3.2 | §6.3 |
| **TOK-1** | 🔴 | Tokens lack `v`/`kid`/key-ring rotation, canonical encoding, strict validation; asset payload omits `code_id`, DB-sourced `iat`/`cookie_exp` | 2.4 | §6.4, §8, §10, §13 |
| **HDR-1** | 🔴 | 302 redirect + failure page carry incomplete/divergent headers (no `no-store`, HSTS, nosniff, CSP) → breaks failure-parity; no header test suite | 3.2, 3.3 | §6.3/6.4, §9, §13 |
| **HDR-2** | 🔴 | `Strict-Transport-Security` never set on any response | 3.2, 3.3 | §9 |
| **HDR-3** | 🟠 | Asset CSP omits `object-src`/`frame-src`/`worker-src 'none'` | 3.2 | §9 |
| **HDR-4** | 🟠 | Admin responses get no CSP at all | 4.3, 5.2 | §9 |
| **HDR-5** | 🟠 | `X-Content-Type-Options: nosniff` never set | 3.2, 3.3 | §9 |
| **HDR-6** | 🟡 | Preview-inert `/admin` returns a bespoke "Unavailable" page, not the byte-identical generic page | 4.3 | §8, §6.3 |
| **HDR-7** | 🟡 | Failure-page copy omits the mandated static second (self-service) sentence | 3.2 | §6.5 |
| **HDR-8** | 🟡 | Final self-review claims "§9→P3" while P3 omits 4 headers + admin CSP | self-review | §9 |
| **AUTH-1** | 🔴 | TOTP step consumed on wrong-password attempts (verify runs before password gate) | 4.2, 4.3 | §5, §8, §13 |
| **AUTH-2** | 🔴 | CSRF accepts absent-`Origin` (no Referer fallback) and compares to the request's own `Host`, not a pinned prod origin | 4.3, 5.2 | §8 |
| **AUTH-3** | 🔴 | Login limiter hard-blocks on wrong-input volume (single-admin lockout DoS), not throttle/backoff | 4.3, 3.4 | §8 |
| **AUTH-4** | 🟠 | Password uses scrypt w/ unpinned defaults, not the design-named argon2id w/ pinned params | 4.1 | §8, §13 |
| **AUTH-5** | 🟠 | Production-only admin gate fails **open** when `VERCEL_ENV` is unset | 4.3 | §8, §11 |
| **AUTH-6** | 🟡 | Bootstrap helper isn't the named `npm run hash-password`; conflates pw+TOTP; no recovery script | 4.1, 0.3, 7.1 | §8 |
| **AUTH-7** | 🟡 | `totp_used_steps` never pruned — unbounded growth | 4.2 | §5 |
| **AUTH-8** | 🟡 | `.env.test` `ADMIN_PASSWORD_HASH=placeholder-set-in-task-4` is a dangling promise no task fulfills | 0.3 vs 4.x | §8, §13 |
| **RL-1** | 🟠 | Limiter keys per raw slug → unbounded `rate_limits` rows from a random-slug spray (no manifest bucketing) | 3.4 | §9, §5, §13 |
| **RL-2** | 🟠 | Global high-water circuit-breaker limiter missing (plan explicitly declines it, citing stale §9) | 3.4 | §9 |
| **RL-3** | 🟠 | No-valid-cookie clean-load failures are never limited (limiter only inside `?code=` branch) | 3.2, 3.4 | §9 |
| **RL-4** | 🟠 | `rate_limits` increment is read-then-write, not atomic `ON CONFLICT … count = count + 1` | 3.4 | §5, §13 |
| **RL-5** | 🟡 | Limiter windows compared on JS wall-clock; `RateStore` interface structurally prevents DB-`now()` | 3.4, 4.3 | §5 |
| **RL-6** | 🟡 ⟲ | Limiter fail-**open** on DB error is undocumented as intentional (defensible, but should be explicit) | 3.4, 4.3 | §3, §9 |
| **ENV-1** | 🔴 | Preview never gates `/a/*` — a leaked preview URL serves real confidential asset HTML | 4.3, 7.1 | §10, §11, §15 Q3, §13 |
| **ENV-2** | 🔴 | Runbook lets the preview Neon DB be **branched from prod** (clones real valid codes into a less-trusted env) | 7.1 | §10, §15 Q3 |
| **MAN-1** | 🔴 | Manifest written to served path `assets/manifest.json`, not a non-served path outside the asset root | 6.2, 5.1, 5.2, conventions | §7 |
| **MAN-2** | 🔴 | No generator registry / slug provenance — build can't reject a hand-crafted word-like 22-char slug | 6.1, 6.2 | §7, §13 |
| **MAN-3** | 🟠 | External-origin scan is a naive `src`/`href` regex framed as hard enforcement (design: advisory lint, CSP is the boundary; broaden surface) | 6.2 | §7, §9, §13 |
| **MAN-4** | 🟠 | No manifest-not-routable deny tests (three URLs must 404) | 3/6 | §7, §13 |
| **OPS-1** | 🟠 | Runbook omits key-ring rotation, exposure-response (revoke+reissue ≠ secret rotation), and export/backup confidentiality | 7.1 | §10, §11 |
| **OPS-2** | 🟡 ⟲ | Runbook omits §3 D4 log-exposure mitigations (short retention, restrict log readers) + Vercel access lockdown | 7.1 | §3, §8 |
| **OPS-3** | 🟡 | `dev` integration branch never established; Task 7.3 merges straight to `main` | 7.1, 7.3 | §11 |
| **SPIKE-1** | 🟠 ⟲ | Phase-1 spike slug `spike00000000000000000000` is **25 chars**, so the spike route's own `{22}` regex 404s its asset — the risk-first gate fails for the wrong reason | 1.1 | §7, §12, §13 |
| **META-1** | 🟠 | Spec pointer path is wrong & points at the *original* design; every `spec §N` + the self-review resolve to the superseded model; §15 absent from coverage map | conventions, self-review | whole REVISED, §15 |
| **META-2** | 🟠 | Phase-0 pitfalls docs seeded from the pre-revision review — omit hashing, non-served manifest, registry, schema-only preview DB, preview gate | 0.1 | §3/§5/§7/§10/§11 |
| **TEST-1** | 🟠 | Missing security/integration tests: no-plaintext-column, atomic redeem under concurrent revoke, concurrent `use_count`, wrong-pw-doesn't-consume-step, DB default, valid-cookie limiter-exempt, spray bucketing | 2–4 | §13 |
| **TEST-2** | 🟠 | Missing route/middleware/action integration tests: precedence, 302→clean→200, traversal-slug reject, expired-cookie re-redeem, admin no-session redirect + preview-inert, login wrong-cred, CSRF bad-Origin | 3.2, 4.3, 5.2 | §13 |
| **TEST-3** | 🟠 | Valid code + missing asset file handled silently — no high-severity log/alert | 3.2 | §13, §6.3 |
| **TEST-4** | 🟡 ⟲ | TOTP ±1 window untested (no adjacent-step accept, matched-step consumed, ±2 reject) | 4.2 | §13, §5 |
| **TEST-5** | 🟡 | Duplicate-slug build check is unreachable dead code (`readdir` can't repeat a name); §13 dup test absent | 6.2 | §7, §13 |
| **PANEL-1** | 🟡 | Code list omits `last_used_at` (a §8-named status field) | 5.2 | §8 |
| **PANEL-2** | 🟡 | Per-code expiry override is duration-only; §2's "absolute date or duration" not implemented | 5.2 | §2, §8 |
| **GEN-1** | 🟡 | `createCode` has no retry-on-unique-violation at generation | 5.1 | §5 |
| **Q1** | 🟡 | §15-Q1 (reusable-code-in-URL) silently foreclosed — query-string hardcoded with no seam | 3.2, 5.2 | §15 Q1, §3 D4 |
| **Q2** | 🟡 | §15-Q2 (sandboxed-iframe) not surfaced — direct top-frame render presented as settled YAGNI | 3.2, self-review | §15 Q2, §14 |
| **Q3** | — | §15-Q3 (preview gating mechanism) — see ENV-1/ENV-2; the *decision* is the owner's, but the gate must exist | 4.3, 7.1 | §15 Q3 |

---

## 🔴 High-severity gaps (detail)

### CODE-1 — Access codes stored in plaintext
The single most important gap; the access code *is* the entire security boundary (§3).
- **Plan:** schema `code: text("code").notNull().unique()` (Task 2.1, line 437); `findByCode` matches `eq(codes.code, code)` (Task 3.2); `createCode` inserts the raw code (Task 5.1); the admin table renders `` `/a/${c.assetSlug}?code=${c.code}` `` **for every row on every load** (Task 5.2, line 1659). Grep confirms **zero** hashing primitives anywhere in the plan.
- **Design:** §5 names the column `code_hash` (SHA-256, unique+indexed); "only its hash is stored — the raw code is never persisted" (§3 D3); redemption "looks up by `SHA-256(code)`" (§6.4); the panel shows "label and status only, never the code value" (§8); §13 mandates a test asserting "no plaintext code column."
- **Impact:** any DB read, backup, or the §11 export silently leaks live, reusable bearer codes, and the admin table re-derives the raw code forever — the exact "hashed at rest, shown once" model is inverted.
- **Fix:** rename to `code_hash`, hash at insert, look up by hash, return the raw code only in-memory from `createCode` for one-time display (see **CODE-2**), drop the code column from the list, regenerate the migration, add the property test. **This finding ripples into CODE-2, TIME-1, TIME-5, TEST-1.**

### TIME-1 — Redemption is not atomic
- **Plan:** `redeemCode` = `findByCode` → `isCodeValid` (JS) → `recordUsage` (a separate unconditional `UPDATE … WHERE id`), Tasks 3.1/3.2. A code revoked between the read and the write is still redeemed (TOCTOU); the increment isn't guarded.
- **Design:** §6.4 mandates **one** conditional statement — `UPDATE codes SET use_count = use_count+1, last_used_at = now() WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at > now() AND asset_slug=$2 RETURNING id, LEAST(now()+interval '24 hours', expires_at) AS cookie_exp` — issue the cookie iff a row returns; fail closed on error.
- **Fix:** replace the three steps with the single guarded UPDATE. This is the linchpin that also delivers TIME-3 (DB time), TIME-4 (`cookie_exp`), and TIME-5 (uniform timing).

### TOK-1 — Token format lacks versioning, key-ring rotation, strict validation
- **Plan:** plain `jose` JWTs, single secret string, HS256; asset payload `{slug, cid}` with `iat`/`exp` from `Date.now()`; the rotation test asserts a rotated-secret token is *rejected* — i.e. flag-day swap, the opposite of a key ring (Task 2.4).
- **Design:** §6.4/§8/§10 require `{v, kid, …}`, canonical encoding, duplicate-key rejection, strict schema validation, and **key rings** (sign current, verify current+previous, reject retired); asset payload binds `{v, kid, slug, code_id, iat, cookie_exp}` with `iat`/`cookie_exp` on **DB** time; §13 tests rotation-window accept + retired-key reject + unknown-`v`/extra-field reject.
- **Fix:** versioned canonical token + `kid`-selected HMAC over a key ring; source `iat`/`cookie_exp` from the atomic UPDATE; update tests.

### HDR-1 / HDR-2 — Incomplete, divergent headers break failure-parity; HSTS absent
- **Plan:** the 302 sets only the cookie; `failurePage()` sets only content-type/referrer-policy/x-robots-tag; `assetHeaders()` sets a superfluous `private` + `no-store` but no Pragma/HSTS/nosniff and an incomplete CSP. The three response classes **diverge**, so failure-vs-failure parity (§6.3) is broken, and **no test** asserts any header set (verification is a manual curl).
- **Design:** §9 mandates the same set on **all** gate responses — bare `Cache-Control: no-store` + `Pragma: no-cache`, `Referrer-Policy`, `X-Robots-Tag`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000`, full CSP; §6.4 says the redirect carries `no-store`; §13 requires a header/cookie coverage suite across redemption/asset/failure/admin. HSTS directly backs the §3 D4 in-transit `?code=` protection.
- **Fix:** route every gate response (302, asset, failure) through one shared header builder; add the coverage test suite. (HDR-3/4/5 fold in: add `object-src/frame-src/worker-src 'none'`, an admin CSP, and nosniff.)

### AUTH-1 — TOTP step consumed on wrong-password attempts
- **Plan:** `login()` computes `okPw` and `okTotp` independently, then rejects; `verifyTotp` calls `store.markUsed(step)` whenever the digits validate — so a wrong-password + valid-TOTP attempt **burns the step** (Task 4.3 lines 1413-1414).
- **Design:** §5 — the matched step "is inserted only after the password also verifies (so a wrong-password attempt can neither burn steps nor probe replay state)"; §13 has the explicit test.
- **Fix:** verify password first; only then call `verifyTotp`. Add the test.

### AUTH-2 — CSRF accepts absent-Origin and compares to Host
- **Plan:** `if (origin && new URL(origin).host !== host) reject` (Tasks 4.3, 5.2). Absent `Origin` ⇒ condition false ⇒ **accepted**, no Referer fallback; when present it compares to the request's own `Host` header, not a pinned origin.
- **Design:** §8 — require `Origin` to equal the **production origin**; if absent, Referer fallback; treat cross-site/malformed/missing-without-fallback as **reject**.
- **Fix:** compare against a configured `PRODUCTION_ORIGIN`; Referer fallback; reject when both absent/malformed.

### AUTH-3 — Login limiter is a single-admin lockout DoS
- **Plan:** `checkRateLimit('login', 10, 5min)` hard-denies on the shared `login` counter; an attacker's wrong-input volume locks out the real admin for the window (Task 4.3).
- **Design:** §8 — single admin ⇒ a hard lockout *is* a DoS; the limiter must throttle/exponentially back off and "MUST NOT lock out on wrong-input volume alone."
- **Fix:** exponential backoff/delay instead of a boolean deny.

### ENV-1 / ENV-2 — Preview serves real confidential assets
- **Plan:** middleware gates only `/admin` on `VERCEL_ENV` (Task 4.3); `/a/*` is served identically on preview. The runbook says "create a separate Neon **branch** for preview" (Task 7.1) — a Neon branch is a copy-on-write clone of prod, so it can contain **real valid codes**. A leaked preview URL + a cloned code = a live door into confidential HTML that's bundled into the preview build.
- **Design:** §10/§11 — "Preview must also gate `/a/*` — admin-only-production is not enough"; preview DB "must be schema-only, never a data clone of prod"; §13 has the preview-gate test. §15 Q3 leaves the *mechanism* an owner choice but the gate must exist.
- **Fix:** add a `VERCEL_ENV !== 'production'` gate to `/a/[slug]` (generic page or preview-secret); rewrite the runbook to provision preview as an empty migrated DB (never branched from prod), verified to hold zero code rows.

### MAN-1 / MAN-2 — Manifest on a served path; no slug provenance
- **Plan:** manifest written to `assets/manifest.json` inside the served asset tree (Task 6.2); `new-asset` mints a slug but writes no registry, and the build checks only shape+duplicates — the shape regex is (incorrectly) called "the D2 backstop" (Task 6.1/6.2).
- **Design:** §7 — write the manifest to a **non-served** path (`.generated/…` or a compiled module), never under `assets/`; `new-asset` appends each token to a committed registry and the build "rejects any asset folder whose slug is not in the registry … The registry check — not the shape check — is what actually closes the D2 backstop." §13 has both the registry-absent build test and the manifest-not-routable deny tests (**MAN-4**).
- **Fix:** relocate the manifest off the served tree; add a `.generated/slugs.json` registry + membership check; add the deny/registry tests.

---

## 🟠 Medium-severity gaps

Grouped; each verified against the file text.

**Time & DB semantics** — **TIME-2** (90-day default should be a DB column default `DEFAULT (now() + interval '90 days')`, not JS), **TIME-3** (all validity/usage comparisons must use DB `now()`, not `new Date()`), **TIME-4** (cookie TTL must be `LEAST(now()+24h, expires_at)`, capped by code expiry — today a 1-hour code still yields a 24-hour cookie), **TIME-5** (once CODE-1+TIME-1 land, unknown-slug and wrong-code must both run the constant-work hashed lookup before the identical failure). **RL-4** (atomic `ON CONFLICT … count+1`).

**Rate limiting** — **RL-1** (bucket malformed/non-manifest slugs into fixed keys + index/prune `window_start`), **RL-2** (add the global high-water circuit-breaker; the plan's scope note wrongly cites §9 to *decline* it), **RL-3** (limit no-valid-cookie clean-load failures; only signature-valid-cookie loads are limiter-exempt — and *limiter*-exempt never means *authorization*-exempt: the DB recheck still runs).

**Auth** — **AUTH-4** (argon2id w/ pinned OWASP params, not scrypt-with-defaults; §13 names argon2id), **AUTH-5** (invert the prod gate to `if (VERCEL_ENV !== 'production') return generic` so "unknown" is inert, not production).

**Headers/CSP** — **HDR-3** (`object-src/frame-src/worker-src 'none'`), **HDR-4** (admin CSP on all `/admin/*`), **HDR-5** (`nosniff`).

**Manifest/pipeline** — **MAN-3** (frame the external-origin scan as advisory with CSP as the boundary; broaden or replace the `src|href` regex to cover `srcset`/CSS `@import`/`url()`/SVG `<use>`/`<meta refresh>`), **MAN-4** (deny tests).

**Environments/ops** — **OPS-1** (runbook: key-ring rotation, exposure-response = revoke+reissue **not** secret rotation, export/backup confidentiality).

**Spike** — **SPIKE-1 ⟲** (`spike00000000000000000000` is 25 chars; the spike route rejects its own asset via the `{22}` regex, so the risk-first bundling gate fails and its troubleshooting misdirects the executor to the tracing glob. Use a real 22-char slug).

**Meta/tests** — **META-1** (repoint the spec link to `.REVISED.`, re-verify every `spec §N`, fix the self-review coverage map, add §15), **META-2** (re-seed the Phase-0 pitfalls docs from the revised design), **TEST-1/2/3** (add the DB-integration, route/middleware/action, and missing-asset-alert tests §13 enumerates), **CODE-2** (implement the show-once code display — without it, hash-at-rest leaves the admin unable to ever obtain a shareable link).

---

## 🟡 Low-severity gaps

**HDR-6** preview-inert `/admin` should reuse the byte-identical generic page · **HDR-7** add the failure page's mandated second sentence · **HDR-8** correct the "§9→P3" self-review claim · **AUTH-6** rename bootstrap to `hash-password` + separate TOTP/recovery script · **AUTH-7** prune `totp_used_steps` · **AUTH-8** fix the dangling `.env.test` password-hash placeholder · **RL-5** move limiter windows onto DB `now()` · **RL-6 ⟲** document the limiter's intentional fail-open (defensible: the *authorization* recheck is the load-bearing fail-closed control) · **OPS-2 ⟲** add D4 log-retention/access-lockdown runbook steps · **OPS-3** establish the `dev` integration branch · **TEST-4 ⟲** test the TOTP ±1 window · **TEST-5** the duplicate-slug check is unreachable dead code · **PANEL-1** show `last_used_at` · **PANEL-2** support absolute-date expiry · **GEN-1** retry `createCode` on unique-violation.

---

## §15 owner decisions (pending — not defects, but the plan silently forecloses them)

The revised design added §15 to record three decisions **you** still own. The plan implements one choice for each with no acknowledgment they're open:

- **Q1 — reusable code in the URL.** Plan hardcodes query-string redemption end-to-end (gate reads `?code=`, admin mints `?code=` links). §15 recommends at least a fragment approach if platform-log leakage matters. **Ask:** keep query-string, or adopt a one-time redemption token / fragment+POST? Regardless, keep a `readCode(req)` seam so switching later doesn't require rewriting the gate + limiter keying.
- **Q2 — sandboxed-iframe rendering.** Plan renders asset HTML directly in the top frame and the self-review calls iframe work settled YAGNI. §15 **promoted** it to a recommended reconsideration (trusted-admin covers malice, not authoring mistakes). **Ask:** direct render now, or sandbox before onboarding any not-hand-authored asset?
- **Q3 — preview gating mechanism.** The *decision* (generic page vs preview-secret) is yours, but per ENV-1 the gate must exist in some form, and per ENV-2 the preview DB must be schema-only regardless.

---

## What the plan already gets right

Worth preserving through any rework: the **risk-first Phase 1 bundling spike** (correct instinct, just fix SPIKE-1); **fail-closed** on the per-load DB recheck (`recheckCode` try/catch → false); the **redemption-redirect** shape that strips `?code=` and never logs it; **HttpOnly/Secure/SameSite=Lax** asset cookie with `Path=/a/<slug>` and 22-char slug enforcement; **byte-identical single `failurePage()`** reused across failures; TOTP replay via `onConflictDoNothing().returning()`; **per-slug (not per-IP)** limiting and **not** adding per-IP; production-only admin intent; the TDD-per-task discipline, Living Document Contract, and the ≥3-round phase-completion gates. The architecture is sound — the gaps are almost all "the design moved and the plan didn't."

---

## Recommended remediation

The findings interlock, so patch by dependency rather than by severity:

1. **META-1 first** — repoint the spec to `.REVISED.md` and re-read it; otherwise fixes drift back. Then **META-2** (re-seed pitfalls docs).
2. **The CODE-1 → TIME-1 cluster** as one change: `code_hash` schema + the single atomic `UPDATE … RETURNING id, cookie_exp` + DB-time defaults/comparisons + `readCode` seam. This one edit resolves CODE-1, TIME-1..5, RL-4/RL-5, and unblocks CODE-2 and TEST-1.
3. **TOK-1** (versioned canonical token + key ring) — pairs with the `cookie_exp`/`iat` DB sourcing from step 2.
4. **The HDR cluster** — one shared header builder → HDR-1..5,7 + TEST (header suite).
5. **The AUTH cluster** — TOTP ordering, CSRF, login backoff, argon2id, prod-gate inversion.
6. **The ENV/MAN cluster** — preview `/a/*` gate + schema-only preview DB + non-served manifest + generator registry + deny tests.
7. **OPS + remaining tests + lows + surface §15.**

Because ~40 of 53 gaps are "re-derive this task against the revised design," the highest-leverage option is to **regenerate the plan from the `.REVISED.` spec** (re-running the plan-authoring + plan-review-cycle against the authoritative doc) rather than hand-patching 53 sites — the plan's *structure* is good; its *content* is a snapshot of a superseded spec. I can do either: apply the patch list above to the existing plan, or regenerate it. Say which and I'll proceed.

---

## Appendix — method

6 Opus dimension-finders (data-model, gate/tokens, headers/CSP, admin-auth/panel, rate-limit/abuse, pipeline/env/tests/meta) over both full documents → Sonnet merge/dedupe (76 raw → 40 unique) → per-finding adversarial verification (Sonnet, Opus for high-severity) → Fable completeness critic (+13, 10 confirmed). The verification layer had a reliability failure (documents surfaced as "undefined" to ~30 verifiers; one reviewed an unrelated repo); those verdicts were discarded and **all findings were re-grounded against the file text in the main loop** — grep, character counts, and line citations — before inclusion here. Refuted-then-reinstated findings are marked ⟲.
