# Product

## Register

product

## Users

- **The admin (owner, single person):** mints and revokes per-recipient access codes in a small
  panel behind Cloudflare Access. In a work context, moving fast; the panel is a utility visited
  for thirty seconds at a time.
- **Recipients (external business contacts):** open a one-time link (`/a/<slug>?code=…`) sent to
  them privately. They see either the shared asset itself (author-styled, out of scope) or the
  generic failure page. They never see navigation, branding beyond the site's mark, or any hint of
  what else exists.

## Product Purpose

A single-admin gated sharing site (Cloudflare Worker + D1) for confidential self-contained HTML
assets. Codes are revocable at any time; every surface fails closed to one indistinguishable
generic page. Success = the admin trusts the panel at a glance and recipients experience quiet
competence, not a hobby page.

## Brand Personality

Discreet, precise, trustworthy. Mood: **"a wax seal on archival paper"** — a private courier, not
a SaaS. One deep crimson accent (the seal) against calm neutral surfaces; everything else stays
out of the way.

## Anti-references

- 1995 bare-HTML default styling (the current state — explicitly rejected by the owner).
- SaaS-cream landing-page slop: gradient text, eyebrow kickers, hero metrics, icon-card grids.
- Anything that advertises, enumerates, or invites probing. The public surfaces must feel like a
  closed door, politely.

## Design Principles

1. **Quiet by default.** Public pages state the minimum and stop. No links, no lists, nothing to
   enumerate (spec §9 is a hard constraint, not a style choice).
2. **The tool disappears into the task.** The admin panel uses earned familiarity: standard form
   controls, a dense readable table, no invented affordances.
3. **Failure looks composed.** The generic failure page is a first-class design surface — byte-
   identical everywhere (spec invariant), calm, blameless copy.
4. **One accent, used semantically.** Crimson marks identity, the primary action, and revocation
   state. It is never decoration.
5. **Constraints are the aesthetic.** Strict CSP (no external fonts/scripts/images, hashed inline
   styles), system font stacks, no client JS. Design within them rather than fighting them.

## Accessibility & Inclusion

WCAG 2.2 AA: ≥4.5:1 body contrast in both schemes, visible labels (not placeholder-only), focus
rings, dark mode via `prefers-color-scheme`, `prefers-reduced-motion` honored, semantic HTML that
works with no JavaScript at all.
