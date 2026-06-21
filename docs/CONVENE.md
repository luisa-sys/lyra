# Convene — Architecture Record

> Living document. Updated as each phase of [KAN-203](https://checklyra.atlassian.net/browse/KAN-203) lands. For the static proposal that approved this work, see `docs/proposals/kan-203-lyra-convene.md`.

**Last updated:** 2026-06-21 (Convene Beta host GUI — KAN-302 — released to production behind the `CONVENE_ENABLED` flag)

## Status snapshot

| Phase | Ticket | State | Notes |
|---|---|---|---|
| P0  | [KAN-204](https://checklyra.atlassian.net/browse/KAN-204) | **Done** | OAuth + Vault + freeBusy verified E2E on dev (2026-05-16). Spike artefacts dropped in this PR. |
| P1  | [KAN-205](https://checklyra.atlassian.net/browse/KAN-205) | In progress | Schema (7 migrations, 15 tables + materialised view), MCP read tools (4, paired PR in `lyra-mcp-server`), ownership-guard test. PR open. |
| P2  | [KAN-206](https://checklyra.atlassian.net/browse/KAN-206) | To do | Google Calendar integration — real OAuth + adapter on canonical interface. |
| P3  | [KAN-207](https://checklyra.atlassian.net/browse/KAN-207) | Blocked | Awaiting Google Cloud billing account (Luisa). |
| P4  | [KAN-208](https://checklyra.atlassian.net/browse/KAN-208) | To do | Gathering lifecycle (draft → live). |
| P5  | [KAN-209](https://checklyra.atlassian.net/browse/KAN-209) | To do | Invites + RSVP — first useful release. |
| P6  | [KAN-210](https://checklyra.atlassian.net/browse/KAN-210) | To do | Reschedule / cancel / substitute — GA bar. |
| P7  | [KAN-211](https://checklyra.atlassian.net/browse/KAN-211) | To do | Microsoft Graph + Apple CalDAV. |
| P8  | [KAN-212](https://checklyra.atlassian.net/browse/KAN-212) | To do | Post-event loop + analytics. |
| P9  | [KAN-213](https://checklyra.atlassian.net/browse/KAN-213) | To do | PWA + mobile prep. |
| P10 | [KAN-214](https://checklyra.atlassian.net/browse/KAN-214) | Post-GA | WhatsApp + SMS — needs paid Twilio. |

> **2026-06-21 — Convene Beta host GUI ([KAN-302](https://checklyra.atlassian.net/browse/KAN-302)) released to production behind the flag.** The host web GUI (nav + landing card, Contacts/People, Organise wizard, Finalise + Send-invites + RSVP surface), MCP write-parity ([KAN-307](https://checklyra.atlassian.net/browse/KAN-307)), and the security gates BUGS-28 + SEC-18 shipped develop → staging → beta → **main** (tag `v0.1.73`). Convene is **inert on production** — see *Environment gating & visibility model* below. The KAN-203 phase table above predates the GUI epic and is not the authoritative tracker for it.

## Environment gating & visibility model

**Convene ships behind one env flag — `CONVENE_ENABLED` (default off) — checked by `isConveneEnabled()` (`src/lib/convene/flags.ts`).** Every Convene route, the nav entry, the landing card, and the public `/r/<token>` RSVP page render only when the flag is `true`; otherwise they show a "Convene is not enabled" fallback and the cron route 404s.

Crucially, the **code is promoted to every environment, production included** — promotion does **not** hold Convene out of prod. What controls whether a user can *see* Convene is the per-environment flag, **not** branch isolation:

| Env | URL | Who can reach it | `CONVENE_ENABLED` | Convene visible? |
|---|---|---|---|---|
| **Production** | `checklyra.com` | everyone (public) | **off** | **No** — invisible to all users |
| **Beta** | `beta.checklyra.com` | beta-approved only (Cloudflare Access "Lyra Beta Testers", KAN-175 / KAN-273) | off today → set `true` at [KAN-308](https://checklyra.atlassian.net/browse/KAN-308) | only beta-approved users, after KAN-308 |
| **Dev** | `dev.checklyra.com` | engineering | `true` (for testing) | yes |

- **Releasing Convene to general (non-beta) production users** is a deliberate, separate action: set `CONVENE_ENABLED=true` on the **production** Vercel scope, then redeploy (Gotcha #21). It is *not* part of the code promotion. Until that flip, Convene is dormant in prod.
- Verified 2026-06-21: `checklyra.com/r/<garbage>` returns the **"Convene is not enabled"** fallback (prod flag confirmed off).
- **Data note:** beta and prod share the same **prod Supabase DB** (KAN-175). Convene data a beta user creates lives in the prod DB but is RLS-scoped to that user — never exposed to others. The flag gates the *UI/routes*, not the data tables.
- **MCP caveat:** the Convene MCP write-tools on `mcp.checklyra.com` are **not** behind `CONVENE_ENABLED` — they are API-key + RLS gated and shipped with KAN-307, so an agent holding a prod API key can already call them. Only the **web UI** is flag-gated.

## Two-OAuth model

Convene introduces a **second** OAuth flow that runs in parallel to KAN-88. Keep these separate:

- **Agent → Lyra MCP** (KAN-88): how an MCP client (Claude.ai) authenticates to call write tools. API key today; bearer JWT post-KAN-88.
- **Lyra → Google/Microsoft/Apple** (this epic): how Lyra accesses a *user's* calendar and contacts on their behalf. Standard per-provider OAuth, refresh tokens vaulted in `oauth_connections`.

Convene's MCP tools use whatever agent-auth scheme is current. They independently call provider APIs using per-user refresh tokens from the second flow. Neither flow knows about the other.

## Constraints in force

- **Autonomy**: auto-merge to develop on green CI; auto-promote to staging; production promotion always pauses for explicit sign-off.
- **Budget**: free tiers only until GA. v1 ships email-only as a consequence (Twilio free tier limited to verified numbers).
- **Feature flag**: `CONVENE_ENABLED` (default off) across all phases until GA.
- **Privacy floor**: non-Lyra invitee contact PII never leaves host's scope. No `child_profiles` table.
- **MCP lockstep (KAN-222)**: every user-facing Convene change ships MCP coverage in the same epic, or carries the deferral annotation.
- **Recommender alignment**: P3 scorers conform to architecture from [KAN-199](https://checklyra.atlassian.net/browse/KAN-199).

## External actions tracked at epic level

1. ~~Google OAuth scopes on consent screen~~ — done in P0.
2. ~~Authorised redirect URI for dev~~ — done in P0.
3. ~~Vercel env vars for dev~~ — done in P0 (via REST API after CLI bugs).
4. Google Cloud billing account (Luisa) — blocks P3.
5. Google OAuth verification reply (Luisa) — blocks expanded-scope rollout to prod.
6. Beta cohort allowlist (Luisa) — blocks P5 live testing.

## Phase 0 — OAuth foundations spike (closed 2026-05-16)

**Goal:** Prove Google OAuth + Vault encrypt/decrypt + token refresh + Google `freeBusy` end-to-end before committing schema.

**Result:** On dev, Luisa connected her real Google account → 21 busy blocks returned from `freeBusy`, sample block `2026-05-17T08:00–10:30Z`. Full round trip works.

**Findings carried forward:**

1. **Vercel CLI `echo "x" | vercel env add` is broken** — appends a literal `n` to the value (e.g. stores `"truen"` instead of `"true"`). Workaround: PATCH directly via Vercel REST API at `/v9/projects/{id}/env/{envId}` using the token from `~/Library/Application Support/com.vercel.cli/auth.json`. `printf` without trailing newline produces empty values; `--value` flag hangs without `--debug`. The REST API path is the only reliable one for branch-scoped env vars.
2. **Vercel sensitive flag is default for Preview** — `vercel env pull` shows `""` for sensitive vars regardless of actual content. Don't trust pull output for diagnostics; redeploy and probe runtime behaviour instead.
3. **NODE_ENV gating is wrong for Vercel** — built bundles set `NODE_ENV=production` everywhere (incl. dev previews). Gate on `VERCEL_ENV` instead. Fixed in PR #217.
4. **Env-var changes don't auto-redeploy** — must `vercel redeploy <url> --scope <team>` after changes (the deploy auto-aliases dev.checklyra.com because the source deployment was already aliased).
5. **Google OAuth scope expansion on the existing Sign-In client works smoothly** — incremental consent in Testing mode shows the "app not verified" notice but lets the user proceed, which is what we want for dev. Production rollout will need verification.

**What we kept from the spike:**

- `src/lib/convene/google/oauth.ts` — `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshAccessToken` (raw `fetch`, no `googleapis` dep). Reused by P2.
- `src/lib/convene/google/calendar.ts` — `getFreeBusy`. Becomes part of the Google adapter in P2.
- `src/lib/convene/vault.ts` — `vaultStoreRefreshToken` / `vaultReadRefreshToken` / `vaultRevokeRefreshToken`. Reused.
- `src/lib/convene/env.ts` and `src/lib/convene/flags.ts` (with `isConveneSpikeAllowed` removed).
- The three `convene_vault_*` security-definer SQL functions. Comment on `convene_vault_store_secret` updated to note it now serves the canonical `oauth_connections`.

**What we dropped:**

- `src/app/api/convene/spike/*` routes — three throwaway handlers.
- `public.convene_spike_oauth_connections` table (drop migration: `20260516240000_drop_convene_spike.sql`).
- The `isConveneSpikeAllowed` helper and its tests.

## Phase 1 — Data model + read MCP tools (in progress)

**Schema (applied to dev `ilprytcrnqyrsbsrfujj`):** 7 migrations.

| # | Migration | Adds |
|---|---|---|
| 1 | `20260516230000_convene_identity_consent.sql` | `oauth_connections`, `oauth_scopes_granted`, `consent_log` + RLS + append-only triggers |
| 2 | `20260516230100_convene_people.sql` | `contacts`, `contact_methods`, `tribes`, `tribe_members` + RLS + same-owner trigger |
| 3 | `20260516230200_convene_venues.sql` | `venues` (shared catalogue), `venue_visits`, `venue_ratings` + RLS |
| 4 | `20260516230300_convene_gatherings.sql` | `gatherings`, `gathering_invitees`, `gathering_proposed_slots`, `gathering_invite_messages`, `gathering_events_log` + RLS + host-owns-contact trigger |
| 5 | `20260516230400_convene_relationship_signals.sql` | Materialised view + `refresh_relationship_signals()` |
| 6 | `20260516230500_convene_profile_categories.sql` | 6 new `item_category` enum values + `tribe_only` visibility + `tribe_only_visible_tribes(uuid)` helper |
| 7 | `20260516240000_drop_convene_spike.sql` | Drops the P0 spike table |

**MCP tools** (paired PR in `lyra-mcp-server`):

- `lyra_list_my_tribes` — host's tribes + member counts (owner-scoped).
- `lyra_list_my_contacts` — address-book entries; **PII excluded** from response (only `display_name`, `city`, `country`, `linked_profile_id`, `source`).
- `lyra_list_my_gatherings` — status-filterable list (host-scoped).
- `lyra_get_gathering` — full detail incl. invitees, slots, venue, events log.

**Ownership-guard test** (`tests/mcp-ownership-guard.test.cjs`) — mirrors `mcp-visibility-guard.test.cjs`. Direct-owner tables require the explicit `.eq('owner_user_id'|'host_user_id'|'user_id', …)` filter; child tables require `// ownership-ok:` allow-list comment.

## MCP tool surface (full plan)

**Read** (P1; auth via API key — see /convene-tools.ts in MCP server):
- `lyra_list_my_tribes`, `lyra_list_my_contacts`, `lyra_list_my_gatherings`, `lyra_get_gathering`

**Read** (P2+; auth via API key):
- `lyra_propose_attendees`, `lyra_get_shared_availability`, `lyra_suggest_venues`

**Write** (P2+; auth via current MCP scheme):
- `lyra_create_gathering`, `lyra_update_gathering`, `lyra_finalise_gathering`, `lyra_send_invite`, `lyra_record_rsvp`, `lyra_reschedule_gathering`, `lyra_cancel_gathering`, `lyra_suggest_substitute`, `lyra_log_attendance`, `lyra_rate_venue`, `lyra_connect_calendar`, `lyra_disconnect_provider`

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

## Open architecture decisions

- _P1_ — _resolved_: `relationship_signals` as **materialised view** (refresh cron). Refresh function added; pg_cron scheduling deferred to P8.
- _P3_: scorer interface alignment with KAN-199 — TBD (waiting on KAN-199 design doc).
- _P5_: token format for `/r/<token>` — JWT vs opaque random — TBD.
- _P6_: pg_cron vs Supabase Edge Function scheduled invocation for silence policy timer — TBD.
- _P9_: VAPID key rotation strategy — TBD.

## Environment variables (Convene-specific)

Per-env (set on Vercel for the lyra app; mirrored on Railway for the MCP servers as noted).

| Var | Where | Required on | Notes |
|---|---|---|---|
| `CONVENE_ENABLED` | Vercel | code on all envs; flag set per-env | Master flag (`isConveneEnabled()` → `CONVENE_ENABLED === 'true'`, default off). The Convene **code is deployed to every env incl. production** (released 2026-06-21); this flag controls whether it is *active/visible*. **Off on production + beta; `true` on dev for testing.** Set `true` on beta at KAN-308; set `true` on production only to release to general (non-beta) users. See "Environment gating & visibility model". |
| `CONVENE_INVITE_ALLOWLIST` | Vercel | develop (preview) | Comma-separated email addresses (or `*`) that the send-worker will actually email. Empty/unset → all sends blocked at the email-layer gate (safety default). |
| `CONVENE_INVITE_FROM_EMAIL` | Vercel | optional | Default `invites@checklyra.com`. Domain must be verified in Resend. |
| `RESEND_API_KEY` | Vercel | wherever invites send | The send-worker calls Resend's REST API with this. If unset, the dispatcher correctly marks rows `failed` with `bounce_reason='RESEND_API_KEY not set'`. Already used by the prod weekly report and security audit emails. |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` | Vercel | develop (preview) | Google OAuth 2.0 credentials for the calendar adapter (KAN-206). |
| `GOOGLE_PLACES_API_KEY` | Vercel | develop + production | Places API v1 for venue suggestions (KAN-207). |
| `CRON_SECRET` | Vercel | wherever cron should fire | Vercel auto-attaches this as `Authorization: Bearer …` on cron invocations. The cron route 401s without it. Vercel Cron only schedules Production deployments — see CLAUDE.md note. |
| `LYRA_SITE_URL` | Railway (MCP services) | both dev + prod MCP services | The MCP `lyra_drain_invite_queue` tool POSTs to `${LYRA_SITE_URL}/api/convene/admin/drain-queue`. Dev MCP → `https://dev.checklyra.com`. Prod MCP → `https://checklyra.com`. Wrong value → 400s from unrelated pages. |

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-16 | Claude | Initial doc; P0 in flight. |
| 2026-05-16 | Claude | P0 closed (KAN-204 Done); P1 schema migrations 1-6 applied; spike dropped; MCP tools paired-PR'd. |
| 2026-05-17 | Claude | P5 part 2 — send-invite cron worker + admin drain route + `lyra_drain_invite_queue` MCP tool. End-to-end smoke-tested on dev: row queued via MCP, drained, dispatcher marks row `failed` with correct `bounce_reason`. Added env var table. |
| 2026-06-21 | Claude | **Convene Beta host GUI (KAN-302) built + released to production behind the flag.** KAN-303/304/305/306 (web GUI), KAN-307 (MCP parity), BUGS-28 + SEC-18 (security gates) shipped develop → staging → beta → main (tag `v0.1.73`). Added the **Environment gating & visibility model** section. Convene inert on prod (`CONVENE_ENABLED` off); KAN-308 enables it on beta. |
