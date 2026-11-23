-- KAN-109: Seed the DEV database with sample profile content for testing.
-- Run against dev Supabase only (ilprytcrnqyrsbsrfujj). Never staging or prod.
--
-- KAN-490 (2026-11-23): spec v0.8 §3 says "Do not seed illustrative sample
-- content into real accounts." Founder answer 2026-11-23: "approved, go
-- ahead". So this script NO LONGER writes to any real member's account.
-- (Until this change it targeted two real dev sign-ins by profile UUID.)
--
-- WHO IT WRITES TO
--   Only dedicated seed accounts whose sign-in email matches the reserved
--   pattern
--
--       seed.dev.<name>@seed.checklyra.com
--
--   (regex, compared lower-case: ^seed\.dev\.[a-z0-9_-]+@seed\.checklyra\.com$).
--   @seed.checklyra.com is Lyra's reserved demo domain: nobody can receive
--   mail there, so no real person can own one of these sign-ins. The
--   `seed.dev.` prefix keeps this script away from the two other kinds of
--   seed account on that domain:
--     * homepage examples (KAN-334, `is_homepage_example`): changing their
--       content would change what the logged-out homepage shows;
--     * the authenticated E2E users `seed.e2e.<state>@seed.checklyra.com`
--       (tests/e2e/support/seed-user.ts): they are deleted and recreated on
--       every E2E run, so anything seeded there would vanish anyway.
--
-- HARD GUARDS (all inside one DO block, so they cannot be skipped by running
-- only part of the file; any failure RAISEs and nothing is written):
--   1. every email in the target list below must match the reserved pattern;
--   2. every profile actually resolved must belong to an auth user whose
--      email matches the reserved pattern (re-checked from auth.users, not
--      taken from the list);
--   3. no target may be a homepage example;
--   4. at least one target account must exist (otherwise it RAISEs with the
--      set-up instructions below). A missing account is reported with a
--      NOTICE and skipped.
--   There are no profile UUIDs or slugs in this file: targets are found only
--   through the reserved email.
--
-- CREATING THE SEED ACCOUNTS (once, on dev, if they are absent)
--   Supabase dashboard (dev project) → Authentication → Users → Add user →
--   "Create new user", with:
--       seed.dev.alex@seed.checklyra.com
--       seed.dev.sam@seed.checklyra.com
--   tick "Auto Confirm User", and leave the password blank (sign-in is by
--   magic link, which cannot be delivered to this domain — these accounts are
--   for looking at, not for logging in to). Equivalent with the service-role
--   admin API: auth.admin.createUser({ email, email_confirm: true,
--   user_metadata: { full_name: 'Alex Example' } }). The signup trigger
--   (handle_new_user) creates the profile row. Then run this script in the
--   SQL editor. To check what exists first (read-only):
--       select count(*) from auth.users
--        where lower(email) ~ '^seed\.dev\.[a-z0-9_-]+@seed\.checklyra\.com$';
--
-- WHAT IT WRITES (v0.8-valid, idempotent — safe to rerun)
--   * profile text: only fills EMPTY fields, never overwrites;
--   * profile_items in v0.8 categories only (gift_ideas, gifts_to_avoid,
--     favourites, causes, quotes, proud_of, life_hacks, current_problems);
--     every insert is "where not exists (same profile + category + title)",
--     because profile_items has no unique key to conflict on;
--   * manual-of-me prompts: only fills empty prompts;
--   * school affiliations: affiliation_type = 'school', postcode ≤ 12 chars
--     (KAN-485 trigger), show_on_profile left at its default (hidden);
--   * it never publishes a profile and never sets is_homepage_example.
--   KAN-485 triggers (caps, field limits, contact-detail filter) still apply
--   to every write; a trigger refusal aborts the whole run.
--
-- The sample content that earlier runs wrote into the two real dev accounts
-- is NOT touched by this script; whether to remove it is the founder's call.

DO $seed$
DECLARE
  -- The one place the reserved pattern is defined.
  c_pattern constant text := '^seed\.dev\.[a-z0-9_-]+@seed\.checklyra\.com$';
  v_bad     text;
  v_found   int;
  r         record;
