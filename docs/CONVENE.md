# Convene — Architecture Record

> Living document. Updated as each phase of [KAN-203](https://checklyra.atlassian.net/browse/KAN-203) lands. For the static proposal that approved this work, see `docs/proposals/kan-203-lyra-convene.md`.

**Last updated:** 2026-05-16 (Phase 0 in flight)

## Status snapshot

| Phase | Ticket | State | Notes |
|---|---|---|---|
| P0  | [KAN-204](https://checklyra.atlassian.net/browse/KAN-204) | In progress | OAuth spike — throwaway |
| P1  | [KAN-205](https://checklyra.atlassian.net/browse/KAN-205) | To do | Data model + read MCP tools |
| P2  | [KAN-206](https://checklyra.atlassian.net/browse/KAN-206) | To do | Google Calendar integration |
| P3  | [KAN-207](https://checklyra.atlassian.net/browse/KAN-207) | Blocked | Awaiting Google Cloud billing account |
| P4  | [KAN-208](https://checklyra.atlassian.net/browse/KAN-208) | To do | Gathering lifecycle |
| P5  | [KAN-209](https://checklyra.atlassian.net/browse/KAN-209) | To do | Invites + RSVP — first useful release |
| P6  | [KAN-210](https://checklyra.atlassian.net/browse/KAN-210) | To do | Reschedule/cancel/substitute — GA bar |
| P7  | [KAN-211](https://checklyra.atlassian.net/browse/KAN-211) | To do | Microsoft + Apple adapters |
| P8  | [KAN-212](https://checklyra.atlassian.net/browse/KAN-212) | To do | Post-event loop |
| P9  | [KAN-213](https://checklyra.atlassian.net/browse/KAN-213) | To do | PWA + mobile prep |
| P10 | [KAN-214](https://checklyra.atlassian.net/browse/KAN-214) | Post-GA | WhatsApp + SMS — needs paid tier |

## Two-OAuth model (clarification)

Convene introduces a **second** OAuth flow that runs in parallel to the existing/KAN-88 work. Keep these separate:

- **Agent → Lyra MCP** (KAN-88): how an MCP client (Claude.ai) authenticates to call our write tools. JWT bearer post-KAN-88.
- **Lyra → Google/Microsoft/Apple** (this epic): how Lyra accesses a *user's* calendar and contacts on their behalf. Standard per-provider OAuth, refresh tokens vaulted in `oauth_connections`.

Convene's MCP write tools use whatever agent-auth scheme is current. They independently call provider APIs using the per-user refresh tokens from the second flow. Neither flow knows about the other.

## Constraints in force

- **Autonomy**: auto-merge to develop on green CI; auto-promote to staging; production promotion always pauses for explicit sign-off.
- **Budget**: free tiers only until GA. v1 ships email-only as a consequence (Twilio free tier limited to verified numbers).
- **Feature flag**: `convene_enabled` (default off) across all phases until GA.
- **Privacy floor**: non-Lyra invitee contact PII never leaves host's scope. No `child_profiles` table.
- **Recommender alignment**: P3 scorers conform to architecture from [KAN-199](https://checklyra.atlassian.net/browse/KAN-199).

## External actions tracked at epic level

1. Google Cloud billing account (Luisa) — blocks P3.
2. Google OAuth verification reply (Luisa) — blocks expanded-scope rollout to prod.
3. Beta cohort allowlist (Luisa) — blocks P5 live testing.

## Phase 0 — OAuth foundations spike

**Goal:** Prove the highest-risk integration (Google OAuth + token vaulting + free/busy round trip) before committing schema. Throwaway code.

**Scope:**

- Branch: `feature/convene/p0-oauth-spike` (this branch).
- Dev-Supabase-only throwaway migration: `9999_spike_oauth.sql` — single `oauth_connections` row with a vault-encrypted `refresh_token`.
- Google scopes: `calendar.readonly`, `calendar.events`, `contacts.readonly` added to the existing OAuth client `381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn` in incremental-consent mode.
- Two API routes under `src/app/api/convene/spike/` (gated by env check + `convene_enabled` flag):
  - `connect-google` → OAuth redirect + token exchange + vault encryption.
  - `free-busy` → reads the token, calls Google `freeBusy`, returns one block.
- This document captures findings as the spike runs.

**Spike findings (will be appended as we go):**

_TBD — populated by spike work._

**What we'll keep / discard from the spike:**

_TBD — decided at end of Phase 0._

## Data model (P1+)

Detailed schema documented when P1 lands. Tables planned:

- Identity & consent: `oauth_connections`, `oauth_scopes_granted`, `consent_log`
- People & relationships: `contacts`, `contact_methods`, `tribes`, `tribe_members`, `relationship_signals`
- Gatherings: `gatherings`, `gathering_invitees`, `gathering_proposed_slots`, `gathering_invite_messages`, `gathering_events_log`
- Venues: `venues`, `venue_visits`, `venue_ratings`

## MCP tool surface (P1+)

Detailed contracts documented as each tool lands. Planned:

**Read** (no auth): `lyra_list_my_tribes`, `lyra_list_my_contacts`, `lyra_propose_attendees`, `lyra_get_shared_availability`, `lyra_suggest_venues`, `lyra_list_my_gatherings`, `lyra_get_gathering`

**Write** (auth via current MCP scheme): `lyra_create_gathering`, `lyra_update_gathering`, `lyra_finalise_gathering`, `lyra_send_invite`, `lyra_record_rsvp`, `lyra_reschedule_gathering`, `lyra_cancel_gathering`, `lyra_suggest_substitute`, `lyra_log_attendance`, `lyra_rate_venue`, `lyra_connect_calendar`, `lyra_disconnect_provider`

## Adapter pattern (P2+)

Calendar providers slot in under `src/lib/convene/calendar/<provider>.ts` implementing a canonical interface:

```ts
interface CalendarAdapter {
  getFreeBusy(userId: string, window: TimeWindow): Promise<BusyBlock[]>;
  createEvent(userId: string, gathering: Gathering): Promise<{ providerEventId: string }>;
  updateEvent(userId: string, gathering: Gathering): Promise<void>;
  deleteEvent(userId: string, gathering: Gathering): Promise<void>;
}
```

Same pattern under `src/lib/convene/venues/<source>.ts` for venue providers (Google Places first).

## Open architecture decisions (will be resolved by phase)

- _P1_: `relationship_signals` as materialised view (refresh cron) vs trigger-maintained table — TBD.
- _P3_: scorer interface alignment with KAN-199 — TBD (waiting on KAN-199 design doc).
- _P5_: token format for `/r/<token>` — JWT vs opaque random — TBD.
- _P6_: pg_cron vs Supabase Edge Function scheduled invocation for silence policy timer — TBD.
- _P9_: VAPID key rotation strategy — TBD.

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-16 | Claude | Initial doc; P0 in flight. |
