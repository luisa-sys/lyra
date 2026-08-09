# KAN-419 — Path-coupling inventory

**Spike · research artefact · read-only · epic KAN-414**
**Produced:** 2026-07-27 · **Base:** `develop` · **Tracked files at scan time:** 791

> **What this is.** A complete register of every path literal and glob in Lyra's
> verification and documentation estate, each one classified LIVE (matches ≥1
> tracked file today) or DEAD (matches nothing — a control that is not
> operating). Plus the specification for `scripts/check-guard-path-drift.sh`,
> the detector that must land *before* the first extraction PR.
>
> **Reproduce everything here with:**
> ```bash
> python3 docs/modularisation/kan419-scan.py          # the register
> python3 docs/modularisation/kan419-scan.py --dead    # dead patterns only
> python3 docs/modularisation/kan419-scan.py --json    # machine-readable
> ```
> The scanner reads its patterns *out of the live artefacts*, so it cannot drift
> from what it audits. It is deliberately **not** wired into CI — it is evidence,
> not a gate. The gate is specified in §6 and implemented by F1.

---

## 0. Headline

**124 path patterns across 18 artefacts. 120 LIVE, 4 DEAD.**
None of the 4 dead patterns is a lost security control (§3) — a genuinely good
result, and one worth having verified rather than assumed.

**The single most important finding is not a dead pattern. It is this:**

```
$ printf 'src/app/(auth)/signup/page.tsx\nsrc/lib/age/declaration.ts\n' > /tmp/now.txt
$ bash scripts/check-signup-surface-gate.sh --files /tmp/now.txt
RESULT: TOUCHED — the following changes hit the sign-up surface:
  - src/app/(auth)/signup/page.tsx
  - src/lib/age/declaration.ts
→ the un-skippable signup E2E is REQUIRED and must pass for this promotion.
exit=10

$ printf 'src/modules/auth/ui/signup/page.tsx\nsrc/modules/age/declaration.ts\n' > /tmp/after.txt
$ bash scripts/check-signup-surface-gate.sh --files /tmp/after.txt
RESULT: CLEAN — no sign-up-surface path touched; signup E2E not required this promotion.
exit=0
```

The **identical semantic change** — editing the signup form and the 18+
declaration — goes from *gate fires* (exit 10) to *gate silently disarmed*
(exit 0) the moment D6 lands. The gate does not fail, warn, or log. It reports
CLEAN. And per its own header it is the **only** thing proving account creation
still works before it reaches staging, because the daily soak deliberately uses a
persistent reset-user and never exercises signup.

This is the whole justification for the spike, and it is now demonstrated rather
than asserted.

---

## 1. The register — inventory by artefact

Full machine-readable form: `python3 docs/modularisation/kan419-scan.py --json`.
`Matches` = number of tracked files the pattern resolves to today.

### A. The five CI policy gates (original scope)

#### A1 · `.github/signup-surface.paths` — 14 patterns, 14 LIVE

Syntax: **bash `case $f in $g)` glob**, so `*` matches *across* `/`. Plus one
extra rule in `matches_glob()`: a trailing `/**` also matches the directory
prefix at any depth. Comments (`#`) and blank lines stripped.

| Pattern | Matches | Status |
|---|---:|---|
| `src/app/(auth)/signup/**` | 2 | LIVE |
| `src/app/(auth)/actions.ts` | 1 | LIVE |
| `src/app/(auth)/auth-errors.ts` | 1 | LIVE |
| `src/app/(auth)/social-login-buttons.tsx` | 1 | LIVE |
| `src/app/auth/confirm/**` | 1 | LIVE |
| `src/app/auth/callback/**` | 1 | LIVE |
| `src/lib/auth/**` | 1 | LIVE |
| `src/lib/age/**` | 5 | LIVE |
| `src/lib/beta-access/**` | 4 | LIVE |
| `src/modules/platform/supabase-server.ts` | 1 | LIVE |
| `src/modules/platform/supabase-service.ts` | 1 | LIVE |
| `src/modules/platform/env.ts` | 1 | LIVE |
| `src/middleware.ts` | 1 | LIVE |
| `supabase/migrations/**` | 73 | LIVE (content-filtered) |

**Verified sub-finding — the `(auth)` route-group parens do *not* break the
matcher.** An unquoted `(` in a bash `case` pattern was a plausible silent
failure (it could have terminated the pattern early). It was tested directly
against the real `matches_glob()` and all four `(auth)` entries match. Recorded
so no later phase re-litigates it.

**100% of the non-migration entries move.** See §4 for the module-term rewrite.

#### A2 · `.github/CODEOWNERS` — 17 patterns, 17 LIVE

Syntax: **gitignore-style, leading `/` anchors to repo root.**

