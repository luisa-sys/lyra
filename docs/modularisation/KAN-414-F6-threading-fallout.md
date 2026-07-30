# KAN-414 F6 — what threading `Database` through the client factories exposes

**Measured 2026-07-29** against `develop`, by adding `<Database>` to the three
client factories (`supabase-server.ts`, `supabase-browser.ts`,
`supabase-service.ts`) and running `npx tsc --noEmit`.

**Result: 31 type errors across 10 files.** The threading was then reverted, so
this document — not the code — is the deliverable. `develop` typechecks clean.

## Why this is split out of F6

F6 landed the generated schemas and the drift gate. Threading is deliberately a
separate change, for three reasons:

1. **These are 31 judgement calls, not a mechanical edit.** Each one is
   "does this column genuinely never contain NULL, or has this code been
   quietly wrong?" Answering that wrong in bulk introduces real defects, and
   two of the files are in the profile write path — the exact territory of
   BUGS-74, where a partial-write bug destroyed members' saved text on all four
   environments.
2. **Two of the ten files are founder-gated.**
   `src/app/dashboard/profile/page.tsx` and
   `src/app/dashboard/profile/legacy/page.tsx` match the KAN-411 UI/copy
   protection, so the change cannot merge without a founder trailer regardless
   of how good the fix is. (`src/app/admin/**` is an explicit carve-out and is
   not gated.)
3. The programme's own repeated lesson: land the cheap enforced gate first, and
   do the expensive part with its own review.

## The fallout

| File | Errors |
|---|---|
| `src/app/admin/users/page.tsx` | 6 |
| `src/app/admin/users/actions.ts` | 5 |
| `src/app/dashboard/profile/actions.ts` | 5 |
| `src/app/dashboard/profile/legacy/page.tsx` | 5 |
| `src/app/dashboard/profile/page.tsx` | 4 |
| `src/lib/metrics.ts` | 2 |
| `src/app/dashboard/convene/contacts/actions.ts` | 1 |
| `src/app/dashboard/settings/actions.ts` | 1 |
| `src/app/dashboard/settings/discoverability-actions.ts` | 1 |
| `src/app/dashboard/widgets/actions.ts` | 1 |

By TypeScript code: **24 × TS2322** (type not assignable), **4 × TS2345**
(argument not assignable), **3 × TS2352** (unsafe cast).

## The three defect classes, in order of how much they matter

### 1. Nullable columns consumed as non-null — 24 of 31

The dominant pattern, and the one worth taking seriously. The database declares
a column nullable; the application's own interface declares it required; the
untyped client let the two disagree in silence.

```
Types of property 'created_at' are incompatible.
  Type 'string | null' is not assignable to type 'string'.
```

Affected properties seen: `created_at`, `is_published`, `visibility`,
`sort_order`, `relationship`, `link_type`.

**`is_published` and `visibility` are the ones to look at first.** Both feed
publication and visibility decisions. Code that declares them non-null will not
have a branch for NULL, so a NULL row takes whichever path the truthiness
happens to fall into — and on the privacy-relevant side of the app, "whichever
path it happens to fall into" is not an acceptable answer. This is the same
shape as SEC-44/SEC-100, where a suspension guard was present at one call site
and absent at its siblings.

Each needs a decision, not a cast:
- if the column genuinely cannot be NULL → add a `NOT NULL` constraint (a
  migration), and the type follows;
- if it can → handle NULL explicitly at the call site.

`as string` would make the error disappear and the defect permanent.

### 2. Loosely-typed update payloads — 4 of 31

```
src/app/dashboard/settings/discoverability-actions.ts(115,13): error TS2345:
  Argument of type 'Record<string, string | boolean | null>' is not assignable
```

An update built as a bare `Record` rather than a typed row. This is exactly the
BUGS-74 class the `check-partial-write-safety.py` guard exists for — the typed
client rejects the shape that guard has to detect by static analysis. Fixing
these makes the type system enforce what the guard currently approximates,
which is a strict improvement.

### 3. Unsafe `Json` casts — 3 of 31

`src/lib/metrics.ts` casts a `Json` column straight to `MetricsSnapshot`, and
`widgets/actions.ts` writes a `Partial<Record<…, WidgetDismissal>>` into a
`Json` column. Both need a parse/validate step rather than a cast. Lowest risk
of the three classes, and the most self-contained.

## Recommended sequencing

1. **`src/lib/metrics.ts` + `widgets/actions.ts`** (3 errors) — self-contained,
   no founder-gated paths, no schema change. Good first slice.
2. **`admin/**`** (11 errors) — carve-out paths, so no trailer needed, and the
   admin console has the smallest blast radius.
3. **`settings/**` + `convene/contacts`** (3 errors).
4. **`profile/**`** (14 errors) — last, deliberately. Needs the founder trailer,
   sits in the BUGS-74 write path, and deserves its own review.

Reproduce at any time:

```bash
# add <Database> to the three factories in src/lib/supabase-*.ts, then:
npx tsc --noEmit 2>&1 | grep 'error TS'
```
