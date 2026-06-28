# Founder Compliance Checklist (one page)

> Prepared 2026-06-28 (SEC-2 / SEC-3 / KAN-283). These are the items **only the
> founder can do** — they need legal sign-off, a payment, an account/identity, or
> a GitHub/Cloudflare admin action. The supporting documents (ROPA, retention,
> sub-processors, procedures) are drafted in this folder and just need your
> review + sign-off. Tick as you go; record dates/references inline.

## A. Legal registration & money (do first — cheap, enforcement risk)
- [ ] **Pay the ICO data-protection fee** — ico.org.uk/registration, Tier 1, **£47/yr by Direct Debit** (£52 by card). Declare ≤10 staff / ≤£632k turnover. _Not registering is itself an enforcement matter._
  - Registration reference: ________  ·  Renewal date: ________  ·  Calendar reminder set: ☐
- [ ] Add the ICO reference to the public **privacy notice** + the ROPA header.

## B. Data-protection documents (review + sign off the drafts in this folder)
- [ ] **ROPA.md** — review; correct any data category / lawful basis; sign off.
- [ ] **SUBPROCESSORS.md** — for each vendor, **accept/reference its DPA online** and record the date + link. Subscribe to sub-processor-change notices.
- [ ] **RETENTION_SCHEDULE.md** — confirm the proposed periods.
- [ ] **DSAR_BREACH_COMPLAINTS.md** — adopt; make `privacy@checklyra.com` live + monitored.
- [ ] **DPIA** — complete a DPIA (audience + age-assurance/biometric-adjacent + contact/calendar data warrant one). Use the ICO template. _Not drafted here — needs the controller's risk judgement._
- [ ] Confirm **Didit** (age provider): Art. 9 basis (explicit consent), biometric retention/deletion, transfer mechanism, and that Lyra never stores the raw selfie. ← special-category, highest diligence.

## C. Publish the public-facing pieces (before 18+ launch)
- [ ] Privacy notice names controller, ICO ref, lawful bases, retention, DSAR route, **complaints route**, transfer safeguard.
- [ ] **DUAA complaints channel** visible on site/support (live duty from **19 Jun 2026**: 30-day acknowledgement, outcome, ICO signposting).

## D. Governance / change control (SEC-3, GOV-01) — GitHub admin
- [ ] Turn on branch protection on `main` + `beta` (both repos): **require ≥1 approving review**, **enable "Require review from Code Owners"** (CODEOWNERS now exists), set **enforce_admins = true**.
- [ ] Give `staging` at least the PR Quality Gate as a required status check.
- [ ] Protect `lyra-mcp-server/main` with required checks + review.
- [ ] Add **Ben's GitHub handle** to the security-critical lines in `/CODEOWNERS` so PRs get an independent reviewer (until then, the compensating control is the self-review checklist below + post-merge review).
- [ ] Mirror `CODEOWNERS` + `SECURITY.md` into `lyra-mcp-server` (and `lyra-admin-mcp-server`).

## E. Security hygiene (SEC-21 and related — founder-gated)
- [ ] **Rotate the dev Supabase service-role key** and move it out of loose `.env` into a secret store (Railway dev + Vercel dev + local).
- [ ] **SEC-32** — record the admin-MCP pre-launch **security sign-off** (highest-privilege surface; verify CF Access policy scoping first).
- [ ] DR secrets (SEC-23): provision the offline age key + write-only R2 + COMPLIANCE-locked bucket so daily encrypted backups run; do a first supervised restore drill.

## F. Standing self-review control (until a 2nd reviewer is wired in)
On any PR you author and must merge yourself, before merging confirm:
1. Tests green + `tsc` clean; CI required checks green.
2. No secrets/keys in the diff; no new silent-skip/error-swallow in workflows (per CLAUDE.md grep checks).
3. RLS/auth/migration changes reviewed against the Security-Review section of the ticket.
4. The change matches a tracked Jira ticket with the 6 sections.
Record "self-reviewed against checklist" in the PR before merge; schedule a post-merge read-through.

---
**Annual review:** renew the ICO fee, re-check each vendor's sub-processor list,
review the ROPA + retention schedule. (Add as a recurring Jira/calendar task.)
