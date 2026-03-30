# KAN-131: Feature Gap Audit — Original Python/Flask vs Current Next.js

> **Audit date:** 30 March 2026
> **Source:** Original code at `/Users/admin/Documents/2026 Lyra/lyra-app/`
> **Status:** Complete audit — subtasks to be created for each gap

## Executive Summary

The original Python/Flask Lyra app (`lyra-app/`) had **significantly more features** than the current Next.js implementation. The migration preserved auth, basic profile viewing, and the profile edit wizard, but lost the majority of user-facing features including profile photos, public search/browse, the recommendation engine, the rich homepage, admin panel, reporting system, GDPR data export, account settings, and many profile sections.

---

## Feature-by-Feature Comparison

### PRIORITY 1 — Critical Missing Features

| # | Feature | Original (Python) | Current (Next.js) | Gap |
|---|---------|-------------------|-------------------|-----|
| 1 | **Profile photo upload** | Full upload with preview, stored in `static/uploads/`, displayed on profile cards and profile page | **MISSING** — No photo upload, no Supabase Storage bucket | Needs Supabase Storage, upload API, display on profile |
| 2 | **Public search/browse** | `/search` with name, school, region, postcode filters. Profile cards with photos, names, locations, headlines, school tags | **MISSING** — No search or browse page exists | Needs new route, Supabase query, UI |
| 3 | **Homepage — featured profiles** | Shows 6 recently published profiles with cards, photo, name, location, headline | **MISSING** — Homepage is static marketing only | Needs Supabase query + profile card component |
| 4 | **Homepage — "How it works" (3 profiles depth tiers)** | Shows Quick (2 min), Thoughtful (10 min), Full (20+ min) profile examples | **MISSING** — Current has generic 3-step how-it-works | Design decision: restore or keep current |
| 5 | **Homepage — "Who it's for" use cases** | Parents, friends/family, colleagues, teachers sections | **MISSING** | Restore content |
| 6 | **Homepage — "What Lyra is not"** | No likes/followers/feeds/algorithms/pressure/data-selling/notifications | **MISSING** | Restore content |

### PRIORITY 2 — Important Missing Features

| # | Feature | Original | Current | Gap |
|---|---------|----------|---------|-----|
| 7 | **Recommendation engine** | `recommend.py` with scoring, `/profile/{slug}/recommendations` page, API endpoint, user feedback (upvote/downvote) | **MISSING** — No recommendation system | Large feature — needs scoring algorithm + UI |
| 8 | **Profile sections (14 types)** | about, gift_ideas, things_i_like, things_i_avoid, boundaries, favourite_books, favourite_media, causes, quotes, proud_of, life_hacks, problems, questions, billboard | **PARTIAL** — Wizard has: gift_ideas, likes, dislikes, helpful_to_know, boundaries, links. Missing 8 section types | Add missing sections to wizard + profile view |
| 9 | **Account settings page** | `/account` with change password, download data (GDPR), delete account | **PARTIAL** — Settings page exists but may not have full GDPR export | Verify and add missing functionality |
| 10 | **Forgot/reset password** | `/forgot-password` and `/reset-password/<token>` flow | **MISSING** — No password reset flow | Supabase handles this differently (email link) — verify it works |
| 11 | **External links on profiles** | Users can add titled links with descriptions (wishlists, favourite shops) displayed on public profile | **PARTIAL** — Wizard has "links" step but verify it displays on public profile |
| 12 | **File/media uploads** | Up to 10 uploads per profile (images, PDFs), displayed on public profile with captions | **MISSING** — No general file uploads beyond profile photo |

### PRIORITY 3 — Admin & Moderation Features

| # | Feature | Original | Current | Gap |
|---|---------|----------|---------|-----|
| 13 | **Admin dashboard** | `/admin` with stats (users, profiles, reports, schools), recent reports, recent users | **MISSING** — No admin panel | Needs admin role check + dashboard |
| 14 | **Report system** | Report button on profiles with reason codes, admin review queue, hide profile action | **MISSING** — No reporting mechanism | Needs reports table, UI, admin review |
| 15 | **School management** | Admin can add/manage schools, school affiliations on profiles, search by school | **MISSING** — Schools concept not in Next.js | Needs Supabase table, admin UI, profile integration |
| 16 | **Moderation logs** | `moderation_logs` table tracking admin actions | **MISSING** | Add with admin panel |

