# Design-change workflow (KAN-441)

> **Source of truth.** The canonical spec is **`BUILD-LOOP.md`** in the separate
> repository **github.com/luisa-sys/lyra-design-system**. This file is the
> **repo mirror**, so the process is readable from the app repo, in CI and
> offline. **If the two differ, `BUILD-LOOP.md` wins and this mirror is
> regenerated.** Registered in `docs/DOC_SOURCE_OF_TRUTH.md`. Epic **KAN-441**;
> loop enforcement **KAN-456**; the canonical-home question is **open but no
> longer blocking** — see "Still open" below and the CTL-040 note beneath it.

Lyra's UI changes go through **Claude Design** before they reach code. A change
is designed, approved by Luisa, then implemented, promoted, re-imported and
baselined. The ticket closes last, not first.

## Why the loop exists

Design and code drift apart in **both** directions, and each direction fails
silently:

- **Code ahead of design.** An engineer edits `src/app/globals.css` or a page's
  copy. The design system still shows the old fonts, colours and wording, so the
  next design decision is made against a picture of a site that no longer
  exists.
- **Design ahead of code.** An approved design sits in Claude Design and never
  lands, or lands only on `develop`. Nobody can tell by looking at either
  surface, because both look finished.
- **Unsynced design work can be lost outright.** Design work that was never
  committed to `lyra-design-system` exists only in a chat surface. Losing it
  costs the rebuild, not just the diff — which is why **G0 (version control)** is
  blocking rather than advisory.

The loop makes each of those states detectable: a single ticket state, one
manifest, and a checker that refuses to let a ticket close while the two sides
disagree.

## The two Claude Design projects

| Project | `projectId` | What it holds |
|---|---|---|
| **Lyra Design System** | `e4682889-26bd-4a88-a7ae-4a9be9cd1632` | Fonts, colours and CSS tokens for the whole site. Its `foundations/tokens.css` carries every token in `src/app/globals.css`, plus a trailing block of recurring inline literals that are **not** in `globals.css` and are candidates for promotion — so it is a superset, not a 1:1 copy. |
| **Lyra Web Design** (the *cards* project) | `c179aa52-22a7-4dd2-bd9d-682f21d2a76c` | One **before/after card per change**, named `<TICKET>.dc.html` — e.g. `KAN-458.dc.html`. |

Deep-link format — the `.dc.html` suffix is **part of the card's file name**, so
it appears once, not twice:

```
https://claude.ai/design/p/{projectId}?file=<TICKET>.dc.html
```

Worked example, for `KAN-458` in the cards project:

```
https://claude.ai/design/p/c179aa52-22a7-4dd2-bd9d-682f21d2a76c?file=KAN-458.dc.html
```

> Not every card follows the convention. `KAN-454`, the pilot, is filed as
> `PR665+KAN-454+Waitlist.dc.html`. When in doubt read `card_url` from
> `rebuild/sync-manifest.json` rather than composing the URL by hand.

Both projects are **writable** via the `DesignSync` MCP tool (`finalize_plan`,
then `write_files`). The cards project is of type `PROJECT_TYPE_PROJECT` rather
than a design system, but `canEdit` is true and writes succeed. Cards are also
mirrored into git at `lyra-design-system/rebuild/cards/`, so a card exists in
two places by design: the Claude Design project (where it is viewed and
approved) and git (where it is versioned).

## Where the tooling lives

Everything below is in the **`lyra-design-system`** repo, not this one.

| Path | What it is |
|---|---|
| `BUILD-LOOP.md` | The canonical spec this file mirrors. |
| `rebuild/sync-manifest.json` | **Where ticket state lives** — one entry per Jira ticket. |
| `rebuild/cards/` | Git mirror of the `<TICKET>.dc.html` cards. |
| `rebuild/check-design-sync.py` | The gate runner — G0 to G5 below. |
| `rebuild/check-token-drift.py` | Diffs the Claude Design tokens against `src/app/globals.css` and can emit the `globals.css` fixes for an auto-PR. Takes `--design` and `--repo`; exits 2 without both. |
| `foundations/tokens.css` | The design-system token file that mirrors `src/app/globals.css`. |

Run the gate runner from the `lyra-design-system` checkout root:

