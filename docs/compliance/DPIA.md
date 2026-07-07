# Data Protection Impact Assessment (DPIA)

> **Status: DRAFT — awaiting founder risk sign-off.** Not legal advice.
> Prepared 2026-07-03 (SEC-70 / KAN-283) following the ICO DPIA template. Every
> section below is filled from the existing compliance pack (ROPA, retention,
> sub-processors, DSAR/breach/complaints) so that only the **residual-risk
> judgement** (likelihood × severity scores) and the **sign-off block** at the
> end remain for the controller to complete. This DPIA is the repo-canonical
> version and supersedes/consolidates the two earlier DRAFTs in Confluence
> (TWC pages 27000875 and 27033667), which the founder should retire in its
> favour.

**Controller:** CheckLyra Ltd (trading as Lyra), registered in England & Wales (company no. 16351012).
**ICO registration:** ZC124222.
**Contact / DP lead:** privacy@checklyra.com (founder is the accountable data-protection lead; no statutory DPO required).
**Assessment date:** 2026-07-03 · **Scope:** the Lyra consumer service at launch (18+ profiles, age assurance, Convene, gift/affiliate analytics).

---

## 1. Identify the need for a DPIA

A DPIA is carried out under UK GDPR Art. 35 because the processing is likely to
result in a high risk to individuals. The triggers are:

- **(a) Audience / children-likely-access.** Lyra is an adults-only (18+)
  service, but it is a public, discoverable profile platform that children may
  attempt to access. The ICO Children's Code and Art. 35 both point to a DPIA
  where a service could be accessed by children even if not aimed at them.
- **(b) Biometric special-category processing.** Age assurance uses Didit's
  **biometric facial age-estimation** (a selfie/liveness check). Biometric data
  used to estimate age is special-category data under Art. 9, and large-scale or
  novel biometric processing is an ICO "likely high risk" trigger.
- **(c) Systematic processing of third-party and calendar data.** Convene
  processes **third-party contact data** (people who are not Lyra users and have
  not themselves consented) and, optionally, **Google Calendar** busy/free data
  via the `calendar.readonly` OAuth scope. Systematic processing of data about
  non-users is an Art. 35 consideration.

This DPIA is the Art. 35 assessment recorded against **SEC-70** and is a launch
blocker until signed off.

## 2. Describe the processing

**Nature, scope, context and purposes** are drawn from the ROPA (P1–P8):

| Ref | Purpose | Data | Notes |
|---|---|---|---|
| P1 | Account & authentication | email, display name | passwordless magic-link; no password stored |
| P2 | Profile content ("Manual of Me") | headline, bio, city/country, preferences, likes/dislikes, boundaries, school, links, photo | all volunteered by the user; may contain free-text that reveals special-category data |
| P3 | Age assurance (18+) | pass/fail result + age band from Didit | **Lyra never receives or stores the selfie image or biometric template** — only the result |
| P4 | Convene: contacts, calendars, gatherings | third-party contact details, gathering data, Google Calendar busy/free | calendar via `calendar.readonly` only (read-only, no write); contacts are third-party data |
| P5 | Waitlist | email | pre-launch interest capture (Cloudflare KV) |
| P6 | Gift recommendations & affiliate analytics | opaque click identifier, standard browser metadata | no account email/name/profile shared with affiliate networks |
| P7 | Transactional email | email, message content | magic links, invites, account notices (Resend) |
| P8 | Security, abuse-prevention & audit | IP, security logs | 90-day retention |

**Data flows.**
- User → Supabase (Postgres/Auth/Storage) for account, profile, contacts.
- Selfie → **Didit** on Didit's own systems; **only the result (pass + band)
  returns to Lyra**. Lyra never stores the image or template.
- Google Calendar → **busy/free times only** via OAuth `calendar.readonly`
  (founder decision: read-only, never write; event contents are not read).
  Tokens are deleted on disconnect.
- Contacts are **third-party personal data** entered by the Lyra user about
  other people.

**Volumes / context.** Low-sensitivity consumer profile data; **adults-only
(18+)**; no payment data, no precise location, no browsing history collected by
Lyra. Media and backups are encrypted; backups are age-encrypted WORM in R2.

## 3. Consultation process

- **Internal:** the founder (accountable DP lead) reviews and signs off this
  DPIA; engineering input is reflected in the ROPA and ARCHITECTURE.md.
- **External guidance:** the ICO DPIA template, Children's Code, and
  biometric/age-assurance guidance were used as the framework.
- **Open (founder decision):** whether to consult data subjects or their
  representatives — in particular whether to seek input on the children-access
  risk and the biometric age-estimation step — and whether any ICO prior
  consultation is warranted (see §6).

## 4. Necessity and proportionality

