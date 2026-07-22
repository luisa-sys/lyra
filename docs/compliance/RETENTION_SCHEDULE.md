# Data Retention Schedule

> **Status: DRAFT for founder / legal review.** Prepared 2026-06-28 (SEC-2 / KAN-283).
> Not legal advice. Retention periods below are proposed defaults proportionate
> to a low-risk UK consumer service; the founder must confirm them and ensure
> the deletion/anonymisation mechanisms actually run. UK GDPR Art. 5(1)(e)
> (storage limitation) requires data not be kept longer than necessary.

**Controller:** CheckLyra Ltd (Lyra). **Last reviewed:** 2026-06-28.

| Data | Store | Proposed retention | Deletion / anonymisation mechanism | Status |
|---|---|---|---|---|
| Account + auth (`auth.users`, profile core) | Supabase | While account active; **purge or anonymise within 30 days** of a verified deletion request | Account-deletion flow must purge/anonymise the profile + cascade rows | ☐ confirm flow purges |
| Profile content ("Manual of Me", media) | Supabase DB + Storage | While account active / published | Removed on unpublish or account deletion; Storage objects deleted | ☐ confirm Storage delete |
| 18+ self-declaration (`age_declared_18_at` timestamp) | Supabase | While account active | Removed with account | ☑ timestamp only — no DOB, no biometric, no provider result |
| Contacts + contact methods (third parties) | Supabase | While the owning account/contact exists | Removed when the user deletes the contact or the account | ☐ confirm cascade |
| Google Calendar OAuth token | Supabase (encrypted) | Until the user disconnects or deletes the account | Deleted on disconnect (`lyra_disconnect_provider`) / account deletion | ☑ disconnect deletes token |
| Gatherings / invitees / RSVPs | Supabase | While the gathering exists; suggest purge ~12 months after the event | Manual/cron purge of past gatherings | ☐ define purge job |
| **Waitlist emails (DP-04)** | **Cloudflare KV** | **Add a TTL — proposed 12 months**, then auto-expire; bring into the data map | Set KV `expirationTtl` on write in the maintenance worker | ☐ **implement TTL (SEC-2)** |
| Transactional email logs | Resend | Per Resend default (typically ~30 days) — confirm | Provider-side | ☐ confirm Resend window |
| Affiliate click events | Supabase | Raw events ~13 months, then aggregate-only | Cron aggregate + purge raw | ☐ define purge job |
| Moderation / admin audit logs | Supabase | **Retain ≥ 12 months** (security/audit; do not auto-delete short-term). **Actor identity is an Art.17(3)(b) erasure exception — see note below.** | Reviewed, not auto-purged within the window; append-only + tamper-evident (SEC-64) | ☑ audit-first writes |
| Operational/web logs (IP, UA) | Cloudflare/Vercel/Railway | Per platform default (short) — confirm | Provider-side | ☐ confirm windows |
| Encrypted backups (WORM) | Cloudflare R2 | Per DISASTER_RECOVERY.md (object-lock window) | Object-lock expiry | ☑ see DR doc |
| OAuth token registry / auth codes | Supabase | Access tokens: until expiry; auth codes: ≤10 min one-time; refresh: 30-day rotation | Expiry + rotation (migration `oauth_2_1_server`) | ☑ enforced in schema |

## Deletion request → action
On a verified erasure request (see `DSAR_BREACH_COMPLAINTS.md`): purge/anonymise
the account + profile + media + contacts + tokens within **30 days**; remove the
waitlist KV entry if present; note that **encrypted, object-locked backups** will
age out per the DR retention window (document this in the DSAR response as a
lawful, time-limited exception — erasure from immutable backups is not required
to be immediate where they are securely isolated and expire on schedule).

### Erasure exception — moderation/admin audit actor identity (Art.17(3)(b))
**Who this affects:** the narrow class of users who have ever taken a moderation
or admin action (an `is_admin`/moderator account) and therefore appear as
`moderation_logs.actor_user_id`. Ordinary members are unaffected — their account
deletes and cascades in full.

**What we retain and why:** the moderation/admin audit trail is retained for
security and accountability, and — because `moderation_logs.actor_user_id` is
`ON DELETE RESTRICT` and the table is append-only + tamper-evident (SEC-64) —
the audit rows cannot be deleted or rewritten, so the `auth.users` account they
reference is also retained for the audit-retention window. This is a documented
**Art.17(3)(b)** exception (retention necessary for compliance with a legal
obligation / for the establishment, exercise or defence of legal claims), not a
failure of the deletion flow. It is **time-limited**: once the audit-retention
window (≥ 12 months) elapses and the rows are eligible for purge, the account is
erased in the ordinary course.

**In practice:** the self-service deletion flow declines for this class with a
clear message and routes the person to `privacy@checklyra.com`; the DSR log
records the request, what was erased, and what is retained under this exception
with its expiry. A future co-designed change (tracked on SEC-75 / SEC-64) may
allow anonymising just the actor identity while preserving the hash-chain — until
then, retention under this exception is the operative behaviour.

> **Decision (Luisa, 2026-07-12):** adopt the Art.17(3)(b) retention exception
> above (SEC-75 "Option 3") rather than an anonymisation/tombstone schema change,
> which is coupled to the SEC-64 tamper-evidence design.

## Open implementation items (tracked under SEC-2)
1. **Waitlist KV TTL (DP-04)** — set `expirationTtl` in the maintenance worker so waitlist emails expire (proposed 12 months). _Small worker change; two-step Cloudflare deploy._
2. **Account-deletion purge** — verify the deletion flow demonstrably purges/anonymises in Supabase (not just deactivates).
3. **Past-gathering + affiliate-raw purge jobs** — define and schedule.
4. Confirm provider-side windows (Resend, platform logs) and record them above. _(Didit removed 2026-07-20 — no provider-side age/biometric retention to confirm.)_