| Pattern | Matches | | Pattern | Matches |
|---|---:|---|---|---:|
| `*` | 791 | | `/supabase/migrations/` | 73 |
| `/src/app/(auth)/` | 8 | | `/.github/workflows/` | 37 |
| `/src/app/oauth/` | 6 | | `/scripts/` | 47 |
| `/src/lib/oauth/` | 10 | | `/vercel.json` | 1 |
| `/src/lib/beta-access/` | 4 | | `/wrangler.toml` | 1 |
| `/src/app/admin/` | 20 | | `/.github/CODEOWNERS` | 1 |
| `/src/modules/platform/cookie-domain.ts` | 1 | | `/SECURITY.md` | 1 |
| `/src/modules/platform/env.ts` | 1 | | `/docs/compliance/` | 7 |
| | | | `/CLAUDE.md` | 1 |

**Move-exposure: 8 of 17.** The eight security-critical `/src/…` rules all move
under extraction. The `*` catch-all keeps @luisa-sys as default owner, so a
moved file is never *unowned* — but it loses its **security-critical
designation**, which is the thing SEC-3/GOV-01 actually bought. That degradation
is silent: CODEOWNERS never errors on a rule that matches nothing.

#### A3 · `scripts/check-ui-copy-ownership.sh` — 20 patterns, 19 LIVE, 1 DEAD

Syntax: **bash `[[ $f == pat ]]`** — again `*` crosses `/`. Four carve-outs
(checked first, they win) and sixteen protected patterns.

Carve-outs: `src/app/admin/*` (20), `src/app/api/*` (16), `*/route.ts` (23),
`src/middleware.ts` (1) — all LIVE.

Protected: `src/lib/invite-text.ts` (1), `src/lib/convene/invites/templates.ts`
(1), `src/lib/convene/invites/sms-templates.ts` (1),
`src/lib/beta-access/email.ts` (1),
`src/app/dashboard/profile/affiliation-fields.ts` (1),
`src/app/dashboard/convene/organise/organise-fields.ts` (1), `src/*.css` (1),
`postcss.config.*` (1), **`tailwind.config.*` (0 — DEAD, see §3)**,
`public/lyra-logo*` (3), `public/lyra-icon-*` (6), `public/og-image.png` (1),
`public/manifest.webmanifest` (1), `public/offline.html` (1),
`src/app/*.tsx` (97), `src/components/*` (1).

**Move-exposure: high, and the carve-outs are the dangerous half.** If
`src/app/api/*` stops matching after extraction, the guard becomes *more*
aggressive (false positives — annoying, safe). But if `src/app/*.tsx` (97 files,
the bulk of the founder-owned surface) stops matching, the guard goes silent on
almost everything it exists to protect. Asymmetric risk: **the protected
patterns are the ones that must be drift-checked.**

#### A4 · `scripts/check-service-role-client.sh` — 2 literals, 2 LIVE

`src/` (grep root, 274 files) and the factory literal
`src/modules/platform/supabase-service.ts` (1). Guard passes today (exit 0, verified).

**Move-exposure: both.** If the factory moves to `modules/platform/` and the
`FACTORY` literal is not updated, the factory's *own* legal call site becomes a
violation — this one **fails loud** (a false positive), which is the safe
direction. If `src/` becomes `src/modules/`, the grep root still covers it.

#### A5 · `stryker.config.mjs` — 2 literals, 2 LIVE

`mutate: ['src/app/(auth)/actions.ts', 'src/lib/sanitise.ts']`.

**Move-exposure: both, and this one is the quietest failure in the estate.**
Stryker with a `mutate` list that matches nothing does not error — it reports a
mutation score over zero mutants. `thresholds.break` is `null`, so the workflow
stays green either way. Mutation coverage of the two most security-sensitive
modules would drop to nothing with no signal at all.

### B. Signup-surface manifest — see §4 for the rewrite.

### C. Out-of-repo couplings — see §5.

### D. Docs, runbooks, mirrors — and the step-4 sweep

The sweep of `.github/**`, `scripts/**`, `docs/**` and the root configs found
**thirteen further path-classifying artefacts** beyond the ticket's A–D list:

