# KAN-414 F4 Group 2 — what actually converted, and what must not

**Written 2026-07-31 while executing the Group 2 sign-off.**

KAN-417 §2 ranked ~8 security-critical files as category **(b)** — "convertible
single-file text scan" — and asserted *"Every one converts under the mutation
rule in §8."*

**That claim does not survive inspection. Two of the eight were (b). Six contain
scans that are category (c) by KAN-417's own definition** — "genuinely
structural … keep as text, manifest-routed."

This is not a shortfall against the sign-off. Converting a (c) scan produces a
test that looks more modern and proves less, which is the failure mode this
whole programme exists to prevent.

## Converted — genuinely (b), mutation-proven

| File | Invariant | Mutation proof |
|---|---|---|
| `feature-entitlements` → `media-uploads-gate` | a revoked `media_uploads` refuses at **both** upload entrypoints, before storage | deleting either gate reddens exactly one case |
| `sec57-issuance-suspension` → `oauth-authorize-suspension-guard` | `suspended` redirects; `ok` **and** `unknown` do not | widening to `standing !== 'ok'` reddens the `unknown` case |

The second mutation is the one worth remembering: **every substring the old scan
searched for is still present after that widening**, so the scan stayed green
while good-standing users would have been locked out of OAuth on a transient
lookup blip.

## Not converted — and why each is (c)

| File | What its scan asserts | Why behaviour cannot express it |
|---|---|---|
| `convene/cron-auth` | the insecure `!== \`Bearer …\`` comparison is **absent**; the comparison is **constant-time** | Absence of a pattern is structural. And a naive and a timing-safe comparison reject a wrong secret **identically** — the difference is a timing side-channel, unobservable from a unit test and flaky if attempted. |
| `bugs74-manual-of-me-field-coverage` | every discovered loader's `select` covers all six allowlisted columns | A multi-file sweep that **discovers** loaders by scanning the tree. Testing it behaviourally needs a live DB, and the hand-maintained-list alternative is what let BUGS-74's first fix miss the legacy editor. |
| `section-visibility` | the migration adds the JSONB column with the right default and a rollback; the module exports its declared surface | Migration **content** and export surface are static facts. There is no runtime in which to observe "this migration file contains a rollback note". |
| `auth-confirm-route` | `/auth/confirm` uses `verifyOtp` and does **not** call `exchangeCodeForSession`; `/auth/callback` still does | Another absence check. The positive behaviour is **already** covered by real route tests in the same file. |
| `bugs70-manual-of-me-persist` | the editor wires `useAutoSave`'s `flush` to `onBlur` | A React-wiring pin. Convertible in principle with a render harness, but the files are founder-gated UI paths, so it needs a `UI-Change-Approved` trailer it does not currently justify. |
| `convene/dispatch-atomic-claim` | claim/release ordering in `dispatch.ts`, and the migration's status enum | The behavioural half (`claimQueuedRows`) is **already** tested above it; what remains is call-ordering and migration content. |

## The evidence that settles it

For `cron-auth` specifically, a single mutation shows the two check styles are
**complementary, not substitutes**. Stop gating on the comparison while leaving
the helper in the file:

```ts
- if (!expected || !timingSafeStrEqual(authHeader, expectedHeader)) {
+ if (false && !timingSafeStrEqual(authHeader, expectedHeader)) {
```

| Check | Result |
|---|---|
| structural scan (`cron-auth.test.ts`) | **9/9 green** — `timingSafeStrEqual` is still present |
| behavioural (`cron-route-auth-behaviour.test.ts`) | **4 of 5 red** |

The scan cannot catch a route that stops gating. The behavioural test cannot
catch a naive comparison. **Converting one into the other would have lost half
the coverage in either direction.**

## What was done instead

Where a (c) scan is kept, behavioural coverage was **added alongside** it where
cheap and valuable — net-new tests, which need no sign-off. `cron-auth` gained
five: no header, wrong-secret-of-same-length (a length check alone would pass
it), correct secret without the `Bearer` prefix, the correct secret, and
`CRON_SECRET` unset failing closed rather than opening the endpoint.

## Recommendation for Group 3

KAN-417 §2 describes Group 3's ~38 files as *"mechanical once the pattern is
set."* Given that 6 of 8 in the supposedly-harder Group 2 turned out to be (c),
**classify before converting** rather than assuming the ranking. The test is
simple: *can a running program observe this?* Absence of a pattern, file
content, export surface and call ordering cannot.

---

## Group 3 triage (added 2026-07-31)

`scripts/triage-source-text-tests.py` classifies every remaining source-text
assertion. Run it before converting anything.

**KAN-417 §2 estimated Group 3 at "~38 files … mechanical once the pattern is
set". The real figure is ~120 files and ~377 source reads.**

| Bucket | Blocks | Convertible? |
|---|---:|---|
| behavioural | 263 | candidate |
| absence (`not.toMatch`) | 28 | **no** — unobservable by construction |
| existence (`existsSync`) | 27 | **no** |
| migration content | 18 | **no** — needs a database |
| export surface | 4 | **no** |
| source ordering (`indexOf`) | 9 | **no** |

`behavioural` is the **fallback** bucket, so it over-counts: anything the triage
cannot confidently classify lands there. That is deliberate — it must never
silently call a structural scan convertible. Treat 263 as an upper bound on
candidates, not a target.

### Converted so far

- **`convene/drain-route`** — the file §2 names as the family's pattern-setter.
  Mutation M2 (hardcode a different `hostUserId`, i.e. one user draining
  another's queue) reddens the behavioural test **while the old regex still
  matches**, because `hostUserId:` remains in the file. The scan guarding
  per-user scoping would have stayed green through the exact bug it existed to
  prevent.

### Deliberately not started

`convene/connections-page.test.ts` is the top candidate by count, but it is the
**SEC-109** file — its behavioural conversion is already half-specified on the
open SEC-109 branch, including the assertion that had to move to
`oauth-connections.ts:158`. Converting it here would collide. It should ride
SEC-109's merge instead.
