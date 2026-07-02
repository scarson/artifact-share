# Design Review — Gated Asset Sharing Site

**Reviewed doc:** `2026-07-01-gated-asset-sharing-site-design.md`
**Revised (hardened) doc:** `2026-07-01-gated-asset-sharing-site-design.REVISED.md`
**Review date:** 2026-07-01
**Method:** `plan-review-cycle` adapted for a design spec — depth: *security-critical*.

## Methodology

Adversarial multi-round review, alternating the runner (Claude Opus 4.8) with an **independent
cross-provider reviewer (OpenAI `codex`, GPT-5-class, high reasoning)** on every even round, per the
skill's cross-provider requirement. Dimensions checked each round: security correctness, internal
consistency, implementer ambiguity/latitude, cross-section dependencies, and missing cases — applied
to a design doc rather than a subagent task plan.

The original was left untouched. Fixes were applied to the `.REVISED.md` copy. Owner-level tradeoffs
(where a decision was already consciously made) were **surfaced in a new §15, not silently changed.**

| Round | Reviewer | Findings | Notes |
|---|---|---|---|
| 1 | Runner (Opus) | 17 | First pass — plaintext codes, log leakage, caching, manifest exposure, password KDF, timing, etc. |
| 2 | **Independent — codex (cross-provider), cold read** | ~26 (5 high) | Most productive round. New issues *and* challenged 2 of Round 1's fixes. |
| 3 | Runner (Opus) | 2 new substantive + ~6 consistency | Admin-response CSP; single-admin login-lockout DoS; plus fixing drift my own edits caused. |
| 4 | **Independent — codex (cross-provider), focused** | 5 (2 med, 3 low) | Caught contradictions the heavy editing introduced (esp. cookie-expiry time source). |
| 5 | Runner (Opus) | 1 cosmetic | `code-id`→`code_id` naming drift only. |
| 6 | **Independent — codex (cross-provider)** | **0 — `NO SUBSTANTIVE FINDINGS`** | Converged. |

6 rounds (min. 3 required), alternating, cross-provider on all even rounds, landing on a genuine
zero-finding independent round.

---

## Findings & resolutions

Severity is the reviewer's; **Resolution** is the runner's decision after critical evaluation (not
blind acceptance — two Round-1 fixes were later *reverted* on the independent reviewer's challenge).

### High — security-significant

| # | Finding | Resolution |
|---|---|---|
| H1 | **Access codes stored in plaintext** while the admin password is hashed. A DB read / backup / the §11 export leaks all live codes. | **Fixed.** Store `SHA-256(code)` only; raw code never persisted, shown once at creation (§3 D3, §5, §8). |
| H2 | **The reusable code rides in the URL query string** (`?code=`) → captured by platform logs, browser history/sync, link scanners, unfurlers, proxies. Original doc under-stated this and over-trusted "only code-minters read logs." | **Honesty fixed + escalated.** §3 D4 now enumerates the full surface and drops the over-confident claim; **§15 Q1** offers two alternatives (one-time redemption token; fragment+POST) as an **owner decision** — not silently changed, since it conflicts with the reusable-link decision (§2). |
| H3 | **CSP top-nav exfiltration residual** justified by "trusted admin" — but that covers malice, not authoring mistakes / copied 3rd-party snippets. | **Honesty fixed + escalated.** §3/§9 reworded; sandboxed-iframe promoted from §14-future to **§15 Q2 recommended reconsideration**. |
| H4 | **No Cache-Control** → confidential asset HTML cached to disk on shared machines. | **Fixed.** `Cache-Control: no-store` (+`Pragma`) on all gate responses (§6/§9). |
| H5 | **Manifest (slug→client-identity map) exposure not prevented**, and it was generated *inside* the served asset tree (`assets/manifest.json`). | **Fixed.** Manifest moved to a non-served path (`.generated/…`), server-only, with deny-tests (§7/§13). |
| H6 | **Admin password hashing under-specified** ("hash + constant-time compare" ⇒ fast hash) — offline-brute-forceable if it leaks. | **Fixed.** argon2id (memory-hard) with pinned OWASP params; `hash-password` bootstrap helper (§8). |
| H7 | **Preview serves `/a/*` with branch-bundled confidential assets**; a Neon *branch* DB may be a copy of prod's codes → a leaked preview URL is a live door. (Admin-only-production doesn't cover this.) | **Fixed + escalated.** §10/§11 require a **schema-only preview DB (never branched from prod)** and gating `/a/*` on preview; **§15 Q3** records the exact gating choice as an owner decision. |
| H8 | **External-origin build scanner presented as enforcement** but a regex can't catch `srcset`/CSS `@import`/SVG/`meta refresh`/import maps/runtime JS → false confidence. | **Fixed.** Reframed as an **advisory lint; CSP is the boundary** (§7/§9); expanded tested surfaces (§13). |

### Medium

