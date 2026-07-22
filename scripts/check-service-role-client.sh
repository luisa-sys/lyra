#!/usr/bin/env bash
# scripts/check-service-role-client.sh
#
# KAN-352 (finding web-arch-4): the service-role Supabase client bypasses ALL
# row-level security — it is the most security-sensitive client in the app.
# It used to be hand-rolled inline in ~30 files with drifting options, so a
# hardening change had to be applied everywhere and was easy to miss.
#
# It now lives in exactly one hardened factory: src/lib/supabase-service.ts
# (`createServiceRoleClient()`). This guard enforces that invariant statically
# by forbidding any call to `env.supabaseServiceRoleKey()` outside that factory
# — you cannot construct a service-role client without the key, so if the key is
# only reachable from the factory, every service-role client must go through it.
#
# Allow-list: append `// service-role-ok: <reason>` to a line to skip it (use
# only with explicit justification, e.g. a second hardened factory).

set -euo pipefail

FACTORY='src/lib/supabase-service.ts'

# Every call site of the service-role key getter. The env DEFINITION in
# src/lib/env.ts is `supabaseServiceRoleKey: () => …` (no leading dot), so the
# `\.` anchor matches only *calls* (`env.supabaseServiceRoleKey()`), never the
# definition.
MATCHES=$(
  grep -rnE '\.supabaseServiceRoleKey\(\)' --include='*.ts' --include='*.tsx' src/ 2>/dev/null || true
)

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
  echo "::error file=$file,line=$linenum::Inline service-role client construction. Use createServiceRoleClient() from @/lib/supabase-service instead. See KAN-352. → $(echo "$content" | sed 's/^[[:space:]]*//')"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<EOF
$MATCHES
EOF

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "::error::Found $VIOLATIONS inline service-role client construction(s) outside $FACTORY."
  echo "Route all service-role usage through createServiceRoleClient() (@/lib/supabase-service). See KAN-352."
  exit 1
fi

echo "All service-role clients go through $FACTORY. ✓"
