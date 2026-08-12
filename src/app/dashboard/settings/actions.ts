'use server';

import { createClient } from '@/modules/platform/supabase-server';
import { getAdminServiceClient } from '@/lib/admin';
import { getAccountStanding, shouldRefuseIssuance } from '@/lib/account-status';
import { redirect } from 'next/navigation';
import { randomBytes, createHash } from 'crypto';
import { isFeatureGloballyEnabled } from '@/modules/features/global-switches-service';
import * as Sentry from '@sentry/nextjs';

// SEC-75 leg (b): external systems that may still hold a copy of a deleted
// user's data after the Postgres cascade runs. On deletion we RECORD (not call)
// an erasure obligation naming these so an ops follow-up — which holds the KV /
// processor write credentials — can action and close each one. Not exported:
// a 'use server' file may only export async functions (BUGS-12 / gotcha #18).
const ERASURE_PROCESSORS = ['cloudflare_kv_waitlist', 'resend', 'didit', 'google'];

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// SEC-71 (UK-GDPR Art. 15/20): the subject-access / data-portability export
// must cover EVERY table keyed to the person, and must stay in lockstep with
// the deletion cascade in deleteAccount() below — export and erasure have to
// describe the same data set. We read with the service-role admin client (not
// the RLS-scoped user client) for two reasons: (1) completeness — some rows
// live in fail-closed, service-role-only tables (no owner SELECT policy), and
// an RLS-scoped read would silently return empty and present a partial export
// as complete; (2) symmetry with the deletion cascade, which is also
// service-role. Every query below is explicitly scoped to the authenticated
// user's own rows (owner_user_id / profile_id / their own gathering ids), so
// there is no over-exposure. Secret material (api-key hashes, OAuth token
// vault refs, RSVP tokens) is redacted by column selection.
export async function exportUserData(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: 'Not authenticated' });

  const admin = getAdminServiceClient();

  // Track partial-fetch failures so we never present an incomplete export as
  // a clean one (Workflow & Backup Integrity Policy: distinguish "0" from
  // "fetch failed"). Any error surfaces in the export payload.
  const fetchErrors: string[] = [];
  const record = (label: string, error: { message: string } | null) => {
    if (error) fetchErrors.push(`${label}: ${error.message}`);
  };

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (profileErr || !profile) return JSON.stringify({ error: 'Profile not found' });

  const profileId = profile.id as string;

  // --- Profile-keyed personal data ---------------------------------------
  const { data: items, error: itemsErr } = await admin
    .from('profile_items').select('*').eq('profile_id', profileId);
  record('profile_items', itemsErr);

  const { data: schools, error: schoolsErr } = await admin
    .from('school_affiliations').select('*').eq('profile_id', profileId);
  record('school_affiliations', schoolsErr);

  const { data: links, error: linksErr } = await admin
    .from('external_links').select('*').eq('profile_id', profileId);
  record('external_links', linksErr);

  const { data: manualOfMe, error: momErr } = await admin
    .from('profile_manual_of_me').select('*').eq('profile_id', profileId);
  record('profile_manual_of_me', momErr);

  const { data: conversationStarters, error: csErr } = await admin
    .from('profile_conversation_starters').select('*').eq('profile_id', profileId);
  record('profile_conversation_starters', csErr);

  // File metadata only — the binary lives in storage, not in this JSON.
  const { data: files, error: filesErr } = await admin
    .from('profile_files').select('*').eq('profile_id', profileId);
  record('profile_files', filesErr);

  // Automated moderation flags raised against this profile's content.
  const { data: moderationFlags, error: modErr } = await admin
    .from('content_moderation_flags').select('*').eq('profile_id', profileId);
  record('content_moderation_flags', modErr);

  // --- User-keyed personal data ------------------------------------------
  const { data: apiKeys, error: keysErr } = await admin
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at, revoked_at')
    .eq('user_id', user.id);
  record('api_keys', keysErr);

  // OAuth connections — redact the Vault secret references and never emit
  // token material.
  const { data: oauthConnections, error: oauthErr } = await admin
    .from('oauth_connections')
    .select('id, provider, provider_account_id, display_name, scope_granted, status, access_token_expires_at, last_used_at, created_at, updated_at, deleted_at')
    .eq('owner_user_id', user.id);
  record('oauth_connections', oauthErr);

  // Reports this user filed against others.
  const { data: reportsFiled, error: reportsErr } = await admin
    .from('reports')
    .select('id, profile_id, profile_item_id, reason, note, status, created_at, resolved_at')
    .eq('reporter_user_id', user.id);
  record('reports_filed', reportsErr);

  // Address book: contacts the user owns, plus their contact methods.
  const { data: contacts, error: contactsErr } = await admin
    .from('contacts').select('*').eq('owner_user_id', user.id);
  record('contacts', contactsErr);

  const contactIds = (contacts || []).map((c) => c.id as string);
  let contactMethods: unknown[] = [];
  if (contactIds.length) {
    const { data, error } = await admin
      .from('contact_methods').select('*').in('contact_id', contactIds);
    record('contact_methods', error);
    contactMethods = data || [];
  }

  // --- Convene: gatherings the user hosts, plus their child rows ----------
  const { data: gatherings, error: gathErr } = await admin
    .from('gatherings').select('*').eq('host_user_id', user.id);
  record('gatherings', gathErr);

  const gatheringIds = (gatherings || []).map((g) => g.id as string);
  let gatheringInvitees: unknown[] = [];
  let proposedSlots: unknown[] = [];
  let inviteMessages: unknown[] = [];
  if (gatheringIds.length) {
    // Redact the RSVP bearer token — it's a live credential, not portability data.
    const invitees = await admin
      .from('gathering_invitees')
      .select('id, gathering_id, contact_id, status, dietary_overrides, plus_ones, notes, invited_at, responded_at, created_at, updated_at')
      .in('gathering_id', gatheringIds);
    record('gathering_invitees', invitees.error);
    gatheringInvitees = invitees.data || [];

    const slots = await admin
      .from('gathering_proposed_slots').select('*').in('gathering_id', gatheringIds);
    record('gathering_proposed_slots', slots.error);
    proposedSlots = slots.data || [];

    const messages = await admin
      .from('gathering_invite_messages').select('*').in('gathering_id', gatheringIds);
    record('gathering_invite_messages', messages.error);
    inviteMessages = messages.data || [];
  }

  // Convene activity log for the user's own actions.
  const { data: gatheringEvents, error: eventsErr } = await admin
    .from('gathering_events_log').select('*').eq('actor_user_id', user.id);
  record('gathering_events_log', eventsErr);

  // SEC-117: the nine person-keyed tables below were absent from this export
  // while the deletion cascade erased them, so a SAR response was incomplete
  // and — because nothing errored — indistinguishable from a complete one.
  // Membership of this list is now checked against the schema by
  // tests/unit/sar-export-completeness.test.js; see
  // src/lib/gdpr/person-keyed-tables.ts.

  // Per-user feature grants (KAN-309). Personal data: it records what this
  // member is permitted to do.
  const { data: entitlements, error: entitlementsErr } = await admin
    .from('feature_entitlements').select('*').eq('profile_id', profileId);
  record('feature_entitlements', entitlementsErr);

  // Consent history — what they agreed to and when. Central to an Art.15
  // response, since it is the record of the lawful basis itself.
  const { data: consents, error: consentsErr } = await admin
    .from('consent_log').select('*').eq('user_id', user.id);
  record('consent_log', consentsErr);

  // OAuth consents granted to third-party clients (distinct from the token
  // material, which stays redacted per SEC-71).
  const { data: oauthConsents, error: oauthConsentsErr } = await admin
    .from('oauth_consents').select('*').eq('user_id', user.id);
  record('oauth_consents', oauthConsentsErr);

  // Contact groups the user owns, and their membership.
  const { data: tribes, error: tribesErr } = await admin
    .from('tribes').select('*').eq('owner_user_id', user.id);
  record('tribes', tribesErr);
  const tribeIds = (tribes || []).map((t) => t.id);
  let tribeMembers: unknown[] = [];
  if (tribeIds.length) {
    const { data, error } = await admin
      .from('tribe_members').select('*').in('tribe_id', tribeIds);
    record('tribe_members', error);
    tribeMembers = data || [];
  }

  // Behavioural / affiliate telemetry keyed to the user.
  const { data: affiliateClicks, error: clicksErr } = await admin
    .from('affiliate_clicks').select('*').eq('user_id', user.id);
  record('affiliate_clicks', clicksErr);

  const { data: recommendationEvents, error: recErr } = await admin
    .from('recommendation_events').select('*').eq('user_id', user.id);
  record('recommendation_events', recErr);

  // Derived relationship strength — inferred personal data, and Art.15 covers
  // inferences as much as it covers what the member typed in.
  const { data: relationshipSignals, error: signalsErr } = await admin
    .from('relationship_signals').select('*').eq('user_id', user.id);
  record('relationship_signals', signalsErr);

  const { data: venueRatings, error: ratingsErr } = await admin
    .from('venue_ratings').select('*').eq('user_id', user.id);
  record('venue_ratings', ratingsErr);

  // KAN-443: the gift suggestions the member dismissed. Their own editorial
  // decisions about their own profile — Art.15 data, keyed by profile_id.
  const { data: giftDismissals, error: dismissalsErr } = await admin
    .from('gift_suggestion_dismissals').select('*').eq('profile_id', profileId);
  record('gift_suggestion_dismissals', dismissalsErr);

  // Venue visits hang off the user's own gatherings.
  let venueVisits: unknown[] = [];
  if (gatheringIds.length) {
    const { data, error } = await admin
      .from('venue_visits').select('*').in('gathering_id', gatheringIds);
    record('venue_visits', error);
    venueVisits = data || [];
  }

  // Scopes granted per OAuth connection.
  const connectionIds = (oauthConnections || []).map((c) => c.id);
  let oauthScopes: unknown[] = [];
  if (connectionIds.length) {
    const { data, error } = await admin
      .from('oauth_scopes_granted').select('*').in('oauth_connection_id', connectionIds);
    record('oauth_scopes_granted', error);
    oauthScopes = data || [];
  }

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    account: { email: user.email, created_at: user.created_at },
    profile,
    items: items || [],
    schools: schools || [],
    links: links || [],
    manual_of_me: manualOfMe || [],
    conversation_starters: conversationStarters || [],
    files: files || [],
    moderation_flags: moderationFlags || [],
    api_keys: apiKeys || [],
    oauth_connections: oauthConnections || [],
    reports_filed: reportsFiled || [],
    contacts: contacts || [],
    contact_methods: contactMethods,
    gatherings: gatherings || [],
    gathering_invitees: gatheringInvitees,
    gathering_proposed_slots: proposedSlots,
    gathering_invite_messages: inviteMessages,
    gathering_events_log: gatheringEvents || [],
    feature_entitlements: entitlements || [],
    consent_log: consents || [],
    oauth_consents: oauthConsents || [],
    tribes: tribes || [],
    tribe_members: tribeMembers,
    affiliate_clicks: affiliateClicks || [],
    recommendation_events: recommendationEvents || [],
    relationship_signals: relationshipSignals || [],
    venue_ratings: venueRatings || [],
    venue_visits: venueVisits,
    oauth_scopes_granted: oauthScopes,
    gift_suggestion_dismissals: giftDismissals || [],
    // Present only when one or more sections failed to fetch — the export is
    // then known-incomplete and must not be treated as a full SAR response.
    ...(fetchErrors.length ? { export_incomplete_errors: fetchErrors } : {}),
  }, null, 2);
}

