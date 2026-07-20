/**
 * /verify-age — retired.
 *
 * Lyra no longer runs a provider age check. Age is established by the 18+
 * self-declaration at sign-up (see src/lib/age/self-declaration.ts), so there
 * is nothing to verify here and no publish-time gate to clear.
 *
 * The route is kept as a redirect rather than deleted so existing links —
 * bookmarks, older emails, and the copy that used to point here — land
 * somewhere useful instead of a 404.
 */
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Verify your age — Lyra',
  robots: { index: false, follow: false },
};

export default async function VerifyAgePage() {
  redirect('/dashboard/profile');
}
