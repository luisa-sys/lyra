# KAN-131: Original Python/Flask Site vs Next.js — Feature Audit

> **Audit date:** 30 March 2026
> **Source:** `/Users/admin/Documents/2026 Lyra/lyra-app/` (original Python/Flask app)
> **Target:** `/Users/admin/Documents/2026 Lyra/lyra/` (current Next.js app)

## Executive Summary

The original Lyra site was a **full Flask application** with SQLite, serving
complete profile management, public search/browse, photo uploads, AI-powered
gift recommendations, an admin dashboard, content moderation, and GDPR compliance.
The Next.js rebuild covers auth, basic dashboard, a profile setup wizard, public
profile view, and legal pages — but is **missing significant functionality**.

---

## Feature Comparison Matrix

| Feature | Original (Flask) | Current (Next.js) | Gap? |
|---|---|---|---|
| **Auth: email/password signup** | ✅ | ✅ | — |
| **Auth: login/logout** | ✅ | ✅ | — |
| **Auth: Google OAuth** | ❌ | ✅ | NJS ahead |
| **Auth: forgot/reset password** | ✅ | ❌ | **MISSING** |
| **Profile photo upload** | ✅ (local fs) | ❌ | **MISSING** |
| **Profile edit — all 14 sections** | ✅ | Partial (wizard) | **PARTIAL** |
| **Profile publish/unpublish** | ✅ | ✅ (via wizard) | — |
| **Public profile view** | ✅ | ✅ (`/[slug]`) | — |
| **Public profile search/browse** | ✅ (`/search` with filters) | ❌ | **MISSING** |
| **Search by name/school/region/postcode** | ✅ | ❌ | **MISSING** |
| **Featured profiles on homepage** | ✅ (6 recent) | ❌ | **MISSING** |
| **Profile cards grid** | ✅ | ❌ | **MISSING** |
| **Gift recommendation engine** | ✅ (`recommend.py`) | ❌ | **MISSING** |
| **Recommendation feedback (up/down)** | ✅ | ❌ | **MISSING** |
| **File/media uploads (10 per profile)** | ✅ | ❌ | **MISSING** |
| **External links management** | ✅ | ✅ (via MCP) | Partial |
| **School affiliations** | ✅ (admin-managed, searchable) | ✅ (via MCP) | Partial |
| **Admin dashboard** | ✅ (stats, users, reports) | ❌ | **MISSING** |
| **Content moderation/reporting** | ✅ (report, hide, resolve) | ❌ | **MISSING** |
| **Moderation logs** | ✅ | ❌ | **MISSING** |
| **Account settings page** | ✅ | ✅ | — |
| **Change password** | ✅ | ❌ | **MISSING** |
| **GDPR data export** | ✅ (JSON download) | ✅ | — |
| **GDPR account deletion** | ✅ (cascade delete) | ✅ | — |
| **Cookie consent** | ✅ | ✅ | — |
| **Privacy policy page** | ✅ | ✅ | — |
| **Terms of service page** | ✅ | ✅ | — |
| **Cookie policy page** | ✅ | ❌ | **MISSING** |
| **404 page** | ✅ (branded) | ✅ | — |
| **AI discoverability (llms.txt, robots.txt, ai-plugin.json, openapi.json)** | ✅ | ✅ | — |
| **Sitemap (dynamic)** | ✅ | ✅ | — |
| **SEO structured data (JSON-LD)** | ✅ (ProfilePage) | Partial | **PARTIAL** |
| **MCP server integration** | ✅ (inline) | ✅ (separate service) | NJS ahead |
| **Profile visibility levels (public/members/draft)** | ✅ | ❌ | **MISSING** |
| **Consent checkboxes on signup (Terms + age)** | ✅ | ❌ | **MISSING** |
| **Password strength requirements** | ✅ (8+ chars, upper, lower, symbol) | ❌ (6 chars min) | **WEAKER** |

---

## Design System Comparison

| Element | Original | Current Next.js | Notes |
|---|---|---|---|
| **Typography — body** | Inter | DM Sans | Different but similar |
| **Typography — display** | Playfair Display | DM Serif Display | Different but similar |
| **Primary accent** | `#7B9E87` (sage) | `#6b8f71` (sage) | Very close |
| **Background** | `#FAFAF8` | `#fafaf9` (stone-50) | Nearly identical |
| **Card radius** | 10px (`--radius-md`) | rounded-lg (8px) | Close |
| **Max width** | 1120px | max-w-5xl (1024px) | NJS narrower |
| **Button style** | Rounded, solid sage | Rounded-full, solid sage | Very similar |
| **Homepage hero** | Serif heading, subtext, 2 CTAs | Serif heading, subtext, 2 CTAs | Similar structure |
| **Profile card** | Avatar + name + location + headline | N/A (no browse) | **MISSING** |

