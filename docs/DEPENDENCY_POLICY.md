# Dependency Freshness Policy (SEC-197)

> **The rule (founder, 2026-11-23):** "make it policy that we always upgrade whenever external software has vulnerabilities or is more than 3 months old."
>
> In practice: **if a dependency is vulnerable, or is more than 90 days old and a newer release exists, upgrade it on `develop`.** If you can't, record a dated waiver. Don't just flag it.

This page turns that rule into definitions, deadlines and an exception process, and names the control that enforces it (**CTL-081**, `scripts/check-dependency-freshness.py`). It applies to every Claude session and every human change. `CLAUDE.md` → "Dependency freshness (SEC-197)" holds the short binding version.

---

## 1. Scope

**Repositories:** every Lyra repo:

| Repo | Covered by the CTL-081 control today? |
|---|---|
| `luisa-sys/lyra` (this repo) | **Yes**: daily report and PR gate |
| `luisa-sys/lyra-mcp-server` | Policy applies; control not yet ported (follow-up) |
| `luisa-sys/lyra-admin-mcp-server` | Policy applies; control not yet ported (follow-up) |
| `luisa-sys/lyra-design-system` | Policy applies; control not yet ported (follow-up) |

**External software in scope:**

| Kind | Vulnerability rule | Age rule |
|---|---|---|
| npm packages | **direct and transitive** (anything in `package-lock.json`) | **direct** dependencies only (`dependencies`, `devDependencies`, `optionalDependencies`) |
| GitHub Actions (`uses:` pins) | yes | yes |
| Node.js runtime (`node-version:` in workflows, `engines`, `.nvmrc`) | yes | yes (see the runtime definition below; the control reads only simple `node-version:` major pins — see §7) |
| Base images, service images and CLIs pinned in the repo (for example `postgres:17` in a workflow, `python-version: '3.12'`, `vercel@…`) | yes | yes |

