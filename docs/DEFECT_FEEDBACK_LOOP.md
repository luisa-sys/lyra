# The Defect Feedback Loop

**Ticket:** SEC-101 · **Adopted:** 2026-07-27 · **Owner:** Luisa (founder)

> Every bug and every security finding must leave the platform permanently
> harder to break in that way again. A fix that does not change a control is a
> repair, not a lesson.

---

## 1. Why this exists

Lyra has closed 129 BUGS and SEC defects. They were fixed properly. But the
same root causes kept returning, because nothing forced the step *after* the
fix — deciding what would have caught it, and making that permanent.

The evidence is in the ticket history:

| Root cause | Recurrences | Tickets |
|---|---|---|
| Postgres `EXECUTE` granted to `anon`/`authenticated` on a `SECURITY DEFINER` function | **9** | SEC-12, SEC-15, SEC-27, SEC-28, SEC-29, SEC-42, SEC-43, BUGS-48, BUGS-65, BUGS-69 |
| A suspension / eligibility guard added to one call site but not its siblings | **8** | SEC-44, SEC-47, SEC-57, SEC-58, SEC-81, SEC-83, SEC-84, SEC-85 |
| Release workflows reporting SUCCESS while doing nothing | **14** | BUGS-4, 6, 7, 8, 9, 10, 11, 13, 15, 16, 18, 20, 54, 72 |
| An `npm audit` gate red-lining the entire deploy chain | **6** | SEC-89, SEC-90, SEC-91, SEC-92, SEC-94, SEC-97 |
| Partial-read / whole-row-write data loss | **3** | BUGS-70, BUGS-73, BUGS-74 |

SEC-42 is the clearest illustration. SEC-29 revoked an `authenticated` EXECUTE
grant on the admin RPCs. It was verified and closed. A later migration
re-granted it, and the same hole reappeared on production. The fix was correct;
what was missing was a control that would notice.

**Baseline at adoption: 22.5% of closed defects had a control behind them.**
That number is the loop's headline metric and is expected to rise over time.

---

## 2. The loop

```
  defect found
       │
       ▼
  fix + close  ──────────►  PREVENTION ANALYSIS  (§3, mandatory before Done)
                                   │
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
   (a) control existed      (b) no control        (c) unpreventable
       but missed it            exists                by a gate
             │                     │                     │
             ▼                     ▼                     ▼
   fix the CONTROL and      build a control        record the reason
   add a fixture to its     + register it          + owner who agreed
   self-test                in controls/registry.json
             │                     │                     │
             └─────────────────────┴─────────────────────┘
                                   │
                                   ▼
                    controls/registry.json  (the memory)
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   check-control-registry.py                 Weekly loop routine (§5)
   (every PR — the registry                  (closes the loop: finds
    cannot drift from reality)                defects with no control)
```

---

## 3. Prevention analysis — mandatory before a BUGS/SEC ticket goes to Done

Every BUGS and SEC ticket must answer one question before it closes:

> **What automated control would have caught this before merge?**

Record the answer in the ticket as a literal line:

```
Prevention: CTL-023
```
```
Prevention: none — <reason> (agreed: Luisa, 2026-07-27)
```

Exactly one of three outcomes applies.

### (a) A control existed and did not fire

**This is the most valuable outcome and the easiest to skip.** The control is
defective — treat that as its own finding, not a footnote.

- Work out *why* it missed. Wrong scope? Wrong pattern? Passing vacuously?
- Fix the control.
- **Add a fixture reproducing the miss to the control's `--self-test`.** This is
  non-negotiable: it is what stops the same blind spot recurring.

Worked example from this repo: the first cut of
`check-partial-write-safety.py` was *file*-scoped and passed
`src/app/dashboard/profile/actions.ts`, because an unrelated function in the
same file contained `!== undefined` while the actually-dangerous
`updateProfileFields` had no guard at all. It was rewritten to be
*function*-scoped, and the fixture
`vulnerable: guard is in a DIFFERENT function` now pins that exact miss.

### (b) No control exists

Build one. Then register it in [`controls/registry.json`](../controls/registry.json)
with the ticket in its `prevents` list.