| Artefact | Syntax | Patterns | Status |
|---|---|---:|---|
| `scripts/check-routine-ownership.sh` | exact bash literal + content needle | 11 | 11 LIVE |
| `scripts/check-server-action-exports.sh` | grep root | 1 (`src/`) | LIVE (274) |
| `scripts/check-codeowners-single.sh` | exact candidates | 3 | 1 LIVE, 2 DEAD-BY-DESIGN |
| `docs/DOC_SOURCE_OF_TRUTH.md` (manifest block) | backtick repo path | 9 | 9 LIVE |
| `.github/workflows/*.yml` | shell literal `bash scripts/X` | 30 | 30 LIVE |
| `.github/workflows/lyra-maintenance-deploy.yml` | Actions `paths:` filter | 3 | 3 LIVE |
| `.github/workflows/pr-checks.yml` | anchored `grep -E` on changed paths | 1 | LIVE (325) |
| `tsconfig.json` | TS path mapping `@/*` → `./src/*` | 1 | LIVE |
| `jest.config.js` | `collectCoverageFrom` glob | 1 | LIVE (272) |
| `package.json` | `jest --testPathPatterns` regex | 3 | 2 LIVE, **1 DEAD** |
| `eslint.config.mjs` | flat-config globs | 3 | 3 LIVE |
| `playwright.config.ts` | `testDir` literal | 1 | LIVE (12) |
| `playwright.config.ts` | `testMatch`/`testIgnore` regex | 3 | 3 LIVE |

Two of these deserve calling out.

**`scripts/check-routine-ownership.sh` is doubly coupled.** Each of its 11
`check_marker` calls pairs a *file literal* with a *verbatim content needle*
(`grep -qF`). A file move breaks the path half; a doc rewording breaks the
content half. It is the only guard in the estate that fails on *both* axes.
Notably one of its markers is `check_marker ".github/signup-surface.paths"
"src/app/(auth)/signup/**"` — so the routine-ownership guard **already asserts a
specific signup-manifest glob verbatim**. The §4 rewrite must update this needle
in the same PR or the guard goes red. (That is the safe direction — loud, not
silent — but it must be sequenced.)

**`scripts/check-doc-mirror-manifest.sh` is already a path-drift detector.** It
fails the PR if any path listed in `docs/DOC_SOURCE_OF_TRUTH.md`'s manifest
block is missing from the repo (verified: "all 9 listed mirror(s) present",
exit 0). It is the existing precedent for the guard specified in §6 — the new
guard generalises this one artefact's behaviour to the whole estate, and should
match its idiom rather than invent a new one.

**Doc prose is *not* covered by any detector, and has already rotted.** A sweep
of all 57 `docs/**/*.md` found **110 distinct repo-path literals, 20 of which
match nothing today (18%)**. Most are benign — deliberately-removed files
documented as removed (`src/app/dashboard/loading.tsx`, `src/app/**/loading.*` —
BUGS-63/66), cross-repo MCP paths cited in a lyra doc (`src/index.ts`,
`tests/mcp-rate-limit.test.cjs`), or package names that look like paths
(`supabase/ssr`). A handful are real drift (`src/sanitise.ts` in
`docs/ARCHITECTURE.md` — the file is `src/lib/sanitise.ts`; `src/lib/age/gate.ts`
in `docs/TEST_RUNBOOK_SIGNUP_ACCESS_AGE_PUBLISH.md`).

This is the empirical case for the guard: **an unguarded path reference layer
rots at ~18% before anyone moves a file on purpose.** It is not, however, a
security finding — see §3. Reproduce with the command block in
`kan419-scan.py`'s header plus the doc sweep recorded in this section.

---

## 2. Guard liveness — verified, not assumed

Every runnable guard was executed read-only against `develop` at scan time:

| Guard | Exit | Result |
|---|---:|---|
| `check-routine-ownership.sh` | 0 | PASS — all KAN-361 markers present |
| `check-service-role-client.sh` | 0 | All service-role clients go through the factory |
| `check-server-action-exports.sh` | 0 | All `'use server'` files export only async functions |
| `check-codeowners-single.sh` | 0 | Exactly one CODEOWNERS (`.github/`) with a default owner |
| `check-doc-mirror-manifest.sh` | 0 | All 9 listed mirrors present |
| `check-macos-duplicate-files.sh` | 0 | No Finder-duplicate files committed |
| `check-signup-surface-gate.sh` | 10 | Correctly fires on today's signup paths |

**The estate is healthy today.** That is precisely why the detector must land
before the first extraction and not after — there is a working baseline to
protect.

---

## 3. Dead patterns and their disposition

Four patterns match nothing. The acceptance criterion asks that each be raised
as a SEC finding. Having examined all four, **none is a lost control**, and
filing four SEC tickets would be noise that devalues the register. The evidence
for each verdict:

| # | Artefact → pattern | Verdict | Evidence |
|---|---|---|---|
| 1 | `check-ui-copy-ownership.sh` → `tailwind.config.*` | **DEAD-BY-DESIGN (forward-looking)** — no SEC ticket | Tailwind v4 is CSS-first; `package.json` has `tailwindcss ^4.3.2` + `@tailwindcss/postcss`, and `postcss.config.mjs` loads it. `git ls-files \| grep -i tailwind` → no config file exists. The surface it would protect (design tokens) *is* covered by `src/*.css` (LIVE, → `src/app/globals.css`). The entry is a correct defensive stub for "if someone adds a Tailwind config, it is founder-owned". |
| 2 | `check-codeowners-single.sh` → `CODEOWNERS` | **DEAD-BY-DESIGN (asserted absent)** — no SEC ticket | The guard's *purpose* is to fail if more than one CODEOWNERS exists. Root and `docs/` candidates matching nothing is the guard **passing**. |
| 3 | `check-codeowners-single.sh` → `docs/CODEOWNERS` | as above | as above |
| 4 | `package.json` → `--testPathPatterns=tests/integration` | **DEAD — real, but test-estate hygiene, not a control** | `git ls-files tests/integration \| wc -l` → **0**. `tests/` contains only `e2e/`, `fixtures/`, `scripts/`, `unit/`. So `npm run test:integration` (and therefore `npm run test:all`) targets a directory that does not exist. It is **not in CI** — `pr-checks.yml` runs `npm run test:unit` only — so no gate is silently inert. `docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md` also references `tests/integration/`. |

**Honest limitation:** jest's exit behaviour with zero matching tests could not
be confirmed in this session — `node_modules` is not installed in the routine's
container, so `npx jest --testPathPatterns=tests/integration` fails at transform
resolution (`Module @swc/jest … not found`) rather than reaching the "no tests
found" path. The *directory-absent* fact is fully verified; the *what-jest-does*
question is not, and is left open rather than guessed.

**Disposition:** finding 4 is handed to **KAN-417** (R2, test-decoupling
strategy) which owns the test-estate categorisation, rather than raised as SEC.
Findings 1–3 are recorded here and need no ticket. **No SEC ticket is raised by
this spike.**

---

## 4. `.github/signup-surface.paths` — proposed module-term rewrite

Mapped entry-by-entry to the target module set. The gate's own header directive
— *"Keep this list broad — 'could be impacted in any way' beats 'definitely
breaks it'"* — is preserved: module-level globs are **broader** than today's file
list, which is the correct direction for this gate.