---

## Homepage Content Comparison

### Original (Flask)
1. Hero — "Help the people around you get it right" + 2 CTAs
2. How it works — 3 step cards (create, fill, share)
3. Profile depth tiers — 3 cards (2 min / 10 min / 20+ min)
4. Who it's for — 4 use cases (parents, friends, colleagues, teachers)
5. What Lyra is not — grid of "No..." items
6. Teacher/parent callout CTA card
7. Featured profiles grid — 6 most recent
8. Final CTA — "It's free. It's private. It takes two minutes."

### Current (Next.js)
The current homepage exists but **I cannot fully verify its sections** without
rendering it. Based on `page.tsx`, it has a hero, feature sections, and CTAs
but lacks: featured profiles grid, "What Lyra is not" section, and the
teacher/parent callout card.

---

## Priority Ranking (by user impact)

### P1 — Critical (users will expect these)
1. **Profile photo upload** — needs Supabase Storage bucket
2. **Public profile search/browse** — `/search` or `/browse` page
3. **Forgot/reset password** — essential auth flow

### P2 — High (visible quality gaps)
4. **Featured profiles on homepage** — social proof
5. **Profile visibility levels** — public/members-only/draft per section
6. **All 14 profile sections** — verify wizard covers all original sections
7. **Signup consent checkboxes** — Terms + age confirmation (legal requirement)
8. **Password strength validation** — original required 8+ with complexity

### P3 — Medium (functional completeness)
9. **Gift recommendation engine** — core differentiator, needs rebuild
10. **File/media uploads** — photos, documents per profile
11. **External links management** — UI in dashboard (MCP has it)
12. **Cookie policy page**
13. **Change password** — in account settings

### P4 — Admin/moderation (needed before public launch)
14. **Admin dashboard** — user stats, reports
15. **Content reporting** — report a profile
16. **Moderation tools** — hide profile, resolve reports
17. **Moderation audit logs**

---

## Profile Sections in Original (14 total)

1. `about` — More About Me (free text)
2. `gift_ideas` — Gift Ideas (repeatable items)
3. `things_i_like` — Things I Like (repeatable)
4. `things_i_avoid` — Things I avoid (repeatable)
5. `boundaries` — Boundaries & Preferences (repeatable)
6. `favourite_books` — Favourite Books (repeatable)
7. `favourite_media` — Favourite Movies & Series (repeatable)
8. `causes` — Causes I care about (repeatable)
9. `quotes` — Quotes I Love (repeatable)
10. `proud_of` — What I am most proud of (repeatable)
11. `life_hacks` — Life Hacks / Places / Other (repeatable)
12. `problems` — Problems I'm trying to solve (repeatable)
13. `questions` — Questions I'd like to have been asked (repeatable)
14. `billboard` — My Billboard (free text)

**Need to verify:** Does the Next.js profile wizard cover all 14, or only a subset?

---

## Database Schema Differences

The original used SQLite with tables:
- `users`, `password_reset_tokens`, `profiles`, `schools`,
  `profile_school_affiliations`, `section_definitions`, `profile_sections`,
  `profile_items`, `media_uploads`, `external_links`, `reports`,
  `moderation_logs`, `recommendation_feedback`

The Next.js Supabase schema **needs to be checked** against this list to
confirm all tables exist. Key tables likely missing:
- `password_reset_tokens` — Supabase Auth handles this natively
- `section_definitions` — may need adding if wizard doesn't cover all 14
- `media_uploads` — needs Supabase Storage
- `reports` — content moderation
- `moderation_logs` — audit trail
- `recommendation_feedback` — feedback on gift recommendations

---

## Recommended Subtasks for KAN-131

1. **KAN-131a: Profile photo upload** (P1) — Supabase Storage bucket, upload UI, display
2. **KAN-131b: Public search/browse page** (P1) — `/browse` with name/school/region filters
3. **KAN-131c: Forgot/reset password flow** (P1) — Supabase Auth reset, UI pages
4. **KAN-131d: Featured profiles on homepage** (P2) — query + card grid component
5. **KAN-131e: Profile section parity audit** (P2) — verify all 14 sections in wizard
6. **KAN-131f: Signup consent checkboxes** (P2) — Terms + age, store consent timestamp
7. **KAN-131g: Password strength validation** (P2) — match original requirements
8. **KAN-131h: Gift recommendation engine** (P3) — port `recommend.py` logic
9. **KAN-131i: File/media uploads per profile** (P3) — Supabase Storage, 10 file limit
10. **KAN-131j: Cookie policy page** (P3) — new route
11. **KAN-131k: Change password in settings** (P3) — Supabase Auth update
12. **KAN-131l: Admin dashboard** (P4) — stats, user list, reports
13. **KAN-131m: Content reporting & moderation** (P4) — report flow, admin tools
