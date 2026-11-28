# Design-change workflow (KAN-441) — repo mirror of `BUILD-LOOP.md`

> **This is a mirror.** The canonical process is **`BUILD-LOOP.md`** in the
> private repository **github.com/luisa-sys/lyra-design-system**. This copy
> exists so the process is readable from the app repo, in CI and offline. **If
> the two differ, `BUILD-LOOP.md` wins and this file is regenerated from it**
> (registered in `docs/DOC_SOURCE_OF_TRUTH.md`). Regenerated 2026-11-23 from the
> rewrite of `BUILD-LOOP.md` (luisa-sys/lyra-design-system#6, `main@7a3ee42`).
>
> **Read "this repo" below as `lyra-design-system`**, and "`lyra`" as this
> repository. Section numbers match the canonical file.

**Owner:** Luisa · **Status:** in force. Enforcement is partial: see §8.
**Rewritten:** 2026-11-23, for the design system's move into git and Claude artifacts (2026-11-22).
**Epic:** KAN-441 · **Enforcement:** KAN-456, KAN-457

**The rule: design first, close last.** No change to the look or wording of a
Lyra page ships unless Luisa approved it as a design first. No ticket closes
until the change is live on every environment **and** the design system
describes what shipped.

---

## 1. Where everything lives

| What | Where | Role |
|---|---|---|
| **Design system (canonical)** | this repo, `main`, `claude-design/project/` | Brand book (`README.md`), tokens (`tokens.json`), component and page previews (`components/<Name>/`). Changed **only by PR**. |
| Published design system | Claude artifact **Lyra Design System**, <https://claude.ai/artifact/7RRnLnaTnWaELbDzTXnVmV> (slug `33fff469-5304-4b22-b3c0-be2672158b6c`, Design System type) | What designers and Claude see. Published **from** `main`, never edited directly. |
| Record of the last publish | `claude-design/SNAPSHOT.json` | Artifact version, plus the sha256 of every published file. Checked by `claude-design/verify.py`. |
| Before/after review cards | Claude artifact **Lyra Web Design**, <https://claude.ai/artifact/FSRSD8jvTmi4SSr2r2esQS> (slug `74ec9808-08e7-4394-a336-507b43a3ae8f`, Migrated Design type). One page per card: `project/<name>.dc.html` | Route A proposals (§3). Backup in `rebuild/cards/`. |
| **Ticket state** | `rebuild/sync-manifest.json` | One entry per Jira ticket: state, approval, PR, baseline. |
| Gate runner | `rebuild/check-design-sync.py` | Gates G0–G6 (§7). |
| Token drift check | `rebuild/check-token-drift.py` | `tokens.json` against the app's `globals.css`. |
| App-side record | `luisa-sys/lyra` `design/BASELINE.json` + `scripts/check-design-baseline.py` (CTL-040) | Which design-repo commit the app was last reconciled against (§9). |
| Training | `academy/lyra-academy.html`, published as **Lyra Academy — Engineering Onboarding** | Module "The design-change loop" teaches this file. Update it when this file changes. |
| **Retired, do not use** | claude.ai/design projects `e4682889…` and `c179aa52…`, the `DesignSync` tool, `claude.ai/design/p/…` links, `build.py`, `validate.py`, top-level `foundations/` `components/` `pages/` | Standalone Claude Design closes by 14 December 2026. The projects no longer accept writes. |

This repo is **private** and the `lyra` app is public, so the app never imports
it at build time. Agents clone it beside `lyra` (or attach it in a cloud
session) and `git pull --ff-only` its `main` before UI work.

## 2. Direction of truth

**App code → this repo → the artifact.** (Decided by Luisa, 2026-11-22.)

- **Token values follow the app.** The source is `luisa-sys/lyra`
  `src/app/globals.css`, the Tailwind classes in `src/`, and the fonts in
  `src/app/layout.tsx`. `tokens.json` → `meta` records which commit they came from.
  **Drift is fixed here, never by editing `globals.css` to match.**
- **Everything else is authored here, by PR:** brand-book rules, component
  guidelines, previews.
- **The artifact is published from `main`** by a *merge re-sync* (§6). The page
  is technically still editable, but policy forbids editing it. Any page edit
  found at re-sync time is merged back into this repo by PR before anything is
  published.

**One sanctioned exception: an approved proposal may lead the app.** On
Route B (§3) the approved design is written into `claude-design/project/`
before the code exists. That preview's `README.md` must name the ticket and say
plainly which parts are **approved but not yet live**. The exception ends at
`BASELINED`, when the preview is reconciled with what actually shipped.

## 3. Two routes to approval

Both routes are valid. Both end in the same manifest state, `DESIGN_APPROVED`,
and **G1 blocks code before it**.

| | **Route A: review card** | **Route B: spec + design-system preview** |
|---|---|---|
| Use for | A small or one-off change to existing UI (copy, a section, a layout tweak) | A larger feature with a founder-written spec (e.g. KAN-487, spec v0.8) |
| The proposal | A before/after page `project/<TICKET>.dc.html` in the **Lyra Web Design** artifact. The "before" is what makes it reviewable. | The spec, plus a PR here changing `claude-design/project/components/<Name>/` (preview and `README.md`). Exact spec copy is kept apart from proposed copy. Open decisions are listed, not guessed. |
| Luisa approves | The card (she may choose an option, or "keep what we have", which closes the ticket with no work) | The spec version. Any copy that is not in the spec needs separate, recorded approval. |
| Recorded in the manifest | `approved_by_founder: true`, `approved_date`, `card_file` (the page name in the artifact), approval detail in `note` | `approved_by_founder: true`, `approved_date`, and the spec title + version and the component folder in `note` |
| Backup | Commit the card to `rebuild/cards/` (§6.3) | The PR itself |

The manifest has no approver-name field: `approved_by_founder` means Luisa.
Approval given after the first entry (e.g. extra copy) is recorded by updating
that ticket's `note` and the repo copy it applies to (`claude-design/project/`
or `rebuild/cards/`) in the same PR, then publishing (§6).

