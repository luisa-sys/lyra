# Data Protection Impact Assessment (DPIA)

> **Status: DRAFT — awaiting founder risk sign-off.** Not legal advice.
> Prepared 2026-07-03 (SEC-70 / KAN-283) following the ICO DPIA template. Every
> section below is filled from the existing compliance pack (ROPA, retention,
> sub-processors, DSAR/breach/complaints) so that only the **residual-risk
> judgement** (likelihood × severity scores) and the **sign-off block** at the
> end remain for the controller to complete. This DPIA is the repo-canonical
> version and supersedes/consolidates the two earlier DRAFTs in Confluence
> (TWC pages 27000875 and 27033667), which the founder should retire in its
> favour.

**Controller:** CheckLyra Ltd (trading as Lyra), registered in England & Wales (company no. 16351012).
**ICO registration:** ZC124222.
**Contact / DP lead:** privacy@checklyra.com (founder is the accountable data-protection lead; no statutory DPO required).
**Assessment date:** 2026-07-03 · **Scope:** the Lyra consumer service at launch (18+ profiles, age assurance, Convene, gift/affiliate analytics).

---

## 1. Identify the need for a DPIA

A DPIA is carried out under UK GDPR Art. 35 because the processing is likely to
result in a high risk to individuals. The triggers are:

- **(a) Audience / children-likely-access.** Lyra is an adults-only (18+)
  service, but it is a public, discoverable profile platform that children may
  attempt to access. The ICO Children's Code and Art. 35 both point to a DPIA
  where a service could be accessed by children even if not aimed at them.
- **(b) ~~Biometric special-category processing.~~ REMOVED 2026-07-20.** This
  assessment originally triggered on Didit's **biometric facial age-estimation**
  (a selfie/liveness check) for age assurance. **That check has been removed
  from Lyra.** Age is now a plain 18+ self-declaration at sign-up recording a
  single timestamp. Lyra performs **no Article 9 special-category processing**,
  and this trigger no longer applies. The DPIA is retained because triggers (a),
  (c) and (d) still stand.
- **(c) Systematic processing of third-party and calendar data.** Convene
  processes **third-party contact data** (people who are not Lyra users and have
  not themselves consented) and, optionally, **Google Calendar** busy/free data
  via the `calendar.readonly` OAuth scope. Systematic processing of data about
  non-users is an Art. 35 consideration.
- **(d) Discovery of people by school or organisation (added 2026-11-23).**
  Public search can find a member through a school or organisation they
  chose to show on their profile. Schools in particular can point to where a
  member's children are. Spec v0.8 §02 said this needed a separate privacy
  specification; the founder decided on 2026-11-23 that it belongs in this
  DPIA instead. It is assessed in **§2a**. (The paragraph under (b) already
  referred to a trigger (d) before one was listed; this is it.)

This DPIA is the Art. 35 assessment recorded against **SEC-70** and is a launch
blocker until signed off.

## 2. Describe the processing

**Nature, scope, context and purposes** are drawn from the ROPA (P1–P8):

| Ref | Purpose | Data | Notes |
|---|---|---|---|
| P1 | Account & authentication | email, display name | passwordless magic-link; no password stored |
| P2 | Profile content ("Manual of Me") | headline, bio, city/country, preferences, likes/dislikes, boundaries, school, links, photo | all volunteered by the user; may contain free-text that reveals special-category data |
| P3 | 18+ self-declaration | a single timestamp (`age_declared_18_at`) | no DOB, no age band, no document, no image, no biometric; **no provider involved** |
| P4 | Convene: contacts, calendars, gatherings | third-party contact details, gathering data, Google Calendar busy/free | calendar via `calendar.readonly` only (read-only, no write); contacts are third-party data |
| P5 | Waitlist | email | pre-launch interest capture (Cloudflare KV) |
| P6 | Gift recommendations & affiliate analytics | opaque click identifier, standard browser metadata | no account email/name/profile shared with affiliate networks |
| P7 | Transactional email | email, message content | magic links, invites, account notices (Resend) |
| P8 | Security, abuse-prevention & audit | IP, security logs | 90-day retention |
| P10 | Affiliation-based discovery (search) | name of a school / organisation the member chose to show; public profile card fields | see §2a; no new data collected — it searches data the member already published |

