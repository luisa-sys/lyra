# 🚫 Convene is OUT OF SCOPE for the modularisation programme

**Decision: 2026-08-09, Luisa. Tracked in [KAN-470](https://checklyra.atlassian.net/browse/KAN-470) — BLOCKED.**

> **The single condition that unblocks this work: Convene is turned back on.**
>
> Nothing else. Not "we had spare capacity". Not "it was next in the sequence".
> Not "the rest of the D-phase is finished". Not "it's only a file move".

If you are reading this because you were about to extract `convene` — **stop.**
Check whether Convene is running. If it is not, this file is your answer.

---

## Why it is deferred

Convene was **D7** in `LYRA_MODULARISATION_PLAN_2026-07-26.md` §6, described there as
*"Biggest module; biggest payoff"*. At **55 files / ~7,014 LOC** it is the largest
single extraction in the whole programme — roughly twice the next largest.

**But Convene is not running.** Every API route under `src/app/api/convene/` is gated
behind `CONVENE_ENABLED`, which is not `true` on any environment; the routes 404 by
design.

So the payoff is currently zero. There is no user journey to protect, no live defect
to prevent, and no boundary being violated at runtime — while the risk is the full
risk of relocating 7,000 lines. Worse, because the feature is dark there is **no E2E
or soak coverage** that would catch a mistake: the extraction would be the least
verifiable large change in the programme, guarding code nobody is executing.

Modularisation is worth doing where it makes a live rule expressible. It is not worth
doing to make a dormant directory tidier.

---

## What is being parked (measured 2026-08-09)

Treat every number here as a **snapshot, not a fact**. Re-derive before acting.

| | |
|---|---|
| Files | 55 |
| LOC | ~7,014 |
| Layer | 3 |
| `mayDependOn` | `access`, `audit`, `contracts`, `features`, `guards`, `platform` |

**Paths** (as declared in `modules.json`):

```
src/lib/convene/
src/lib/recommend/convene/
src/app/dashboard/convene/
src/app/api/convene/
src/app/r/
```

**10 exclusive tables** — `contacts`, `contact_methods`, `gatherings`,
`gathering_invitees`, `gathering_invite_messages`, `gathering_proposed_slots`,
`gathering_events_log`, `oauth_connect_state`, `oauth_connections`, `venues`.
Plus 5 RPCs.

---

## What stays true while it is parked

Deferring the extraction does **not** deregister the module. `convene` remains a
declared module in `modules.json`, which means:

- **CTL-041** still asserts its `owns.files` count matches the tree, that every
  declared path exists, and that nothing under it is unowned. Convene code cannot
  silently drift out of the manifest just because the extraction is parked.
- The dependency rules still name it.
- `src/lib/recommend/convene/` is nested inside `recommendations`' `src/lib/recommend/`
  and is owned by `convene` under **longest-prefix-wins**. This reads like an
  ambiguous boundary and is not. **CTL-041 pins this exact case** — do not "tidy" it
  away while working on `recommendations`.

---

## Traps for whoever eventually does this

Recorded now, while the analysis is fresh, so it does not have to be re-derived.

1. **Routes must not move.** In the App Router a route's URL *is* its directory path.
   Moving `src/app/api/convene/**`, `src/app/dashboard/convene/**` or `src/app/r/**`
   changes live URLs. Follow D1 (#730/#731/#732) and D2 (`oauth-as`): library code
   moves into `src/modules/convene/`, routes stay exactly where they are.

2. **There is a verbatim copy in another repo.** `lyra-mcp-server/src/convene-recommend-scoring.ts`
   is a byte-copy of the `src/lib/recommend/convene/` scoring logic, and its own header
   says so. That is `@lyra/contracts` territory ([KAN-418](https://checklyra.atlassian.net/browse/KAN-418)),
   not something to solve inside the extraction.

3. **It owns real OAuth tokens.** `oauth_connections` and `oauth_connect_state` hold
   users' calendar OAuth credentials. Any move through those paths needs a security
   review that a dormant feature has not had recently.

4. **The invite allowlist is load-bearing.** `CONVENE_INVITE_ALLOWLIST` exists to stop
   mail reaching real people from a non-production environment. Preserve it exactly.

5. **Coverage before extraction, not after.** If Convene is re-enabled, journey
   coverage should land *before* the move, not as a follow-up. Extracting first means
   the riskiest refactor in the programme ships with nothing watching it.

---

## Re-enabling Convene is its own event

Turning `CONVENE_ENABLED` on is a security and data-protection decision independent of
this epic: it makes 10 tables of personal data — contacts, contact methods, gathering
attendance — reachable again. That decision comes first and separately. This epic only
becomes actionable afterwards.