**"Keep what we have"** is a valid outcome on either route. The ticket closes
with no code and no baseline change; record it in `note`.

## 4. The state machine

One state per ticket, held in `rebuild/sync-manifest.json`, in this order:

```
TODO → DESIGN → DESIGN_APPROVED → DEV_IMPL → PROMOTED → REIMPORT_VERIFIED → BASELINED → DONE
```

| State | Means | To leave it |
|---|---|---|
| `TODO` | Ticket exists. No design work yet. | — |
| `DESIGN` | A proposal is being built: a card (Route A) or a design-system PR (Route B). | The proposal is in git: card backed up, or PR open. |
| `DESIGN_APPROVED` | Luisa approved it (§3). | Approval recorded in the manifest. |
| `DEV_IMPL` | Code, **and any DB work**, on a branch off `lyra` `develop`. Commits carry `UI-Change-Approved: <KEY>`. `dev_pr` set. | PR green (Quality Gate, CodeQL, E2E) and merged. |
| `PROMOTED` | Live on all four environments, `develop → staging → beta → main`. | **G3:** `staging` = `beta` = `main` by **tree SHA**. Separately, a human confirms the change is on `main` (G3 does not check that). |
| `REIMPORT_VERIFIED` | A human compared the live site with the approved card or preview and found them matching. Differences are listed in `note`. | Parity recorded in `note` (who, date, environment checked). |
| `BASELINED` | This repo describes what shipped: `claude-design/project/` updated by PR (tokens re-synced if they changed), **published** to the artifact, `SNAPSHOT.json` refreshed, `verify.py` exits 0. `baseline_ref` set. | `baseline_ref` recorded. |
| `DONE` | Jira ticket closed. | **Reachable only from `BASELINED`.** |

**`baseline_ref` format:** `ds:<design-repo main sha> app:main@<lyra sha> <YYYY-MM-DD>`.
`ds:` is the merge commit of the baseline PR (§5 step 7); `app:` is the
production commit it describes. Entries written before 2026-11-23 use free text (e.g. KAN-454's
`main d255ddd2 @2026-08-02`, which is an app commit).

"Re-import" is a leftover name from Claude Design, which imported the live
site. It now means the human parity check above. Nothing is imported.

## 5. A change, end to end

1. **Ticket.** A KAN ticket with the six required sections (`lyra`
   `docs/JIRA_TICKET_STANDARD.md`). Add a manifest entry at `TODO`: `key`,
   `title`, `has_ui`, `dev_paths` (globs of the app files the change touches),
   `has_db_work`.