| # | Current glob | Matches today | Target module | Proposed glob |
|---:|---|---:|---|---|
| 1 | `src/app/(auth)/signup/**` | 2 | `auth` | `src/modules/auth/**` |
| 2 | `src/app/(auth)/actions.ts` | 1 | `auth` | *(subsumed by #1)* |
| 3 | `src/app/(auth)/auth-errors.ts` | 1 | `auth` | *(subsumed by #1)* |
| 4 | `src/app/(auth)/social-login-buttons.tsx` | 1 | `auth` | *(subsumed by #1)* |
| 5 | `src/app/auth/confirm/**` | 1 | `auth` | *(subsumed by #1)* |
| 6 | `src/app/auth/callback/**` | 1 | `auth` | *(subsumed by #1)* |
| 7 | `src/lib/auth/**` | 1 | `auth` | *(subsumed by #1)* |
| 8 | `src/lib/age/**` | 5 | `age` | `src/modules/age/**` |
| 9 | `src/lib/beta-access/**` | 4 | `access` | `src/modules/access/**` |
| 10 | `src/modules/platform/supabase-server.ts` | 1 | `platform` | `src/modules/platform/**` |
| 11 | `src/modules/platform/supabase-service.ts` | 1 | `platform` | *(subsumed by #10)* |
| 12 | `src/modules/platform/env.ts` | 1 | `platform` | *(subsumed by #10)* |
| 13 | `src/middleware.ts` | 1 | — (stays) | `src/middleware.ts` — unchanged |
| 14 | `supabase/migrations/**` | 73 | — (stays) | `supabase/migrations/**` — unchanged, content-filtered |

**Result: 14 file-globs → 6 module-globs.** Route-composition shells that remain
under `src/app/(auth)/` after extraction (thin pages that re-export from
`modules/auth`) must keep a matching entry — so the rewritten manifest should
retain `src/app/(auth)/**` alongside `src/modules/auth/**` rather than replacing
it. **Broader is correct here.**

### Sequencing constraints (both must hold, or the gate is inert mid-flight)

1. **The manifest rewrite lands in the same PR as the move.** A PR that moves
   `src/lib/age/**` → `src/modules/age/**` without touching the manifest leaves
   the gate blind to the age module from that commit onward.
2. **`scripts/check-routine-ownership.sh` must be updated in lockstep.** Its
   marker asserts the literal string `src/app/(auth)/signup/**` inside
   `.github/signup-surface.paths`. If the rewrite drops that line without
   updating the needle, the ownership guard fails the PR — loud, correct, but it
   *will* happen, so plan for it.
3. **`platform` is the trap.** Entries 10–12 are three separate files today that
   become one module glob. If `platform` extraction (which the plan sequences
   early, as everything depends on it) lands before the manifest rewrite, the
   gate loses the Supabase clients *and* `env.ts` in one commit — and those are
   exactly the files a signup regression would come through.

**Recommendation for KAN-415/D6:** land the rewritten manifest **first**, listing
*both* the current paths and the future module paths simultaneously. Both sets
are then LIVE-or-future and the gate over-fires rather than under-fires during
the transition. Shrink it to module-only terms once the moves are complete. The
drift guard (§6) must therefore tolerate a *deliberately* not-yet-matching
pattern via its escape hatch — this is the primary use case for the marker.

---

## 5. The two out-of-repo couplings — no repo-side grep can see these

> ⚠️ **Corrected 2026-08-04 (KAN-441) — §5.1 only; §5.2 stands unchanged.**
> Three statements below are now false. The correction belongs here rather than
> only in the files that cite it, because `docs/MODULARISATION_EXTRACTION_DOD.md`,
> `docs/RUNBOOK.md` and the PR template all name **"KAN-419 §5.1"** as their
> authority.
>
> 1. **"Neither lives in any repository this CI can read" (§5 below), and
>    "founder's machine, not in git" (§5.1 heading).** The design system **is**
>    in git, at `github.com/luisa-sys/lyra-design-system`. It is a **different**
>    repo, which this repo's CI still cannot read — so §5's conclusion (a human
>    checklist item, never a CI gate *here*) is unchanged and only its *reason* is
>    narrower.
> 2. **"No drift detection between them" (§5.1, "Second problem").** Partly
>    false, and the boundary matters. `check-token-drift.py` in that repo diffs
>    the **Claude Design tokens against `src/app/globals.css`**, and
>    `foundations/tokens.css` mirrors `globals.css` 1:1 — so **that pair is now
>    detected**. It covers **that pair only**. Whether `build.py`'s own copy of
>    the tokens is diffed against anything is **unspecified**, so that leg of the
>    three-way remains undetected. The "three copies" observation stands.
> 3. **"KAN-427 cannot be completed by a cloud session" (the note under §5.1, and
>    the §8 handover row).** The stated reason has gone. Whether KAN-427 is
>    therefore unblocked is **Luisa's call, not a conclusion this document should
>    draw for her** — the diff still spans two repositories, so a cloud session
>    would need both checked out.
>
> Process of record: `docs/DESIGN_CHANGE_WORKFLOW.md`. The canonical-home
> question (fold the two repos together, or not) is **KAN-427 / KAN-457**.

Recorded here so they land in the extraction Definition-of-Done (**KAN-428**) as
human checklist items. **Neither can ever be a CI gate**, because neither lives
in any repository this CI can read.

### 5.1 `~/lyra-design-system/build.py` (founder's machine, not in git)

- Generates 21 `@dsCard` previews for Claude Design project
  `e4682889-26bd-4a88-a7ae-4a9be9cd1632`.
- Reads **`src/app/globals.css`** for design tokens (confirmed: that is the only
  `.css` file tracked in the repo — `git ls-files | grep -E '\.css$'` returns
  exactly one path) and mirrors component markup reconstructed from
  `lyra/develop`.
- **Coupling:** when `ui-kit` extraction moves `globals.css`, the generator's
  source pointer breaks. It breaks *loudly* — but on the founder's machine,
  hours or days later, and nothing warns the agent that moved the file.
- **Second problem:** design tokens now exist in three places — `globals.css`,
  `build.py`, and the published Claude Design project — with **no drift
  detection between them**. Structurally identical to
  `convene-recommend-scoring.ts` being verbatim-copied into the MCP repo (X-3).
  The *contract* question is **KAN-427**'s; this spike records only the coupling.
- **DoD item for KAN-428:** *"If this PR moves `src/app/globals.css` or any file
  under the `ui-kit` module, update the source pointer in
  `~/lyra-design-system/build.py` and re-run it before merge."*

> **Note for the routine that runs this epic:** KAN-427 cannot be completed by a
> cloud session — `build.py` is on the founder's local machine and in no git
> repo. It requires a local Claude Code session. Flagged separately on that
> ticket.
>
> ⚠️ **Corrected 2026-08-04 (KAN-441): the premise above is false** — see item 3
> of the §5 correction banner. The design system is in git; whether that unblocks
> KAN-427 for a cloud session is Luisa's call, since the diff still spans two
> repositories.

### 5.2 The claude.ai routine prompts (routine config, not in git)

- The **Staging Soak** and **Backlog Autopilot** prompts name
  `scripts/staging-soak.sh` and protected-surface path lists **verbatim**.
- These live in claude.ai routine configuration. A repo grep will *never* find
  them; `check-guard-path-drift.sh` will never see them.
- **Confirmed in-repo counterpart:** `scripts/check-ui-copy-ownership.sh` states
  in its own header that its protected list is *"mirrored 1:1 from the
  autopilot's protected-surface list so the guard and the robot agree"*. So the
  repo-side guard and the out-of-repo prompt are a **manually-maintained
  duplicate pair** — the guard is the only half CI can check.
- **DoD item for KAN-428:** *"If this PR changes any protected-surface path list
  or renames a script named in a routine prompt, update the corresponding
  claude.ai routine prompt in the same session and note it in the PR body."*

---

## 6. Section E — confirmed: what is URL-coupled and therefore safe

The ticket asked this be verified rather than assumed. It was.

### E1 · `scripts/staging-soak.sh` — **RESILIENT, confirmed**

Its assertions are URL literals only: `/`, `/api/health`, `/login`, `/signup`,
`/status`. It contains exactly **four** repo-path strings and **all four are in
comments** pointing at docs (`docs/STAGING_SOAK_ROUTINE.md` ×1,
`docs/E2E_AUTHED_CF_BYPASS.md` ×3). Zero functional path coupling. Since the
extraction plan freezes URLs as a live external API, the soak's C1/C2/C4 layer is
unaffected by any file move.

```bash
grep -oE '"/[a-z0-9/{}_-]*"' scripts/staging-soak.sh | sort -u   # → the 5 URLs
grep -nE "(src|tests|docs)/" scripts/staging-soak.sh              # → 4 hits, all comments
```

### E2 · `tests/e2e/**` — **RESILIENT, confirmed**

Twelve tracked files. Grepping the whole tree for `@/` or `src/` returns **two
hits, both in comments** (doc pointers in `support/seed-user.ts` and
`support/mint-session.ts`). The E2E suite has **zero functional coupling to
`src/` paths** — it drives the app over HTTP.

### E3 · `tests/e2e/support/*` helper imports — **checked, safe**

Eleven cross-file imports, all **relative and internal to `tests/e2e/`**
(`../support/supabase-admin`, `./supabase-admin`, `../global-setup`, …). The
extraction plan does not move `tests/e2e/`, so they are untouched. And if it ever
did, they break at **TypeScript compile time** — loud, not silent.

### E4 · `playwright.config.ts` `AUTHED_MATCH` / `SOAK_MATCH` / `SIGNUP_MATCH` — **checked, safe**

All three are **basename regexes** — `/journey\.authed\.spec\.ts/`,
`/journey\.soak\.spec\.ts/`, `/signup\.e2e\.spec\.ts/` — not path patterns. Each
matches exactly one tracked file and would keep matching after any directory
move. The config's one real path literal is `testDir: './tests/e2e'` (12 files),
which the plan does not move.

**Net:** the entire deployed-behaviour verification layer — soak, E2E, smoke — is
**resilient by construction**. The exposure is concentrated in the *static*
layer: the CI policy gates, the mutation config, and doc prose. That is a
significantly better starting position than the epic assumed, and it should
narrow F1's scope accordingly.

### E5 · The one thing that is *not* safe, handed to KAN-417

**174 of 216** tracked files under `tests/unit/` + `tests/scripts/` reference
`src/` or `@/` (80%). These break loudly (module-not-found), not silently, so
they are outside this spike's remit — but the number is the input KAN-417 needs
for its cost model, so it is recorded here rather than re-derived.

```bash
grep -rlE "(@/|\bsrc/)" tests/unit tests/scripts | wc -l   # 174
git ls-files tests/unit tests/scripts | wc -l              # 216
```

---

## 7. Specification — `scripts/check-guard-path-drift.sh`

To be implemented by **F1**, wired as guard #12 in `pr-checks.yml`. Follows the
repo's established guard idiom: a bash script with a rationale header, a
`tests/scripts/` suite, and a `::error::`-annotated failure path.

### 7.1 Contract

> Every path pattern in a registered artefact must match at least one **tracked**
> file, unless explicitly and individually excepted.

### 7.2 Inputs

A registry embedded in the script (not a separate data file — one artefact to
review, matching `check-routine-ownership.sh`'s idiom). Each entry declares:

| Field | Meaning |
|---|---|
| `artefact` | repo-relative path to the file holding the patterns |
| `syntax` | one of `bash-case`, `bash-dbl-bracket`, `codeowners`, `literal`, `glob`, `regex`, `basename-regex` |
| `extractor` | how to get patterns out (line-based, block-delimited, or a named regex) |
| `severity` | `blocking` (default) or `advisory` |

Initial registry = the 18 artefacts in §1. `severity: advisory` is reserved for
the doc-prose sweep, which has a known 18% pre-existing dead rate (§1D) and must
**not** block PRs on day one — see §7.7.

### 7.3 Matching semantics — per artefact, not one-size-fits-all

The seven syntaxes in §7.2 are **not interchangeable**; the register in §1 shows
each artefact using a genuinely different one. Two rules the implementation must
not get wrong:

- **`bash-case` and `bash-dbl-bracket`: `*` matches across `/`.** Standard
  fnmatch does not. Using fnmatch here would make `src/app/*.tsx` report 0
  instead of 97 — a false DEAD on the largest protected pattern in the estate.
- **`bash-case` additionally applies the trailing-`/**`-prefix rule** from
  `check-signup-surface-gate.sh`'s `matches_glob()`. Re-implement it from that
  function, do not approximate it.

`docs/modularisation/kan419-scan.py` is the executable reference implementation
of all seven; F1 should port from it rather than re-derive.

### 7.4 Resolution set

`git ls-files` — **tracked files only.** This is what makes the subtle case work:
a pattern that matches only an untracked or `.gitignore`d file **fails**, because
CI checks out tracked content and the pattern would be inert there.

### 7.5 Exit codes

| Code | Meaning |
|---:|---|
| `0` | every registered pattern matches ≥1 tracked file (or is excepted) |
| `1` | ≥1 pattern matches nothing — **the drift case** |
| `2` | **fail-closed**: an artefact is missing, unreadable, or unparseable |

Exit `2` is distinct and non-negotiable. Per the Workflow & Backup Integrity
Policy, a guard that cannot read its input must **fail the build**, never skip.
There is no `if: env.X != ''` and no `continue-on-error` on this step.

### 7.6 Output

```
::error file=.github/signup-surface.paths,line=27::guard-path-drift: pattern
matches no tracked file — 'src/lib/age/**'. This control is not operating. If
the path moved, update it here in the SAME PR as the move. If it is deliberately
forward-looking, add: # guard-path-ok: <JIRA-KEY> <reason>
```

Every failure names **artefact, line, pattern, and the remedy**. Success prints
one summary line per artefact (`OK  .github/signup-surface.paths — 14/14 live`)
so a passing run still shows the estate was actually checked.

### 7.7 Escape hatch

Marker: **`guard-path-ok: <JIRA-KEY> <reason>`**, as a trailing comment on the
pattern's own line (or the nearest preceding comment line where the artefact's
syntax forbids trailing comments — e.g. a JS array).

Rules, mirroring the `service-role-ok` / `integrity-ok` / `loading-tsx-ok`
precedents already in the repo:

1. Suppresses **exactly one** pattern — the one on its line. Never a file, never
   a directory, never a wildcard.
2. **Requires a Jira key.** A bare `guard-path-ok` is itself a failure.
3. The script **prints every active exception** on success. An escape hatch you
   cannot enumerate is an escape hatch you cannot audit — this is the
   `UI-Change-Approved` loudness standard the ticket asks for.
4. Exceptions are counted; if the count exceeds **5**, the run emits a
   `::warning::` that the register is being used to paper over drift.

The four current DEAD patterns (§3) get markers at implementation time:
`tailwind.config.*` → `# guard-path-ok: KAN-419 Tailwind v4 is CSS-first; defensive stub`,
the two CODEOWNERS candidates → `# guard-path-ok: KAN-419 asserted-absent by design`.
`tests/integration` is **not** excepted — it is handed to KAN-417 to fix or
remove.

### 7.8 The companion rule for every extraction PR (implementation step 8)

A second, cheaper check, run per-PR rather than over the whole registry:

> For every path **deleted or renamed** in this PR's diff, grep `.github/`,
> `scripts/` and `docs/` for the old path. Any remaining hit fails the PR.

```bash
# sketch — F1 owns the real implementation
git diff --name-status "$MERGE_BASE" HEAD |
  awk '$1 ~ /^[DR]/ {print $2}' |
  while read -r old; do
    if grep -rlF -- "$old" .github/ scripts/ docs/ 2>/dev/null | grep -q .; then
      echo "::error::stale reference to moved path '$old' remains in the estate"
    fi
  done
```

This catches what §7.1 cannot: a *doc* that still names the old path while the
new path also exists (so nothing is DEAD, but the doc is now wrong). Together the
two rules cover both drift directions. **Advisory on day one** given the 18%
pre-existing dead rate in docs; promoted to blocking once F1's cleanup lands.

### 7.9 Test suite — `tests/scripts/check-guard-path-drift.test.cjs`

Per the ticket, F1 implements; this is the required list.

| # | Case | Expect |
|---:|---|---|
| 1 | pattern matching a tracked file | pass, exit 0 |
| 2 | pattern matching nothing | **exit 1**, error names artefact + pattern |
| 3 | pattern matching **only an untracked/ignored** file | **exit 1** (the subtle case) |
| 4 | `bash-case` `*` crossing `/` (`src/app/*.tsx` → 97) | pass — proves fnmatch was not used |
| 5 | `bash-case` trailing `/**` prefix rule (`src/lib/age/**`) | pass |
| 6 | `bash-dbl-bracket` carve-out vs protected ordering | carve-out wins |
| 7 | `codeowners` leading-`/` anchoring | `/src/modules/platform/env.ts` matches 1, not any nested `env.ts` |
| 8 | `literal` exact path (stryker `mutate`) | pass |
| 9 | `glob` `**` vs `*` depth (eslint/jest) | `tests/**/*.ts` ≠ `tests/*.ts` |
| 10 | `regex` (`package.json --testPathPatterns`) | pass |
| 11 | `basename-regex` survives a directory move | pass |
| 12 | artefact **missing** | **exit 2**, not 0 and not 1 |
| 13 | artefact present but **unparseable** (empty manifest block) | **exit 2** |
| 14 | escape-hatch marker suppresses **exactly one** pattern | the marked one passes, its neighbour still fails |
| 15 | escape-hatch marker **without** a Jira key | **exit 1** |
| 16 | every active exception is printed on a passing run | assert on stdout |
| 17 | `severity: advisory` artefact with a dead pattern | warns, exit **0** |

Cases 12–13 are the fail-closed guarantee and are the ones most likely to be
skipped under time pressure. They are not optional.

### 7.10 PR-check time budget — confirmed within budget

Measured on this container, against the real 791-file tree:

| Workload | Wall time |
|---|---:|
| `kan419-scan.py` — all 124 patterns, 18 artefacts (mean of 3 runs) | **~0.064 s** |
| The 6 existing shell guards in `pr-checks.yml`, one pass | **7.35 s** |

```bash
time (for i in 1 2 3; do python3 docs/modularisation/kan419-scan.py >/dev/null; done)
# real 0m0.193s  → ~64ms per full scan
```

The new guard adds **well under 1%** to the existing shell-guard block, and is
two orders of magnitude cheaper than `npm ci` + lint + type-check + unit tests
that follow it. `git ls-files` is called once and the result reused; no
per-pattern shelling out. **Confirmed: comfortably within the existing PR-check
time budget.**

---

## 8. Handover

| To | What |
|---|---|
| **F1** (implements the guard) | §7 in full. Port matching semantics from `kan419-scan.py`; do not re-derive. §7.9 cases 12–13 are mandatory. |
| **KAN-428** (extraction DoD) | §5.1 and §5.2 checklist items verbatim — the two out-of-repo couplings CI can never see. Plus §4's three sequencing constraints. |
| **KAN-427** (design-system contract) | §5.1. Also: this spike cannot be run from a cloud session — `build.py` is founder-local and in no git repo. ⚠️ **Corrected 2026-08-04 (KAN-441)** — that second sentence is false; read the §5 correction banner before acting on this row. |
| **KAN-429** (verification estate) | §6 — the deployed-behaviour layer (soak, E2E, smoke) is resilient by construction. Do not re-litigate. |
| **KAN-417** (test-decoupling) | §3 finding 4 (`tests/integration` matches nothing) and §6 E5 (174/216 test files reference `src/`). |
| **KAN-415 / D6** | §4 — land the *union* manifest (current paths **and** module paths) before the moves, shrink after. |

## 9. Acceptance criteria — status

| Criterion | Status |
|---|---|
| Complete inventory across A–D + step-4 sweep | ✅ 124 patterns, 18 artefacts (§1); 13 artefacts found beyond the ticket's list |
| Each pattern classified matching / not matching | ✅ 120 LIVE, 4 DEAD (§1, §3) |
| Every pre-existing dead pattern raised as a SEC finding | ✅ all 4 examined (§3); **none is a lost control**, so no SEC ticket raised — verdict + evidence recorded per pattern, and finding 4 routed to KAN-417 |
| `signup-surface.paths` module-term rewrite, entry-by-entry | ✅ §4, 14 → 6 globs, + 3 sequencing constraints |
| Two out-of-repo couplings recorded, CI-undetectable noted | ✅ §5 |
| Section E confirmed, incl. `tests/e2e/support/*` + `playwright.config.ts` | ✅ §6 (E1–E4), plus E5 handed to KAN-417 |
| Full spec for `check-guard-path-drift.sh` + test list | ✅ §7 (contract, 3 exit codes, fail-closed, escape hatch, 17 test cases) |
| Guard runs within the PR-check time budget | ✅ §7.10 — ~64 ms vs 7.35 s for the existing guard block |

**No application code, test, migration, or user-facing file was modified by this
spike. No database was written to. Read-only throughout.**
