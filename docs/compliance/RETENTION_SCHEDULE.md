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
| Age-assurance result (`age_status`, band, ref) | Supabase | While account active (proof of assurance) | Removed with account | ☑ stored result only (no biometric) |
| Didit biometric (selfie) | Didit | **Per Didit's policy — confirm + record** | Provider-side | ☐ confirm Didit retention |
| Contacts + contact methods (third parties) | Supabase | While the owning account/contact exists | Removed when the user deletes the contact or the account | ☐ confirm cascade |
| Google Calendar OAuth token | Supabase (encrypted) | Until the user disconnects or deletes the account | Deleted on disconnect (`lyra_disconnect_provider`) / account deletion | ☑ disconnect deletes token |
| Gatherings / invitees / RSVPs | Supabase | While the gathering exists; suggest purge ~12 months after the event | Cron purge of past gatherings (SEC-74: `gatherings_purge_expired` via `/api/retention/cron/sweep`, gated by `RETENTION_ENABLED`; window `RETENTION_GATHERINGS_MONTHS`, default 12; child rows — invitees/RSVPs/messages/events-log — cascade) | ◑ purge job built (SEC-74); enable + confirm window per env |
| **Waitlist emails (DP-04)** | **Cloudflare KV** | **Add a TTL — proposed 12 months**, then auto-expire; bring into the data map | Set KV `expirationTtl` on write in the maintenance worker | ☐ **implement TTL (SEC-2)** |
| Transactional email logs | Resend | Per Resend default (typically ~30 days) — confirm | Provider-side | ☐ confirm Resend window |
| Affiliate click events | Supabase | Raw events ~13 months, then aggregate-only | Cron purge raw (SEC-74: `affiliate_clicks_purge_expired` via `/api/retention/cron/sweep`, gated by `RETENTION_ENABLED`; window `RETENTION_AFFILIATE_CLICKS_MONTHS`, default 13) | ◑ purge job built (SEC-74); enable + confirm window per env |
| Moderation / admin audit logs | Supabase | **Retain ≥ 12 months** (security/audit; do not auto-delete short-term) | Reviewed, not auto-purged within the window | ☑ audit-first writes |
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

## Open implementation items (tracked under SEC-2)
1. **Waitlist KV TTL (DP-04)** — set `expirationTtl` in the maintenance worker so waitlist emails expire (proposed 12 months). _Small worker change; two-step Cloudflare deploy._
2. **Account-deletion purge** — verify the deletion flow demonstrably purges/anonymises in Supabase (not just deactivates).
3. **Past-gathering + affiliate-raw purge jobs** — define and schedule.
   - **Affiliate-raw purge — BUILT (SEC-74).** `affiliate_clicks_purge_expired(cutoff)` (SECURITY DEFINER, service_role-only; refuses null/future cutoffs) driven by the retention sweep at `/api/retention/cron/sweep` (Sun 03:00 UTC). Gated behind `RETENTION_ENABLED` (default OFF) so nothing is deleted until the window is confirmed and the flag is enabled per environment. Window is config (`RETENTION_AFFILIATE_CLICKS_MONTHS`, default 13). _Remaining: Luisa confirms the 13-month window, then set `RETENTION_ENABLED=true` per env._
   - **Past-gathering purge — BUILT (SEC-74).** `gatherings_purge_expired(cutoff)` (SECURITY DEFINER, service_role-only; refuses null/future cutoffs) driven by the same retention sweep at `/api/retention/cron/sweep`. "Past" is anchored to `coalesce(finalised_slot_end, finalised_slot_start, target_window_end, target_window_start, created_at)`, so a still-upcoming gathering can never match an always-past cutoff. Child rows (invitees, RSVPs, invite-messages, events-log) are removed by the existing `ON DELETE CASCADE` foreign keys — a full purge, not an anonymise. Gated behind `RETENTION_ENABLED` (default OFF). Window is config (`RETENTION_GATHERINGS_MONTHS`, default 12). _Remaining: Luisa confirms the 12-month window, then set `RETENTION_ENABLED=true` per env._
   - **Moderation / admin audit logs — retention is by policy, not a destructive purge.** `moderation_logs` is deliberately append-only (admin read+write, no update/delete) and is being hardened toward tamper-evident (SEC-64); auto-deleting rows would weaken an audit guard. The documented stance is "retain ≥ 12 months, reviewed-not-auto-purged" (row above). Any change to that window is a governance decision, not a cron job.
4. Confirm provider-side windows (Resend, Didit, platform logs) and record them above.