| # | Finding | Resolution |
|---|---|---|
| M1 | **Timing oracle** despite byte-identical failure body (unknown-slug could short-circuit before the code lookup). | **Fixed.** Uniform code path + an explicit **timing-distinction taxonomy** (must-be-uniform vs accepted vs not-reachable) (§6 step 3). |
| M2 | **"Friendlier message" for lapsed cookies = a cookie-validity oracle** (this was a *Round-1 runner fix* that the independent reviewer rightly challenged). | **Reverted.** Replaced with static, generic-but-helpful copy on the **single byte-identical** failure page — helps the legit user, breaks parity for no one (§6 step 5). |
| M3 | **Global rate limiter = self-inflicted DoS**; and could deny already-authenticated viewers. | **Fixed.** Valid-cookie loads are **limiter-exempt (not authorization-exempt)**; limiter targets unauthenticated traffic; per-slug is primary (§9). |
| M4 | **Rate-limit row-cardinality DoS** — spraying random slugs mints unbounded Postgres rows. | **Fixed.** Bucket malformed/non-manifest slugs into a small fixed key set; only manifest slugs get their own bucket (§9). |
| M5 | **Redemption ordering not transactional** — a DB failure could issue access without recording, or vice-versa. | **Fixed.** Single conditional `UPDATE … RETURNING`; cookie issued iff a row returns; fail-closed on error (§6 step 4). |
| M6 | **Cookie/session token format under-specified** — no version, `kid`, canonical encoding, strict validation → canonicalization/rotation bypass risk. | **Fixed.** Versioned `{v,kid,…}`, canonical encoding, HMAC-SHA256, strict schema, length-check-then-constant-time; duplicate-key rejection caveat (§6/§8). |
| M7 | **Secret rotation was flag-day**; and rotating the cookie secret was conflated with the response to code exposure. | **Fixed.** `kid` **key rings** (verify current+previous, retire old); exposure response = **revoke+reissue codes**, not rotate secret (§10). |
| M8 | **Backups/exports still leak client identities** (labels, slug↔label, sharing graph) even with hashed codes. | **Fixed.** Classified exports confidential: encrypt, restrict, retention, minimal labels (§11). |
| M9 | **CSRF policy vague** (`Origin`/`Sec-Fetch-Site` unspecified). | **Fixed.** Exact accept/reject policy; `Origin`=prod, documented `Referer` fallback, reject otherwise (§8). |
| M10 | **Session expiry only a cookie attribute**, not in the signed payload. | **Fixed.** `{v,kid,iat,exp}` signed; enforced server-side (§8). |
| M11 | **Missing-asset-file for a valid code returns generic page silently** — hides an integrity failure. | **Fixed.** Same page to the recipient **plus a high-severity server alert** (§13). |
| M12 | **TOTP replay keying / consume timing under-specified** (which step; consumed before password check?). | **Fixed.** Consume the **exact matched step only after the password verifies**; single-admin keying noted (§5/§8). |
| M13 | **`cookie_exp` computed on serverless wall-clock**, contradicting the DB-single-time-source rule (Round-4 catch on a Round-2 edit). | **Fixed.** `cookie_exp` is **DB-returned** (`LEAST(now()+interval '24h', expires_at)`) from the atomic UPDATE (§6 step 4). |

### Low / clarity / consistency

- Missing headers: **HSTS** (with `includeSubDomains` caveat), **`X-Content-Type-Options: nosniff`**, explicit **`object-src`/`frame-src`/`worker-src 'none'`** (§9). **Fixed.**
- **DB time source / `TIMESTAMPTZ`**: corrected a Round-1 error (Postgres *can* default to `now()+interval`); all time columns `TIMESTAMPTZ`, compared on DB `now()` (§5). **Fixed.**
- **Generator registry** backstop so a human can't hand-create a word-like 22-char slug that passes the shape regex but leaks identity (§7). **Fixed.**
- **Admin-response CSP** (the asset CSP was scoped to asset responses only) (§9). **Fixed.**
- **Single-admin login-lockout DoS** → throttle/backoff, not hard lock (§8). **Fixed.**
- argon2id concrete params; code-hash generation collision retry; `code_id` naming consistency; §12/§13 updated to match all mechanism changes; stale "check-then-write" test wording reworded. **Fixed.**

---

## Owner decisions to make (see §15 of the revised doc)

The review deliberately did **not** overturn decisions you already made. These three are surfaced for
an explicit call:

1. **Reusable code in the URL (§15 Q1).** Keep the simple query-string model (accept the broad
   leakage surface, rely on revoke+reissue) — or adopt a one-time redemption token / fragment+POST
   to remove the reusable code from the URL, at the cost of the pure reusable-link / no-JS property.
   *Reviewer lean: at least the fragment approach if platform-log leakage matters.*
2. **Sandboxed-iframe rendering (§15 Q2).** The structural fix for the top-nav exfiltration residual.
   *Reviewer lean: build it before onboarding any asset you didn't hand-author end-to-end.*
3. **How to gate `/a/*` on preview (§15 Q3).** Production-gate `/a/*`, a preview shared secret, or
   accept-but-don't-publish-sensitive-via-PR-previews. In all cases the preview DB must be
   schema-only, never branched from prod.

---

## Notes

- The working directory is **not a git repository**, so the reviewed doc was not committed (the
  skill's final commit step doesn't apply). Both deliverables are in `~/Downloads/`.
- The revised doc grew from 303 to ~540 lines — the additions are hardening detail and the new §15,
  not scope creep; the original architecture and every accepted tradeoff are preserved.
