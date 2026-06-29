import Link from 'next/link';
import type { ReactNode } from 'react';
import ShareProfile from '../share-profile';
import { dismissWidget } from './actions';
import {
  isDismissible,
  type WidgetId,
  type OnboardingState,
  type WidgetResolution,
} from '@/lib/dashboard/resolve-widgets';

/**
 * KAN-346/347 (epic KAN-349) — dashboard widget framework + the six widgets.
 *
 * Takes the resolver output (KAN-344) and renders the ordered, gated widget
 * stack, reusing the KAN-326/337 share card for W5. The registry below is the
 * one place a new feature adds its dashboard widget — add an id to the resolver
 * + a case here. Dismissal is a server-action form (no client JS).
 *
 * ⚠️ COPY is PROPOSED — flagged for founder review (KAN-347 §6 "final copy").
 */

export interface WidgetContext {
  state: OnboardingState;
  completionScore: number;
  /** canPublishWithAge(age_status) — drives W2's "publish" vs "verify age" CTA. */
  canPublishAge: boolean;
  profileUrl: string | null;
  displayName: string | null;
  betaLink: string | null;
}

/** Card shell with an optional server-action dismiss control (top-right ✕). */
function WidgetShell({
  widgetId,
  state,
  title,
  accent,
  children,
}: {
  widgetId: WidgetId;
  state: OnboardingState;
  title?: string;
  accent?: boolean;
  children: ReactNode;
}) {
  const dismissible = isDismissible(widgetId);
  return (
    <div
      className={`relative bg-white rounded-xl border p-6 ${
        accent ? 'border-[var(--color-sage)]/40' : 'border-[var(--color-border)]'
      }`}
    >
      {dismissible && (
        <form action={dismissWidget} className="absolute top-3 right-3">
          <input type="hidden" name="widget_id" value={widgetId} />
          <input type="hidden" name="state" value={state} />
          <button
            type="submit"
            aria-label={`Dismiss ${title ?? widgetId}`}
            className="text-[var(--color-muted)] hover:text-[var(--color-ink)] text-sm leading-none px-1"
          >
            ✕
          </button>
        </form>
      )}
      {title && <h3 className="text-lg font-medium text-[var(--color-ink)] mb-1 pr-6">{title}</h3>}
      {children}
    </div>
  );
}

function Cta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-3 inline-block rounded-lg bg-[var(--color-sage)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
    >
      {label}
    </Link>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--color-muted)] leading-relaxed">{children}</p>;
}

/** Render one widget by id. PROPOSED copy — review before finalising. */
function renderWidget(id: WidgetId, ctx: WidgetContext): ReactNode {
  switch (id) {
    case 'complete_profile':
      return (
        <WidgetShell widgetId={id} state={ctx.state} title="Complete your profile" accent>
          <Body>
            You&rsquo;re {ctx.completionScore}% of the way there. Add a few more details so the
            people in your life know what you&rsquo;d love.
          </Body>
          <Cta href="/dashboard/profile" label="Edit profile →" />
        </WidgetShell>
      );
    case 'publish':
      return ctx.canPublishAge ? (
        <WidgetShell widgetId={id} state={ctx.state} title="Publish your profile" accent>
          <Body>Your profile is ready — publish it so people can find you on Lyra.</Body>
          <Cta href="/dashboard/profile" label="Open editor →" />
        </WidgetShell>
      ) : (
        <WidgetShell widgetId={id} state={ctx.state} title="Verify your age to publish" accent>
          <Body>A quick age check is required before your profile can go public.</Body>
          <Cta href="/verify-age" label="Verify age →" />
        </WidgetShell>
      );
    case 'add_gifts':
      return (
        <WidgetShell widgetId={id} state={ctx.state} title="Add a few gift ideas">
          <Body>
            Share some things you&rsquo;d genuinely love — it&rsquo;s the easiest way for people to
            get it right.
          </Body>
          <Cta href="/dashboard/profile" label="Add gift ideas →" />
        </WidgetShell>
      );
    case 'add_affiliations':
      return (
        <WidgetShell widgetId={id} state={ctx.state} title="Add your schools &amp; groups">
          <Body>
            Add the schools, organisations and communities you&rsquo;re part of so the right people
            can find you.
          </Body>
          <Cta href="/dashboard/profile" label="Add affiliations →" />
        </WidgetShell>
      );
    case 'share':
      // Reuses the KAN-326/337 share card (its own heading serves as the title).
      return (
        <WidgetShell widgetId={id} state={ctx.state}>
          <ShareProfile profileUrl={ctx.profileUrl} displayName={ctx.displayName} betaLink={ctx.betaLink} bare />
        </WidgetShell>
      );
    case 'convene':
      return (
        <WidgetShell widgetId={id} state={ctx.state} title="Organise a gathering">
          <Body>
            Pick a time that works, suggest a place, and send invites — all from your dashboard with
            Convene.
          </Body>
          <Cta href="/dashboard/convene/gatherings" label="Open Convene →" />
        </WidgetShell>
      );
  }
}

export default function DashboardWidgets({
  resolution,
  ctx,
}: {
  resolution: WidgetResolution;
  ctx: WidgetContext;
}) {
  if (resolution.widgets.length === 0) return null;
  const fullCtx = { ...ctx, state: resolution.state };
  return (
    <div className="space-y-4 mb-6" data-onboarding-state={resolution.state}>
      {resolution.widgets.map((w) => (
        <div key={w.id} data-widget={w.id}>
          {renderWidget(w.id, fullCtx)}
        </div>
      ))}
    </div>
  );
}
