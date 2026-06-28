# Record of Processing Activities (ROPA)

> **Status: DRAFT for founder / legal review.** Prepared 2026-06-28 (SEC-2 / KAN-283).
> This is a first-pass record built from the codebase and architecture; it is
> **not legal advice**. The controller (Luisa / Ben) must review, correct, sign
> off, and keep it current. UK GDPR Art. 30 requires this record to be
> maintained and made available to the ICO on request.

**Controller:** CheckLyra Ltd (trading as Lyra), registered in England & Wales.
**Contact:** privacy@checklyra.com · security@checklyra.com
**ICO registration:** _<to be completed — see KAN-283; Tier 1 fee, £47/yr Direct Debit>_
**DPO:** Not appointed — not legally required (Lyra is not a public authority and
core activity is not large-scale special-category or systematic-monitoring
processing). Founder is the accountable data-protection lead.
**Last reviewed:** 2026-06-28 · **Next review due:** 2026-12-28 (6-monthly until launch, then annually).

---

## A. Categories of data subjects

| # | Data subject | Notes |
|---|---|---|
| DS1 | **Registered users** (adults 18+) | Account holders who build a Lyra profile. Age-gated to 18+. |
| DS2 | **Waitlist sign-ups** | People who submitted an email to join the waitlist but have not completed signup. |
| DS3 | **Contacts** added by a user | Third parties (name + contact method) a user records for Convene/gatherings. Data subject ≠ the account holder. |
| DS4 | **Gathering invitees** | Recipients of an event invite (subset of DS3). |

## B. Processing activities

### P1 — Account & authentication
- **Personal data:** email address, display name, Supabase `auth.users` record, magic-link/OTP tokens, session cookies, IP + user-agent (web logs).
- **Purpose:** create and secure the account; passwordless (magic-link) sign-in.
- **Lawful basis:** Art. 6(1)(b) **contract** (necessary to provide the requested service).
- **Retention:** while account active; purge/anonymise on deletion request (see RETENTION_SCHEDULE.md).
- **Recipients/processors:** Supabase (auth + DB), Resend (sends the magic-link email), Cloudflare (edge/CDN), Vercel (app hosting).

### P2 — Profile content ("Manual of Me")
- **Personal data:** free-text fields (intro, things I love / boundaries / proud of, etc.), headline, city/country, avatar/photo, uploaded files/media, external links, schools/organisations, slug. User-authored, may reveal opinions/preferences.
- **Purpose:** publish a profile page so people the user knows can understand them; power gift recommendations.
- **Lawful basis:** Art. 6(1)(b) **contract** for storing/serving the profile to the user; **Art. 6(1)(a) consent / publication by the user** for making it *public* (the user chooses to publish).
- **Special category note:** users may *volunteer* special-category-adjacent info in free text (health, beliefs, etc.). Lyra does not solicit it; privacy notice should warn against posting sensitive data. No deliberate Art. 9 processing.
- **Retention:** while account active / published; removed on unpublish or deletion.
- **Recipients/processors:** Supabase (DB + Storage for media), Vercel, Cloudflare.

### P3 — Age assurance (Online Safety Act)
- **Personal data:** age-check result (`age_status`), age band (`age_range`), provider reference (`age_provider_ref`), timestamp. The **biometric selfie itself is processed by the provider (Didit), not stored by Lyra** — Lyra receives only pass/fail + band.
- **Purpose:** verify the user is 18+ before publishing (OSA / platform policy).
- **Lawful basis:** Art. 6(1)(c) **legal obligation** (age assurance under the Online Safety Act) and/or Art. 6(1)(f) legitimate interests (child-safety). Provider's biometric step relies on the user's explicit consent captured by the provider.
- **Special category:** the selfie is biometric (Art. 9) **at the provider**; Lyra's stored result is not biometric. Confirm Didit's Art. 9 basis (explicit consent) in their DPA.
- **Retention:** result retained while account active (proof of assurance); provider retention per Didit's policy — confirm and record.
- **Recipients/processors:** Didit (age-verification provider), Supabase.

