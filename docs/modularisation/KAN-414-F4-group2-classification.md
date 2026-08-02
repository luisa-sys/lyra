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
| behavioural | 234 | candidate |
| copy-pin | 17 | **no** — Group 4, founder-gated content |
| absence (`not.toMatch`) | 25 | **no** — unobservable by construction |
| existence (`existsSync`) | 24 | **no** |
| migration content | 36 | **no** — needs a database |
| export surface | 4 | **no** |
| source ordering (`indexOf`) | 9 | **no** |

`behavioural` is the **fallback** bucket, so it over-counts: anything the triage
cannot confidently classify lands there. That is deliberate — it must never
silently call a structural scan convertible. Treat 234 as an upper bound on
candidates, not a target.

### The upper bound keeps falling, and that is the finding

The first run reported **263 convertible vs 86 structural**. Two rounds of
hand-inspection moved 29 blocks out of `behavioural` — not by changing what the
tests do, but by correcting what the triage could see:

- **copy-pin (17 blocks).** `gdpr.test.js` pins the privacy policy's mandated
  GDPR headings and the cookie banner's button text. That is founder-owned
  legal copy — **Group 4, out of scope**. It is also not improvable: rendering
  the page to assert the same string is the same pin with more machinery.
- **migration content (18 → 36 blocks).** The original detector matched the
  path literal `supabase/migrations`, and therefore **missed the common shape**
  — a test that lists the migrations directory and `.find()`s its file.
  `profile-items-visibility-migration.test.js` does exactly that, and its 8
  assertions on RLS-policy SQL were being reported as convertible. It now
  matches on the SQL-ness of what is read rather than the spelling of the path.

**The lesson is the one this programme keeps relearning: a classifier that
reports the wrong bucket is worse than no classifier**, because 263 reads as a
work queue. Every hand-inspection so far has shrunk the number. Expect the real
convertible set to be materially smaller again, and re-run the triage after each
batch rather than working from a cached figure.

### Not convertible without a config change

`seo.test.js`'s root-layout metadata scans **cannot** be converted today.
Asserting the exported `metadata` object would be a genuine improvement — it
catches "`metadataBase` present but pointing at a preview host", which the regex
structurally cannot — but importing `@/app/layout` fails under Jest: it pulls in
`./globals.css` and `next/font/google`, and `jest.config.js` has no CSS mapper.

Adding one is a **jest.config change**, which the Test Integrity Policy puts
behind sign-off. It was **not** made. Worth knowing before anyone else reaches
for it: this blocks exactly **1 of the 109** src modules the test tree
references, so it is a one-file question, not a systemic blocker, and almost
certainly not worth the config change on its own.

### Converted so far

