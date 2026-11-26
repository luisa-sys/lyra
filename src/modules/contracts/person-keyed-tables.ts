/**
 * SEC-117 — the single source of truth for "what must a subject access request
 * return", and the only place a table may be excluded from one.
 *
 * WHY THIS EXISTS
 * ---------------
 * `exportUserData()` hand-wrote 18 `.from()` blocks. `deleteAccount()` hard-
 * deletes the auth user and relies on FK cascade to erase EVERY person-keyed
 * table — its own comment says the cascade "removes ALL of the person's data in
 * one step". The two drifted, and the test meant to prevent that drift
 * hard-coded a copy of the export's own list, so it could only ever detect a
 * table being *removed* from the export, never one being missing from it.
 *
 * The failure that produced was silent by construction: a member who had
 * connected a calendar or created contact groups got a JSON with those sections
 * simply absent. No query failed, so no `export_incomplete_errors` key was
 * emitted either — an incomplete response was indistinguishable from a complete
 * one. UK-GDPR Art.15/20, on a service holding minors' data.
 *
 * THE RULE
 * --------
 * Every table in the schema that is keyed to a person must appear in EXACTLY
 * one of the three lists below. `tests/unit/sar-export-completeness.test.js`
 * derives the person-keyed set from the committed schema and fails if any table
 * is in none of them — so adding a person-keyed table to a migration without
 * deciding its SAR treatment is a red build, not a silent gap.
 *
 * That is the part that matters. A hand-maintained list can never be a
 * completeness check; only one checked against the schema can.
 */

/** Tables keyed DIRECTLY to the subject, by the column named. */
export const PERSON_KEYED_TABLES = {
  profiles: 'user_id',
  profile_items: 'profile_id',
  school_affiliations: 'profile_id',
  external_links: 'profile_id',
  profile_manual_of_me: 'profile_id',
  profile_conversation_starters: 'profile_id',
  profile_files: 'profile_id',
  content_moderation_flags: 'profile_id',
  feature_entitlements: 'profile_id',
  api_keys: 'user_id',
  oauth_connections: 'owner_user_id',
  oauth_consents: 'user_id',
  reports: 'reporter_user_id',
  contacts: 'owner_user_id',
  gatherings: 'host_user_id',
  gathering_events_log: 'actor_user_id',
  tribes: 'owner_user_id',
  consent_log: 'user_id',
  affiliate_clicks: 'user_id',
  recommendation_events: 'user_id',
  relationship_signals: 'user_id',
  venue_ratings: 'user_id',
  // KAN-443. A member's own editorial decisions about their own profile —
  // which auto-generated gift suggestions they said "not for me" to. Personal
  // data about them, and something they would expect to see in an Art.15
  // response. Added 2026-08-09, at the same time as its migration, precisely
  // so it never exists in the schema without a SAR decision attached.
  gift_suggestion_dismissals: 'profile_id',
  // KAN-489. The AI gift suggestion claim log: one row per paid generation,
  // holding a timestamp and the random session id of the editor that asked.
  // Members cannot read it in the app (RLS on, no policies — the abuse limit
  // must not be inspectable or editable), but it is personal data about them,
  // so the service-role export returns it. Added with its migration.
  ai_gift_generations: 'profile_id',
  // KAN-490. The member's pre-v0.8 profile addresses (old slugs, which hold
  // their name), kept so old links redirect; and the full archive copy of
  // their pre-v0.8 list items taken before the v0.8 data migration moved
  // them. RLS on, no policies; personal data, so the export returns both.
  // Added with their migration.
  profile_slug_history: 'profile_id',
  profile_items_legacy_archive: 'profile_id',
} as const;

/**
 * Tables reached only through a parent the subject owns. The export fetches
 * these with an `.in(<fk>, <parentIds>)`, so they are covered — but they must
 * be listed, or the completeness check cannot tell "joined" from "forgotten".
 */
export const JOIN_KEYED_TABLES = {
  contact_methods: 'contact_id',
  gathering_invitees: 'gathering_id',
  gathering_proposed_slots: 'gathering_id',
  gathering_invite_messages: 'gathering_id',
  tribe_members: 'tribe_id',
  venue_visits: 'gathering_id',
  oauth_scopes_granted: 'oauth_connection_id',
} as const;

/**
 * Deliberately NOT returned, each with the reason. Being on this list is a
 * decision, not an oversight — which is exactly why it is a list rather than an
 * absence.
 */
export const DELIBERATELY_EXCLUDED: Record<string, string> = {
  // SEC-71: live credentials. Returning them in a downloadable file would turn
  // a data-access request into a credential-disclosure vector, and the subject
  // gains nothing — the tokens are opaque and revocable from Settings.
  oauth_access_tokens: 'SEC-71 — live credential, redacted by design',
  oauth_refresh_tokens: 'SEC-71 — live credential, redacted by design',
  oauth_authorization_codes: 'SEC-71 — short-lived credential, redacted by design',
  oauth_connect_state: 'SEC-71 — transient CSRF state, not personal data',

  // Art.17(3)(b): retained for a legal obligation / the establishment of legal
  // claims. `moderation_logs` is ON DELETE RESTRICT precisely so it survives
  // an erasure, and `erasure_obligations` is the record OF the erasure — both
  // would be self-defeating to erase or hand back on request.
  moderation_logs: 'Art.17(3)(b) — moderation audit trail, ON DELETE RESTRICT',
  erasure_obligations: 'Art.17(3)(b) — the record of erasure itself',

  // SEC-132: a VIEW over `profiles`, not independent storage. All 17 of its
  // columns are a strict subset of the `profiles` row the same export already
  // returns in full, so including it would hand the subject a second copy of
  // data they have already been given rather than anything new. Excluded as
  // REDUNDANT, not withheld — unlike the entries above, nothing here is absent
  // from the response. Art.15 is satisfied by the `profiles` row itself.
  public_profiles: 'SEC-132 — view over profiles; every column already exported via the profiles row',

  // KAN-497: the bare CheckLyra ID of a deleted, once-published account, kept
  // forever so no one can take it and old links never reach a stranger. It has
  // no user_id or profile_id: nothing ties it to a person, so there is nothing
  // to return to a subject, and it is written only AFTER their account is gone.
  retired_lyra_ids: 'Art.11 — KAN-497 retired IDs of deleted accounts; no link to any person',

};