```bash
python3 rebuild/check-design-sync.py     # G0–G5 for every ticket in the manifest
```

The token-drift checker is **not** run the same way — it takes two mandatory
file arguments, and the design-side token file has to be fetched live through
`DesignSync` first, so it cannot be run unattended:

```bash
python3 rebuild/check-token-drift.py --design <fetched-tokens.css> --repo src/app/globals.css
```

> **This repo's CI cannot run either checker** — they are in a different
> repository. That is the substance of the canonical-home question below, and it
> is why the PR-template `EXTRACTION-DOD-DESIGN-SYSTEM` line is still a **human
> attestation**.

## The state machine

One state per Jira ticket, held in `rebuild/sync-manifest.json`:

```
TODO → DESIGN → DESIGN_APPROVED → DEV_IMPL → PROMOTED → REIMPORT_VERIFIED → BASELINED → DONE
```

| State | Means |
|---|---|
| `TODO` | Ticket exists; no design work started. |
| `DESIGN` | A before/after card is being built in the **Lyra Web Design** project. |
| `DESIGN_APPROVED` | Luisa has approved the card. This is the approval the KAN-411 trailer asserts. |
| `DEV_IMPL` | Code is being written against the approved card, on a branch off `develop`. |
| `PROMOTED` | The change is live on all four environments — `develop → staging → beta → main`. |
| `REIMPORT_VERIFIED` | The shipped result has been re-imported and checked against the card. |
| `BASELINED` | The Claude Design baseline has been updated to match what actually shipped. |
| `DONE` | Jira ticket closed. |

**The rule of the loop: design first, close last.** A ticket cannot be closed
until it is `BASELINED` — meaning the change is live on all four environments
**and** the Claude Design baseline matches it. Closing at "merged to develop" is
exactly the drift the loop exists to prevent.

## The gates

Enforced by `rebuild/check-design-sync.py`:

| Gate | Name | Blocks |
|---|---|---|
| **G0** | Version control | Design source not in git. **Blocking** — unsynced design work is work that can be lost. |
| **G1** | Design-first | Entering `DEV_IMPL` from `DESIGN` without passing through `DESIGN_APPROVED`. Code cannot precede the approval. |
| **G2** | No-close | `DONE` unless the ticket is `BASELINED`. |
| **G3** | Promote-verified | `PROMOTED` unless `main` = `beta` = `staging` **by TREE SHA**, and the ticket's `dev_paths` change is present on `main`. |
| **G4** | Baseline current | `DONE` when a ticket is `PROMOTED` / `REIMPORT_VERIFIED` but its `baseline_ref` has not been updated. |
| **G5** | No lost work | Raises alerts on uncommitted design changes, or design ahead of dev. |

> **G3 uses tree SHA, never ahead/behind counts — and this is a rule the design
> loop introduces, not one it inherits.** The 2026-06-20 re-root leaves `main`
> hundreds of prod-promote merge commits ahead of `develop` with an identical
> tree, so ahead/behind reads as a huge gap at the exact moment the environments
> are identical. Tree SHA compares the content, so it tells the truth.
>
> **Do not assume an existing gate already carries this.** Nothing in the release
> chain checked alignment by tree SHA before G3 —
> `scripts/check-release-drift.sh` does the opposite: it counts commits ahead
> (`git rev-list --count "$MAIN_REF..$DEVELOP_REF"`) and thresholds
> green/yellow/red on that count, which the re-root makes meaningless as an
> alignment signal. G3 is the first place the rule is enforced.

## How a change flows, end to end

1. **Ticket first.** A KAN ticket exists, with the six required sections
   (`docs/JIRA_TICKET_STANDARD.md`). Its manifest entry starts at `TODO`.
2. **Design.** Build the before/after card as `<TICKET>.dc.html` in the **Lyra
   Web Design** project via `DesignSync` (`finalize_plan` → `write_files`), and
   commit the mirror to `lyra-design-system/rebuild/cards/`. State → `DESIGN`.
3. **Approval.** Luisa reviews the card and approves it. State →
   `DESIGN_APPROVED`. **G1 blocks any code before this point.**