- **`convene/drain-route`** — the file §2 names as the family's pattern-setter.
  Mutation M2 (hardcode a different `hostUserId`, i.e. one user draining
  another's queue) reddens the behavioural test **while the old regex still
  matches**, because `hostUserId:` remains in the file. The scan guarding
  per-user scoping would have stayed green through the exact bug it existed to
  prevent.

- **`convene/post-event`** — the sweep that marks gatherings completed and
  attendees attended. Mutation: flip the invitee filter from `accepted` to
  `pending` and the behavioural test reddens while the original regexes all
  still match, because every literal they search for is still in the file.
  The bug that would ship is recording someone as having attended an event
  they declined.

- **`sentry-scaffold` → `sentry-client-init-behaviour`** — the strongest
  evidence in Group 3 so far. Two mutations redden the behavioural suite while
  the old scan stays **9/9 green**:

  | Mutation | Behavioural | Old scan |
  |---|---|---|
  | `beforeSend: (event) => event` | **1 failed** | 9 passed |
  | `Sentry.init` hoisted out of `if (dsn)` | **2 failed** | 9 passed |

  The first is **SEC-55 undone** — the scan asserts `toContain('beforeSend')`,
  so wiring the hook to identity keeps it green while every OAuth secret in
  every error event ships to a third-party processor. The second is why "the
  gate is present" and "the gate works" must not be the same assertion: the
  literal `if (dsn)` survives in the file above the hoisted call.

  What replaced the scan asserts the **output** of the registered hook — feed
  it an event carrying `client_secret` and an `Authorization` header, and
  require the secret to be absent from the result. No text scan can express
  that, which is precisely why the conversion is worth making here and not in
  the six Group 2 files where it would have lost coverage.

- **`seo.test.js` sitemap block → `sitemap-suspension-behaviour`** — the
  strongest evidence in the programme, because the defect is not hypothetical.

  | Mutation | Behavioural | Old scan |
  |---|---|---|
  | drop `.eq('is_suspended', false)` — **SEC-100 verbatim** | **3 failed** | 9 passed |
  | flip to `.eq('is_suspended', true)` | **3 failed** | — |
  | drop `.eq('is_published', true)` | **1 failed** | 9 passed |

  **SEC-100 was live while `expect(sitemap).toContain('is_published')` was
  green.** Suspended — moderated, taken-down — members' slugs were being
  published to search engines for crawling. `is_published` was in the file the
  whole time; the missing filter was `is_suspended`. The scan asserted the
  presence of the one string that was never the problem, so it read identically
  before the defect, during it, and after the fix.

#### The comment keeps the scan green after the code is deleted

The third mutation is worth stating on its own, because it generalises well
beyond this file. `is_published` occurs **twice** in `sitemap.ts` — once in the
query, and once in the comment explaining why the query needs it:

```ts
// SEC-100: the sitemap is built with the SERVICE-ROLE client, which
// bypasses RLS — the `is_published = true AND is_suspended = false`
```

Delete `.eq('is_published', true)` and `toContain('is_published')` **still
matches — on the comment.** The prose written to document the fix is precisely
what conceals the fix's removal.

This is not unique to `sitemap.ts`; it is structural to the whole technique. Any
source-text scan over a file whose comments discuss the thing being asserted is
weaker than it appears, and the better a fix is documented, the weaker its scan
becomes. The codebase already knows this in one place —
`check-bash-portability.py` strips comments before matching, and pins that case
as a `--self-test` fixture (CLAUDE.md gotcha #28) — but the test-side scans do
not. **Any Group 3 scan that is kept rather than converted should strip comments
before matching.**

### A hole, not a weak test — `maintenance-page.test.js`

Every other item in this batch replaced a scan that was *weaker* than a
behavioural test. This one replaced seven tests that asserted **nothing at all**
about the worker.

`tests/unit/maintenance-page.test.js` opens by re-declaring the worker's own
logic inside the test file:

```js
// Extract validation logic from Worker for testing
function isValidEmail(email) { ... }
function createRateLimiter() { ... }
```

and then tests those copies. Its header is candid — *"The actual Worker runs on
Cloudflare, but we test the core logic here."*
`scripts/lyra-maintenance-worker.js` is never loaded.

**Proven by mutating the worker and re-running that suite:**

| Mutation applied to the worker | `maintenance-page.test.js` | New behavioural suite |
|---|---|---|
| `isValidEmail` → `return true` | **19/19 pass** | 2 failed |
| `isRateLimited` → `return false` | **19/19 pass** | 2 failed |
| `escapeHtml` → identity (SEC-21 F-23 undone) | **19/19 pass** | 1 failed |

So the public maintenance page's email-capture form had **no effective coverage
on its input validation, its abuse limiting, or its HTML escaping**, while
reporting 19 green tests. This is the shape CLAUDE.md names directly: *a control
that has never been seen to fail is indistinguishable from no control.* Here it
was worse than absent, because 19 passing tests read as coverage.

It matters more this week than last: **BUGS-19 closed 2026-07-31**, making this
worker's repo-owned workflow the single live deploy path to production.

**Raised as a defect in its own right, not just a conversion** — the finding is
that the coverage was absent, which is true regardless of whether anyone
converts the scan. Tracked as **BUGS-85**.

**Now guarded: CTL-038** (`scripts/check-test-reimplementation.py`, in
`pr-checks.yml`). SEC-101 outcome (b) — no control existed, so one was built.
It flags a test that names a subject module, defines a function whose name also
exists there, and never reaches the real module; `vacuous` when the subject is
never imported *and* never invoked, `partial` when it is reached but a private
copy of some logic remains. Shrink-only ratchet, failing on new, worsened
**and stale** entries, exit 2 with no baseline.

Two blind spots surfaced while building it, both now `--self-test` fixtures:
a subject named only as `SRC.<key>` and driven by `execFileSync` was misread as
`vacuous`; fixing that then over-matched the
`const { execFileSync } = require(...)` destructure, whose argument window
swallowed the rest of the file. Both are the same class of error as the defect
itself — **a check reporting on something adjacent to, but not, the thing it
names** — which is worth noticing, because it is evidently easy to make even
while concentrating on exactly that failure mode.

#### How it runs without a jest.config change

The worker is an ES module and `jest.config.js` transforms only `.ts`/`.tsx`.
Adding a `.js` rule would change how ~100 existing `.js` test files execute — a
jest.config change affecting test behaviour, which the Test Integrity Policy
puts behind sign-off. **It was not made.** Instead this follows the convention
already used throughout `tests/scripts/`: invoke the real thing in a subprocess.
`tests/support/maintenance-worker-harness.mjs` imports the actual worker,
exercises it, and prints observations as JSON; the assertions live in the test.

One detail worth keeping: the notification `subject` is **not** escaped, and
that is correct — mail clients render subjects as plain text. It is pinned
explicitly so a future reader does not have to re-derive whether the asymmetry
with `html` is a bug.

### Deliberately not started

`convene/connections-page.test.ts` is the top candidate by count, but it is the
**SEC-109** file — its behavioural conversion is already half-specified on the
open SEC-109 branch, including the assertion that had to move to
`oauth-connections.ts:158`. Converting it here would collide. It should ride
SEC-109's merge instead.


---

## How much of group 3 is actually left (measured 2026-08-02)

The triage headline is **105 files / 239 behavioural blocks**. That number has
never survived contact with the files, and it does not here either.

| Bucket | Files |
|---|---:|
| classified + adversarially refuted (tranche 1) | 8 |
| classified (tranche 2) | 8 |
| converted, or deliberately deferred | 7 |
| **never inspected** | **82** (134 blocks) |

### The untouched tail is thinner than its block count

**50 of the 82 files have exactly ONE behavioural block**, 17 have two, and only
15 have three or more. A single `toContain` is overwhelmingly a copy pin, an
assertion already covered behaviourally elsewhere, or structural — which is what
tranche 1 kept demonstrating (11 of 25 conversion claims refuted outright).

### A mechanical filter that turned out to be reassuring

Cross-referencing the untouched tail against **CTL-039**'s baseline finds
**7 comment-satisfied assertions across 5 files**. Those are, by construction,
assertions a text scan cannot make load-bearing — so they looked like the most
promising place to find another BUGS-85.

**Every one was checked, and none is a coverage gap:**

| Assertion | Verdict |
|---|---|
| `revoke-route` → `/Unknown token — return 200/` (RFC 7009 §2.2) | already behavioural — the suite calls `POST(req)` and asserts real statuses |
| `gdpr` → `deleteAccount` | already behavioural — `account-deletion.test.ts` invokes it |
| `section-visibility` → `/coerceSectionVisibility/` | already behavioural — the same file invokes it |
| `retention` → `/security definer/`, `/cutoff >= now()/` | migration SQL — structural, needs a database |
| `dcr-anti-phishing` → `/drop column if exists …/` | migration rollback note — structural |

They are decorative redundancy sitting **alongside** real tests, not holes. That
is a materially different picture from `maintenance-page.test.js` and
`rate-limit.test.js`, where the scan was the *only* thing present.

### Revised estimate

Expect roughly **two more classification tranches** over the 15 files with three
or more blocks, then a single cheap sweep across the ~67 one-and-two-block
files. The genuinely convertible remainder is likely nearer **10-15 blocks than
134**.

**A units warning for whoever continues.** The classifier agents report every
`test` in a file, while the triage script reports only blocks it bucketed as
behavioural. `convene/microsoft-calendar.test.ts` is 5 blocks by the triage and
22 tests by the agent, which reported 20 "convertible". Those two numbers are
not comparable, and quoting the agent's figure as progress would overstate the
remaining work by roughly four times.