2. **Design** (`DESIGN`). Route A: publish `project/<TICKET>.dc.html` to the
   Lyra Web Design artifact (`publish_files`, mode `patch`, `base_version` =
   live version), and commit **the same local file** to `rebuild/cards/`.
   Route B: open a PR here changing the component folder. **Do not merge it
   yet:** anything merged gets published (§6.1), and an unapproved design must
   never reach the Lyra Design System artifact.
3. **Approval** (`DESIGN_APPROVED`). Record it as in §3. Route B: merge the
   preview PR only now, with the approval in the same PR's manifest change, then
   publish (§6). Nothing in `lyra` may start before this.
4. **Implement** (`DEV_IMPL`). Branch off `origin/develop` in `lyra`. Pull this
   repo first and run the token-drift check (§10). Tokens are synced from
   `lyra` `main`, and `develop` may be ahead: if the only drift is a token change
   that is on `develop` but not yet on `main`, note it in the ticket and re-sync
   once it reaches `main` (§6.4). Never edit `globals.css` to clear drift. Build with the app's own
   components and token classes: **previews are specs, not code to copy.**
   Every commit touching founder-owned UI carries `UI-Change-Approved: <KEY>`.
   Set `dev_pr`.
5. **Promote** (`PROMOTED`). `develop → staging → beta → main` by the normal
   workflow-dispatch promotions. SEC-98 applies unchanged: design approval is
   never release approval. Migrations follow §11, which is **not** the same
   order as the code.
6. **Parity check** (`REIMPORT_VERIFIED`). Compare the live site with the card
   or preview. Record the result.
7. **Baseline** (`BASELINED`). PR here bringing `claude-design/project/` in
   line with what shipped. Route B: remove the "not yet live" wording, and fix
   anything that shipped differently. Merge it, then publish (§6). The
   follow-up PR (§6.1 step 3) carries the refreshed `SNAPSHOT.json` **and** the
   manifest change: state `BASELINED`, `baseline_ref` with `ds:` = the baseline
   PR's merge commit. `verify.py` must exit 0. If the ticket touched a
   design-bearing path in `lyra` (§9), also open a `lyra` PR to `develop`
   updating `design/BASELINE.json`; the ticket closes only once that is merged.
8. **Close** (`DONE`). Only now. **G2** fails a `DONE` ticket without a `baseline_ref`.

## 6. Publishing

Publishing needs a Claude session with the artifact tools
(`list_files`, `read_file`, `publish_files`). A plain script or CI job cannot do it.

### 6.1 Order: merge, then publish (decided 2026-11-23)

`main` is the source. The artifact only ever shows content that has been
reviewed and merged.

1. PR here → merge to `main`. `verify.py` now exits 1 (UNPUBLISHED). That is
   expected, and it is a debt until step 2 is done. (On an open design PR,
   `verify.py` exiting 1 is normal too.)
2. Publish from `main` (§6.2).
3. Commit the refreshed `SNAPSHOT.json` by a second, small PR. `verify.py` must exit 0.

**Do not move a ticket to `BASELINED` while `verify.py` exits 1.** Nothing enforces this: G6 is one repo-wide warning, and no gate compares a ticket's state with it.

### 6.2 Design System artifact (slug `33fff469-…`)

1. **Check the page hasn't moved.** `list_files`: its `version`, and the
   sha256 of every file not marked `of_type`, must equal `SNAPSHOT.json`. If
   not, someone edited in the page. Read those files and merge them into
   `claude-design/project/` by PR **first**.
2. **Send the changed files.** `publish_files`, mode `patch`, `base_version`
   = the live version, changed files only, each under its `project/…` path.
   Patch mode keeps files you don't name, so list deleted or renamed files in
   `remove`.
3. **Send `project/design-system.json` last**, in its own call, re-read right
   before. Set `lastChange` (`by`, `at`, `via`: `"GitHub · luisa-sys/lyra-design-system@<sha>"`).
4. **Confirm.** `list_files` again. The hashes must equal the files on `main`,
   except `project/tokens.css`, which the page regenerates from `tokens.json`:
   record whatever hash `list_files` reports for it. At the next publish, a
   difference confined to `tokens.css` after a token change is that
   regeneration, not a page edit.
5. **Refresh `SNAPSHOT.json`:** `source.version`, the `files` hashes and sizes,
   and `synced_from_code` if tokens changed. Run `python3 claude-design/verify.py`
   (must exit 0) and commit (§6.1 step 3).