export async function deleteAccount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const userId = user.id;

  // True erasure (GDPR). Hard-delete the auth user with the service-role
  // client: profiles.user_id -> auth.users(id) is ON DELETE CASCADE, and
  // every profile-owned table cascades from profiles(id), so this removes
  // ALL of the person's data in one step — profile, items, links, schools,
  // files, manual-of-me, conversation starters, moderation reports, api
  // keys, oauth tokens, convene rows. (The previous version only deleted
  // the profile and left the auth user, and their email, behind.)
  const admin = getAdminServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // The only expected failure is an account that has performed moderation/
    // admin actions: moderation_logs.actor_user_id is ON DELETE RESTRICT and
    // the log is append-only + tamper-evident (SEC-64), so the auth-user
    // delete is blocked by those audit rows. Per SEC-75 (UK-GDPR Art.17(3)(b),
    // retention for a legal obligation), the moderation audit trail — and the
    // actor identity it references — is retained as a documented, time-limited
    // erasure exception (see docs/compliance/RETENTION_SCHEDULE.md +
    // DSAR_BREACH_COMPLAINTS.md). Don't half-delete anything; route the person
    // to the privacy inbox, which erases everything lawful and records what
    // must be retained and why.
    return redirect(
      '/dashboard/settings?error=' +
        encodeURIComponent(
          'Your account includes moderation/admin audit records we are legally required to keep, so it cannot be deleted automatically. Please email privacy@checklyra.com — we will erase everything we lawfully can and explain what must be retained.',
        ),
    );
  }

  // SEC-75 leg (b): the auth cascade erased everything in Postgres, but copies
  // may persist in external processors (Resend/Didit/Google) and Cloudflare KV
  // (waitlist email). Record a durable erasure obligation for an ops follow-up
  // to action. Best-effort: a logging failure must NOT block the user's erasure
  // right — capture it to Sentry so the missed obligation is still surfaced.
  try {
    const { error: obligationError } = await admin.rpc('record_erasure_obligation', {
      p_subject_user_id: userId,
      // SEC-132: the generated Args type says `p_subject_email: string`, because
      // typegen marks any parameter without a SQL DEFAULT as required and
      // non-null. Verified against the database: `record_erasure_obligation` is
      // NOT STRICT and `erasure_obligations.subject_email` is nullable, so NULL
      // is accepted and stored. Passing `''` instead would type-check and be
      // WRONG — it would record an erasure obligation carrying an email address
      // that is not merely unknown but affirmatively empty, which is what an ops
      // follow-up would then try to chase through Resend and Didit.
      p_subject_email: (user.email ?? null) as string,
      p_processors: ERASURE_PROCESSORS,
      p_notes: 'Account hard-deleted; external processor / KV copies pending erasure (SEC-75 leg b).',
    });
    if (obligationError) {
      Sentry.captureException(new Error(`record_erasure_obligation failed: ${obligationError.message}`), {
        tags: { area: 'erasure-obligation', ticket: 'SEC-75' },
      });
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { area: 'erasure-obligation', ticket: 'SEC-75' } });
  }

  // Best-effort: remove now-orphaned storage objects (the DB cascade
  // doesn't touch storage). Non-fatal — the account and all rows are gone.
  for (const bucket of ['profile-photos', 'profile-files']) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(userId);
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // ignore — orphaned-object cleanup isn't worth failing the flow
    }
  }

  // Clear the now-invalid session cookie and send them home.
  await supabase.auth.signOut();
  redirect('/');
}

