# Recommender inputs — canonical field list (KAN-198)

> The recommendation engine's quality is bounded by the data it gets about the recipient, the buyer, and the occasion. This document is the canonical inventory of every field the V2 recommender (KAN-139, design in KAN-199) reads — what we have today, what's in flight, what's added in this ticket, and what stays unstored (per-request inputs).

If you add a new field to a recipient profile, or a new parameter to the recommendation request, list it here. The recommender, eligibility filter, ranker, and MCP tool all reference this doc.

## Three buckets

### 1. Recipient profile (persistent, on `profiles` or sibling tables)

| Field | Type | Source | Used by |
|---|---|---|---|
| `profiles.display_name` | text | onboarding wizard | rationale string ("Anna mentioned…") |
| `profiles.headline` | text | onboarding wizard | optional context for V1 + LLM |
| `profiles.bio_short` | text | onboarding wizard | V1 + LLM context |
| `profiles.city` / `region` / `country` | text (freeform) | onboarding wizard | display / loose geo cue |
| `profiles.delivery_country_code` | text (ISO-2) | KAN-186 | **hard filter** — recipient shipping eligibility |
| `profiles.age_range` | text (bucket enum) | **KAN-198 — this ticket** | V1 + LLM context; future demographic-aware ranking |
| `profiles.recipient_attributes` | JSONB | **KAN-198 — this ticket** | bag for dietary / allergies / sizes / dislikes / future structured signals |
| `profile_items` rows (category `likes`) | rows | onboarding wizard | V1 main input + LLM context |
| `profile_items` rows (category `gifts_to_avoid`) | rows | onboarding wizard | V1 anti-category + LLM "don't suggest" list |
| `profile_items` rows (other categories) | rows | onboarding wizard | V1 input |
| `profile_manual_of_me` (KAN-154) | freeform text | KAN-154 | LLM context for richer profiles |
| `profile_conversation_starters` answers (KAN-181) | text | KAN-181 | LLM context |
| `profile_files` (KAN-142) | rows | KAN-142 | NOT used by recommender (display only) |
| `profile_items` rows (category `current_problems` — KAN-182) | rows | KAN-182 | LLM context for problem-solving gift ideas |

### 2. Buyer context (per-recommendation request, not stored)

These are passed into the recommender on every call — either from a small form on the web (KAN-191) or as parameters to the MCP tool (KAN-201). They are NOT stored on the recipient profile because they're buyer-specific.

| Parameter | Type | Required | Default | Notes |
|---|---|---|---|---|
| `buyer_country` | ISO-2 | yes | from KAN-185 detection chain | drives commission attribution |
| `occasion` | enum: birthday / christmas / anniversary / valentines / just_because / other | no | `just_because` | a tag string for the ranker + rationale |
| `budget_min` | numeric | no | 0 | buyer's preferred minimum |
| `budget_max` | numeric | no | unset (no upper bound) | hard ceiling — products above this are dropped |
| `budget_currency` | ISO-4217 | no | inferred from buyer_country | display + budget comparison |
| `delivery_by_date` | ISO date | no | unset | urgency signal, reserved for V2.1 |
| `relationship_to_recipient` | enum: partner / parent / child / sibling / friend / colleague / other | no | `other` | LLM context; never persisted |

### 3. Signals — derived at recommendation time

These are computed, not user-supplied.

| Signal | Source | Used by |
|---|---|---|
| `merchant_eligibility[country]` | KAN-187 matrix | hard filter (KAN-190) |
| `merchant_EPC[merchant, country]` | KAN-195 reporting feedback | ranker weight 20% (KAN-199) |
| `merchantSeenCount` (within current result list) | computed | diversity penalty in ranker |
| `recipient_dietary_inferred` | V1 free-text inference from likes/avoids | falls back to `recipient_attributes.dietary` if structured |
| `profile_completeness_score` | existing `profiles.completion_score` | weighted "show this prompt" UX for sparse profiles |

## What's new in this ticket

### `age_range` — bucket enum on `profiles`

A bucketed value, NOT a date of birth. Buckets:
- `0_5` — infant to early-years
- `6_12` — primary school
- `13_17` — secondary school (AADC applies — see KAN-155 / KAN-164)
- `18_29`
- `30_44`
- `45_64`
- `65_plus`

Why buckets, not DOB:
- AADC (Age Appropriate Design Code) for under-13 profiles requires that we minimise data collection. Buckets are sufficient for recommendation quality and avoid storing precise DOB.
- The V2 ranker uses age for rough product-class matching (e.g. don't recommend a £200 gadget to a recipient in `0_5`). Bucket granularity is plenty.

NULL allowed — sparse profiles work fine without it, falling back to V1's existing behaviour.

### `recipient_attributes` — JSONB on `profiles`

A small JSONB bag for structured recipient attributes that the recommender can read but that don't merit their own column. Shape (all keys optional):

```json
{
  "dietary": ["vegan", "gluten_free"],
  "allergies": ["nuts", "shellfish"],
  "sizes": { "clothing": "M", "shoes_uk": "8" },
  "dislikes_text": "Strong perfumes, anything pink"
}
```

Why JSONB instead of columns-per-attribute:
- Schema iteration without a migration. We expect the V2.1 + V2.2 evolution (per KAN-199) to introduce new fields (gift-history, preferences) — JSONB lets us add without churning the schema.
- Most attributes feed an LLM prompt as text, so structured queries on them aren't required for MVP.
- A migration to lift any attribute into its own column is cheap when the access pattern justifies it.

NULL allowed and default `'{}'::jsonb`.

NOT stored in JSONB:
- Anything PII-grade (full address, real DOB) — those go in columns with RLS we can reason about.
- Anything regulated (financial, health) — Lyra is not a healthcare app and we keep that boundary deliberately.

### Helper module: `src/lib/recommender/inputs.ts`

Type guards and constants for the new fields (the canonical age-range buckets, the dietary enum, the allergies enum) — used by the (future) recommender, the (future) MCP tool, and the (future) profile UI. Adding the helpers in this ticket so downstream tickets can import canonical types instead of duplicating literals.

## Tests required (this ticket)

- Unit: `AGE_RANGE_BUCKETS` matches the migration's check constraint.
- Unit: `isAgeRangeBucket` / `isDietaryRestriction` / `isAllergy` type guards reject unknown values.
- Unit: `coerceRecipientAttributes` normalises a raw JSONB blob into the typed shape (drops unknown keys, validates enums, length-caps free text).

## Not in this ticket (deferred)

- **UI surfaces** for these fields — small form on the profile wizard (deferred until V2 needs it, expected next session).
- **MCP `lyra_recommend_gifts` parameter extension** — handled in KAN-201 because it's the same surface as wiring monetised links.
- **Buyer-context capture UX** (occasion / budget form on the web) — handled in KAN-191 because it lives next to the recommendation render path.

## Cross-reference

| Ticket | Relationship to this audit |
|---|---|
| KAN-139 | Umbrella V2 recommender ticket |
| KAN-154 | Adds Manual of Me + conversation-starters + current-problems profile data — counted above |
| KAN-181 | Conversation-starters table — counted above |
| KAN-186 | Delivery country — counted above |
| KAN-187 | Eligibility matrix — secondary derived signal |
| KAN-191 | Web recommendation render — consumer of these inputs |
| KAN-195 | Reporting — produces `merchant_EPC` signal |
| KAN-199 | V2 architecture — references this inventory |
| KAN-201 | MCP `lyra_recommend_gifts` — consumer of these inputs |
| KAN-202 | Feedback loop — adds new event-type signal not covered here |
