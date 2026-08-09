# Extraction Definition-of-Done

**Ticket:** KAN-428 (F11) · **Epic:** KAN-414 (modularisation scoping) ·
**Derived from:** `docs/modularisation/KAN-419-path-coupling.md` (the
path-coupling register) · **Guard:** `scripts/check-extraction-dod.sh`
(guard #13, blocking in `pr-checks.yml`) · **Extends:** the KAN-359
Documentation Definition-of-Done, it does not replace it.

---

## 0. The rule

> **An extraction carries its own estate rework in the SAME PR.**

The modularisation plan originally sequenced documentation and verification
rework as a closing phase (G2). That is the classic way a refactor programme
leaves a trail of stale runbooks and inert gates behind it: the estate degrades
module by module while CI stays green, and nobody finds out until something
ships that should not have.

This is not a theoretical worry. KAN-419 measured the baseline before a single
file was moved on purpose:

| Measurement | Result |
|---|---|
| Path literals across `docs/**/*.md` | **110** |
| Of those, matching nothing today | **20 (18%)** |
| `.github/signup-surface.paths` | **100% path globs — every entry moves in the first two extractions** |
| Runnable guards, exit status at scan time | all green |

An unguarded path-reference layer rots at ~18% *without* a refactor. The
estate is healthy today — which is exactly why the gate lands before the first
extraction, not after.

---

## 1. What counts as an extraction

Any PR that **deletes or renames a file under `src/`**. That is the guard's
trigger and this document's scope. A PR that only edits files in place is not
an extraction and the gate is inert for it.

---

## 2. The checklist — for each moved path, what must move with it

Read this as: *"I am moving `<old>` to `<new>`. Which artefacts in this repo
name `<old>` and must be updated in this same PR?"* Every row is derived from
the KAN-419 register; the section reference points at the evidence.

### 2.1 Machine-checked — the guard fails the PR

| Artefact | Why it breaks | Register |
|---|---|---|
| `.github/signup-surface.paths` | 14 patterns, 100% path globs. The signup E2E gate is the **only** thing proving account creation works before staging — the daily soak deliberately does not test signup. A dead glob here is the single highest-consequence failure in the estate. | §1 A1, §4 |
| `.github/CODEOWNERS` | 17 patterns, incl. per-file security paths. A dead entry means a security-critical file merges unreviewed. | §1 A2 |
| `scripts/check-ui-copy-ownership.sh` | 20 protected-path patterns. A dead entry means UI/copy ships without Luisa's sign-off. | §1 A3 |
| `scripts/check-service-role-client.sh` | 2 allow-list literals. Dead ⇒ inline RLS-bypassing clients reappear. | §1 A4 |
| `stryker.config.mjs` | `mutate` globs. Dead ⇒ mutation coverage of the security modules silently drops to nothing. | §1 A5 |
| `scripts/check-routine-ownership.sh` | **Doubly coupled** — 11 `check_marker` calls each pair a file literal with a verbatim *content* needle. A move breaks the path half; a rewording breaks the content half. One of its needles asserts a signup-manifest glob verbatim. | §1 D |
| `docs/DOC_SOURCE_OF_TRUTH.md` | The mirror manifest. `check-doc-mirror-manifest.sh` already fails the PR when a listed path vanishes — this is the existing precedent the new guard generalises. | §1 D |
| `docs/ARCHITECTURE.md`, `RUNBOOK.md`, `OPS_ROUTINES_CONTROL_ROOM.md`, `TEST_AUDIT_2026Q2.md`, and every other `docs/**` prose reference | The system map goes stale. This is the 18% layer. | §1 D |
| `modules.json` | The module's `paths` entry. If it does not move, the module manifest describes a codebase that no longer exists. | §1 D |
| `tests/**` | The module's tests. A test left behind is a test that no longer covers the module it names. | §1 D, KAN-417 |
| `.github/workflows/*.yml` | 30 `bash scripts/X` literals + Actions `paths:` filters + one anchored `grep -E` on changed paths in `pr-checks.yml`. | §1 D |
| `tsconfig.json`, `jest.config.js`, `package.json`, `eslint.config.mjs`, `playwright.config.ts` | TS path mapping, `collectCoverageFrom`, `--testPathPatterns`, flat-config globs, `testDir` / `testMatch` / `testIgnore`. | §1 D |

### 2.2 Human-attested — CI can never check these

Two couplings live outside every repository this CI can read. **No grep will
ever find them.** A ticked box is a weaker control than a machine check, and
this document is not going to pretend otherwise — it is simply the only control
available for these two.

| Coupling | What breaks | PR-body line |
|---|---|---|
| `~/lyra-design-system/build.py` — ⚠️ **Corrected 2026-08-04:** no longer "in no git repo". The design system is now versioned at `github.com/luisa-sys/lyra-design-system` (KAN-441) — but that is a **different repo, which this repo's CI still cannot read**, so the attestation stands and only its *reason* changes. Generates 21 `@dsCard` previews and reads `src/app/globals.css` for design tokens. See `docs/DESIGN_CHANGE_WORKFLOW.md`. | When `ui-kit` extraction moves `globals.css`, the generator's source pointer breaks — loudly, but on her machine, hours later, and nothing warns the agent that moved the file. (The token *duplication* question — `globals.css` vs `build.py` vs the published Design project, with no drift detection between them — is **KAN-427**, not this document.) | `EXTRACTION-DOD-DESIGN-SYSTEM:` |
| The claude.ai **routine prompts** — routine config, not git. | The Staging Soak and Backlog Autopilot prompts name `scripts/staging-soak.sh` and protected-surface path lists **verbatim**. `check-ui-copy-ownership.sh` says in its own header that its list is "mirrored 1:1 from the autopilot's protected-surface list so the guard and the robot agree" — so the repo-side guard and the out-of-repo prompt are a manually-maintained duplicate pair, and CI can only see one half. | `EXTRACTION-DOD-ROUTINE-PROMPTS:` |

### 2.3 Coverage — state it or record the gap

Every extraction PR states which **Playwright project** and which **soak
contract clause (C1–C6)** cover the moved module:

```
EXTRACTION-DOD-COVERAGE: playwright project `authed`, soak clause C4
EXTRACTION-DOD-COVERAGE: no coverage
```

`no coverage` is an acceptable answer and a **finding** — raise it as a ticket.
Recording the gap is the point; leaving the line vague is what hides it.

KAN-419 §6 confirmed the good news here: `scripts/staging-soak.sh` and the
Playwright specs are coupled to **URLs** (`/status`, `/join`, `/api/health`,
`/login`, `/signup`, `/dashboard`, `/{slug}`), not file paths, and the
extraction plan freezes URLs as a live external API. So the soak's C1/C2/C4
layer and most E2E are **resilient** to a move. The checked exceptions are
`tests/e2e/support/*` helper imports and `playwright.config.ts`'s
`AUTHED_MATCH` / `SOAK_MATCH` / `SIGNUP_MATCH` patterns.

### 2.4 Routine-prompt review

When a moved path is one the routine prompts name verbatim, the PR body must
**name the affected routine and its trigger ID**, because no PR can update a
prompt — Luisa does, in the routine config.

| Routine | Trigger ID | Why it is coupled |
|---|---|---|
| Staging Soak | `trig_018MWFmc7LSzj15egayKJNrt` | Names `scripts/staging-soak.sh` verbatim. |
| Backlog Autopilot | `trig_01HniS6vXfGEFR4gvJaLNTM9` | Carries the protected-surface path list verbatim (the `LOOK AND TEXT` surface). |
| Modularisation Scoping | **not recorded in this repo** — see below | Names repo paths verbatim (plan §E-4). |

> **Open item.** `docs/OPS_ROUTINES_CONTROL_ROOM.md` indexes every routine by
> trigger ID except the **Modularisation Scoping** routine, which the
> modularisation plan (§E-4) names as the third path-coupled prompt. Its trigger
> ID is not recorded anywhere in the repo. Until Luisa adds it to the Control
> Room table, this row cannot be verified by anyone reading the repo alone —
> which is precisely the failure mode §2.2 is about. Flagged on KAN-428.

The paths currently known to be named in a prompt are listed in
`ROUTINE_COUPLED` at the top of `scripts/check-extraction-dod.sh`. Keep that
array and the prompts in step; it is a manually-maintained mirror, like the
protected-surface list it partly duplicates.

---

## 3. The PR body

The PR template supplies the three lines. They are machine-read, so the
markers must appear verbatim; the answer after the colon is free text and must
be non-empty.

```
- [ ] EXTRACTION-DOD-DESIGN-SYSTEM: done | n/a — <reason>
- [ ] EXTRACTION-DOD-ROUTINE-PROMPTS: done | n/a — <reason>
- [ ] EXTRACTION-DOD-COVERAGE: playwright project `<name>`, soak clause C<n> | no coverage
```

An extraction PR whose body is **empty or unreadable** fails the gate with
exit 2. An unverifiable human attestation is a failed one.

---

## 4. The escape hatch

A commit in the PR may carry:

```
EXTRACTION-DOD-OK: <JIRA-KEY> <check-id>
```

* It suppresses **exactly one** named check and nothing else.
* A **Jira key is required**. A bare `EXTRACTION-DOD-OK:` is itself a failure.
* Every active exception is **printed on every run**, passing or failing —
  the `UI-Change-Approved` loudness standard. An escape hatch you cannot
  enumerate is an escape hatch you cannot audit.
* Exceptions are **counted**. More than three in one PR emits a `::warning::`
  that the hatch is papering over estate drift rather than recording a
  considered exception.

Check ids: `stale-refs`, `doc-manifest`, `module-manifest`, `test-estate`,
`out-of-repo`, `coverage`, `routine-prompts`.

---

## 5. Exit codes and the fail-closed contract

| Exit | Meaning |
|---:|---|
| 0 | Pass — including "not an extraction PR", which is the common case. |
| 1 | A DoD violation: a stale reference, or a missing/unanswered attestation. |
| 2 | **Cannot verify — fail closed.** |

Exit 2 fires when the diff base cannot be resolved, when an artefact the guard
must sweep is missing, when a search command itself fails, or when an
extraction PR has no readable body.

This is deliberately stricter than KAN-411's UI/copy guard, which fails *open*
on an unresolvable diff base. That guard can afford to: CODEOWNERS still
hard-gates every path it protects. **There is no second gate underneath this
one** — it is the control that protects the other controls — so "unknown" must
never read as "fine". This is the KAN-167 Workflow & Backup Integrity Policy
applied to a guard rather than a workflow.

---

## 6. What this does *not* catch

Stated plainly, because a control whose limits are undocumented gets trusted
past them:

1. **Glob deadness.** The guard matches **literal** old paths. If `docs/` names
   `src/lib/age/**` and you move `src/lib/age/gate.ts`, the literal does not
   match and this guard stays quiet. That is `check-guard-path-drift.sh`'s job
   (F1 / KAN-419 §7) — it evaluates every pattern in the estate and fails the
   ones matching nothing. The two are complements: **F1 catches an inert gate;
   this catches the move that would make it inert.**
2. **Test *floors*.** The register asks that the module's floor entry in
   `modules.json` move with its paths. `modules.json` today (KAN-416 v1) carries
   `paths` but not floors — floor re-anchoring is F5 and has not landed. The
   guard therefore checks the `paths` half only. When F5 lands, extend
   `module-manifest` to the floor entry rather than assuming it is covered.
3. **The two out-of-repo couplings**, by construction (§2.2).
4. **Confluence.** The *Architecture & Infrastructure* and *Data Model &
   Security* pages go stale on a move and no CI can see it. That is the KAN-359
   Documentation Definition-of-Done's item, already on the PR template.

---

## 7. Provenance

| Source | What it gave this document |
|---|---|
| `docs/modularisation/KAN-419-path-coupling.md` | The register — every artefact in §2.1, the 18% measurement, §7.8's companion rule (which is what the `stale-refs` check implements), and both out-of-repo couplings. |
| `docs/modularisation/LYRA_MODULARISATION_PLAN_2026-07-26.md` §6 Workstream F | The promotion of G2 from a closing phase to a per-extraction gate. |
| `docs/OPS_ROUTINES_CONTROL_ROOM.md` | The routine trigger IDs in §2.4. |
| KAN-359 | The Documentation Definition-of-Done this extends. |