Choose the strongest mechanism available, in this order:

| Rank | Mechanism | Why | Example |
|---|---|---|---|
| 1 | **Make it impossible** — types, DB constraints, architecture | cannot be forgotten | column-level grants; `undefined` omitted at the write path |
| 2 | **Assert it exhaustively** — a test that enumerates the surface | new call sites are covered automatically | the auto-discovering loader scan in `partial-write-safety.test.ts` |
| 3 | **Detect it statically** — a grep/AST gate in `pr-checks.yml` | cheap, fast, pre-merge | `check-migration-privileges.py` |
| 4 | **Detect it live** — a scheduled assertion against the running system | catches out-of-band change | `check-db-invariants.py` |
| 5 | **Document it** — CLAUDE.md gotcha | last resort; humans forget | gotchas #18, #22 |

A control that *enumerates* a surface beats one that *samples* it. The BUGS-74
loader guard originally used a hardcoded list of three files — and the legacy
editor was missed precisely because nobody added it to that list. Its
replacement discovers loaders by scanning the tree.

### (c) Genuinely unpreventable

Rare, and it needs a named owner. Acceptable reasons: a third-party outage, an
upstream framework bug with no detectable signature, a one-off remediation
project rather than a defect. Label the ticket with one of
`third-party-outage`, `upstream-bug`, `vendor-config` so the loop reports it as
exempt rather than as a gap.

"We'll be careful next time" is **not** an acceptable reason.

---

## 4. The control registry

[`controls/registry.json`](../controls/registry.json) is the durable memory of
this loop — 26 controls across 14 defect classes, each naming the historical
tickets it would have caught.

Each entry records: `id`, `name`, `defect_class`, `summary`, `implementation`,
`kind` (`ci-gate` / `test` / `scheduled` / `policy`), `wired_in`, `prevents`,
optional `self_test`, and its `escape_hatch`.

`scripts/check-control-registry.py` runs on **every PR** and fails if:

1. a registered control's implementation file is missing;
2. nothing actually invokes it — *the SEC-79 failure mode, where
   `health-check.yml` and `weekly-report.yml` sat disabled for over a month
   while still reporting green*;
3. a `scripts/check-*.{sh,py}` exists in the repo but is not registered;
4. a control cites no Jira key, or its declared `self_test` names a missing file.

### Every control must be able to fail

A control that cannot demonstrate a failure is indistinguishable from no
control. Each one therefore ships with:

- a **`--self-test`** carrying at least one *known-bad* fixture it must reject
  and one *known-good* fixture it must accept, run in CI **before** the real
  scan; and
- a **vacuous-pass guard** — if the scan finds zero targets, it fails rather
  than reports green. Finding nothing means the detector has drifted, not that
  the risk is gone.

When you add a control, prove it by mutation: reintroduce the original defect,
confirm the control goes red, then revert. Record that you did.

---

## 5. The weekly loop routine

Runs as a scheduled **claude.ai cloud routine**, alongside Daily Security and
Weekly Health + Regression. Same conventions as
[`docs/OPS_ROUTINES_CONTROL_ROOM.md`](OPS_ROUTINES_CONTROL_ROOM.md):
read-only over Jira, one heartbeat row per run, honest `PASS` / `FAIL` /
`UNVERIFIED`.

**Cadence:** weekly, Monday 08:00 UTC (after the 07:00 weekly report).

### Steps

1. **Query Jira** for BUGS and SEC tickets resolved since the last heartbeat:

   ```
   project IN (BUGS, SEC) AND status = Done AND resolutiondate >= -8d ORDER BY key ASC
   ```

   Write them to `closed.json` as
   `[{"key", "summary", "labels", "resolutiondate"}, …]`.

   > ⚠️ Jira MCP returns descriptions regardless of the `fields` parameter, so
   > more than ~2 issues per query overflows the SSE transport. Page in small
   > batches, or save the tool result to disk and slice it with `jq`. A U+2028
   > character in BUGS-30 makes it unreadable by every Atlassian tool — skip it
   > by key rather than retrying.

