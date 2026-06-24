# Convene Beta Launch — Host GUI Design Spec

> Design record for **[KAN-302](https://checklyra.atlassian.net/browse/KAN-302)** — the launch push that puts Convene in front of a human host on `beta.checklyra.com`. Sits on top of the architecture epic **[KAN-203](https://checklyra.atlassian.net/browse/KAN-203)** (P0–P10) and links back to it. For the full architecture record see `docs/CONVENE.md`.

**Last updated:** 2026-06-21 (epic + tickets created; plan only — no app code yet)

## Why this exists

Convene's backend and MCP surface are largely built. An AI agent over MCP can already propose attendees, find shared availability, suggest venues, create gatherings, send invites, and track RSVPs. **But there is no way for a human host to do any of this from the web** — the only driver is an MCP agent.

The product vision is direct: a host should be able to **click on a person, organise an event with them, and initiate it** — entirely from the GUI, with the agent path remaining a first-class alternative (MCP-main lockstep, KAN-222). This spec defines that GUI and the work to launch it on beta.

## Current state (what exists today)

**Web (`src/app/dashboard/convene/`)**
- `connections/` — connect/disconnect Google + Microsoft calendars.
- `gatherings/` — list of the host's gatherings.
- `gatherings/[id]/` — gathering detail; server actions for `addToHostCalendar`, `cancelGathering`, finalise.

**MCP (`luisa-sys/lyra-mcp-server`)** — 16 Convene tools, incl.:
- Read: `lyra_list_my_contacts`, `lyra_list_my_tribes`, `lyra_list_my_gatherings`, `lyra_get_gathering`, `lyra_get_shared_availability`, `lyra_get_my_calendar_busy_times`.
- Write: `lyra_connect_calendar`, `lyra_create_gathering`, `lyra_update_gathering`, `lyra_finalise_gathering`, `lyra_send_invite`, `lyra_record_rsvp`, `lyra_drain_invite_queue`, `lyra_reschedule_gathering`, `lyra_cancel_gathering`, `lyra_suggest_substitute`, `lyra_propose_attendees`, `lyra_suggest_venues`.

**Backend libs (`src/lib/convene/`)** — calendar adapters (Google/Microsoft), invites (email + ICS + dispatch + repository + Twilio templates), state machine, OAuth, post-event, vault, scorers (`src/lib/recommend/convene/`).

**Gaps (this epic):**
| Gap | Today | Ticket |
|---|---|---|
| No Convene nav entry from the web | unreachable without typing the URL | KAN-303 |
| No contacts/address book UI | contacts seeded via raw SQL only | KAN-304 |
| No "organise an event" flow | only `lyra_create_gathering` via agent | KAN-305 |
| No "send invites" / RSVP UI | only `lyra_send_invite` via agent | KAN-306 |
| No `lyra_add_contact` / tribe / link MCP tools | parity gap (KAN-222) | KAN-307 |
| Not enabled on beta | flag off, no allowlist, sender unverified | KAN-308 |

## Decisions locked for this epic

- **Invitee model: both.** Contacts are primary — a host-owned address book (name + email/phone, stored in `contacts` + `contact_methods`). A contact can *optionally* be linked to a Lyra profile to unlock shared availability. (Decided 2026-06-21.)
- **Consent-gated availability.** A linked profile's calendar busy-times are never shown without the target's consent. BUGS-41 (busy-time consent) is **Done**; SEC-18 (pre-prod privacy gate: busy-time consent + HMAC contact-discovery hashes) is the remaining open gate.
- **Feature-flagged.** Everything renders only when `CONVENE_ENABLED` is on. Beta-only until GA.
- **MCP lockstep.** Every new GUI write action ships an MCP equivalent in the same epic (KAN-307) or carries the deferral annotation.

## User journey (the happy path)

1. Host opens the dashboard → sees a **Convene** entry in the top-bar (KAN-303).
2. Goes to **People** → adds a contact (name + email), optionally links them to a Lyra profile (KAN-304).
3. Clicks the contact → **Organise** wizard: pick attendees → propose a time → pick a venue → creates a **draft gathering** (KAN-305).
4. On the gathering detail, clicks **Send invites** → invitee gets an email; **RSVP status** appears and updates live (KAN-306).
5. (Existing) finalise / add-to-calendar / reschedule / cancel from the detail page.

## Screen specs

### 1. Navigation + entry point (KAN-303)
- Add a `Convene` link to the dashboard header (`src/app/dashboard/page.tsx`, beside **Settings**) and the profile-page header. There is no shared `src/app/dashboard/layout.tsx` today — the header is hand-rolled per page; consider extracting a shared component.
- A dashboard landing card linking to **Gatherings** and **People**.
- Render gated on `isConveneEnabled()` (`src/lib/convene/flags.ts`).

### 2. People / Contacts (KAN-304)
- Route: `src/app/dashboard/convene/contacts/page.tsx`.
- List the host's contacts; **Add contact** (name + email and/or phone → `contacts` + `contact_methods`); edit/delete.
- **Link to Lyra profile** (optional): directory search → store the link. Any availability use stays consent-gated (SEC-18 / BUGS-41).
- Server actions: `addContact`, `updateContact`, `deleteContact`, `linkContactToProfile`. Per Gotcha #18, keep constants/types in a sibling `.ts` module — `'use server'` files export async functions only.
- Each contact row offers **Organise** → step 3.

### 3. Organise-event wizard (KAN-305)
- Route: `src/app/dashboard/convene/organise/page.tsx` (also reachable from a contact row).
- Steps: **attendees** (one or many contacts) → **time** (shared availability across the host's calendar + consenting linked profiles) → **venue** (`src/lib/recommend/convene/score-venue.ts`) → **create draft**.
- Reuses the existing gathering-create path; on success routes to the gathering detail page.
- Edge cases: no availability overlap, no venue candidate, attendee with no linked calendar (host proposes times manually).

### 4. Initiate (send invites) + RSVP surface (KAN-306)
- Extend the gathering detail page with a `sendInvites` server action wiring `src/lib/convene/invites/dispatch.ts` + the admin drain route.
- Show the invitee list with delivery + RSVP status; **resend** and **cancel-invite** actions.
- Respects the `CONVENE_INVITE_ALLOWLIST` gate. Per-user send caps + per-recipient dedup (epic constraint).
- MCP parity already exists: `lyra_send_invite`, `lyra_record_rsvp`, `lyra_drain_invite_queue`.
- **Depends on KAN-209 (P5 invites + public RSVP)** — linked as a blocker.

## MCP parity (KAN-307)

Per KAN-222, the new GUI write actions need MCP equivalents in `luisa-sys/lyra-mcp-server`:
- `lyra_add_contact` (+ `contact_methods`) — closes the "seed contacts via raw SQL only" gap.
- `lyra_create_tribe` / `lyra_add_contact_to_tribe`.
- `lyra_link_contact_profile`.
- Ownership-guard static-test entries (`mcp-ownership-guard.test.cjs`) for any new table read.
- Deploy MCP first, then the paired web PR (per `lyra-mcp-server/CLAUDE.md` deploy order).

## Beta enablement (KAN-308)

1. `CONVENE_ENABLED=true` on the **beta** Vercel scope (Gotcha #21 — branch-scoped env changes need a redeploy push).
2. `CONVENE_INVITE_ALLOWLIST` = beta cohort addresses (or `*` once the SEC gates close).
3. Verify the `CONVENE_INVITE_FROM_EMAIL` sender domain (`invites@checklyra.com`) in Resend.
4. **Do not open the allowlist to real invitees until SEC-18 / SEC-14 / BUGS-28 are Done.**
5. E2E smoke per `CLAUDE.md` → "Smoke-testing MCP tools end-to-end".

## Security gates (must close before real invitees)

| Ticket | What | State |
|---|---|---|
| [SEC-18](https://checklyra.atlassian.net/browse/SEC-18) | Convene privacy (pre-prod): busy-time consent + HMAC contact-discovery hashes | To Do |
| [SEC-14](https://checklyra.atlassian.net/browse/SEC-14) | Precautionary rotation of Convene OAuth refresh tokens | To Do |
| [BUGS-28](https://checklyra.atlassian.net/browse/BUGS-28) | `oauth_connections`: authenticated role can write `*_secret_id` (cross-user token reference) | In Progress |
| [BUGS-41](https://checklyra.atlassian.net/browse/BUGS-41) | Require target-side consent before disclosing busy-times (F-07) | **Done** |
| [KAN-243](https://checklyra.atlassian.net/browse/KAN-243) | Content moderation wired into Convene write tools | **Done** |

These are linked as **blockers** of KAN-308 in Jira (SEC/BUGS live in separate projects, so they are linked rather than re-parented under the epic).

## Jira map

```
KAN-203  Convene (origin epic, P0–P10)  ── relates ──┐
                                                      │
KAN-302  Convene Beta Launch (this epic) ────────────┘
  ├─ KAN-303  Nav + dashboard entry point
  ├─ KAN-304  Contacts/People page
  ├─ KAN-305  Organise-event wizard
  ├─ KAN-306  Initiate + RSVP surface   ← blocked by KAN-209 (P5)
  ├─ KAN-307  MCP parity (lyra-mcp-server)
  └─ KAN-308  Beta enablement           ← blocked by SEC-18, SEC-14, BUGS-28

relates: KAN-302 ↔ KAN-209 (P5 invites, in progress), KAN-210 (P6 lifecycle)
```

## Open questions

- **Shared dashboard layout?** The header is duplicated across dashboard/profile pages. Extracting a shared layout would centralise the Convene nav entry — worth doing as part of KAN-303 or as a small precursor.
- **Contact↔profile link storage** — new column on `contacts` vs a join table — to be settled with SEC-18 (the consent surface lives near it).
- **Beta cohort list** — the actual allowlist addresses are an external blocker (owner: Luisa), mirrored from the KAN-203 epic blockers.
