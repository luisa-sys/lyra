# Convene Beta Launch — Handover & Status

**Epic:** [KAN-302 — Convene Beta Launch](https://checklyra.atlassian.net/browse/KAN-302)
**Date:** 2026-06-21
**Production release:** tag `v0.1.73` (`main` @ `a00df75`)
**Status:** Build **complete** and **released to production behind a feature flag (off)**. One owner-action remains — the beta go-live flip (KAN-308).

---

## 1. TL;DR

Convene's host **web GUI**, its **MCP agent parity**, and **all three security gates** are built, tested, and shipped through the full pipeline to **production** (`develop → staging → beta → main`). Everything is gated behind the `CONVENE_ENABLED` environment flag, which is **off on production and beta**, so it is **invisible to users** today. Turning it on for the beta cohort is a deliberate, separate config step (KAN-308) owned by Luisa. Security is no longer a blocker — SEC-18, SEC-14, and BUGS-28 are all closed.

---

## 2. What Convene is

An AI-orchestrated way to plan gatherings (coffees, dinners, parties, meetings). A host keeps an address book of **contacts**, optionally **links** a contact to a Lyra profile to unlock consent-gated shared availability, **organises** a gathering (people → time → venue → draft), then **initiates** it (sends invites, tracks RSVPs). It is drivable both from the **web** (this launch) and by an **AI agent over MCP** (already existed; kept in lockstep).

---

## 3. Current state — where everything lives

| Surface | URL | Convene code present? | `CONVENE_ENABLED` | Visible to users? |
|---|---|---|---|---|
| **Production** | `checklyra.com` | ✅ Yes (released `v0.1.73`) | **off** | **No** — renders "Convene is not enabled" |
| **Beta** | `beta.checklyra.com` | ✅ Yes | **off** (→ set at KAN-308) | No yet; beta also gated by Cloudflare Access "beta testers" |
| **Dev** | `dev.checklyra.com` | ✅ Yes | `true` (testing) | Yes |
| **Prod MCP** | `mcp.checklyra.com` | ✅ Tools live | n/a (not flag-gated) | Agents with a prod API key can already call the write tools |

**Key principle — flag-gating, not branch isolation:** the Convene *code* is deployed to **every** environment including production. What controls visibility is the **per-environment `CONVENE_ENABLED` flag** (`isConveneEnabled()` → `process.env.CONVENE_ENABLED === 'true'`, default off). Promotion ships the code everywhere; the flag decides where it is *active*. This is why pushing to prod is safe.

> **Verified 2026-06-21:** `checklyra.com/r/<garbage>` returns the "Convene is not enabled" fallback — production flag confirmed off.

---

## 4. What shipped (tickets)

| Ticket | Deliverable | Status |
|---|---|---|
| [KAN-303](https://checklyra.atlassian.net/browse/KAN-303) | Convene nav (dashboard + profile header) + landing card, flag-gated | ✅ Done |
| [KAN-304](https://checklyra.atlassian.net/browse/KAN-304) | Contacts/People page — add/edit/delete, link-to-profile (directory search), per-contact "Organise" | ✅ Done |
| [KAN-305](https://checklyra.atlassian.net/browse/KAN-305) | Organise-event wizard (people → time → venue → draft); host free/busy via calendar adapter; real `scoreVenue` ranking | ✅ Done |
| [KAN-306](https://checklyra.atlassian.net/browse/KAN-306) | Finalise (draft→live) + Send invites (queue, per-recipient dedup, drain) + per-invitee RSVP/delivery surface + resend/cancel | ✅ Done |
| [KAN-307](https://checklyra.atlassian.net/browse/KAN-307) | MCP parity tools: `lyra_add_contact`, `lyra_create_tribe`, `lyra_add_contact_to_tribe`, `lyra_link_contact_profile` — live on prod MCP | ✅ Done |
| [BUGS-28](https://checklyra.atlassian.net/browse/BUGS-28) | `oauth_connections` secret-column lockdown (trigger) — applied to dev + staging + prod | ✅ Done |
| [SEC-18](https://checklyra.atlassian.net/browse/SEC-18) | Busy-time **consent gate** (opt-in, default deny) + **HMAC-keyed** contact-discovery hashes | ✅ Done |
| [SEC-14](https://checklyra.atlassian.net/browse/SEC-14) | OAuth refresh-token rotation decision → **Accept** (0 connections on prod, nothing to rotate) | ✅ Done |
| [KAN-308](https://checklyra.atlassian.net/browse/KAN-308) | **Beta enablement** — flag + allowlist + verified sender | ⏳ **To Do (owner: Luisa)** |
| [KAN-302](https://checklyra.atlassian.net/browse/KAN-302) | Epic | 🟡 In Progress — closes when KAN-308 is done |

**Pull requests (all green on required gates):**
- lyra: #339 (KAN-303/304), #341 (BUGS-28 test), #342 (KAN-305), #343 (KAN-306), #345 (SEC-18), #348 (docs/gating model)
- lyra-mcp-server: #75 (KAN-307), #78 (SEC-18 MCP consent gate)

---

## 5. Security gates — all closed

The three gates that had to close before opening Convene to real invitees are **all Done**:

- **BUGS-28** — `oauth_connections` could let an authenticated user point a token-secret reference at another user's vault secret. Fixed by a `BEFORE INSERT/UPDATE` trigger (`oauth_connections_guard_secret_cols`) that blocks authenticated/anon inserts and any change to the secret columns (service-role only). Applied **live to all 3 Supabase projects** (byte-identical). Prod had 0 rows → no data impact.
- **SEC-18** — (a) `lyra_get_shared_availability` fanned out a linked profile's busy-times with no target consent → added `profiles.share_availability_with_contacts` (default **false = deny**); the MCP tool now only shares for opted-in users; an opt-in toggle is on the Convene calendar-connections page. (b) Contact-discovery hashes were plain SHA-256 → switched to **HMAC-SHA256**. Migration applied to all 3 envs; MCP change deployed.
- **SEC-14** — precautionary OAuth-token rotation. Prod `oauth_connections` has **0 rows** → nothing to rotate; closed as **Accept**.

---

## 6. What's left — KAN-308 beta enablement (owner: Luisa)

The code is already on beta. To open Convene for the beta cohort, do the env config + a redeploy:

1. **On the BETA Vercel scope** (branch-scoped via CLI — the dashboard can't scope to a branch, Gotcha #2):
   - `CONVENE_ENABLED=true`
   - `CONVENE_INVITE_ALLOWLIST` = cohort emails, comma-separated. **For a safe first self-test, set just `luisa@santos-stephens.com,ben@santos-stephens.com`** — only allow-listed addresses ever receive an email. Use `*` only when ready to open it.
   - `CONVENE_INVITE_FROM_EMAIL=invites@checklyra.com` (confirm present)
   - `RESEND_API_KEY` (must be set on beta or every send goes to `failed`)
   - *(Optional hardening)* `CONTACT_SEARCH_HMAC_KEY` = a fresh ≥16-char secret (SEC-18). Until set, the search pepper is used as the HMAC key — already safe.
2. **Verify the sender domain** `invites@checklyra.com` is **verified in Resend** (else Resend returns 422 and invites land in `failed`).
3. **Redeploy** so the env vars take effect (Gotcha #21 — branch-scoped env changes don't auto-redeploy): merge a no-op chore PR to `beta`, or re-run the beta promote.
4. **E2E smoke on beta:** dashboard shows **Convene** → People (add a contact with your email) → Organise (pick a time) → gathering detail → **Finalise** → **Send invites** → confirm `gathering_invite_messages.delivery_status` goes `queued → sent`, and the `/r/<token>` RSVP page records your response back on the dashboard.

> Claude can drive steps 3–4 (and the flag flip if you grant Vercel access). Steps 1–2 need your Vercel/Resend access + the cohort list, which is why they're held.

### Later — releasing to *all* (non-beta) production users
Set `CONVENE_ENABLED=true` on the **production** Vercel scope and redeploy. This is a separate, deliberate decision — not part of code promotion. Until then Convene stays dormant on `checklyra.com`.

---

## 7. Quality & verification

- **Tests:** ~150 new tests added. Full lyra unit suite **1643 passing** (floor 800 / 60 suites). lyra-mcp-server **528 passing** (CLAUDE.md floor is stale at 217; real current count is higher).
- **CI:** every PR green on the required **PR Quality Gate** + CodeQL + Playwright E2E.
- **Release:** the supervised `promote-to-production` run was all-green — verify ✓, merge ✓, prod deploy SHA-matched ✓, **production smoke tests ✓**, release tag created ✓ (auto-rollback not triggered).
- **MCP deploy order** honoured throughout: MCP merged + deployed before each paired web change.
- **DB migrations** applied via Supabase MCP to dev + staging + prod (BUGS-28 trigger; SEC-18 consent column).

---

## 8. Architecture notes worth knowing

- **Beta and prod share the same prod Supabase database** (KAN-175). Convene data a beta user creates lives in the prod DB but is **RLS-scoped to that user** — never exposed to others. The flag gates the *UI/routes*, not the data tables.
- **MCP write-tools are NOT flag-gated.** `lyra_add_contact` and friends on `mcp.checklyra.com` are API-key + RLS gated and went live with KAN-307. An agent holding a prod API key can already use them (own-data only). Only the **web UI** is hidden by `CONVENE_ENABLED`.
- **Public RSVP page** `/r/<token>` already existed (KAN-209) and is itself flag-gated.
- **MCP-main lockstep (KAN-222)** satisfied: every GUI write action has an agent equivalent.

---

## 9. Open follow-ups (non-blocking)

- **Supabase Preview CI check fails on every migration PR** (pre-existing — also red on #330/#332; it is **not** a required check, so PRs merge). It's an ignored-red signal worth fixing or disabling. A background task was spun off for it.
- **Optional:** provision a dedicated `CONTACT_SEARCH_HMAC_KEY` on prod/beta (SEC-18 hardening). Safe without it (pepper used as key).

---

## 10. References

- **Docs:** `docs/CONVENE.md` (architecture record — see *Environment gating & visibility model*); `docs/CONVENE_BETA_GUI.md` (design spec, on the original handover branch).
- **Repos:** `github.com/luisa-sys/lyra` (web), `github.com/luisa-sys/lyra-mcp-server` (MCP).
- **Pipeline:** `develop → staging → beta → main`. Beta = prod Supabase + in-app beta gate.
- **Env vars (Convene):** `CONVENE_ENABLED`, `CONVENE_INVITE_ALLOWLIST`, `CONVENE_INVITE_FROM_EMAIL`, `RESEND_API_KEY`, `CONTACT_SEARCH_HMAC_KEY` (optional), `CRON_SECRET`.
- **Supabase projects:** prod `llzkgprqewuwkiwclowi` · staging `uobmlkzrjkptwhttzmmi` · dev `ilprytcrnqyrsbsrfujj`.

---

*Generated by Claude Code, 2026-06-21. Source of truth for ticket status is Jira; for code state, `git`/CI.*