**Data flows.**
- User → Supabase (Postgres/Auth/Storage) for account, profile, contacts.
- Age: the user's own confirmation → Supabase (one timestamp). **No data
  leaves Lyra for age purposes and no provider is involved.**
- Google Calendar → **busy/free times only** via OAuth `calendar.readonly`
  (founder decision: read-only, never write; event contents are not read).
  Tokens are deleted on disconnect.
- Contacts are **third-party personal data** entered by the Lyra user about
  other people.

**Volumes / context.** Low-sensitivity consumer profile data; **adults-only
(18+)**; no payment data, no precise location, no browsing history collected by
Lyra. Media and backups are encrypted; backups are age-encrypted WORM in R2.

## 2a. Affiliation-based discovery (search)

> Added 2026-11-23 (KAN-482). Spec v0.8 §02 said *"Affiliation-based discovery
> requires a separate privacy specification"* and that search-by-affiliation
> was not authorised by the spec. Founder decision 2026-11-23: *"make this
> part of the main privacy spec, no need to have a separate one."* This
> section is that specification. Behaviour below was read from the code on
> 2026-11-23, not from earlier docs; file references are given so it can be
> re-checked.

### What it does

Members can add schools, organisations and communities to "Where you might
know me from". Each one is **hidden by default**
(`school_affiliations.show_on_profile`, `NOT NULL DEFAULT false`) and is shown
on the public profile only when the member ticks **"Show on my profile"**.

Two search surfaces can match on those affiliations:

