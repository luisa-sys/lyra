# Record of Processing Activities (ROPA)

> **Status: DRAFT for founder / legal review.** Prepared 2026-06-28 (SEC-2 / KAN-283).
> This is a first-pass record built from the codebase and architecture; it is
> **not legal advice**. The controller (Luisa / Ben) must review, correct, sign
> off, and keep it current. UK GDPR Art. 30 requires this record to be
> maintained and made available to the ICO on request.

**Controller:** CheckLyra Ltd (trading as Lyra), registered in England & Wales.
**Contact:** privacy@checklyra.com · security@checklyra.com
**ICO registration:** ZC124222 (CheckLyra Ltd; registered 17 Apr 2026; renewal ~17 Mar 2027; Tier 1, £47/yr Direct Debit).
**DPO:** Not appointed — not legally required (Lyra is not a public authority and
core activity is not large-scale special-category or systematic-monitoring
processing). Founder is the accountable data-protection lead.
**Last reviewed:** 2026-07-03 · **Next review due:** 2026-12-28 (6-monthly until launch, then annually).

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

### P3 — 18+ self-declaration
> **Changed 2026-07-20.** This activity previously described a provider-run
> biometric facial age-estimation (Didit). That check has been **removed**. Lyra
> no longer sends any image to an age-assurance provider, no longer receives a
> pass/fail result or age band, and no longer has Didit as a processor. The
> removal eliminated Lyra's **only** Article 9 special-category processing.

- **Personal data:** a single timestamp (`profiles.age_declared_18_at`) recording that the user confirmed they are 18 or over, and when. No date of birth, no age band, no document, no image, no biometric.
- **Purpose:** apply and evidence Lyra's adults-only (18+) rule.
- **Lawful basis:** Art. 6(1)(b) **contract** — being 18+ is a term of service (see /terms), so recording the user's confirmation is necessary to provide the service on those terms. Supported by Art. 6(1)(f) legitimate interests (keeping an adults-only service adults-only).
- **Special category:** **none.** No Art. 9 data is processed for this activity, or anywhere else in Lyra.
- **Retention:** while the account is active; removed with the account.
- **Recipients/processors:** Supabase only.
- **Note on the Online Safety Act:** the previous entry claimed Art. 6(1)(c) legal obligation citing the OSA. Lyra does not host pornography or "primary priority content", so the OSA's *highly effective age assurance* duty is not the driver here — the 18+ rule is Lyra's own contractual term. **Confirm this characterisation with a data-protection adviser before relying on it** (see FOUNDER_CHECKLIST.md).

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

## E. Data location inventory — person-keyed tables

**Added 2026-08-04 (SEC-117).** Sections A–D describe *categories* of personal
data. They did not say where any of it lives, so a DSAR worked by hand from this
document had no locate-checklist — the same gap the code had, where the export
queried 18 tables while the deletion cascade erased 32.

This table is the checklist. It is **kept honest by a test**:
`tests/unit/ropa-table-inventory.test.ts` asserts that every table in
`src/lib/gdpr/person-keyed-tables.ts` appears below, so the manifest and this
document cannot drift apart. Adding a person-keyed table to a migration without
recording it here is a red build.

| Table | Activity | Keyed by | SAR treatment |
|---|---|---|---|
| `profiles` | P1 | `user_id` | exported |
| `api_keys` | P1 | `user_id` | exported (hashes redacted) |
| `consent_log` | P1 | `user_id` | exported |
| `feature_entitlements` | P1 | `profile_id` | exported |
| `profile_items` | P2 | `profile_id` | exported |
| `school_affiliations` | P2 | `profile_id` | exported |
| `external_links` | P2 | `profile_id` | exported |
| `profile_manual_of_me` | P2 | `profile_id` | exported |
| `profile_conversation_starters` | P2 | `profile_id` | exported |
| `profile_files` | P2 | `profile_id` | exported |
| `contacts` | P4 | `owner_user_id` | exported |
| `contact_methods` | P4 | via `contact_id` | exported (join) |
| `tribes` | P4 | `owner_user_id` | exported |
| `tribe_members` | P4 | via `tribe_id` | exported (join) |
| `gatherings` | P4 | `host_user_id` | exported |
| `gathering_invitees` | P4 | via `gathering_id` | exported (join) |
| `gathering_proposed_slots` | P4 | via `gathering_id` | exported (join) |
| `gathering_invite_messages` | P4 | via `gathering_id` | exported (join) |
| `gathering_events_log` | P4 | `actor_user_id` | exported |
| `relationship_signals` | P4 | `user_id` | exported — **inferred** data; Art.15 covers inferences |
| `venue_ratings` | P4 | `user_id` | exported |
| `venue_visits` | P4 | via `gathering_id` | exported (join) |
| `oauth_connections` | P4 | `owner_user_id` | exported (token refs redacted) |
| `oauth_consents` | P4 | `user_id` | exported |
| `oauth_scopes_granted` | P4 | via `oauth_connection_id` | exported (join) |
| `affiliate_clicks` | P6 | `user_id` | exported |
| `recommendation_events` | P6 | `user_id` | exported |
| `content_moderation_flags` | P8 | `profile_id` | exported |
| `reports` | P8 | `reporter_user_id` | exported (reports the subject *filed*) |
| `moderation_logs` | P8 | `actor_user_id` | **withheld** — Art.17(3)(b), `ON DELETE RESTRICT` |
| `erasure_obligations` | P8 | `subject_user_id` | **withheld** — Art.17(3)(b); the record *of* the erasure |
| `oauth_access_tokens` | P8 | `user_id` | **withheld** — live credential (SEC-71) |
| `oauth_refresh_tokens` | P8 | `user_id` | **withheld** — live credential (SEC-71) |
| `oauth_authorization_codes` | P8 | `user_id` | **withheld** — short-lived credential (SEC-71) |
| `oauth_connect_state` | P8 | `user_id` | **withheld** — transient CSRF state, not personal data |

### On the withheld rows

Four are live credentials: returning them in a downloadable file would turn an
access request into a credential-disclosure vector, and the subject gains
nothing — the tokens are opaque and revocable from Settings.

Two are retained under **Art. 17(3)(b)**. `moderation_logs` is
`ON DELETE RESTRICT` precisely so it survives an erasure, and
`erasure_obligations` is the record that the erasure happened. Erasing either on
request would defeat its purpose.

**If a subject disputes a withholding**, the answer is not to widen the export —
it is to confirm the lawful basis above still applies to their specific case, and
to say so in the response. See `DSAR_BREACH_COMPLAINTS.md`.

### Cross-references
- Sub-processors + transfer mechanisms → `SUBPROCESSORS.md`
- Retention periods + deletion → `RETENTION_SCHEDULE.md`
- DSAR / breach / complaints procedures → `DSAR_BREACH_COMPLAINTS.md`
- Founder action list (ICO fee, DPAs, sign-off) → `FOUNDER_CHECKLIST.md`
- Risk register (GOV/DP findings) → Confluence TWC "Lyra Risk Register"