### P4 — Convene: contacts, calendars & gatherings
- **Personal data:** contact names + contact methods (email/phone) of **third parties**; Google Calendar busy/free times via OAuth; encrypted OAuth refresh token; gathering details, invitees, RSVPs.
- **Purpose:** help the user organise gatherings and find shared availability.
- **Lawful basis:** Art. 6(1)(b) **contract** with the user; for the third-party contact data, Art. 6(1)(f) **legitimate interests** (the user's interest in coordinating with people they know) — balanced by data minimisation and the contact's right to object; **Art. 6(1)(a) consent** for connecting a Google Calendar (the user grants OAuth).
- **Retention:** while the account/contact/gathering exists; OAuth token deleted on disconnect.
- **Recipients/processors:** Google (Calendar API), Supabase, Resend (invite emails).

### P5 — Waitlist
- **Personal data:** email address (and name) submitted to join the waitlist.
- **Purpose:** manage staged access; email the user when a spot opens.
- **Lawful basis:** Art. 6(1)(a) **consent** (the user asks to be notified) / Art. 6(1)(b) pre-contractual steps.
- **Retention:** until converted to an account or the user asks to be removed; **define a TTL** (DP-04 — waitlist emails currently sit in Cloudflare KV without expiry; see SEC-2 / RETENTION_SCHEDULE.md).
- **Recipients/processors:** Cloudflare (KV + Worker), Supabase, Resend.

### P6 — Gift recommendations & affiliate analytics
- **Personal data:** profile-derived interests (input to the recommender); affiliate click events (which outbound link, when). Outbound links carry no PII in query strings.
- **Purpose:** suggest relevant gifts; measure affiliate performance; earn commission.
- **Lawful basis:** Art. 6(1)(f) **legitimate interests** (running the service / monetisation), with privacy-by-default (hidden affiliate links, no PII in outbound URLs).
- **Retention:** aggregated analytics; click logs per RETENTION_SCHEDULE.md.
- **Recipients/processors:** affiliate merchants (Amazon Associates, Bookshop.org, etc.) receive the *click* (not Lyra's user data); Supabase.

### P7 — Transactional email
- **Personal data:** email address, name, message content (magic links, beta notices, invites, weekly owner reports).
- **Purpose:** operate the service.
- **Lawful basis:** Art. 6(1)(b) contract (service emails); consent for any marketing.
- **Recipients/processors:** Resend.

### P8 — Security, abuse-prevention & audit
- **Personal data:** IP/user-agent, moderation logs, admin actions, OAuth token registry (jti), backups.
- **Purpose:** secure the platform, detect abuse, maintain an audit trail, disaster recovery.
- **Lawful basis:** Art. 6(1)(f) **legitimate interests** (security) and Art. 6(1)(c) where a legal duty applies.
- **Retention:** logs/backups per RETENTION_SCHEDULE.md (encrypted WORM backups per DISASTER_RECOVERY.md).
- **Recipients/processors:** Supabase, Cloudflare, Vercel, Railway, R2 (backups).

## C. International transfers

Lyra's processors are predominantly US-headquartered. Transfers outside the UK
rely on the **UK IDTA** or the **UK Addendum to the EU SCCs** incorporated by
each processor's DPA, plus a short **Transfer Risk Assessment** per vendor. See
SUBPROCESSORS.md for the per-vendor mechanism and TRA.

## D. Technical & organisational security measures (summary)

RLS on all user tables (deny-by-default); TLS in transit; encryption at rest
(Supabase/AWS); passwordless auth; OAuth 2.1 with RS256/JWKS; service-role keys
held in platform secret stores; Cloudflare Access on admin surfaces; daily
encrypted WORM backups + restore drills (DISASTER_RECOVERY.md); least-privilege
admin via a separate audited admin MCP. Full detail in ARCHITECTURE.md and the
SEC epic.

---

### Cross-references
- Sub-processors + transfer mechanisms → `SUBPROCESSORS.md`
- Retention periods + deletion → `RETENTION_SCHEDULE.md`
- DSAR / breach / complaints procedures → `DSAR_BREACH_COMPLAINTS.md`
- Founder action list (ICO fee, DPAs, sign-off) → `FOUNDER_CHECKLIST.md`
- Risk register (GOV/DP findings) → Confluence TWC "Lyra Risk Register"
