# Documentation source-of-truth direction (KAN-363)

> **One canonical statement of where truth lives.** This file resolves the
> long-standing contradiction where the Confluence *Operations & Support
> Runbook* told readers to _"always check the RUNBOOK.md in the repo for the
> authoritative procedures"_ (repo = authority) while the intended direction is
> that the **wiki** is definitive for narrative/ops. There is now **one**
> documented direction, below, and each mirrored doc's own header agrees with
> it. Parent epic **KAN-350**; ticket **KAN-363**.

## The direction, by document class

Truth does not live in a single place — it lives in the **right** place for
each class of document. The rule is chosen so that the canonical surface is the
one that is *edited* and *reviewed*, and every other surface is a mirror of it.

| Document class | Canonical surface | Mirror(s) | Rationale |
|---|---|---|---|
| **Ops / runbook narrative** (incident response, DR/backup, on-call, routine action-lists) | **Confluence wiki** | repo `docs/` (this repo) | Ops procedures are edited and reviewed in the wiki where they are read during an incident; the repo copy exists so they are available in CI/offline and version-controlled. **If they differ, the wiki wins and the repo mirror is regenerated.** |
| **Compliance pack** (DPIA, ROPA, sub-processors, retention, DSAR/breach) | **repo `docs/compliance/`** | Confluence (index/links only) | These are signed-off, version-controlled legal artefacts; the repo is where they are drafted, diffed and approved. The Confluence DRAFT copies are retired/consolidated in favour of the repo canonical (see `docs/compliance/FOUNDER_CHECKLIST.md`). |
| **Project / Claude instructions** | **Claude.ai Project knowledge** (`lyra.md`) | repo `docs/PROJECT_INSTRUCTIONS.md` | Claude reads the Project knowledge file at the start of every chat; the repo copy exists so the instructions are version-controlled, reviewable and recoverable. |
| **Work / tickets** | **Jira** | — | Jira is the source of truth for *what* each ticket means and its status. Never close a ticket without completing the work. |
| **Code / deploy state** | **git + CI** | — | The live state of code and what is deployed is `git`/CI, never a doc. Docs describe intent; `git` describes reality. |
| **System-documentation index** | **Confluence "Lyra — System Documentation"** (TWC/19922947) | repo `CLAUDE.md` pointer | The wiki index is the navigational source of truth read first before architecture/ops/security work (KAN-360). |

**No document may contradict this table.** If a repo doc or a wiki page states a
different authority for its class, that statement is the bug — fix it to point
here.

## Mirror manifest

The rows below are the **critical runbook + compliance documents that are
mirrored between the repo and the wiki**. The presence guard
`scripts/check-doc-mirror-manifest.sh` (run from `pr-checks.yml`) parses this
block and **fails the PR if any repo path listed here no longer exists** — so a
mirror cannot be silently deleted or renamed out of the tree, which is the
first and cheapest form of drift. A companion guard
`scripts/check-doc-mirror-content.sh` (also run from `pr-checks.yml`) fails the
PR if any listed `.md` mirror still exists but has been reduced to an empty /
heading-less / stub file — the "looks present but carries no real content"
drift (the KAN-167 placeholder-backup failure mode). Both guards are
repo-side and structural. (Full *content* drift-vs-Confluence detection needs
Confluence API access in CI and is tracked as a follow-up leg on KAN-363 — see
"Not yet covered" below.)

<!-- doc-mirror-manifest:start -->
| Repo path (must exist) | Canonical surface | Confluence page | What it mirrors |
|---|---|---|---|
| `docs/RUNBOOK.md` | wiki | Operations & Support Runbook (19988502) | Environments, release procedure, scheduled-workflow schedule, on-call ops. |
| `docs/DISASTER_RECOVERY.md` | wiki | Disaster Recovery & Backup/Restore Runbook (27131914) | Backup layers, restore/recovery test plan, compromise recovery (SEC-5/SEC-23). |
| `docs/OPS_ROUTINES_CONTROL_ROOM.md` | wiki | Ops Routines Control Room (34275370) | Routine index, heartbeat contract, one-concern-one-owner map (KAN-362). |
| `docs/PROJECT_INSTRUCTIONS.md` | Claude Project `lyra.md` | — | Lyra Project knowledge instructions Claude reads each chat. |
| `docs/compliance/DPIA.md` | repo | (retires Confluence drafts 27000875 / 27033667) | Data Protection Impact Assessment (SEC-70). |
| `docs/compliance/ROPA.md` | repo | — | Record of Processing Activities (Art. 30). |
| `docs/compliance/SUBPROCESSORS.md` | repo | — | Sub-processor register + DPAs/TRAs. |
| `docs/compliance/RETENTION_SCHEDULE.md` | repo | — | Data-retention schedule (SEC-74). |
| `docs/compliance/DSAR_BREACH_COMPLAINTS.md` | repo | — | DSAR / breach / complaints procedures. |
<!-- doc-mirror-manifest:end -->

## Not yet covered (decomposed follow-up legs of KAN-363)

The presence guard plus the repo-side content/substance guard
(`scripts/check-doc-mirror-content.sh`) above are the dev-safe, CI-runnable
slices of the "drift check" acceptance criterion. The remaining legs need a
supervised / main session and are tracked on the KAN-363 ticket:

- **Content drift-vs-Confluence check** — compare each mirror's body against its
  canonical Confluence page. Requires a Confluence API token + network in CI
  (secret provisioning is founder/ops), so it is not autopilot-safe.
- **Correcting the wording on the Confluence *Operations & Support Runbook*
  page** itself (the _"always check RUNBOOK.md … authoritative"_ sentence) — the
  repo mirror already carries the corrected direction (`docs/RUNBOOK.md`
  header); the wiki page is founder-owned and edited from the main session.
- **Sync/regeneration mechanism** — a scripted wiki⇄repo mirror refresh so the
  two never hand-drift. Design pending.
