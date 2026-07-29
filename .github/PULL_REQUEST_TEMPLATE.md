## Summary

Brief description of what this PR does.

## Jira Ticket

KAN-XX

## Checklist

- [ ] Unit tests added/updated for new/changed functionality
- [ ] All existing tests pass (`npm run test:unit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Type check passes (`npm run type-check`)
- [ ] Build succeeds (`npm run build`)
- [ ] Coverage has not decreased
- [ ] No eslint-disable or ts-ignore without KAN-XX reference
- [ ] Dependency-rule gate reviewed — `npm run depcruise` adds no new `no-module-to-app` / `no-cross-segment-app` / `no-circular` violation (KAN-425; it is non-blocking today, so read the warnings rather than trusting the green tick)
- [ ] ARCHITECTURE.md updated if architectural changes were made
- [ ] Ops routine / Control-Room registry updated if scheduled-routine behaviour, cadence, or ownership changed — `docs/OPS_ROUTINES_CONTROL_ROOM.md` + the Confluence Control Room (or N/A) (KAN-359)
- [ ] Docs / system map updated — Architecture & Infrastructure and/or Data Model & Security (+ ADR for any design decision), or N/A with reason (KAN-359 Documentation Definition-of-Done; see `docs/RUNBOOK.md` and `docs/DOC_SYNC_HEALTHCHECK_ROUTINE.md`)

## Extraction Definition-of-Done (KAN-428)

**Only applies if this PR moves (deletes or renames) a file under `src/`.** If it
does not, delete this section — `scripts/check-extraction-dod.sh` is inert and
these lines are not read. If it does, an extraction carries its own estate
rework in the SAME PR: see `docs/MODULARISATION_EXTRACTION_DOD.md` for the
per-path checklist and `docs/modularisation/KAN-419-path-coupling.md` for why.

CI checks the rest of the estate for you (`.github/`, `scripts/`, `docs/`,
`modules.json`, `tests/`). The three lines below are the part CI **cannot**
check, so answer them honestly — replace `FILL-IN`, which fails the gate as-is.

- [ ] EXTRACTION-DOD-DESIGN-SYSTEM: FILL-IN — `done` if this PR moves `src/app/globals.css` or a `ui-kit` file and the source pointer in `~/lyra-design-system/build.py` was updated + the generator re-run; else `n/a — <reason>`. Out of repo: no CI can see this.
- [ ] EXTRACTION-DOD-ROUTINE-PROMPTS: FILL-IN — `done` if this PR renames a script or changes a protected-surface path list named verbatim in a claude.ai routine prompt and Luisa updated the prompt; else `n/a — <reason>`. Out of repo: no CI can see this. Name the routine + its `trig_…` ID (`docs/OPS_ROUTINES_CONTROL_ROOM.md`).
- [ ] EXTRACTION-DOD-COVERAGE: FILL-IN — the Playwright project and soak contract clause (C1–C6) covering the moved module, e.g. ``playwright project `authed`, soak clause C4``; or `no coverage`, which is an acceptable answer and a finding to raise.
