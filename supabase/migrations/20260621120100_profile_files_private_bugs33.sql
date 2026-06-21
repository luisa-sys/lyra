-- BUGS-33 / SEC-03b: make the profile-files storage bucket private.
--
-- The profile-files bucket was public=true. A public bucket serves objects via
-- /storage/v1/object/public/<bucket>/<path> WITHOUT evaluating the (already
-- owner-scoped, per BUGS-25) RLS SELECT policy — so private/connections-visibility
-- files were world-readable by anyone holding the direct URL.
--
-- Fix: make the bucket private. Object access now requires the owner-scoped RLS
-- (authenticated API) or a short-lived signed URL. The public profile page
-- (src/app/[slug]/page.tsx) mints per-file signed URLs via the service role for
-- only the files the viewer is allowed to see (visibility already filtered).
--
-- profile-photos stays public — avatars are public on a published profile and
-- have no per-file visibility.
--
-- Applied to dev + staging + prod (DB history) 2026-06-21. Both buckets were
-- empty (0 objects) at the time, so no in-flight object access was affected.

update storage.buckets set public = false where id = 'profile-files';