Transitive npm packages are outside the age rule on purpose. Their versions are chosen by their parents, and the fix is to upgrade the direct dependency that pulls them in. Vulnerabilities are different: a vulnerable transitive package is in scope, and an `overrides` pin may be the right fix (see CLAUDE.md gotcha #23 for how to scope an override safely).

## 2. Definitions

**Vulnerable.** An advisory of **any severity** (critical, high, moderate, low) covers the version that is actually installed. For npm, "installed" means the version resolved in `package-lock.json`, and the source is `npm audit --json` against the full tree, dev included. A package flagged only because something beneath it is vulnerable isn't counted separately: the package beneath it is the finding.

**Fix available.** A released, non-prerelease version exists that is outside the advisory's vulnerable range. If it exists, you upgrade (§3). If it doesn't, you need a waiver (§5).

**More than 3 months old.** The installed version's **publish date** is more than **90 days** before today, **and** a **newer stable release** exists. Both conditions must hold:

- Old and still the latest release: in policy. Nothing to upgrade to.
- A newer release exists but the installed version is ≤ 90 days old: in policy.
- More than 90 days old **and** superseded: **out of policy, so upgrade.** **Majors count.** A major upgrade is still an upgrade. If the major needs code changes, do that work on `develop` like any other change, or take a waiver while you do it.

For npm, the publish date is the registry's `time[<version>]`, and "newer stable release" means `dist-tags.latest` is a higher, non-prerelease version.

**Runtime (Node.js).** A pinned major line (for example `node-version: '20'`) counts as installed at its **newest release**. It's out of policy when that newest release is more than 90 days old, which means the line has stopped receiving releases, **and** a newer LTS major exists. So Node 22 stays in policy while it still gets maintenance releases, even after Node 24 ships. Node 20 has had no release since 2026-03-24 and is out of policy.

## 3. Deadlines (SLA)

The clock starts when a **fixed version exists** (vulnerabilities) or when a dependency **becomes** out of policy (age).

| Finding | Upgrade merged to `develop` within |
|---|---|
| Vulnerability, **critical or high** | **2 days** |
| Vulnerability, **moderate or low** | **14 days** |
| Age (> 90 days and superseded) | Next dependency PR, and no later than **14 days** |

"Upgraded" means merged to `develop` through the **normal PR flow**: tests, the PR Quality Gate and review all apply. This policy changes **what** must be upgraded and **how fast**. It doesn't change how changes reach production.

## 4. How this works with SEC-98 (production change control)

**Nothing in this policy bypasses the promotion chain.** A security fix reaches production the same way as every other change: `develop → staging → beta → main`, through the promote workflows. Never push straight to `main`, never use an isolated hotfix branch, and never merge a PR whose base is `main` (`main-chain-guard.yml` blocks all three). See `CLAUDE.md` → "Production change control — no chain-bypass hotfixes (SEC-98)".

What the policy adds:

- **Run the promote chain promptly after a security fix lands on `develop`.** Don't wait for the weekly release. `docs/RELEASE_POLICY.md` → "Security SLA" already asks for high/critical fixes to reach production within 24 hours of landing on `develop`. This policy's 2-day deadline covers getting the fix **onto** `develop`. Together, a high or critical fix is in production within about 3 days of a fixed version existing.
- **Running the promotes is the founder's step.** `promote-to-staging.yml`, `promote-staging-to-beta.yml` and `promote-to-production.yml` are dispatched by Luisa (production is manual-only, SEC-98). A Claude session lands the fix on `develop`, reports that a security promote is due, and stops there.

**Dependabot security PRs against `main` (SEC-190).** GitHub opens Dependabot *security* updates against the repository's default branch (`main`), whatever `target-branch` says in `.github/dependabot.yml`. That setting only governs *version* updates. Those PRs can never merge: `main-chain-guard.yml` blocks every PR to `main`. Under this policy:

1. A `main`-targeted Dependabot security PR is **a signal, not a route**. The same upgrade is made on `develop`, either by the matching Dependabot version-update PR (which targets `develop`) or by hand. The CTL-081 daily report lists the vulnerability either way.
2. Once the fix has been **promoted to `main`** through the chain, close the `main`-targeted PR with a comment linking the promote run. Dependabot usually closes it on its own once `main` is no longer vulnerable.
3. Never merge or admin-merge it.

## 5. Waivers: the only exception

If **no fixed version exists**, or an upgrade is **genuinely blocked**, add an entry to **`security/dependency-freshness-waivers.json`**. A genuine block is a breaking change that needs real work, or an upstream bug in the new version. "No time" is not a block.

```json
{
  "waivers": [
    {
      "package": "picomatch",
      "kind": "vulnerability",
      "advisory": "GHSA-xxxx-xxxx-xxxx",
      "reason": "No patched release exists (SEC-194). Reachable only from build-time globbing; no user input reaches it. Re-check weekly.",
      "jira": "SEC-194",
      "expires": "2027-01-15",
      "approved_by": "founder 2026-11-23 standing policy"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `package` | npm package name. Use `node` for the Node.js runtime pin. |
| `kind` | `vulnerability` or `age` |
| `advisory` | One GHSA id for `vulnerability` (one entry per advisory). `null` for `age`. |
| `reason` | Why it isn't upgraded **and** what mitigates the risk in the meantime. At least 40 characters. |
| `jira` | The ticket tracking the upgrade: any Jira key, e.g. `SEC-194`. |
| `expires` | `YYYY-MM-DD`, **no more than 90 days** after the day the check runs. |
| `approved_by` | Who approved it, for example `founder 2026-11-23 standing policy`. |

**File shape.** The file is `{"waivers": [...]}` with exactly the entry fields above. It also carries two top-level documentation keys, `_why` (the rules, in the file itself) and `ticket` (`SEC-197`). That is a deliberate deviation from the bare `{"waivers": [...]}` shape, copied from `security/npm-audit-waivers.json` so both waiver files read the same way. The validator ignores top-level keys other than `waivers`; inside an entry, unknown fields are malformed.

Rules the control enforces:

- **Expired waivers fail.** When a waiver lapses, both the daily job and any dependency PR go red. At that point you either upgrade or **renew with a fresh reason**. Moving the date forward with the same reason isn't a renewal.
- **One package and one advisory per waiver.** A waiver never carries over to another package that shares the advisory.
- **Stale waivers are removed.** A waiver that matches nothing (because the upgrade happened) is reported as stale and should be deleted. The file should only hold live exceptions. **An empty file is the correct steady state.**

## 6. Relationship to `security/npm-audit-waivers.json` (kept, not folded in)

The two waiver files stay **separate**. That's the least disruptive option, and the two files waive different gates:

| File | Waives | Governed by |
|---|---|---|
| `security/npm-audit-waivers.json` | The **blocking prod-tree HIGH/CRITICAL** audit gate in `pr-checks.yml` (SEC-105) | CTL-052 (matching), CTL-025 (hygiene: ticket/owner/reason, `expires` ≤ 12 months or `review_by`) |
| `security/dependency-freshness-waivers.json` | **This policy**: any severity, any tree, plus the age rule | CTL-081 (shape, ≤ 90-day expiry, expiry fails, staleness) |

If a package has an unfixable HIGH in the production tree, it needs an entry in **both** files. The audit-gate entry stops PRs being blocked; the freshness entry records the policy exception and its 90-day re-look. Merging the two would mean either loosening CTL-081's 90-day cap to CTL-025's 12 months, or tightening every existing audit waiver. Neither is worth the churn while both files are empty.

## 7. The control (CTL-081)

`scripts/check-dependency-freshness.py` is registered in `controls/registry.json` and has a self-test plus fixture-driven jest tests in `tests/scripts/check-dependency-freshness.test.js`.

| Where | Mode | Blocking? |
|---|---|---|
| `dependency-freshness.yml`, **daily 05:40 UTC** (its own workflow) | `--report --report-only`: the whole tree (all advisories, all direct-dependency ages, pinned Node majors) | **No.** It opens, updates or closes **one** GitHub issue, *"Dependency freshness — out-of-policy dependencies (SEC-197)"* (label `dependencies`). It goes red only for an **expired or malformed waiver** or a **failed measurement**. |
| `pr-checks.yml`, step *"Dependency freshness — dependency PRs only"* | `--pr --base origin/<base>` | **Yes, but only** when the PR changes `package.json`, `package-lock.json` or the waiver file. Even then, it fails only on an expired or malformed waiver, or on what the PR **introduces relative to its base** (below). |

**What "introduces" means in the PR gate.** The gate audits both the PR's tree and the base tree (the base from its lockfile alone, `npm audit --package-lock-only`), then fails on:

- a vulnerability on a new or re-versioned lockfile entry whose **identity — (package name, installed version, advisory) — the base audit does not already report**. Identity is never the lockfile path: a lockfile regeneration that hoists or nests an already-vulnerable copy (same name, same version, same advisory) moves it and introduces nothing, and a fix that clears one copy while another copy of the same version stays vulnerable leaves it *still present* (the daily report keeps listing it), not introduced. A `(name, advisory)` pair absent from the base fails, and so does the same advisory on a version the base did not carry it on, with one exception: a bump that replaces an older base version and stays vulnerable to the same advisory (for example `glob` 10.4.5 → 10.4.6 while the fix needs a parent's major) is a step forward and passes. Each replaced base copy excuses one such bump, so adding a further vulnerable version, or moving backwards, still fails.
- a **changed direct dependency that is out of the age rule**, unless the base version was **also** out of it and the PR doesn't move it backwards. `eslint` 9.39.3 → 9.39.4 while 10.x is latest is a step toward compliance and passes. A new dependency that is already old, a version that was in policy at base, or a downgrade, fails.

Improvements therefore never need a waiver first. The daily issue still lists what remains out of policy.

**The PR gate is time- and feed-dependent.** Re-running an unchanged dependency PR can turn red: a new advisory may be published against a version it introduces, or an introduced version may cross 90 days while the PR sits open. That is accepted because only dependency PRs are exposed, and the answer is the same as any finding: upgrade further, or waive.

**Why it is built this way (the SEC-88 lesson).** A gate driven by a third-party feed, sitting in front of every PR, froze the pipeline for about 11 days in SEC-88. Twelve tested security fixes were held out of production. CTL-081 can't repeat that:

- A PR that doesn't touch dependencies is "not applicable" and makes **no network call**.
- An advisory published overnight against a package the PR didn't touch **never blocks the PR**. It shows up in the daily issue.
- Measurement failures are retried for network faults (the audit uses CTL-052's `run_audit`), then fail closed. A measurement that didn't run is never reported as clean.

**Not measured by the control yet.** These are still in policy scope (§1) and get checked by hand, or by Dependabot where noted:

- GitHub Actions versions. Dependabot opens weekly grouped PRs against `develop`.
- Node.js pins the runtime check can't read: `engines` in `package.json`, `.nvmrc`, `node-version-file:`, `node-version:` given as a matrix list, as a full `x.y.z` pin, or as an alias such as `lts/*`. Only single-major `node-version: '20'` / `20.x` pins in workflows are measured.
- Python versions, service images and CLIs pinned in workflows (`postgres:17`, `python-version`).
- The other three repos.

## 8. Dependabot

`.github/dependabot.yml` covers **npm** and **github-actions**. Both target **`develop`** and run **weekly** (Monday). Minor and patch updates are grouped, and majors get their own PR for review. A weekly cadence is well inside the 90-day window. Dependabot raises the PRs; this policy says they get merged rather than left open. A Dependabot PR that fails `npm ci` (BUGS-112) or goes stale (BUGS-113) is still a pending upgrade, so fix it or redo the bump by hand. Don't close it and forget it.

## 9. What every session does

When you see a vulnerable dependency, or one that is more than 90 days old and superseded, in any Lyra repo:

1. **Upgrade it on `develop`** in a PR, in the same session when you can. Don't just mention it.
2. If you can't (there's no fix, or the upgrade is genuinely blocked), **add a waiver** with a ticket and a mitigation, and say so.
3. For a security fix, tell the founder **a promote is due** (§4).

Related: SEC-174 (critical/high open on `main`), SEC-190 (Dependabot security PRs target `main`), SEC-194 (picomatch has no patched release), BUGS-112/BUGS-113 (Dependabot PR health), SEC-105/CTL-052 (scoped audit gate), SEC-170 (audit-forced overrides have no expiry).
