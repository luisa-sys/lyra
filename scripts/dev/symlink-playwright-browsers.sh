#!/usr/bin/env bash
# Idempotent helper for remote-session sandboxes that pre-install Playwright
# browser binaries under a fixed path (e.g. /opt/pw-browsers) but whose
# revision numbers can trail the @playwright/test version this repo pins.
#
# When the exact revision-numbered directory @playwright/test expects is
# missing or incomplete, this creates it by symlinking the browser binary
# from whichever other already-installed revision of the SAME browser is
# present, rather than downloading anything. It never touches the network.
#
# This is sandbox-local only: nothing under $PLAYWRIGHT_BROWSERS_PATH is
# part of this repo, so there is nothing to commit, and the effect does not
# persist to a fresh container. Safe to re-run; a no-op once the expected
# revision is already present and complete.
#
# Background: docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md "Self-update log"
# entries 2026-10-01 and 2026-10-08 derived and re-derived this technique by
# hand on successive runs. This promotes it out of that tribal knowledge.
#
# webkit (mobile-safari) is deliberately NOT handled here: this class of
# sandbox has never shipped a pre-installed webkit build to symlink from
# (see the 2026-09-09/17/20/21 log entries), so there is nothing to link.
# That project stays UNVERIFIED by design, not a defect in this script.
set -euo pipefail

PW_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
BROWSERS_JSON="node_modules/playwright-core/browsers.json"

if [ ! -f "$BROWSERS_JSON" ]; then
  echo "::error::symlink-playwright-browsers: $BROWSERS_JSON not found — run npm ci first" >&2
  exit 2
fi

if [ ! -d "$PW_PATH" ]; then
  echo "::warning::symlink-playwright-browsers: $PW_PATH does not exist — nothing to link from, skipping"
  exit 0
fi

expected_rev() {
  # $1 = playwright-core browser name, e.g. chromium | chromium-headless-shell
  python3 -c "
import json, sys
d = json.load(open('$BROWSERS_JSON'))
for b in d['browsers']:
    if b['name'] == '$1':
        print(b['revision'])
        sys.exit(0)
sys.exit(1)
"
}

link_one() {
  # $1 = playwright-core browser name (chromium | chromium-headless-shell)
  # $2 = directory prefix under PW_PATH (chromium | chromium_headless_shell)
  # $3 = subfolder name inside the revision dir that must exist/be linked
  pw_name="$1"
  prefix="$2"
  subfolder="$3"

  rev="$(expected_rev "$pw_name")" || {
    echo "::warning::symlink-playwright-browsers: no $BROWSERS_JSON entry for $pw_name, skipping"
    return 0
  }

  target_dir="$PW_PATH/${prefix}-${rev}"

  if [ -e "$target_dir/INSTALLATION_COMPLETE" ] && [ -e "$target_dir/$subfolder" ]; then
    echo "symlink-playwright-browsers: ${prefix}-${rev} already present and complete, nothing to do"
    return 0
  fi

  src_dir=""
  for d in "$PW_PATH"/"${prefix}"-*; do
    [ -d "$d" ] || continue
    base="$(basename "$d")"
    other_rev="${base#${prefix}-}"
    [ "$other_rev" = "$rev" ] && continue
    [ -e "$d/INSTALLATION_COMPLETE" ] || continue
    [ -e "$d/$subfolder" ] || continue
    src_dir="$d"
    break
  done

  if [ -z "$src_dir" ]; then
    echo "::warning::symlink-playwright-browsers: no other complete pre-installed ${prefix} build found to link ${rev} from"
    return 0
  fi

  mkdir -p "$target_dir"
  ln -sfn "$src_dir/$subfolder" "$target_dir/$subfolder"
  : > "$target_dir/INSTALLATION_COMPLETE"
  : > "$target_dir/DEPENDENCIES_VALIDATED"
  echo "symlink-playwright-browsers: linked ${prefix}-${rev}/${subfolder} -> ${src_dir}/${subfolder}"
}

link_one "chromium" "chromium" "chrome-linux64"
link_one "chromium-headless-shell" "chromium_headless_shell" "chrome-headless-shell-linux64"

echo "symlink-playwright-browsers: done (webkit/mobile-safari has no pre-installed build in this sandbox class and is intentionally not handled — remains UNVERIFIED)"
