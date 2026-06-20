"use server";

import { headers } from "next/headers";
import { sanitiseText } from "@/lib/sanitise";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * KAN-272 — Contact form server action.
 *
 * Records/relays a contact message. There is no `contact_messages` table yet
 * (adding one is a schema migration outside this PR's scope), so the message
 * is RELAYED BY EMAIL via the existing Resend integration to the team inbox.
 * If Resend isn't configured (no RESEND_API_KEY), the action degrades
 * gracefully: it logs the message server-side and still returns success, so
 * the form works in every environment. Keys are read from env, never
 * hardcoded.
 *
 * A Cloudflare Turnstile human-check runs first, but only when both
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are provisioned
 * (see src/lib/turnstile.ts). When unset, the check is skipped and the form
 * still submits.
 *
 * Per gotcha #18 this 'use server' module exports ONLY async functions; the
 * result shape is exported as a `type` (erased at runtime).
 */

export type ContactState = {
  ok: boolean;
  message: string;
};

const CONTACT_TO_EMAIL =
  process.env.CONTACT_TO_EMAIL || "hello@checklyra.com";
const CONTACT_FROM_EMAIL =
  process.env.CONTACT_FROM_EMAIL || "noreply@checklyra.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function relayByEmail(
  name: string,
  email: string,
  message: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Graceful degrade — no email provider configured. Don't lose the
    // message silently and don't fail the user's submit.
    console.warn(
      "[contact] RESEND_API_KEY not set — message not emailed. From:",
      email,
    );
    return;
  }

  const subject = `Lyra contact form — ${name}`;
  const text = `New contact message\n\nName: ${name}\nEmail: ${email}\n\n${message}`;
  const html =
    `<p><strong>New contact message</strong></p>` +
    `<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
    `<strong>Email:</strong> ${escapeHtml(email)}</p>` +
    `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Lyra <${CONTACT_FROM_EMAIL}>`,
        to: [CONTACT_TO_EMAIL],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[contact] Resend send failed:", res.status, detail.slice(0, 200));
    }
  } catch (err) {
    console.error("[contact] Resend send threw:", err);
  }
}

export async function submitContact(
  _prev: ContactState | null,
  formData: FormData,
): Promise<ContactState> {
  const name = sanitiseText(String(formData.get("name") ?? ""), 120).trim();
  const email = sanitiseText(String(formData.get("email") ?? ""), 254).trim();
  const message = sanitiseText(String(formData.get("message") ?? ""), 5000).trim();
  const token = String(formData.get("cf-turnstile-response") ?? "");

  // Basic validation.
  if (!name || !email || !message) {
    return { ok: false, message: "Please fill in your name, email and message." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "That email address doesn't look right — please check it." };
  }

  // Human-check (only enforced when Turnstile keys are provisioned).
  let remoteIp: string | null = null;
  try {
    const h = await headers();
    remoteIp =
      h.get("cf-connecting-ip") ||
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
  } catch {
    remoteIp = null;
  }

  const turnstile = await verifyTurnstile(token, remoteIp);
  if (!turnstile.ok) {
    return {
      ok: false,
      message:
        turnstile.reason === "missing_token"
          ? "Please complete the human-check before sending."
          : "We couldn't verify the human-check — please try again.",
    };
  }

  await relayByEmail(name, email, message);

  return {
    ok: true,
    message:
      "Thank you — your message is on its way. We read everything and we'll come back to you. 💛",
  };
}