6. **Never** write `project/tokens.css` (the page regenerates it from
   `tokens.json`), anything outside `project/`, or the type's own files
   (`index.html`, `SKILL.md`, `artifact-type/**`).

### 6.3 Lyra Web Design artifact (slug `74ec9808-…`)

- **Add a card:** `publish_files`, mode `patch`, `base_version` = live, one
  file `project/<TICKET>.dc.html`. A new root-level `.html` file becomes a
  page. Change `project/compat.json` only to rename or reorder pages, and keep
  its `report` exactly as read.
- **Back up a new card** by committing the same local file you published to
  `rebuild/cards/`. No read-back is needed: the type's own instructions say not
  to read back after publishing unless asked, and that applies to this artifact.
  (The hash confirmation in §6.2 applies to the Design System artifact, because
  `SNAPSHOT.json` depends on it.)
- **Full backup** (only when asked, or to catch edits made in the page):
  `list_files`, then `read_file` with `paths` (32 at most per call), then write
  to `rebuild/cards/` and commit. `rebuild/cards/README.md` records the artifact
  version last backed up. The KAN-454 page `PR665 KAN-454 Waitlist.dc.html` is
  backed up as `KAN-454-waitlist.dc.html`, a whitespace-cleaned copy.
- The page's `_ds/` folder is a frozen copy of the **old** Claude Design system.
  Nothing keeps it current, so cards may render with pre-2026-11-22 tokens. Judge a
  card against `claude-design/project/`, not against `_ds/`.
- New cards go here. New design **projects** are made from the Design type,
  never from Migrated Design.

### 6.4 Re-syncing tokens from the app

When `globals.css`, the token classes or the fonts change in `lyra`, or the
drift check exits 1:

1. Fetch `luisa-sys/lyra` on its default branch (`main`) and note the short sha.
2. Diff `globals.css` `:root` and the class values against `tokens.json`.
   **Show Luisa the table before changing anything.**
3. Edit `tokens.json`, keeping every `usage` note. Colours not in
   `globals.css` are not tokens. Update `meta.ref` and `meta.synced`.
4. PR, merge, publish (§6.1).

## 7. The gates (`rebuild/check-design-sync.py`)

What the code checks today:

| Gate | Result | Fires when |
|---|---|---|
| **G0** Version control | BLOCK, but the run ends UNVERIFIABLE (exit 2) | The design repo is not a git work tree. |
| **G1** Design-first | BLOCK | A UI ticket is at `DEV_IMPL` or later and `approved_by_founder` is not true. |
| **G2** No-close | BLOCK | A ticket is `DONE` with no `baseline_ref`. |
| **G3** Promote-verified | BLOCK | A ticket is at `PROMOTED` or later and `staging`, `beta` and `main` are not identical **by tree SHA**. |
| **G4** Baseline current | WARN | A ticket is `PROMOTED` or `REIMPORT_VERIFIED` with no `baseline_ref`. |
| **G5** No lost work | WARN | The design repo has uncommitted changes, or a UI ticket is at `DESIGN` / `DESIGN_APPROVED` with no `dev_pr`. |
| **G6** Published | WARN | `claude-design/project/` differs from `SNAPSHOT.json` (calls `verify.py`). |

**Exit codes:** 0 CLEAN · 1 DRIFT (warnings only) · 2 BLOCKING *or*
UNVERIFIABLE. The last line, `SYNC-CHECK-STATUS: CLEAN|DRIFT|BLOCKING|UNVERIFIABLE`,
tells the two kinds of 2 apart. **This is the reverse of the `lyra` guards**,
where 1 = violation and 2 = cannot verify.

**It fails closed.** If either repo is unreadable, G3 cannot read the
environment trees, or G6 cannot run `verify.py` or read `SNAPSHOT.json`, the
result is UNVERIFIABLE (exit 2), never a pass. `--self-test` proves the
unreadable-repo case only.

**G3 is pipeline-wide.** While `staging`, `beta` and `main` differ, *every*
run is BLOCKING if *any* ticket is at `PROMOTED` or later, whoever's it is. On
2026-11-23 that is KAN-454, because production has not been promoted since
August. Such a block does not stop you moving your own ticket up to
`DEV_IMPL`. It does mean no ticket may be moved to `PROMOTED` or later.

**What it does not check**, so do not read a clean run as covering these:
- **Token drift.** Run `check-token-drift.py` separately.
- **The live artifact.** G6 compares the repo with `SNAPSHOT.json`, not with the page.
  An edit made in the page is caught only at the next publish (§6.2 step 1).