**Lawful bases (per ROPA):**
- Art. 6(1)(b) contract — account/auth and the core profile service.
- Art. 6(1)(a) consent — publishing a profile; connecting Google Calendar.
- Art. 6(1)(f) legitimate interests — anonymised analytics, security/abuse
  prevention, and processing third-party contact data to operate Convene
  (balanced against the third party's interests; minimised, not published).
- Art. 9(2)(a) explicit consent — the biometric age-estimation step, captured
  by Didit at the point of the selfie check.

**Data minimisation.**
- `calendar.readonly` only — **busy/free, not event contents**; no write access.
- **No selfie stored** — Didit returns only pass/fail + age band.
- No precise location; no payment data; no browsing history.
- Affiliate analytics use an **opaque identifier**, not account identity.
- Contacts held to the minimum needed to run a gathering.

**Retention** follows `RETENTION_SCHEDULE.md` — active-account data retained
while active; deleted-account data purged within 30 days; security logs 90 days;
backups 90-day WORM.

**International transfers** follow `SUBPROCESSORS.md` — UK Addendum to the EU
SCCs / UK IDTA incorporated by each processor's DPA, plus encryption in transit
and at rest. Supabase DPA signed 2026-07-03; Vercel/Cloudflare(R2)/Resend
recorded by reference 2026-07-03; Didit, Google and Railway remain to be
confirmed (Didit at highest diligence as special-category).

## 5. Identify and assess risks

For each risk: the mitigation **already in place** is recorded; the
**likelihood, severity and overall rating are left blank for the founder** to
score (Low / Medium / High), and the **residual risk** after mitigation is the
founder's judgement.

| # | Risk to individuals | Mitigation already in place | Likelihood | Severity | Rating | Residual (founder) |
|---|---|---|---|---|---|---|
| R1 | **Under-18 access** despite the adults-only rule | Age gate + Didit biometric age-estimation before a profile can be created; 18+ self-declaration | ____ | ____ | ____ | ____ |
| R2 | **Biometric misuse / over-retention at Didit** | Result-only architecture (Lyra never stores the image/template); Art. 9(2)(a) explicit consent captured by Didit; Didit DPA + biometric retention/deletion to be confirmed | ____ | ____ | ____ | ____ |
| R3 | **Over-collection of third-party contact data** (contacts who never consented) | Art. 6(1)(f) with minimisation; contacts not published; used only to run gatherings; deletion on account deletion | ____ | ____ | ____ | ____ |
| R4 | **Calendar data exposure** | `calendar.readonly` busy/free only (no event contents, no write); OAuth tokens deleted on disconnect | ____ | ____ | ____ | ____ |
| R5 | **Re-identification / disclosure of special-category free-text** volunteered in profile fields | Privacy-notice warning against posting sensitive data; user controls publish/unpublish and edit/erase; RLS deny-by-default | ____ | ____ | ____ | ____ |
| R6 | **International-transfer / US-government-access risk** | UK Addendum/IDTA via each DPA; encryption in transit + at rest; age-encrypted WORM backups; low-sensitivity dataset (TRA in SUBPROCESSORS.md) | ____ | ____ | ____ | ____ |
| R7 | **Incomplete account deletion** | 30-day purge flow; deletion covers profile, media, contacts; backup rotation | ____ | ____ | ____ | ____ |

## 6. Measures to reduce risk and sign-off

**Technical & organisational measures (from ROPA §D):** RLS on all user tables
(deny-by-default); TLS in transit; encryption at rest (Supabase/AWS);
passwordless auth; OAuth 2.1 with RS256/JWKS; service-role keys in platform
secret stores; Cloudflare Access on admin surfaces; daily encrypted WORM backups
+ restore drills (DISASTER_RECOVERY.md); least-privilege admin via a separate
audited admin MCP; result-only age-assurance architecture; `calendar.readonly`
scope with token deletion on disconnect; 30-day deletion purge.

**Sign-off block (founder to complete):**

- Residual risk (founder): ____________________
- Additional measures required before launch (if any): ____________________
- DPO / measures approved by: ____________________  date: __________
- ICO prior consultation required? (only if residual risk remains **high**
  after mitigations): ☐ yes ☐ no — rationale: ____________________
- Review date: ____________________

---

### Cross-references
- Processing purposes, lawful bases, TOMs → `ROPA.md`
- Retention periods + deletion mechanisms → `RETENTION_SCHEDULE.md`
- Sub-processors + transfer mechanisms + TRAs → `SUBPROCESSORS.md`
- DSAR / breach / DUAA complaints procedures → `DSAR_BREACH_COMPLAINTS.md`
- Founder action list → `FOUNDER_CHECKLIST.md`
- Supersedes: Confluence TWC DRAFT DPIAs 27000875 and 27033667 (retire on sign-off).
