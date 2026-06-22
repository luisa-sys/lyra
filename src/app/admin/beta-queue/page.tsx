/**
 * KAN-277 → KAN-311: the beta queue is now a filtered view of the unified
 * user-management console. This route is kept as a permanent redirect so old
 * links / bookmarks / the nav shortcut keep working.
 *
 * The single-row `approveBetaUser` action (./actions) is retained — it remains a
 * valid one-off approve path and is covered by its unit test — but day-to-day
 * approvals now happen in the console with search + bulk select.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BetaQueueRedirect() {
  redirect('/admin/users?stage=waitlist');
}
