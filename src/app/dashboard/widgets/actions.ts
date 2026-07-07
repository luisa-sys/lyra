'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import { withDismissal, type DashboardWidgetState } from '@/lib/dashboard/dismissal';
import { WIDGET_IDS, type WidgetId, type OnboardingState } from '@/lib/dashboard/resolve-widgets';

const STATES: readonly string[] = ['empty', 'drafted', 'published_activate', 'published_grow'];

/**
 * KAN-345 — dismiss a dashboard widget for the current user + onboarding state.
 * Owner-only write via the cookie client (RLS); dashboard_widget_state is not an
 * admin-only column, so it passes the self-elevation guard. Re-surfaces on a
 * state change because the dismissal records the state it happened in.
 */
export async function dismissWidget(formData: FormData): Promise<void> {
  const widgetId = String(formData.get('widget_id') ?? '');
  const state = String(formData.get('state') ?? '');
  if (!(WIDGET_IDS as readonly string[]).includes(widgetId) || !STATES.includes(state)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, dashboard_widget_state')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.id) return;

  const next = withDismissal(
    (profile.dashboard_widget_state as DashboardWidgetState | null) ?? {},
    widgetId as WidgetId,
    state as OnboardingState,
    new Date().toISOString(),
  );

  await supabase.from('profiles').update({ dashboard_widget_state: next }).eq('id', profile.id);
  revalidatePath('/dashboard');
}