### PRIORITY 4 — Content & SEO Features

| # | Feature | Original | Current | Gap |
|---|---------|----------|---------|-----|
| 17 | **Billboard section** | "If I had a giant billboard, it would say..." — large quote at bottom of profile | **MISSING** — Not in wizard or profile view |
| 18 | **Q&A format for "questions" section** | Questions section renders as styled Q&A cards with left border accent | **MISSING** — Section doesn't exist |
| 19 | **Visibility levels** | Sections can be public, members_only, or draft | **MISSING** — All sections are public only |
| 20 | **Publish/unpublish toggle** | Explicit publish and unpublish buttons | **PARTIAL** — Wizard has publish but verify unpublish |
| 21 | **Cookie policy page** | `/cookies` with cookie policy content | **MISSING** — Only privacy and terms exist |
| 22 | **404 page** | Custom styled 404 | **EXISTS** — Has error.tsx and not-found.tsx |

### PRIORITY 5 — AI/MCP Discovery Features (ALREADY MIGRATED)

| # | Feature | Original | Current | Gap |
|---|---------|----------|---------|-----|
| 23 | **llms.txt** | ✅ Existed | ✅ Exists in Next.js (`public/.well-known/`) | **OK** |
| 24 | **ai-plugin.json** | ✅ Existed | ✅ Exists | **OK** |
| 25 | **robots.txt** | ✅ AI-welcoming | ✅ Exists | **OK** |
| 26 | **OpenAPI spec** | ✅ Existed | Verify if migrated | Check |
| 27 | **MCP server** | ✅ `mcp_server.py` (stdio + HTTP) | ✅ Separate TypeScript MCP server on Railway | **OK — upgraded** |
| 28 | **Sitemap** | ✅ Dynamic with profiles | ✅ `sitemap.ts` exists | Verify it includes profiles |

---

## Design/UX Differences

| Aspect | Original | Current | Assessment |
|--------|----------|---------|------------|
| **Typography** | DM Sans + DM Serif Display | Same fonts via CSS variables | **OK** |
| **Colour palette** | Sage green (#6b8f71), stone tones, warm accents | Same via CSS custom properties | **OK** |
| **Profile cards** | Avatar (photo or initial), name, location, headline, school tags | Not implemented (no browse page) | **Needs building** |
| **Profile page layout** | Hero with photo + info, sections with items, billboard, links, uploads, report button | Exists but simpler — verify completeness | **Partial** |
| **Homepage tone** | "Help the people around you get it right" — practical, warm, specific use cases | "Let people know you" — more abstract, less specific | **Design decision** |
| **Section richness** | 14 section types with varied rendering (Q&A, items, links, billboard) | 6 section types in wizard | **Significant gap** |

---

## Recommended Subtask Breakdown (Priority Order)

1. **Profile photo upload** — Supabase Storage bucket + upload API + display
2. **Public search/browse page** — `/search` route with filters
3. **Restore missing profile sections** — Add 8 missing section types to wizard + profile view
4. **Homepage content restoration** — Featured profiles, use cases, "What Lyra is not"
5. **Recommendation engine** — Port scoring from `recommend.py` or build new
6. **Admin dashboard** — Stats, user management, report review
7. **Report system** — Report button + admin queue
8. **School affiliations** — Schools table, admin management, profile integration
9. **GDPR data export** — Verify/add download-my-data functionality
10. **Cookie policy page** — Add `/cookies` route
11. **Visibility levels** — Public/members-only/draft per section
12. **File/media uploads** — General uploads beyond profile photo

---

## Files Audited

- `lyra-app/app.py` (1421 lines — full Flask application)
- `lyra-app/db.py` (629 lines — schema + seed data)
- `lyra-app/recommend.py` (not read in full — recommendation engine)
- `lyra-app/templates/` (16 templates)
- `lyra-app/static/css/style.css` (not read — visual styles)
- `lyra/src/app/` (current Next.js routes and components)