export async function generateApiKey(name: string = 'Default'): Promise<{ key?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // SEC-57: refuse to mint credentials for a suspended (or unverifiable)
  // account. Fail closed — a suspended user must not be able to obtain a new
  // MCP API key even if they reach this action directly (the middleware
  // redirect that normally catches them fails open on a lookup error).
  const standing = await getAccountStanding(supabase, user.id);
  if (shouldRefuseIssuance(standing)) {
    return { error: 'Your account is suspended. API keys cannot be generated.' };
  }

  // KAN-408: MCP access (Administration via MCP) can be turned off globally per
  // environment. When it is, refuse to mint new keys. (Full enforcement over
  // existing keys is the MCP-server lockstep follow-up, KAN-222.)
  if (!(await isFeatureGloballyEnabled('mcp'))) {
    return { error: 'MCP access is currently disabled.' };
  }

  // Generate a secure random API key
  const rawKey = `lyra_${randomBytes(24).toString('base64url')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);

  const { error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name,
  });

  if (error) return { error: error.message };

  // Return the raw key — this is the ONLY time it's visible
  return { key: rawKey };
}

export async function listApiKeys(): Promise<{ keys?: Array<{ id: string; key_prefix: string; name: string; created_at: string; last_used_at: string | null }>; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { keys: data || [] };
}

export async function revokeApiKey(keyId: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function updateEmail(newEmail: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.auth.updateUser({
    email: newEmail,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  if (newPassword.length < 6) return { error: 'New password must be at least 6 characters' };

  // SEC-82: current-password proof is mandatory. The re-auth below needs an
  // email (signInWithPassword is email+password), so previously the whole
  // check was wrapped in `if (user.email)` — meaning an emailless account
  // (e.g. OAuth-provisioned) could set a new password with ZERO proof of the
  // old one from any authenticated session. There is no way to prove knowledge
  // of the current password without an email, so refuse: the user must add an
  // email first, which routes them back through the proof-carrying path.
  if (!user.email) {
    return { error: 'Add an email address to your account before setting a password.' };
  }

  // Verify current password by re-authenticating
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) return { error: 'Current password is incorrect' };

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) return { error: error.message };
  return { success: true };
}
