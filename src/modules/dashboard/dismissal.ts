/**
 * KAN-345 (epic KAN-349) — dashboard widget dismissal state (pure helpers).
 *
 * Persisted as a JSONB map on `profiles.dashboard_widget_state`:
 *   { [widget_id]: { dismissed_at, state } }
 *
 * A dismissal is recorded together with the onboarding STATE it happened in, so
 * a widget re-surfaces when the state changes (the proposal default — "remind me
 * later by progressing"). The user writes only their own row (RLS owner-update;
 * not an admin-only column, so the self-elevation guard does not block it).
 */
import type { OnboardingState, WidgetId } from './resolve-widgets';

export interface WidgetDismissal {
  dismissed_at: string;
  state: OnboardingState;
}
export type DashboardWidgetState = Partial<Record<WidgetId, WidgetDismissal>>;

/**
 * Map the persisted dismissals to the resolver's `dismissed` input for the
 * CURRENT state. A widget is dismissed-for-this-state only if it was dismissed
 * WHILE in this state — so a state change re-surfaces it.
 */
export function dismissedForState(
  stored: DashboardWidgetState | null | undefined,
  current: OnboardingState,
): Partial<Record<WidgetId, boolean>> {
  const out: Partial<Record<WidgetId, boolean>> = {};
  if (!stored) return out;
  for (const [id, d] of Object.entries(stored)) {
    if (d && d.state === current) out[id as WidgetId] = true;
  }
  return out;
}

/** Pure: merge a new dismissal into the stored map. */
export function withDismissal(
  stored: DashboardWidgetState | null | undefined,
  id: WidgetId,
  state: OnboardingState,
  now: string,
): DashboardWidgetState {
  return { ...(stored ?? {}), [id]: { dismissed_at: now, state } };
}