| | Web "Find someone" (`/search`, `src/app/search/page.tsx`) | MCP `lyra_search_profiles` `school` filter (`luisa-sys/lyra-mcp-server`, `src/index.ts`; being retired, KAN-483) |
|---|---|---|
| Who can search | **Anyone, signed in or not.** Only `/dashboard` requires sign-in; `/search` is also crawlable (`robots.txt` allows it) | Anyone (MCP read tools are public by convention, KAN-222) |
| Affiliations matched | `show_on_profile = true` only; types **school and organisation** (community is not matched); on the **name** only, never the postcode/location, relationship or description | `show_on_profile = true` only; **any type**; name only |
| Profiles returned | the `public_profiles` view (published and not suspended) and `is_homepage_example = false` | `is_published = true`, `is_suspended = false`, `is_homepage_example = false` |
| What a result shows | name, CheckLyra ID, headline, city, country, photo. **Never** the affiliation that matched, its postcode or any other affiliation field | slug, name, headline, city, country. Never affiliation fields |
| Search term | metacharacters and wildcards (`, ( ) * % _ . : " \`) stripped; empty after stripping → no query at all; max 100 characters | **not sanitised**: `%` and `_` act as wildcards, so `school: "%"` matches every shown affiliation |
| Bounds | at most 100 matching affiliation rows (stably ordered), then at most 30 profiles | **no cap** on the school path (`limit` is ignored there) |
| Failures | a failed read is reported to Sentry (without the search term) and the page errors instead of showing "0 found" | errors on the school path are ignored and read as "no matches" |

Other places affiliation data can be read, checked on the same date:

- **MCP `lyra_list_schools`** (same repo and file as above, public): matches
  `school_name` on `show_on_profile = true` rows of published, non-suspended
  profiles and returns **the affiliation's name, location/postcode,
  relationship and description together with the owner's name and slug**, 20
  rows at most. It does **not** exclude homepage examples, and the term is not
  sanitised (`%` lists any 20 shown affiliations). It reveals nothing a public
  profile page does not, but it is a "people at this school" list.
- **Public profile** (`/[slug]`, `src/modules/public-profile/load-public-profile.ts`):
  shows shown affiliations only (name, location/postcode, description).
- **Direct database API.** The RLS policy *"Anyone can read visible affiliations
  from published profiles"* (`20261113120000_hidden_affiliations_public_read_rls.sql`)
  lets anyone holding the public anon key read shown affiliations of published,
  non-suspended profiles through PostgREST, with filters, up to 1,000 rows per
  request. Hidden affiliations are not readable this way. The web app does not
  need this for anonymous visitors (public pages read through the service
  role); the signed-in autocomplete does (see next line).
- **Autocomplete** in the editor (`suggest_affiliation_names`, SECURITY
  INVOKER): signed-in members only, at least 3 characters, returns affiliation
  **names only** (no people, no profile ids), limited by RLS to shown
  affiliations plus the member's own.
- **Sitemap, page metadata, Open Graph tags:** contain no affiliation data
  (`src/app/sitemap.ts` lists slugs; `/search` metadata is static).
- **Hidden affiliations** are not used by any search, suggestion or discovery
  surface. They are read only by the member's own editor and dashboard, their
  SAR export, account deletion, and operator (admin) tooling.

### Purpose

Help people who already know a member offline find their profile, e.g. "the
parent I met at the school gate". Lyra does not use affiliations to suggest
people, rank results, notify anyone or build lists.

### Lawful basis

Art. 6(1)(a) **consent / the member's own choice to publish**, as for the rest
of the public profile (ROPA P2): an affiliation is searchable only after the
member ticks "Show on my profile", and stops being searchable as soon as they
untick it, unpublish or delete it. Lyra's legitimate interest (Art. 6(1)(f))
in offering search is secondary and relies on the same opt-in. *(Founder to
confirm.)*

### Necessity and proportionality

- **Minimal:** no new data is collected; search reads only what the member has
  already made public, and only the name field.
- **Opt-in per affiliation:** hidden by default; a hidden affiliation never
  changes whether or where a profile appears.
- **No disclosure beyond the profile:** a result reveals nothing the profile
  page does not already show; the matched affiliation is not displayed.
- **Bounded:** web results are capped and wildcards are stripped, which limits
  using search to list everyone at a school.
- **Gaps against proportionality** (scored as risks below): web search needs
  no sign-in and accepts a one-letter term; the MCP `school` filter and the
  direct database API are uncapped and allow wildcard-style listing; the
  editor text (spec copy, verbatim) says hidden affiliations are *"only used to
  help people who know you find you"*, which suggests hidden ones are
  searchable — the code is stricter than the copy (they are not).

### Binding rules

Any change to a search, suggestion, export or notification surface must keep
these. A new affiliation-based discovery surface, or a change to who can
search, requires updating this section first.

- **AD-1 Opt-in only.** Only affiliations with `show_on_profile = true` may be
  matched. Hidden affiliations must never affect whether, where or in what
  order a profile appears. Enforced in the query itself (web, MCP) and by RLS
  for anon/authenticated reads.
- **AD-2 Public profiles only.** Only profiles in `public_profiles` (published,
  not suspended) and not homepage examples may be returned.
- **AD-3 No affiliation fields in results.** Results show only public card
  fields; never which affiliation matched, nor its location/postcode,
  relationship, type or description.
- **AD-4 Name only.** Matching is on the affiliation name. Never on
  location/postcode, relationship or dates, and never on hidden fields.
- **AD-5 Sanitised and bounded.** Search terms are stripped of filter
  metacharacters and wildcards; an empty sanitised term reads nothing; every
  surface caps how many profiles one search can return.
- **AD-6 Terms are not logged.** Search terms are not written to logs,
  analytics or error monitoring.
- **AD-7 No affiliation data in indexable metadata.** Sitemap, page metadata
  and Open Graph tags carry no affiliation data.
- **AD-8 Fail loudly.** A failed read is reported, never shown as "no matches".

**Compliance on 2026-11-23:** the web search and the public profile meet AD-1
to AD-8 (pinned by `tests/unit/kan450-search-affiliations.test.ts` and
`tests/unit/kan482-affiliation-discovery-rules.test.ts`). The **MCP
`school` filter breaks AD-5 and AD-8** (no sanitising, no cap, errors read as
no matches) and matches community affiliations the web search does not; it
lives in another repo and is being retired (KAN-483), so it is recorded here
and as risk R10 rather than fixed in this repo. **MCP `lyra_list_schools`
breaks AD-2, AD-3 and AD-5** (homepage examples not excluded; returns the
matched affiliation's fields; term not sanitised) — same repo, same
treatment. The **direct database API**
(PostgREST) is uncapped beyond PostgREST's 1,000 rows per request (AD-5) and
returns affiliation fields (it is a data API, not a search page): risk R10.

### Risks (scored in §5)

R8 (listing people by school), R9 (unauthenticated and crawlable search), R10
(uncapped or unsanitised channels: the MCP `school` filter, MCP
`lyra_list_schools` and the direct database API), R11 (member expectation: the editor copy implies hidden affiliations are
used for search).

## 3. Consultation process

- **Internal:** the founder (accountable DP lead) reviews and signs off this
  DPIA; engineering input is reflected in the ROPA and ARCHITECTURE.md.
- **External guidance:** the ICO DPIA template and Children's Code were used
  as the framework. (ICO biometric/age-assurance guidance no longer applies —
  see trigger (b).)
- **Open (founder decision):** whether to consult data subjects or their
  representatives on the children-access risk, and whether any ICO prior
  consultation is warranted (see §6).
- **Open (founder decision, NEW 2026-07-20):** the move from provider-run age
  assurance to self-declaration **weakens** the mitigation for R1 while
  **eliminating** R2 entirely. Confirm with a data-protection adviser that
  self-declaration is proportionate for Lyra's risk profile — Lyra hosts no
  pornography or "primary priority content", so the Online Safety Act's
  *highly effective age assurance* duty is not engaged, but that
  characterisation should be checked rather than assumed.

## 4. Necessity and proportionality

**Lawful bases (per ROPA):**
- Art. 6(1)(b) contract — account/auth and the core profile service.
- Art. 6(1)(a) consent — publishing a profile; connecting Google Calendar.
- Art. 6(1)(f) legitimate interests — anonymised analytics, security/abuse
  prevention, and processing third-party contact data to operate Convene
  (balanced against the third party's interests; minimised, not published).
- **No Art. 9 condition is required** — Lyra processes no special-category
  data. (Until 2026-07-20 this line recorded Art. 9(2)(a) explicit consent for
  the biometric age-estimation step, which has since been removed.)

**Data minimisation.**
- `calendar.readonly` only — **busy/free, not event contents**; no write access.
- **No age data beyond a timestamp** — no DOB, no image, no provider result.
- No precise location; no payment data; no browsing history.
- Affiliate analytics use an **opaque identifier**, not account identity.
- Contacts held to the minimum needed to run a gathering.

**Retention** follows `RETENTION_SCHEDULE.md` — active-account data retained
while active; deleted-account data purged within 30 days; security logs 90 days;
backups 90-day WORM.

**International transfers** follow `SUBPROCESSORS.md` — UK Addendum to the EU
SCCs / UK IDTA incorporated by each processor's DPA, plus encryption in transit
and at rest. Supabase DPA signed 2026-07-03; Vercel/Cloudflare(R2)/Resend
recorded by reference 2026-07-03; Google and Railway remain to be confirmed.
**Didit is no longer a processor** (age check removed 2026-07-20), so the
special-category diligence it required no longer applies.

## 5. Identify and assess risks

For each risk: the mitigation **already in place** is recorded; the
**likelihood, severity and overall rating are left blank for the founder** to
score (Low / Medium / High), and the **residual risk** after mitigation is the
founder's judgement.

| # | Risk to individuals | Mitigation already in place | Likelihood | Severity | Rating | Residual (founder) |
|---|---|---|---|---|---|---|
| R1 | **Under-18 access** despite the adults-only rule | **Mitigation reduced 2026-07-20:** 18+ self-declaration required before a profile can be created (both sign-up paths, server-enforced, recorded with a timestamp) + 18+ term in /terms + suspend-and-delete on discovery. The provider age-estimation check has been removed, so there is **no independent verification** of age. | ____ | ____ | ____ | ____ |
| R2 | ~~**Biometric misuse / over-retention at Didit**~~ **CLOSED 2026-07-20** — the biometric check was removed; Lyra holds no biometric data and Didit is no longer a processor. | n/a | n/a | **Eliminated** | n/a |
| R3 | **Over-collection of third-party contact data** (contacts who never consented) | Art. 6(1)(f) with minimisation; contacts not published; used only to run gatherings; deletion on account deletion | ____ | ____ | ____ | ____ |
| R4 | **Calendar data exposure** | `calendar.readonly` busy/free only (no event contents, no write); OAuth tokens deleted on disconnect | ____ | ____ | ____ | ____ |
| R5 | **Re-identification / disclosure of special-category free-text** volunteered in profile fields | Privacy-notice warning against posting sensitive data; user controls publish/unpublish and edit/erase; RLS deny-by-default | ____ | ____ | ____ | ____ |
| R6 | **International-transfer / US-government-access risk** | UK Addendum/IDTA via each DPA; encryption in transit + at rest; age-encrypted WORM backups; low-sensitivity dataset (TRA in SUBPROCESSORS.md) | ____ | ____ | ____ | ____ |
| R7 | **Incomplete account deletion** | 30-day purge flow; deletion covers profile, media, contacts; backup rotation | ____ | ____ | ____ | ____ |
| R8 | **Listing people by school or organisation** (e.g. finding the parents at one school; schools can point to where children are) — §2a | Opt-in per affiliation (hidden by default); only shown affiliations on published, non-suspended profiles; matched affiliation not displayed; web search strips wildcards and caps at 100 affiliation rows / 30 profiles | ____ | ____ | ____ | ____ |
| R9 | **Search needs no sign-in and `/search` is crawlable**, so anyone (including scrapers) can search by school — §2a | Same as R8; search term not logged. *Founder decision open:* require sign-in for affiliation matches, add `noindex` to `/search`, and/or set a minimum term length | ____ | ____ | ____ | ____ |
| R10 | **Uncapped / unsanitised channels:** MCP `lyra_search_profiles` `school` filter (wildcards, no cap, errors ignored), MCP `lyra_list_schools` (returns affiliation fields with the owner's name; demo profiles not excluded; wildcards) and the direct PostgREST read of shown affiliations (up to 1,000 rows per request, with postcodes) — §2a | Both return shown affiliations only, on published non-suspended profiles. *Open:* fix or retire the two MCP tools (KAN-483); narrow the anon RLS read policy to `authenticated` (the web app reads public pages through the service role) | ____ | ____ | ____ | ____ |
| R11 | **Member expectation:** the editor says hidden affiliations are "only used to help people who know you find you", but search uses shown ones only — §2a | The mismatch is in the privacy-protective direction (hidden ones are never searched). *Open:* founder to decide whether the copy should change (founder-owned copy) and whether the Privacy Policy should mention search by affiliation | ____ | ____ | ____ | ____ |

## 6. Measures to reduce risk and sign-off

**Technical & organisational measures (from ROPA §D):** RLS on all user tables
(deny-by-default); TLS in transit; encryption at rest (Supabase/AWS);
passwordless auth; OAuth 2.1 with RS256/JWKS; service-role keys in platform
secret stores; Cloudflare Access on admin surfaces; daily encrypted WORM backups
+ restore drills (DISASTER_RECOVERY.md); least-privilege admin via a separate
audited admin MCP; no biometric or special-category processing anywhere in the
service; `calendar.readonly`
scope with token deletion on disconnect; 30-day deletion purge.

**Sign-off block (founder to complete):**

- Residual risk (founder): ____________________
- Additional measures required before launch (if any): ____________________
- DPO / measures approved by: ____________________  date: __________
- ICO prior consultation required? (only if residual risk remains **high**
  after mitigations): ☐ yes ☐ no — rationale: ____________________
- Review date: ____________________

---

### Cross-references
- Processing purposes, lawful bases, TOMs → `ROPA.md`
- Affiliation-based discovery (search) → §2a above; ROPA P10; `docs/ARCHITECTURE.md` (Find someone)
- Retention periods + deletion mechanisms → `RETENTION_SCHEDULE.md`
- Sub-processors + transfer mechanisms + TRAs → `SUBPROCESSORS.md`
- DSAR / breach / DUAA complaints procedures → `DSAR_BREACH_COMPLAINTS.md`
- Founder action list → `FOUNDER_CHECKLIST.md`
- Supersedes: Confluence TWC DRAFT DPIAs 27000875 and 27033667 (retire on sign-off).
