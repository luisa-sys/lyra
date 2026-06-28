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
| [RETENTION_SCHEDULE.md](RETENTION_SCHEDULE.md) | Retention periods + deletion mechanisms (incl. waitlist-KV TTL) | Art. 5(1)(e) |
| [DSAR_BREACH_COMPLAINTS.md](DSAR_BREACH_COMPLAINTS.md) | Data-subject rights (1 month), breach (72h), DUAA complaints (30-day) | Art. 12–22, 33/34; DUAA 2025 |
| [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md) | One-page list of founder-only actions (ICO fee, DPAs, branch protection, sign-offs) | — |

**Also relevant (existing):** `/SECURITY.md` (vuln disclosure), `/CODEOWNERS`
(SEC-3 change-control), `docs/DISASTER_RECOVERY.md` (SEC-23 backups/restore),
`docs/SECURITY_ROTATION.md` (secret rotation). The Risk Register lives in
Confluence (TWC "Lyra Risk Register"); the SEC Jira epic (SEC-1) tracks findings.

**Not in this pack (founder-owned, can't be auto-drafted):** the **DPIA** (needs
the controller's risk judgement), the **ICO registration/payment**, **DPA
acceptance** per vendor, and the **branch-protection** GitHub-admin changes — all
listed in [FOUNDER_CHECKLIST.md](FOUNDER_CHECKLIST.md).