- **Jira.** G2 reads the manifest. It cannot see a ticket closed in Jira while the manifest is behind.
- **That `dev_paths` actually reached `main`.** G3 checks environment alignment only.
- **That the manifest is true.** States and approvals are typed by people and agents.
- **Fresh refs.** G3 reads the app repo's local `origin/*` refs. Run `git fetch` first.

`--help` is not a flag: the script ignores unknown flags and runs the full check.

## 8. How much of this is enforced

Be exact about this. A control that only exists on paper reads as green.

| Control | Enforced by | Reality on 2026-11-23 |
|---|---|---|
| G0–G6 | `check-design-sync.py` | **Manual.** No CI workflow in this repo and no schedule anywhere. Run it before moving any ticket state and before closing anything. |
| G2 at Jira | A Jira automation rule blocking Done (proposed) | **Not built** (founder action, needs Jira admin; KAN-457). Until then, agents must refuse to close a ticket that is not `BASELINED`. |
| PRs to `main` here | Policy | `main` has **no branch protection**. Branch + PR is a rule, not a gate. |
| Founder approval in `lyra` | `check-ui-copy-ownership.sh` (KAN-411) | **CI-enforced** in `lyra`, but it checks for a trailer string, not for an approval (§9). |
| Design-baseline pointer in `lyra` | CTL-040 | **CI-enforced** in `lyra`, but only when a design-bearing file is moved (§9). |

Wiring `check-design-sync.py` into a CI workflow here, and a daily
detect-and-log run, is outstanding on KAN-457.

## 9. The controls on the app side (`luisa-sys/lyra`)

- **UI trailers (KAN-411, `scripts/check-ui-copy-ownership.sh`, run by
  `pr-checks.yml`).** Any PR touching founder-owned UI (every `.tsx` under
  `src/app` or `src/modules`, `src/components/**`, `src/**/*.css`,
  `postcss.config.*`, `tailwind.config.*` (matches nothing today), six named copy
  modules and five `public/` paths; not `src/app/admin/**`, `src/app/api/**`,
  `*/route.ts`, `src/middleware.ts`) needs one commit trailer:
  - `UI-Change-Approved: <KEY>`: an approved design change. **This loop produces the approval.**
  - `UI-Bugfix-Only: <KEY>`: restores intended design, or fixes a plain text or rendering error. No card needed.
  - `UI-No-Visual-Change: <KEY>` (SEC-152): the diff changes no pixel and no word. No loop obligation.

  The trailer is a claim, and the manifest entry is the evidence. A trailer
  without an approved ticket turns a control into a rubber stamp. The exact
  path list is `is_protected` in that script.
- **CTL-040 (`scripts/check-design-baseline.py`) and `design/BASELINE.json`.**
  When a PR **renames or deletes** a design-bearing file (`src/app/globals.css`,
  anything under `src/components/`, any `.tsx` under `src/app/`), it must also
  change `baseline_ref` in `design/BASELINE.json`: by policy, to the current
  head of this repo's `main`. CI checks only that the value changed, not what it
  is. Plain edits and additions do not trigger it. The escape hatch
  is a `Design-Baseline-Ok: <KEY> <reason>` trailer. `BASELINE.json` is
  app-wide ("last reconciled against"); the manifest's `baseline_ref` is per
  ticket. They are different records. Update `BASELINE.json` at a ticket's
  `BASELINED` step whenever the ticket touched those paths.
- **PR template.** The "Design loop (KAN-441)" line asks for the ticket, its
  approval route and the trailer. `EXTRACTION-DOD-DESIGN-SYSTEM` remains a
  human attestation, because `lyra` CI cannot read this private repo.

## 10. Running the checks

From `lyra-design-system` (after `git fetch` in both repos; `lyra` needs
`develop`, `staging`, `beta` and `main` fetched for G3):

```bash
python3 rebuild/check-design-sync.py --self-test                    # must print OK
python3 rebuild/check-design-sync.py --design-repo . --app-repo ../lyra
python3 claude-design/verify.py                                     # 0 published · 1 unpublished · 2 unreadable snapshot
```

From `lyra`:

```bash
python3 ../lyra-design-system/rebuild/check-token-drift.py \
  --design ../lyra-design-system/claude-design/project/tokens.json \
  --repo src/app/globals.css                                        # 0 in sync · 1 drift · 2 usage/read error
```

