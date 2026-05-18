/**
 * KAN-244 (KAN-63 Tier 2-A audit trail) — moderation audit recorder.
 *
 * Wraps `checkModeration` so callers can keep their existing flow
 * (`if (!mod.ok) return error`) AND get a row written to
 * `public.content_moderation_flags` whenever the moderator flags a
 * field — warn or block.
 *
 * Failure mode: the audit insert is fire-and-forget. If the write fails
 * (table missing, RLS misconfig, network blip), we `console.warn` once
 * but the action keeps going. Audit is a side-effect; it must never
 * block a user save.
 *
 * Why this wrapper rather than changing `checkModeration` itself:
 *   - `checkModeration` is pure and synchronous; its tests assert exact
 *     return shapes (`toEqual({ ok: true })`). Mutating that contract
 *     would break a bunch of existing assertions. The wrapper bolts
 *     the audit-write on without touching the existing surface.
 *   - The MCP server (lyra-mcp-server) also wires this via a parallel
 *     module — same pattern, different supabase client.
 */

import { moderateContent, type FieldType } from './content-moderation';
import { checkModeration, type CheckResult } from './moderation-policy';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ModerationSource = 'web_app' | 'mcp_server';

interface ModerateAndAuditArgs {
  text: string | null | undefined;
  fieldType?: FieldType;
  field: string;
  profileId: string | null;
  source: ModerationSource;
}

/**
 * Moderate the text + record a `content_moderation_flags` row when
 * severity is warn or block. Returns the same `CheckResult` shape as
 * `checkModeration` so callers don't have to change their branching.
 */
export async function moderateAndAudit(
  supabase: SupabaseClient,
  args: ModerateAndAuditArgs,
): Promise<CheckResult> {
  const { text, fieldType = 'public', field, profileId, source } = args;
  const mod = checkModeration(text, fieldType, field);

  // Skip the audit table when nothing was flagged (severity=none). This
  // is the hot path for clean saves — we don't want a DB round-trip on
  // every field of every profile edit.
  if (mod.ok) {
    // ok=true means severity is either 'none' or 'warn'. To distinguish
    // we re-derive the severity from the library; cheap pure call.
    // (The pure policy module deliberately doesn't expose `warn` in
    //  its return shape — see header comment.)
    if (text && typeof text === 'string') {
      const detail = moderateContent(text, fieldType);
      if (detail.severity === 'warn') {
        await recordFlag(supabase, {
          profileId,
          field,
          severity: 'warn',
          flags: detail.flags,
          snippet: text,
          source,
        });
      }
    }
    return mod;
  }

  // Block: surface the same error to the caller, write the audit row.
  await recordFlag(supabase, {
    profileId,
    field,
    severity: 'block',
    flags: mod.flags,
    snippet: text ?? '',
    source,
  });
  return mod;
}

interface RecordArgs {
  profileId: string | null;
  field: string;
  severity: 'warn' | 'block';
  flags: string[];
  snippet: string;
  source: ModerationSource;
}

async function recordFlag(supabase: SupabaseClient, args: RecordArgs): Promise<void> {
  try {
    const { error } = await supabase.from('content_moderation_flags').insert({
      profile_id: args.profileId,
      field: args.field,
      severity: args.severity,
      flags: args.flags,
      // DB has CHECK length<=200; defensive truncation here too.
      content_snippet: args.snippet.slice(0, 200),
      source: args.source,
    });
    if (error) {
      console.warn('[moderation-audit] insert failed (will not block save)', {
        field: args.field,
        severity: args.severity,
        error: error.message,
      });
    }
  } catch (e) {
    console.warn('[moderation-audit] insert threw', {
      field: args.field,
      severity: args.severity,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
