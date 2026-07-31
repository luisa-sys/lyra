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
