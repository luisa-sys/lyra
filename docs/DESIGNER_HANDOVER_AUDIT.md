# Lyra Designer Handover — Dev Environment Readiness Audit

**Date:** 29 March 2026 (updated)

## Environment status

| Endpoint | Status | Notes |
|----------|--------|-------|
| dev.checklyra.com | ✅ 200 OK (behind SSO) | Full Next.js app serving. Designer needs Vercel team access or Cloudflare Access (KAN-85) |
| stage.checklyra.com | ✅ 200 OK (behind SSO) | Full Next.js app serving. Same access requirement |
| checklyra.com | 🔴 503 | Intentional "Coming Soon" holding page |
| mcp.checklyra.com/health | ✅ 200 OK | Returns `{"status":"ok","server":"lyra-mcp-server","version":"1.0.0"}` |

## Signup & auth — confirmed working

- ✅ Email signup works on dev.checklyra.com
- ✅ Google OAuth login works on dev.checklyra.com
- ✅ Email confirmation flow works (PKCE code exchange via middleware)
- Apple Sign-In deferred (no Apple Developer account yet)

## Blocking issues for designer testing

### P1: Designer access
- dev.checklyra.com and stage.checklyra.com require Vercel SSO — designer cannot access without being added to the Vercel team or Cloudflare Access being set up (KAN-85)
- **Recommended:** Proceed with KAN-85 (Cloudflare Access) — beta testers enter their email, get a one-time PIN, access for 24 hours. Adding a new tester = add their email in Cloudflare dashboard.

### P1: Supabase advisories (KAN-108)
- 2 security warnings: Functions `handle_updated_at` and `handle_new_user` have mutable `search_path`
- 7 performance warnings: All RLS policies using `auth.uid()` need wrapping as `(select auth.uid())`
- Multiple permissive SELECT policies on profiles, profile_items, external_links, school_affiliations need consolidation
- Duplicate index: `profiles_slug_idx` duplicates `profiles_slug_key`

### P2: Sample data needed (KAN-109)
- Dev database has only 1 user/profile with 0 items, 0 links, 0 school affiliations
- Designer cannot evaluate populated UI states
- Need 3-5 sample profiles with items across all categories

## Infrastructure — healthy

- **Vercel:** Pro plan. 20/20 recent builds pass. Turbopack builds in ~9s. Full environment separation (custom environments per branch).
- **Supabase:** Pro plan. 3 separate projects (dev/staging/prod). 5 tables with RLS. Schema clean.
- **Railway:** MCP server healthy. Auto-deploys from lyra-mcp-server main branch.
- **CI/CD:** GitHub Actions. deploy-dev.yml on push to develop. Promotion workflows for staging and production.

## Open Jira tickets for designer readiness

| Ticket | Priority | Summary | Status |
|--------|----------|---------|--------|
| KAN-85 | P1 | Open staging to beta testers via Cloudflare Access | To Do |
| KAN-108 | P1 | Fix Supabase security advisories and optimise RLS | To Do |
| KAN-109 | P2 | Seed dev database with sample profiles | To Do |
| KAN-106 | P0 | ~~Fix signup Server Action 404~~ | ✅ Done — confirmed working |
| KAN-107 | P0 | ~~Fix Supabase AuthApiError on signup~~ | ✅ Done — confirmed working |

## Pages built (verified from src/app/)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `page.tsx` | Landing / home page |
| `/login` | `(auth)/login/page.tsx` | Email/password + Google OAuth login |
| `/signup` | `(auth)/signup/page.tsx` | Email/password + Google OAuth signup |
| `/auth/callback` | `auth/callback/route.ts` | PKCE code exchange (server-side route handler) |
| `/dashboard` | `dashboard/page.tsx` | Main dashboard (post-login) |
| `/dashboard/profile` | `dashboard/profile/page.tsx` | Profile editor wizard (7 steps: identity, bio, items, links, schools, preview + wizard shell) |
| `/dashboard/settings` | `dashboard/settings/page.tsx` | API key management, account settings (change email, change password) |
| `/privacy` | `(legal)/privacy/page.tsx` | Privacy policy |
| `/terms` | `(legal)/terms/page.tsx` | Terms of service |
| `/{slug}` | `[slug]/page.tsx` | Public profile page (with custom not-found) |

### Supporting files (not routes)
- `(auth)/actions.ts` — Server Actions: signIn, signUp, signInWithGoogle, signInWithApple
- `(auth)/social-login-buttons.tsx` — Google/Apple OAuth button component
- `dashboard/profile/steps/*.tsx` — 7 wizard step components (identity, bio, items, links, schools, preview, types)
- `dashboard/profile/wizard.tsx` — Wizard container/state management
- `dashboard/profile/actions.ts` — Profile mutation Server Actions
- `dashboard/settings/actions.ts` — Settings mutation Server Actions
- `dashboard/settings/settings-client.tsx` — Client component for settings page
- `cookie-consent.tsx` — Cookie consent banner component
- `sitemap.ts` — Dynamic sitemap generation
- `error.tsx`, `global-error.tsx`, `loading.tsx` — Error/loading boundaries

### What does NOT exist yet
- `/dashboard/edit` — referenced in previous handover but does NOT exist. Profile editing is at `/dashboard/profile`
- `/api/*` — empty directory, no API routes. All mutations use Server Actions
- No admin panel
- No public profile discovery/search page

## What the designer needs to know

- **Design system:** No formal design system yet — this is part of what the designer will establish
- **Tailwind CSS:** All styling is utility-first Tailwind. No component library (no shadcn, no MUI)
- **Colour palette:** Currently uses CSS custom properties (`--color-sage`, etc.) — designer can propose changes
- **Responsive:** Basic responsive layout in place but not thoroughly tested across breakpoints
- **Accessibility:** Not audited — needs attention during design phase
