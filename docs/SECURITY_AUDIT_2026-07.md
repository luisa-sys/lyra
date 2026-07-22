# Security & Operational-Resilience Audit — 2026-07 exit-gate re-run (KAN-295)

**Ticket:** [KAN-295](https://checklyra.atlassian.net/browse/KAN-295) — "Runbook: re-run the checklyra.com security & operational-resilience audit"
**Baseline:** 2026-06-21 red-team assessment (Confluence TWC, page 27033642); first-run remediation under BUGS-34 (BUGS-36..46).
**This cycle:** Phase-4 exit-gate re-run, executed as five bounded, **read-only** autopilot legs over 2026-07-11 → 2026-07-15.
**Scope of this document:** a consolidation of the five completed legs — what was checked, what is non-regressed, and every new finding with its ticket. It is a repo-side summary, **not** the KAN-295 sign-off: the go/no-go exit-gate decision and the dated Confluence assessment page remain Luisa-gated (see "Remaining before KAN-295 closes" below).

> Method note: every leg was read-only (no writes, no prod DB, no workflow dispatches). Code-heavy layers were fanned to parallel read-only sub-agents; every reported finding was re-verified against source before filing. Full per-leg evidence lives in the KAN-295 Jira comments cited in each row.

---

## 1. Legs completed

| Leg | Runbook step | Surface | Date (UTC) | Control-Room row | Result |
|-----|-------------|---------|-----------|------------------|--------|
| A. Database | A | Supabase dev + staging security advisors, SECDEF ACLs, RLS on sensitive tables, storage buckets | 2026-07-11 | #50 | Clean / non-regressed except **SEC-80** |
| B. App-route / server-action | C.10–C.13 | 15 `route.ts` + 14 `*actions.ts` + shared auth primitives (develop @ `adf5e4a`) | 2026-07-13 | #65 | **SEC-81** (1 Med) + **SEC-82** (4 Low); 0 high, 0 regressions |
| C. MCP-tool layer | B | `lyra-mcp-server` @ `e544531` + `lyra-admin-mcp-server` @ `435f28f` — every `.from()` read + write-tool auth | 2026-07-14 | #66 | **SEC-83** (High) + **SEC-84** (Med) + **SEC-85** (Low batch); 0 critical |
| D. CI/CD & supply chain | D | GitHub Actions across all three repos (34 + 3 + 1 workflows) | 2026-07-14 | #68 | **SEC-86** (2 Low); F-17/F-19/F-22/F-09 all clean |
| E. Workstation data-at-rest | E | git history + working trees of all three repos | 2026-07-15 | #72 | **PASS — no findings** |

---

## 2. New findings this cycle

All filed in the **SEC** project, labelled `security-audit` (+ `security-audit-2026-07-11` / `kan-295-audit` variants). Statuses as of 2026-07-18; all remediation is a separate gated slice (dev → staging → prod; prod founder-gated). None fixed under this write-up leg.

| Ticket | Severity | Layer | Summary | Status |
|--------|----------|-------|---------|--------|
| [SEC-83](https://checklyra.atlassian.net/browse/SEC-83) | **High** | MCP auth (user) | Suspended actor retains MCP write + invite-send under `ACCESS_MODEL_V2=off` (v1) — `authenticateApiKey` never checks `is_suspended`; the only suspension gate is `v2`-gated in `requireFeatures`. Prod runs v1 today, so live-latent. | In Progress |
| [SEC-80](https://checklyra.atlassian.net/browse/SEC-80) | Medium | DB (SECDEF) | `search_by_contact_hash` omits `is_suspended=false` — a published+suspended profile is hidden from normal reads yet still returned (id+slug) by phone/postcode contact-hash discovery. Deviates from the F-13/SEC-44 RLS contract. | In Progress |
| [SEC-81](https://checklyra.atlassian.net/browse/SEC-81) | Medium | Web (Convene) | `sendInvites`/`resendInvite`/`dispatchQueuedInvites` omit the SEC-57 standing guard → a suspended host can still dispatch invite emails. | In Progress |
| [SEC-84](https://checklyra.atlassian.net/browse/SEC-84) | Medium | admin-MCP | SEC-47 self/admin-target guard wired only on `admin_suspend_user`; 7 other mutators can self-escalate (`admin_set_feature`, `admin_set_age_status`) or grief peer admins. Missing `destructiveHint` annotations. | In Progress |
| [SEC-86](https://checklyra.atlassian.net/browse/SEC-86) | Medium | CI/CD | (A) prod-promote reviewer gate is post-merge — `promote-to-production.yml` merges beta→main behind only a typed-confirm string, no `environment:` block on the merge job. (B) admin-MCP has no CodeQL/SAST. Both Low individually; not exploitable without repo write. | In Progress |
| [SEC-82](https://checklyra.atlassian.net/browse/SEC-82) | Low (×4) | Web | Batch: (1) report `profileItemId` not verified to belong to target profile; (2) v1 recommendations CDN cache staleness vs suspension; (3) `redeemWaitlistCode` missing standing check + ignored error (mitigated); (4) `updatePassword` skips current-password proof for emailless accounts. | In Progress |
| [SEC-85](https://checklyra.atlassian.net/browse/SEC-85) | Low (batch) | MCP guards | Guard-coverage hardening: ownership-guard `sourceFiles` list stale (5 Convene write-tool files unscanned), suspension/visibility guards index.ts-only, `link_contact` validates `is_published` but not `is_suspended`. Current code hand-verified correct — latent regression-risk. | In Progress |

**Cross-cutting theme:** SEC-80 / SEC-81 / SEC-83 are the *same class* — a suspended/standing control skipped on a live path at, respectively, the DB, web, and MCP layers. SEC-82#3, SEC-84, and SEC-85(c) are further instances of the same suspended-guard / separation-of-duties parity gap. Remediation should treat "suspended-guard parity across all issuance/write surfaces" as one workstream.

---

## 3. Non-regressed baseline (previously-fixed items confirmed holding)

Each was re-checked this cycle and confirmed clean:

- **F-01 / F-14** — `convene_vault_*` and `get_metrics_for_window` remain `service_role`-only (DB leg A.4). ✓
- **F-03 / F-13** — `profiles` public SELECT policy is `is_published = true AND is_suspended = false`; public read APIs (`recommendations/[slug]` + `/v2`) filter both (leg A.3, leg B). ✓ (SEC-80 and SEC-82#2 are *newly-found* deviations on adjacent surfaces, not regressions of the RLS policy itself.)
- **SECDEF ACLs** — no function grants `anon` or PUBLIC EXECUTE; all inspected functions pin `SET search_path` (no `function_search_path_mutable`). ✓
- **OAuth server** — state unguessable/server-stored/single-use/expiry-checked/provider-matched; open-redirect guard present; upstream errors logged not echoed (SEC-76) (leg B). ✓
- **IDOR / ownership** — every dashboard/oauth/verify mutation resolves `auth.getUser()` before writing; admin actions gate on `getCurrentAdmin()`; Convene writes carry explicit `.eq('host_user_id', …)`; MCP write/convene tools owner-scoped with no caller-supplied-id IDOR (legs B, C). ✓
- **Reports** — `reporter_user_id` forced, self-report blocked, 24h per-(reporter,profile) limit, enum + ≤500-char caps (SEC-53) (leg B). ✓
- **CI/CD (F-17/F-19/F-22/F-09)** — no `pull_request_target`; lyra 34/34 workflows least-privilege `permissions:`; lyra 82/82 `uses:` SHA-pinned with zero third-party actions; blocking `npm audit` gates present in lyra + admin-MCP; CodeQL on lyra + mcp-server (leg D). ✓
- **Secrets at rest** — no secret file ever committed in any repo history; no high-signal token prefixes or JWT-shaped tokens in added lines; `.env` ignored in all three repos; no tracked `Backups/` plaintext dumps (leg E). ✓

---

## 4. Scope limitations (honest)

- **No prod DB access.** Legs A were run against dev (`ilprytcrnqyrsbsrfujj`) and staging (`uobmlkzrjkptwhttzmmi`) only — identical advisor surfaces (good env parity). The prod `get_advisors` pass remains part of a supervised/founder-framed full run.
- **SEC-83 prod exposure is config-dependent.** Whether prod is currently exploitable depends on the live `ACCESS_MODEL_V2` value on the `lyra-mcp-server` Railway service, not verifiable from the autopilot container. The v1 code path is a latent hole regardless.
- **Workstation data-at-rest proper** (Luisa's laptop, offline age key, write-only R2 key, R2 dumps — original F-02/F-10 class) cannot be inspected from the container; it lives in the SEC-23/SEC-30/SEC-31 DR-secrets session. Leg E covered repo history/working-trees only (durable `develop`/`main` fully; transient un-fetched `claude/` branches out of scope).

---

## 5. Remaining before KAN-295 closes (Luisa / supervised session)

The read-only evidence-gathering is complete; the exit gate itself is not. Still outstanding:

1. **Prod DB `get_advisors` pass** (supervised full run).
2. **New dated Confluence assessment page** under space TWC, mirroring the 2026-06-21 structure, with a risk-rating table and a diff-vs-baseline — a main-session/Luisa deliverable (the autopilot does not write TWC pages; it owns only the Control Room page).
3. **BUGS/SEC remediation workstream + severity/owner/target-date assignment** for the new findings, and the **go/no-go exit-gate sign-off**.

This document and its presence test are the repo-side artefact of steps 1–5 above; KAN-295 stays **In Progress** until the sign-off lands.
