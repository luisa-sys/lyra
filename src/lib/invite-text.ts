/**
 * KAN-154-B: build the shareable invite text a user can copy from the
 * dashboard and paste into WhatsApp / SMS / email.
 *
 * Kept in a sibling .ts module (NOT in 'use server' files) so it can be
 * imported by both the Server Component (dashboard/page.tsx) AND the
 * client share button (dashboard/share-profile.tsx) without colliding
 * with the use-server export rule (CLAUDE.md gotcha #18).
 *
 * Personalisation: the user's profile URL is embedded so recipients land
 * on the inviter's profile. The text is deliberately gentle and explicit
 * about the time cost ("a couple of minutes") to defuse the common
 * objection "I don't have time for another app".
 */

const PRODUCT_BLURB =
  "I'm using Lyra to help people around me know what I'd appreciate — gift ideas, things I love, things I don't, that sort of thing.";

const COMMITMENT_BLURB =
  "It only takes a couple of minutes — even just adding a few gift ideas helps.";

const SITE_LANDING =
  process.env.NEXT_PUBLIC_SITE_URL || "https://checklyra.com";

/**
 * Returns the full invite message a user can paste into any channel.
 *
 * @param opts.profileUrl - The inviter's published profile URL
 *                          (e.g. https://checklyra.com/<slug>). Omit /
 *                          pass undefined if the inviter has no slug yet —
 *                          we fall back to the public landing page.
 * @param opts.greeting   - Optional opener (e.g. "Hi Sarah!"). Falls back
 *                          to a neutral "Hi!" so the text stays useful
 *                          even when copied without personalisation.
 */
export function buildInviteText(opts: {
  profileUrl?: string | null;
  greeting?: string;
}): string {
  const greeting = (opts.greeting ?? "Hi!").trim();
  const myProfileLine = opts.profileUrl
    ? `Mine's here if you want to take a look: ${opts.profileUrl}`
    : null;
  const ctaLine = `Here's where you can create yours: ${SITE_LANDING}`;

  return [
    greeting,
    "",
    PRODUCT_BLURB,
    "",
    COMMITMENT_BLURB,
    "",
    myProfileLine,
    ctaLine,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
