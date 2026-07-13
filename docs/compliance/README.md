# Lyra Compliance Pack

First-pass UK data-protection documentation for CheckLyra Ltd (Lyra), created
2026-06-28 under **SEC-2** (DP-01..04), **SEC-3** (GOV-01) and **KAN-283**.

> **These are DRAFTS for founder / legal review — not legal advice.** They give
> Lyra a defensible documentation baseline that a micro-controller can stand up
> with the free official ICO templates + the vendors' self-serve DPAs. The
> founder owns the legal sign-off, the ICO fee, DPA acceptance, and the DPIA.

| Document | Covers | UK GDPR / law |
|---|---|---|
| [ROPA.md](ROPA.md) | Record of Processing Activities — every data category, purpose, lawful basis, processor | Art. 30 |
| [SUBPROCESSORS.md](SUBPROCESSORS.md) | Sub-processor register + international transfers + per-vendor TRA | Art. 28, 44–46 |
| [DPIA.md](DPIA.md) | Data Protection Impact Assessment — need, description, necessity/proportionality, risk table, measures + sign-off (children-access, Didit biometric, calendar, contacts). **Drafted — awaiting founder risk scores + sign-off (SEC-70).** | Art. 35 |
| [RETENTION_SCHEDULE.md](RETENTION_SCHEDULE.md) | Retention periods + deletion mechanisms (incl. waitlist-KV TTL) | Art. 5(1)(e) |
| [DSAR_BREACH_COMPLAINTS.md](DSAR_BREACH_COMPLAINTS.md) | Data-subject rights (1 month), breach (72h), DUAA complaints (30-day) | Art. 12–22, 33/34; DUAA 2025 |
| [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) | One-page list of founder-only actions (ICO fee, DPAs, branch protection, sign-offs) | — |

**Also relevant (existing):** `/SECURITY.md` (vuln disclosure), `/.github/CODEOWNERS`
(SEC-3 change-control — single source of truth; GitHub enforces the `.github/` copy),
`docs/DISASTER_RECOVERY.md` (SEC-23 backups/restore),
`docs/SECURITY_ROTATION.md` (secret rotation). The Risk Register lives in
Confluence (TWC "Lyra Risk Register"); the SEC Jira epic (SEC-1) tracks findings.

**Founder-owned (drafted here, needs the controller's judgement/sign-off):** the
**DPIA** ([DPIA.md](DPIA.md)) is now drafted from the pack — only the residual
risk scores + signature remain (SEC-70). Still fully founder-owned and not
auto-completable: **ICO registration/payment** (done — ref ZC124222), remaining
**DPA acceptance** for Didit/Google/Railway, and the **branch-protection**
GitHub-admin changes — all listed in [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md).
