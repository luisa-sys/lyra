#!/usr/bin/env python3
"""CTL-075 — every admin moderation write to `profiles` must refuse a self-target.

SEC-118. Of the four code paths that moderate a member's `profiles` row, three
carried a self-moderation guard and one did not: `suspendProfileFromReport`.
The consequence was not privilege escalation — an admin can already suspend a
peer through the sanctioned UI — it was an unrecoverable SELF-lockout, because
any member can report an admin and the report page rendered a live "Suspend"
button with nothing behind it.

WHY THIS CONTROL EXISTS AT ALL
------------------------------
`docs/DEFECT_FEEDBACK_LOOP.md` counts EIGHT prior tickets in one family: "a
suspension guard added to one call site but not its siblings". SEC-118 is the
ninth. Fixing the ninth call site without changing a control produces a tenth.

CTL-028 named this class in its `prevents` list and could not fire on it — its
implementation only matched `.eq('is_published', true)` READ chains. That claim
was removed on 2026-08-12 by an unrelated rewrite, which is honest but leaves
the class with NO control at all. This is that control.

WHAT IT MATCHES, AND WHY IT IS NOT KEYED ON THE COLUMN NAME
----------------------------------------------------------
The obvious predicate — "a function whose update payload mentions
`is_suspended`" — is WRONG here, and measurably so. `bulkUserAction` writes
`svc.from('profiles').update(transition.update)`, where `transition.update` is
built by `computeAccessTransition` in another module entirely. The column name
appears nowhere in the writing function. A column-keyed gate would report clean
over the highest-volume moderation path in the product (it suspends up to
BULK_MAX members in one statement), which is the CTL-055 `opaque-builder`
lesson: a matcher that needs a literal cannot see a variable.

So the predicate is the ADMIN MODERATION SIGNATURE instead — a function that
BOTH:
  1. writes `profiles` (`.from('profiles')` … `.update(`/`.upsert(`), AND
  2. records the act in the tamper-evident trail (`logModerationAction` or
     `logModerationActionsBatch`).

Writing a member's row *and* logging it as a moderation action is what makes a
function a moderation path, whatever columns it happens to touch. That pairing
is also what keeps the owner's own `is_published` write in
`src/app/dashboard/profile/actions.ts` out of scope: a member publishing their
own profile is self-targeting BY DEFINITION and must not be refused. Excluding
it by "does it log a moderation action" is a statement about what the code IS,
where excluding it by path would only be a statement about where it lives.

COMMENTS ARE STRIPPED BEFORE MATCHING
-------------------------------------
Catalogue failure mode 2, and it is live in this very repo: the file this
control was written for has a header paragraph naming `isSelfModeration` while
explaining the defect. Matching raw source would let that PROSE satisfy the
guard requirement — the better the fix is documented, the weaker the scan
becomes. Annotations are read from the raw text (they are comments by
construction); everything else is matched post-strip.

STATED GAPS — read these before trusting a clean result
-------------------------------------------------------
* `deleteProfileItem` (`src/modules/trust-safety/user-actions.ts`) logs a
  moderation action and has no self-guard, but deletes from `profile_items`,
  not `profiles`, so it is OUT of this predicate. That is deliberate: whether
  an admin may delete an item from their own profile is a product decision
  with an owner, not a defect (SEC-118 §D). It is recorded here so a clean
  run is not misread as covering it.
* A moderation path that neither writes `profiles` nor logs would be invisible.
  Such a path would be a worse defect than this one and is not currently
  reachable — every writer in the tree does both.
* This is a static scan. It proves a self-check is PRESENT in the function, not
  that it is correct. The behavioural contract is pinned by
  `tests/unit/trust-safety-report-actions.test.ts` and
  `tests/unit/trust-safety-user-actions.test.ts`, which are mutation-proven.

Escape hatch: `// self-moderation-ok: <JIRA-KEY> <reason>` inside the function.

Usage:
  python3 scripts/check-self-moderation-guard.py
  python3 scripts/check-self-moderation-guard.py --self-test
"""

from __future__ import annotations

import re
import subprocess
import sys

# A floor, not an exact count. Asserted BEFORE iterating, because a
# parameterised scan over an empty corpus is green and says nothing
# (catalogue failure mode 4). If the tree genuinely drops below this, the
# scan is not finding the files it used to and that is the finding.
MIN_FILES_SCANNED = 200
MIN_MODERATION_WRITERS = 3

WRITE_RE = re.compile(r"\.from\(\s*['\"]profiles['\"]\s*\)")
MUTATE_RE = re.compile(r"\.(update|upsert)\s*\(")
LOG_RE = re.compile(r"\blogModerationAction(sBatch)?\s*\(")

# Either the shared helper, or an explicit comparison against the acting
# admin's own profile id. `bulkUserAction` uses the second form — a filter over
# a list — and rewriting it to use the helper is a refactor this control has no
# business forcing.
GUARD_RE = re.compile(
    r"isSelfModeration\s*\(|[!=]==?\s*admin\.profileId|admin\.profileId\s*[!=]==?"
)

