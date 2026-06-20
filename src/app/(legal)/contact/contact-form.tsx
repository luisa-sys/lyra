"use client";

import { useActionState, useEffect, useRef } from "react";
import Script from "next/script";
import { submitContact, type ContactState } from "./actions";

/**
 * KAN-272 — Contact form (client).
 *
 * Renders a name / email / message form wired to the `submitContact` server
 * action via React 19's useActionState. When `turnstileSiteKey` is provided
 * (i.e. Turnstile is provisioned) the Cloudflare Turnstile widget renders and
 * the script loads; when it's null the widget is omitted and the form still
 * submits (the server action skips the check). The site key is the only
 * Turnstile value sent to the browser — the secret stays server-side.
 */

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
  }
}

export function ContactForm({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string | null;
}) {
  const [state, formAction, pending] = useActionState<ContactState | null, FormData>(
    submitContact,
    null,
  );
  const widgetRef = useRef<HTMLDivElement | null>(null);

  // Explicitly render the Turnstile widget once the script is ready. The
  // implicit auto-render also works, but rendering by ref is robust to the
  // client-side navigation case.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const el = widgetRef.current;
    if (el && window.turnstile && el.childElementCount === 0) {
      window.turnstile.render(el, { sitekey: turnstileSiteKey });
    }
  });

  if (state?.ok) {
    return (
      <div
        role="status"
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-4 py-4 text-sm text-[var(--color-ink)]"
      >
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="not-prose space-y-1">
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}

      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 mb-2"
        >
          {state.message}
        </div>
      )}

      <label htmlFor="contact-name" className="block text-[12.5px] text-[var(--color-muted)] mt-3 mb-1">
        Your name
      </label>
      <input
        id="contact-name"
        name="name"
        type="text"
        required
        autoComplete="name"
        placeholder="Your name"
        className="w-full px-3 py-2.5 rounded-[9px] border border-[#d8d0c6] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />

      <label htmlFor="contact-email" className="block text-[12.5px] text-[var(--color-muted)] mt-3 mb-1">
        Your email (so we can reply)
      </label>
      <input
        id="contact-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="w-full px-3 py-2.5 rounded-[9px] border border-[#d8d0c6] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />

      <label htmlFor="contact-message" className="block text-[12.5px] text-[var(--color-muted)] mt-3 mb-1">
        Message
      </label>
      <textarea
        id="contact-message"
        name="message"
        required
        rows={5}
        placeholder="How can we help?"
        className="w-full px-3 py-2.5 rounded-[9px] border border-[#d8d0c6] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />

      {turnstileSiteKey ? (
        <div ref={widgetRef} className="cf-turnstile mt-4" data-sitekey={turnstileSiteKey} />
      ) : (
        <p className="text-[11.5px] text-[var(--color-muted)] mt-3">
          A human-check will appear here once it&apos;s switched on.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-block px-6 py-2.5 rounded-[9px] bg-[var(--color-sage)] text-white text-sm font-medium hover:bg-[var(--color-sage-hover)] transition-colors disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