4. **Implement.** Branch off `origin/develop`, write the code and its tests, and
   carry the `UI-Change-Approved: <KEY>` commit trailer. State → `DEV_IMPL`.
5. **Promote.** `develop → staging → beta → main`, unchanged — see SEC-98 in
   `CLAUDE.md`. State → `PROMOTED` once **G3** agrees `staging`, `beta` and
   `main` are flat by tree SHA and the change is present on `main`. (G3 compares
   those three; `develop` is ahead by design while work is in flight.)
6. **Re-import and verify.** Re-import the shipped result and check it against
   the card. State → `REIMPORT_VERIFIED`.
7. **Baseline.** Update the Claude Design baseline (and the tokens, if the change
   touched them) so the design system describes what is now live. State →
   `BASELINED`.
8. **Close.** Only now may the ticket go to Done. **G2** enforces it.

## How this connects to the existing controls

| Control | Relationship to the loop |
|---|---|
| **KAN-411 quality gate** (`scripts/check-ui-copy-ownership.sh`, run from `pr-checks.yml`) | Any PR touching founder-owned UI paths must carry a `UI-Change-Approved: <KEY>` or `UI-Bugfix-Only: <KEY>` commit trailer. **The design loop is what produces the approval that trailer asserts** — the trailer is the claim, `DESIGN_APPROVED` is the evidence. |
| **The founder-gated UI rule** (`CLAUDE.md` → "LOOK AND TEXT") | Anything **changing** the look or wording of a user-facing page is founder-approved-and-initiated. **Restoring** intended design, or fixing a plain text or rendering error, is not gated and does not need a card. |
| **SEC-98 production change control** | Unchanged. Design approval is **not** a release approval and never bypasses `develop → staging → beta → main`. |

The founder-owned surface is whatever `scripts/check-ui-copy-ownership.sh`
(`is_protected`) says it is — that function is the authority. Broadly: every
`.tsx` page/layout/component under `src/app`, all of `src/components/**`, any
`.css` under `src/` (including `globals.css`), `postcss.config.*`, the named
user-facing copy modules, and **five named paths under `public/`** — `public/`
is not covered as a class. Not gated: `src/app/admin/**`, `src/app/api/**`, any
`*/route.ts`, `src/middleware.ts`. The exact list, including which `public/`
paths and why `tailwind.config.*` matches nothing, is in `CLAUDE.md` →
"LOOK AND TEXT".

## Database migrations — four deploy environments, three databases

**DB work is not a separate track, but it does not travel the same chain the
code does.** The deploy chain has **four** environments; the database has
**three** Supabase projects, and they do not line up one-to-one:

| Deploy environment | Reads/writes which Supabase project |
|---|---|
| `develop` → dev.checklyra.com | `dev-lyra` |
| `staging` → stage.checklyra.com | `stage-lyra` |
| `beta` → beta.checklyra.com | **`prod-lyra` — the production database** |
| `main` → checklyra.com | `prod-lyra` |

`beta` has no database of its own. It is the **production** Supabase behind the
in-app beta gate — see `CLAUDE.md` → Deployment Pipeline and gotcha #19.
Accordingly `CLAUDE.md`'s Supabase Migration Rules name three environments, in
order: **dev first, then staging, then production.**

> **The consequence a reader must not miss.** Because beta runs on the production
> database, a migration has to be applied to **production Supabase before the
> `staging → beta` promote** — *not* before `beta → main`. Scheduling it against
> the `beta → main` step is **one promote too late**: the beta deploy then runs
> new code against a production database that does not yet have the column.

Migrations still ride inside `DEV_IMPL → PROMOTED`, there is no design-side
migration gate and no separate promotion path for the code, and SEC-98 is
unchanged. What differs is only the count and the ordering above.

One trap this makes concrete:

> **PGRST204.** PostgREST derives the INSERT column list from the payload's
> **keys**, so sending a key for a not-yet-migrated column fails the **whole**
> request — even when the value is `null`. `type-check` cannot catch it, because
> `src/lib/supabase-server.ts` builds an **untyped** client. So a UI change whose
> migration has reached `dev-lyra` but not `prod-lyra` breaks at run time on
> **beta and production alike** — both read the production database — even while
> the code promote itself looks healthy. Promote the migration ahead of the
> `staging → beta` step, and verify environment alignment by tree SHA (G3) rather
> than by assumption.