ANNOTATION_RE = re.compile(r"//\s*self-moderation-ok:\s*([A-Z][A-Z0-9]+-[0-9]+)\s+\S")

FUNC_START_RE = re.compile(
    r"^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.M
)


def strip_comments(src: str) -> str:
    """Remove // and /* */ comments, preserving line structure.

    Deliberately naive about strings containing "//": the cost of a false
    strip here is a guard that reads as ABSENT (a loud, investigable failure),
    where the cost of not stripping is a guard that reads as PRESENT because
    a comment mentioned it — silent, and the defect this repo keeps hitting.
    Fail in the direction that is visible.
    """
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def split_functions(src: str) -> list[tuple[str, str]]:
    """Split a module into (name, body) for each top-level function.

    Function-scoped rather than file-scoped for the reason gotcha #27 records:
    a file-scoped cut of `check-partial-write-safety.py` passed `actions.ts`
    because an UNRELATED function in the same file contained the token it was
    looking for. A guard present in one function says nothing about its sibling
    — which is the entire defect class this control exists for.
    """
    starts = [(m.start(), m.group(1)) for m in FUNC_START_RE.finditer(src)]
    if not starts:
        return []
    out = []
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
        out.append((name, src[pos:end]))
    return out


def tracked_sources() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "src/"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    return [p for p in out if p.endswith((".ts", ".tsx"))]


def analyse(raw: str) -> list[tuple[str, bool, bool]]:
    """Return (function name, is a moderation writer, is guarded-or-annotated)."""
    stripped = strip_comments(raw)
    results = []
    raw_funcs = dict(split_functions(raw))
    for name, body in split_functions(stripped):
        writes = bool(WRITE_RE.search(body)) and bool(MUTATE_RE.search(body))
        if not (writes and LOG_RE.search(body)):
            continue
        guarded = bool(GUARD_RE.search(body))
        # The annotation is a comment, so it is read from the RAW body.
        annotated = bool(ANNOTATION_RE.search(raw_funcs.get(name, "")))
        results.append((name, True, guarded or annotated))
    return results