2. **Compute coverage:**

   ```bash
   python3 scripts/defect-control-coverage.py --closed-tickets closed.json
   ```

3. **For each GAP**, do the §3 prevention analysis. Raise one SEC task per gap,
   titled `Control gap: <ticket> — <defect class>`, containing the six-section
   ticket standard and a proposed control.

4. **Check for stale claims.** A control claiming a still-open ticket usually
   means it was written from the description before the fix landed. Re-verify.

5. **Verify the controls still work.** Run every registered `self_test`:

   ```bash
   python3 scripts/check-control-registry.py
   for t in $(python3 -c "import json;[print(c['self_test']) for c in json.load(open('controls/registry.json'))['controls'] if c.get('self_test')]"); do :; done
   ```

6. **Write the heartbeat row** to the Ops Routines Control Room:
   `Timestamp | Defect Feedback Loop | PASS/FAIL/UNVERIFIED | tickets raised | next-expected | coverage %`.

### Honesty rules

- A run that cannot reach Jira is **UNVERIFIED**, never a silent PASS.
- The routine **raises tickets; it does not build controls**. Designing a
  control is engineering work with a human in the loop.
- Never close a gap by adding the ticket to a control's `prevents` list unless
  that control genuinely catches it. The registry is evidence, not decoration.

---

## 6. Where this plugs into existing process

| Existing artefact | Change |
|---|---|
| `CLAUDE.md` → Jira Ticket Standard | BUGS/SEC tickets need a `Prevention:` line before Done |
| `docs/JIRA_TICKET_STANDARD.md` | same, with the three outcomes spelled out |
| `docs/OPS_ROUTINES_CONTROL_ROOM.md` | new routine + heartbeat row |
| `.github/workflows/pr-checks.yml` | `check-control-registry.py` on every PR |
| `docs/RUNBOOK.md` | links here from the routine schedule |

---

## 7. Known open gaps in the control environment

Recorded here rather than quietly carried. Each needs a decision.

| Gap | Evidence | Why it matters |
|---|---|---|
| `staging` has **zero** required status checks | `gh api repos/luisa-sys/lyra/branches/staging/protection` → `required_checks: []` | A branch in the promotion chain with no gate |
| `develop` does not require CodeQL | same, `develop` → `["PR Quality Gate"]` only | All feature work lands on `develop` |
| `main-chain-guard` is not a required check | `main` → `["CodeQL Analysis", "PR Quality Gate"]` | SEC-98's technical backstop is advisory, exactly as CLAUDE.md warns |
| `enforce_admins: false` on all four branches | branch protection API | Every gate is admin-bypassable |
| Zero required reviewers on all branches | `required_approving_review_count: 0` | No second pair of eyes anywhere |
| `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`, `SUPABASE_MANAGEMENT_TOKEN` are referenced by workflows but **do not exist** | `gh secret list`; environments hold no secrets | They expand to empty strings — silent degradation |
| `security_invariants_report()` not yet applied to any database | migration `20260727090000` is in the repo only | `check-db-invariants.py` reports UNVERIFIED until it is applied to dev, staging and production |
| 21 pre-existing migrations lack a `REVOKE ... FROM PUBLIC` | `supabase/migration-privileges-baseline.json` | Grandfathered; fix forward, and the list may only shrink |
| `profile-photos` bucket is world-readable on all three databases | live query, 2026-07-27 | SEC-60, waived until 2026-10-31 |

---

## 8. Quick reference

```bash
# Is the registry still true?
python3 scripts/check-control-registry.py

# Are the escape hatches still owned and dated?
python3 scripts/check-waiver-hygiene.py

# Do the databases still satisfy the security invariants?
python3 scripts/check-db-invariants.py

# What did we learn from the defects closed this week?
python3 scripts/defect-control-coverage.py --closed-tickets closed.json

# Prove every control can still fail
python3 scripts/check-partial-write-safety.py --self-test
python3 scripts/check-migration-privileges.py --self-test
python3 scripts/check-db-invariants.py --self-test
python3 scripts/check-waiver-hygiene.py --self-test
python3 scripts/check-control-registry.py --self-test
python3 scripts/defect-control-coverage.py --self-test
```
