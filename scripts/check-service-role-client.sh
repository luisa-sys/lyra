#!/usr/bin/env bash
# scripts/check-service-role-client.sh
#
# KAN-352 (finding web-arch-4): the service-role Supabase client bypasses ALL
# row-level security — it is the most security-sensitive client in the app.
# It used to be hand-rolled inline in ~30 files with drifting options, so a
# hardening change had to be applied everywhere and was easy to miss.
#
# It now lives in exactly one hardened factory: src/modules/platform/supabase-service.ts
# (`createServiceRoleClient()`). This guard enforces that invariant statically
# by forbidding any call to `env.supabaseServiceRoleKey()` outside that factory
# — you cannot construct a service-role client without the key, so if the key is
# only reachable from the factory, every service-role client must go through it.
#
# Allow-list: append `// service-role-ok: <reason>` to a line to skip it (use
# only with explicit justification, e.g. a second hardened factory).

set -euo pipefail

FACTORY='src/modules/platform/supabase-service.ts'

# Every call site of the service-role key getter. The env DEFINITION in
# src/modules/platform/env.ts is `supabaseServiceRoleKey: () => …` (no leading dot), so the
# `\.` anchor matches only *calls* (`env.supabaseServiceRoleKey()`), never the
# definition.
# grep exits 1 for "no match" — the answer we want — but >=2 when the search
# ITSELF failed. A bare `|| true` here makes those two indistinguishable, and
# this control's clean result is an EMPTY match list: an unreadable src/ would
# print "All service-role clients go through the factory" and pass a
# security gate that never ran. That is the KAN-167 false-green class (and the
# SEC-79 shape: a control reporting green while disabled). Exit 2 = unverified.
# ---------------------------------------------------------------------------
# Portability precondition (SEC-109). The exit-code check below cannot carry
# this on its own: GNU grep (Linux/CI) returns 2 when a search path does not
# exist, but BSD grep (macOS) returns 1 — indistinguishable from "no match".
# So on a developer Mac an absent src/ read as a CLEAN SCAN and this control
# reported green while searching nothing: exactly the SEC-79 false-green it
# exists to prevent. Verified 2026-08-08 against /usr/bin/grep. Testing the
# path directly is dialect-independent and true on both platforms.
if [ ! -d src ] || [ ! -r src ]; then
  echo "::error::check-service-role-client: src/ is missing or unreadable, so the search command failed to run."
  echo "::error::  Failing closed (exit 2) rather than reporting a clean scan that never ran."
  exit 2
fi

if MATCHES="$(grep -rnE '\.supabaseServiceRoleKey\(\)' --include='*.ts' --include='*.tsx' src/ 2>&1)"; then
  GREP_RC=0
else
  GREP_RC=$?
fi
if [ "$GREP_RC" -gt 1 ]; then
  echo "::error::check-service-role-client: the search command failed (exit ${GREP_RC}): ${MATCHES}"
  echo "::error::  Failing closed (exit 2) rather than reporting a clean scan that never ran."
  exit 2
fi
[ "$GREP_RC" -eq 1 ] && MATCHES=""

VIOLATIONS=0
while IFS=: read -r file linenum content; do
  [ -z "$file" ] && continue
  # The factory itself is the one legal home.
  if [ "$file" = "$FACTORY" ]; then
    continue
  fi
  # Allow-list comment.
  if echo "$content" | grep -q 'service-role-ok'; then
    continue
  fi
  echo "::error file=$file,line=$linenum::Inline service-role client construction. Use createServiceRoleClient() from @/modules/platform/supabase-service instead. See KAN-352. → $(echo "$content" | sed 's/^[[:space:]]*//')"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<EOF
$MATCHES
EOF

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "::error::Found $VIOLATIONS inline service-role client construction(s) outside $FACTORY."
  echo "Route all service-role usage through createServiceRoleClient() (@/modules/platform/supabase-service). See KAN-352."
  exit 1
fi

echo "All service-role clients go through $FACTORY. ✓"