def run_scan() -> int:
    files = tracked_sources()
    if len(files) < MIN_FILES_SCANNED:
        print(
            f"::error::CTL-075: scanned only {len(files)} tracked source files "
            f"(floor {MIN_FILES_SCANNED}). The scan did not run over the tree it "
            "is supposed to cover; failing closed rather than reporting clean."
        )
        return 2

    writers: list[str] = []
    violations: list[str] = []
    for path in files:
        try:
            with open(path, encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as exc:  # unreadable file => fail closed, never "clean"
            print(f"::error::CTL-075: could not read {path}: {exc}")
            return 2
        for name, _, ok in analyse(raw):
            writers.append(f"{path}::{name}")
            if not ok:
                violations.append(f"{path}::{name}")

    if len(writers) < MIN_MODERATION_WRITERS:
        print(
            f"::error::CTL-075: found only {len(writers)} admin moderation "
            f"writer(s) (floor {MIN_MODERATION_WRITERS}). Either the detector "
            "stopped matching or the moderation paths moved. Both are findings."
        )
        for w in writers:
            print(f"    matched: {w}")
        return 2

    for v in violations:
        print(
            f"::error::CTL-075: {v} writes `profiles` and logs a moderation "
            "action, but performs no self-moderation check."
        )
    if violations:
        print(
            "\n  An admin server action is reachable by anyone who can post a "
            "form, so it must defend itself — hiding the button is not enough.\n"
            "  Fix: call isSelfModeration(admin.profileId, targetProfileId) and "
            "bail BEFORE the audit write.\n"
            "  Or annotate: // self-moderation-ok: <JIRA-KEY> <reason>\n"
            "  See SEC-118 and docs/DEFECT_FEEDBACK_LOOP.md."
        )
        return 1

    print(
        f"CTL-075: {len(writers)} admin moderation writer(s) across "
        f"{len(files)} files, all self-guarded. ✓"
    )
    for w in writers:
        print(f"    ok: {w}")
    return 0


# ── self-test ────────────────────────────────────────────────────────────

GUARDED = """
export async function setSuspendState(profileId: string): Promise<void> {
  const admin = await getCurrentAdmin();
  if (isSelfModeration(admin.profileId, profileId)) { redirect('/x'); }
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

# The SEC-118 defect, verbatim in shape.
UNGUARDED = """
export async function suspendProfileFromReport(profileId: string): Promise<void> {
  const admin = await getCurrentAdmin();
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

# The reason this control is not keyed on the column name: the payload is
# opaque and `is_suspended` appears nowhere in the writing function.
OPAQUE_GUARDED = """
export async function bulkUserAction(formData: FormData): Promise<void> {
  const admin = await getCurrentAdmin();
  ids = ids.filter((id) => id !== admin.profileId);
  await logModerationActionsBatch({ admin, targetProfileIds: ids });
  await svc.from('profiles').update(transition.update).in('id', ids);
}
"""

OPAQUE_UNGUARDED = """
export async function bulkUserAction(formData: FormData): Promise<void> {
  const admin = await getCurrentAdmin();
  await logModerationActionsBatch({ admin, targetProfileIds: ids });
  await svc.from('profiles').update(transition.update).in('id', ids);
}
"""

# Catalogue failure mode 2: prose naming the guard must NOT satisfy it.
COMMENT_ONLY = """
/**
 * Historically this called isSelfModeration(admin.profileId, profileId)
 * before the audit write. See SEC-118.
 */
export async function suspendProfileFromReport(profileId: string): Promise<void> {
  // isSelfModeration is the shared helper used by the sibling actions.
  const admin = await getCurrentAdmin();
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

ANNOTATED = """
export async function suspendProfileFromReport(profileId: string): Promise<void> {
  // self-moderation-ok: SEC-999 target is always a third party by construction
  const admin = await getCurrentAdmin();
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

# A bare marker with no ticket key must NOT satisfy the hatch.
ANNOTATION_NO_KEY = """
export async function suspendProfileFromReport(profileId: string): Promise<void> {
  // self-moderation-ok: because I said so
  const admin = await getCurrentAdmin();
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

# The member publishing their OWN profile. Self-targeting by definition, and
# no moderation log — must never be flagged.
OWNER_SELF_PUBLISH = """
export async function publishProfile(profileId: string): Promise<void> {
  await supabase.from('profiles').update({ is_published: true }).eq('id', profileId);
}
"""

# Reads the table but does not mutate it.
READ_ONLY = """
export async function loadProfile(profileId: string): Promise<void> {
  await logModerationAction({ admin, action: 'view' });
  await supabase.from('profiles').select('id').eq('id', profileId);
}
"""

# Gotcha #27's lesson: a guard in a SIBLING function must not cover this one.
SIBLING_LEAK = """
export async function setSuspendState(profileId: string): Promise<void> {
  if (isSelfModeration(admin.profileId, profileId)) { redirect('/x'); }
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}

export async function suspendProfileFromReport(profileId: string): Promise<void> {
  await logModerationAction({ admin, action: 'suspend' });
  await supabase.from('profiles').update({ is_suspended: true }).eq('id', profileId);
}
"""

# A moderation write to a DIFFERENT table is out of scope (the stated gap).
OTHER_TABLE = """
export async function deleteProfileItem(itemId: string): Promise<void> {
  await logModerationAction({ admin, action: 'delete_item' });
  await supabase.from('profile_items').delete().eq('id', itemId);
}
"""

CASES = [
    ("guarded", GUARDED, [("setSuspendState", True)]),
    ("unguarded — the SEC-118 defect", UNGUARDED, [("suspendProfileFromReport", False)]),
    ("opaque payload, guarded by filter", OPAQUE_GUARDED, [("bulkUserAction", True)]),
    ("opaque payload, unguarded", OPAQUE_UNGUARDED, [("bulkUserAction", False)]),
    ("comment naming the guard does NOT satisfy it", COMMENT_ONLY,
     [("suspendProfileFromReport", False)]),
    ("annotation with a ticket key satisfies it", ANNOTATED,
     [("suspendProfileFromReport", True)]),
    ("annotation without a ticket key does NOT", ANNOTATION_NO_KEY,
     [("suspendProfileFromReport", False)]),
    ("owner self-publish is not a moderation write", OWNER_SELF_PUBLISH, []),
    ("read-only access is not a write", READ_ONLY, []),
    ("a sibling's guard does not cover this function", SIBLING_LEAK,
     [("setSuspendState", True), ("suspendProfileFromReport", False)]),
    ("a write to another table is out of scope", OTHER_TABLE, []),
]


def self_test() -> int:
    failures: list[str] = []
    checked = 0

    def check(cond: bool, label: str) -> None:
        nonlocal checked
        checked += 1
        if not cond:
            failures.append(label)

    for label, src, expected in CASES:
        got = [(n, ok) for n, _, ok in analyse(src)]
        check(got == expected, f"{label}: expected {expected}, got {got}")

    # Guard-the-guard: prove strip_comments actually removes the token the
    # COMMENT_ONLY case depends on. Without this, that case could be passing
    # because the regex never matched for some other reason.
    check(
        "isSelfModeration" in COMMENT_ONLY
        and "isSelfModeration" not in strip_comments(COMMENT_ONLY),
        "strip_comments must remove a guard token that appears only in prose",
    )
    # ...and that it does NOT remove one in real code.
    check(
        "isSelfModeration" in strip_comments(GUARDED),
        "strip_comments must preserve a guard token in executable code",
    )

    # The corpus floor is asserted, not assumed (catalogue failure mode 4).
    check(len(CASES) >= 11, f"case corpus shrank to {len(CASES)}")

    # Read the verdict AFTER every case has run (catalogue failure mode 9 —
    # assertions appended to a list nothing consumes report a rising count and
    # never fail).
    if failures:
        for f in failures:
            print(f"::error::CTL-075 self-test FAILED — {f}")
        print(f"Self-test FAILED ({len(failures)} of {checked} checks)")
        return 1
    print(f"CTL-075 self-test passed ({checked} checks over {len(CASES)} fixtures). ✓")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else run_scan())