BEGIN
  CREATE TEMP TABLE _seed_targets (
    seed_key   text PRIMARY KEY,
    email      text NOT NULL,
    profile_id uuid
  ) ON COMMIT DROP;

  -- The target list. Add accounts here only with a seed.dev.* address.
  INSERT INTO _seed_targets (seed_key, email) VALUES
    ('alex', 'seed.dev.alex@seed.checklyra.com'),
    ('sam',  'seed.dev.sam@seed.checklyra.com');

  -- Guard 1: the list itself.
  SELECT string_agg(seed_key, ', ') INTO v_bad
    FROM _seed_targets WHERE lower(email) !~ c_pattern;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed-dev-data: refusing to run — target(s) % do not use a reserved seed.dev.*@seed.checklyra.com address (spec v0.8 §3: never seed real accounts)', v_bad;
  END IF;

  UPDATE _seed_targets t
     SET profile_id = p.id
    FROM auth.users u
    JOIN public.profiles p ON p.user_id = u.id
   WHERE lower(u.email) = lower(t.email);

  -- Guard 2: re-check every resolved profile against its owner's real email.
  SELECT string_agg(t.seed_key, ', ') INTO v_bad
    FROM _seed_targets t
    JOIN public.profiles p ON p.id = t.profile_id
    JOIN auth.users u ON u.id = p.user_id
   WHERE lower(coalesce(u.email, '')) !~ c_pattern;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed-dev-data: refusing to run — profile(s) for % belong to an account outside the reserved seed pattern', v_bad;
  END IF;

  -- Guard 3: never change a homepage example.
  SELECT string_agg(t.seed_key, ', ') INTO v_bad
    FROM _seed_targets t
    JOIN public.profiles p ON p.id = t.profile_id
   WHERE p.is_homepage_example;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed-dev-data: refusing to run — % is a homepage example (KAN-334); seeding it would change the public homepage', v_bad;
  END IF;

  -- Guard 4: something to seed.
  FOR r IN SELECT seed_key, email FROM _seed_targets WHERE profile_id IS NULL LOOP
    RAISE NOTICE 'seed-dev-data: seed account % (%) does not exist yet — skipped. See the file header to create it.', r.seed_key, r.email;
  END LOOP;
  DELETE FROM _seed_targets WHERE profile_id IS NULL;
  SELECT count(*) INTO v_found FROM _seed_targets;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'seed-dev-data: no seed.dev.*@seed.checklyra.com accounts exist on this database — create them first (see the file header). Nothing was written.';
  END IF;

  -- ==========================================================
  -- Profile text (only fills empty fields — never overwrites)
  -- ==========================================================
  UPDATE public.profiles p SET
    display_name = coalesce(nullif(p.display_name, ''), v.display_name),
    headline     = coalesce(nullif(p.headline, ''),     v.headline),
    bio_short    = coalesce(nullif(p.bio_short, ''),    v.bio_short),
    city         = coalesce(nullif(p.city, ''),         'Crawley'),
    country      = coalesce(nullif(p.country, ''),      'GB'),
    billboard    = coalesce(nullif(p.billboard, ''),    v.billboard)
  FROM (VALUES
    ('alex', 'Alex Example', 'Parent, coffee enthusiast, amateur gardener',
     'I love a quiet Sunday morning with a good book and too much coffee. My kids think I''m embarrassing but I think I''m hilarious.',
     'Kindness is free. Sprinkle it everywhere.'),
    ('sam', 'Sam Example', 'Parent, tech tinkerer, terrible cook',
     'I build things with code and break things in the kitchen. My idea of a perfect weekend involves a long walk, a pub lunch, and absolutely no DIY.',
     'Sleep is a superpower. Protect it.')
  ) AS v(seed_key, display_name, headline, bio_short, billboard)
  JOIN _seed_targets t ON t.seed_key = v.seed_key
  WHERE p.id = t.profile_id;

  -- ==========================================================
  -- Profile items (v0.8 categories), idempotent per profile + category + title
  -- ==========================================================
  INSERT INTO public.profile_items (profile_id, category, title, description, url)
  SELECT t.profile_id, v.category::item_category, v.title, v.description, v.url
  FROM (VALUES
    ('alex', 'gift_ideas', 'Anything from Oliver Bonas', 'I love their candles and homeware', NULL),
    ('alex', 'gift_ideas', 'A really good hand cream', 'L''Occitane or Aesop — I go through these fast', NULL),
    ('alex', 'gift_ideas', 'Book tokens', 'I always have a reading list', NULL),
    ('alex', 'gift_ideas', 'Earl Grey tea', NULL, NULL),
    ('alex', 'gift_ideas', 'Fresh flowers on the table', NULL, NULL),
    ('alex', 'gift_ideas', 'Amazon Wishlist', NULL, 'https://www.amazon.co.uk/hz/wishlist/example'),
    ('alex', 'gifts_to_avoid', 'Scented candles that smell artificial', NULL, NULL),
    ('alex', 'gifts_to_avoid', 'Perfume', 'I''m very particular about scents', NULL),
    ('alex', 'favourite_books', 'Where the Crawdads Sing', 'Read it three times', NULL),
    ('alex', 'causes', 'Mental health awareness', NULL, NULL),
    ('alex', 'quotes', 'Be yourself; everyone else is already taken', 'Oscar Wilde', NULL),
    ('sam', 'gift_ideas', 'Craft beer subscription', 'BrewDog, Beavertown, anything hoppy', NULL),
    ('sam', 'gift_ideas', 'Board games', 'Especially strategy ones — Catan, Wingspan', NULL),
    ('sam', 'gift_ideas', 'Socks', 'Seriously, I always need socks. Fun patterns welcome.', NULL),
    ('sam', 'gift_ideas', 'Board game wishlist', NULL, 'https://boardgamegeek.com/collection/user/example'),
    ('sam', 'gifts_to_avoid', 'Mushrooms', 'Texture thing, sorry', NULL),
    ('sam', 'gifts_to_avoid', 'Anything with dairy', 'Lactose intolerant — oat milk is fine', NULL),
    ('sam', 'favourite_books', 'Project Hail Mary', 'Andy Weir', NULL),
    ('sam', 'favourite_media', 'Ted Lasso', 'Watched it four times', NULL),
    ('sam', 'proud_of', 'Ran a half marathon in 2024', NULL, NULL),
    ('sam', 'life_hacks', 'Keep a water bottle at your desk', 'Game changer', NULL),
    ('sam', 'current_problems', 'What should we do for our anniversary?', 'Open to ideas that aren''t just dinner', NULL)
  ) AS v(seed_key, category, title, description, url)
  JOIN _seed_targets t ON t.seed_key = v.seed_key
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profile_items i
     WHERE i.profile_id = t.profile_id
       AND i.category = v.category::item_category
       AND i.title = v.title
  );

  -- ==========================================================
  -- To understand me a little better (manual of me) — only empty prompts
  -- ==========================================================
  INSERT INTO public.profile_manual_of_me (profile_id, good_to_know, boundaries)
  SELECT t.profile_id, v.good_to_know, v.boundaries
  FROM (VALUES
    ('alex', 'Vegetarian since 2019. Allergic to cats.', 'Please text before visiting.'),
    ('sam', 'Lactose intolerant — oat milk is fine. Formula 1 fan since childhood.', 'No surprise birthday parties, please.')
  ) AS v(seed_key, good_to_know, boundaries)
  JOIN _seed_targets t ON t.seed_key = v.seed_key
  ON CONFLICT (profile_id) DO UPDATE SET
    good_to_know = coalesce(nullif(profile_manual_of_me.good_to_know, ''), excluded.good_to_know),
    boundaries   = coalesce(nullif(profile_manual_of_me.boundaries, ''),   excluded.boundaries);

  -- ==========================================================
  -- Where you might know me from — schools (v0.8: type + postcode <= 12)
  -- ==========================================================
  INSERT INTO public.school_affiliations (profile_id, school_name, school_location, relationship, affiliation_type)
  SELECT t.profile_id, v.school_name, v.postcode, 'parent'::school_relationship, 'school'
  FROM (VALUES
    ('alex', 'Crawley Primary School', 'RH10 1AA'),
    ('alex', 'St Wilfrid''s Catholic School', 'RH11 8PG'),
    ('sam', 'Crawley Primary School', 'RH10 1AA')
  ) AS v(seed_key, school_name, postcode)
  JOIN _seed_targets t ON t.seed_key = v.seed_key
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_affiliations s
     WHERE s.profile_id = t.profile_id
       AND s.affiliation_type = 'school'
       AND s.school_name = v.school_name
  );

  RAISE NOTICE 'seed-dev-data: seeded % seed account(s).', v_found;
END
$seed$;