- `check-design-sync.py` takes the repo locations from `--design-repo` /
  `--app-repo`, then the `DESIGN_REPO` / `APP_REPO` environment variables, then
  `paths` in the manifest. The manifest holds Luisa's laptop paths, so pass the
  flags anywhere else.
- `check-token-drift.py` only compares tokens present on **both** sides. A token
  added to `globals.css` but missing from `tokens.json` is **not** reported. When
  `globals.css` gains a variable, add it by hand (§6.4).
- Drift (exit 1) means the design system is behind the app. Re-sync it (§6.4).
  **Never edit `globals.css` to match.**

## 11. Database migrations: four deploy environments, three databases

| Deploy environment | Supabase project |
|---|---|
| `develop` → dev.checklyra.com | `dev-lyra` |
| `staging` → stage.checklyra.com | `stage-lyra` |
| `beta` → beta.checklyra.com | **`prod-lyra`, the production database** |
| `main` → checklyra.com | `prod-lyra` |

`beta` has no database of its own. **A migration must reach production before
the `staging → beta` promote**, not before `beta → main`. Scheduling it against
`beta → main` is one promote too late: beta then runs the new code against a
database without the column.

> **PGRST204.** PostgREST builds the INSERT column list from the payload's
> keys. Sending a key for a column that is not migrated yet fails the **whole**
> request, even when the value is `null`. `type-check` cannot catch it, because
> the server Supabase client is untyped. So it breaks beta and production
> together, while the code promote looks healthy.

Migrations still ride inside `DEV_IMPL → PROMOTED`. There is no separate design
gate for them.

## 12. Traps already hit

- **Verify environment alignment by tree SHA, never ahead/behind.** The
  2026-06-20 re-root leaves `main` hundreds of merge commits ahead of
  `develop` with an identical tree. `lyra` `scripts/check-release-drift.sh`
  counts commits and is no alignment signal. G3 is the place this rule is enforced.
- **Merged is not published.** The KAN-487 design PRs (#4, #5) merged on
  2026-11-23 and were not published, so `verify.py` exited 1 and the artifact
  showed the old editor. §6.1 makes the publish an explicit step.
- **Merged is not promoted.** Tickets sat at `DEV_IMPL` with notes saying
  "merged" long after their code reached all four branches. The manifest
  describes the loop only if it is updated at each step.
- **Mutation-verify every guard.** Nine vacuous assertions surfaced in one
  day: satisfied by a pre-read, by a code comment, or by a list mapping over
  itself. CTL-039, and the follow-ups under KAN-459 (done), exist because of it.
  A control that has never been seen to fail is no control.
- **A card can lie about tokens.** Lyra Web Design renders with its frozen `_ds/`
  copy of the old system (§6.3).

## 13. Open questions (Luisa decides)

| Question | Ticket | Status |
|---|---|---|
| Fold this repo into the `lyra` monorepo, so `lyra` CI can diff design against `src/` and run the gates itself? | KAN-427 | **Open.** Which surface is canonical *was* decided on 2026-11-22 (this repo, following the app's code). Only the fold remains. Not blocking. |
| CI for this repo, a daily drift run, and the Jira automation for G2 | KAN-457 (and KAN-456) | **Open.** §8. |
| Which Claude surface may publish to the two artifacts and merge here, and which documentation class this process belongs to. `lyra` `docs/CLAUDE_SURFACE_POLICY.md` has no row for this repo or for artifact publishing. | KAN-465 (written for `DesignSync`, to be re-scoped) | **Open.** In practice, Claude Code sessions do the publishing. |
| The design surfaces sit outside the security-lockdown and secret-rotation estate | SEC-124 | **Open.** |

## Quick reference

```
TODO → DESIGN → DESIGN_APPROVED → DEV_IMPL → PROMOTED → REIMPORT_VERIFIED → BASELINED → DONE
         │            │                │           │              │                │          ▲
     card or DS    Luisa ✓ in       PR + trailer  staging=beta=  live = design   DS PR merged  close
     PR in git     manifest (G1)    (KAN-411)     main by tree   (human check)   + published   allowed
                                                  (G3)                           + SNAPSHOT    (G2)
                                                                                 + baseline_ref
```

**Never close before `BASELINED`. Never edit an artifact page directly. Never
edit `globals.css` to match the design system. Merged is not published.**