## Proven in practice

- **KAN-454** was the pilot: design card → founder approval → dev → staging →
  beta → production, verified live.
- **2026-08-03:** nine approved changes shipped to `develop` across six PRs —
  #673, #674, #681, #682, #683, #684.

## Traps this loop has already hit

- **Mutation-verify every guard.** Nine vacuous-test findings surfaced in a
  single day: assertions satisfied by a pre-read, by a code **comment**, or by a
  list mapping over itself. A control that has never been seen to fail is
  indistinguishable from no control. **CTL-039** (`check-comment-only-assertions.py`) is built and live, but it
  missed the comment-satisfied case above — that gap in the detector is
  **KAN-459**.
- **Verify environment alignment by TREE SHA, never ahead/behind** (G3, above).

## Still open — Luisa decides

| Question | Ticket | Status |
|---|---|---|
| **Canonical home.** Should `lyra-design-system` fold into the `lyra` monorepo, so CI can diff design against `src/` directly instead of relying on a human attestation? | **KAN-427** | **Open — but no longer blocking.** The two checkers still cannot run in this repo's CI, and that is unchanged. What changed (2026-08-08, KAN-457) is that it is no longer a prerequisite for having *any* control here: **CTL-040** gates the app side from inside this repo. Folding the repos would buy a genuinely stronger check; it is now an improvement rather than an unblock. |
| **Documentation class.** This doc is registered in `docs/DOC_SOURCE_OF_TRUTH.md` as its own class (canonical = the `lyra-design-system` spec). The alternative is to treat it as an Ops/runbook narrative with a Confluence page as canonical — which would make `BUILD-LOOP.md` a *second* mirror, i.e. three surfaces for one process. | **Unspecified — needs a ticket.** Surfaced by epic KAN-441, but no ticket tracks the decision. | **Open.** The table currently records what is true today. |
| **Which surface performs the `DesignSync` writes.** `docs/CLAUDE_SURFACE_POLICY.md` is a strict binary — Claude Code is the auditable surface, chat is the discussion surface — and its "What requires Claude Code" table has no row for Claude Design. Writing a card is a persisted state change. `DesignSync` **is** available in Claude Code, so routing writes through it would satisfy the policy, but the rule is not written down. | **Unspecified — needs a ticket.** KAN-456 tracks loop *enforcement*, not this question; `docs/ADR.md` (ADR-009) raises it with no key attached either. | **Open** — needs a row in that table. |

### CTL-040 — what shipped, and what it is not

**Updated 2026-08-08 (KAN-457).** The paragraph that stood here said CTL-040 was
pending, because registering `check-design-sync.py` is impossible from this repo:
`scripts/check-control-registry.py` fails when a registered control's
implementation file is missing, and that file lives in the other repo. **That
constraint is real and has not gone away.**

So **CTL-040 as shipped is a different control**, and the distinction matters
enough to state rather than let the ID paper over:

| | `check-design-sync.py` | **CTL-040** (`scripts/check-design-baseline.py`) |
|---|---|---|
| Repo | `lyra-design-system` | **this one** |
| Checks | the loop's G0–G4 gates across both repos and all four envs | that a PR moving a design-bearing file also moves `design/BASELINE.json`'s `baseline_ref` |
| Registered | no — cannot be | **yes** |
| Runs in this CI | no | **yes, on every PR** |

CTL-040 does **not** verify the design system was re-pointed or regenerated —
this CI still cannot read that repo. It verifies that whoever moved the file
opened it, took its head commit, and recorded it. That raises the cost of a
false `EXTRACTION-DOD-DESIGN-SYSTEM: done` from *typing a word* to *going and
looking*, which is the most an in-repo check can do across a boundary it cannot
cross.

The human attestation therefore **still stands**. CTL-040 backs it; it does not
replace it, and it does not close the canonical-home question — it removes that
question as a *blocker* for having any control at all. Registering
`check-design-sync.py` itself remains available only if the repos ever fold
together.

> The `lyra-design-system` side of this — running `check-design-sync.py` in that
> repo's own CI, which currently has **no workflows at all** — is the other half
> and is not done. Tracked on KAN-457.
