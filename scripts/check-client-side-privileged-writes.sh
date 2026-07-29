#!/usr/bin/env bash
# scripts/check-client-side-privileged-writes.sh
#
# SEC-109 — regression guard for "a client component writes directly to a table
# whose invariant is enforced server-side".
#
# The defect this exists for: the Convene Disconnect button soft-deleted
# `oauth_connections` straight from the browser under the user's own JWT. The
# row was marked revoked, but the vaulted OAuth refresh token was never revoked,
# because the only code that calls `vaultRevokeRefreshToken` is
# `disconnectConnection` on the server. The UI promised the user "we'll forget
# your tokens immediately" and the code did not keep that promise — a consent
# withdrawal (GDPR Art.7(3)/17) that silently did not happen.
#
# The general shape is what matters, not this one table: a browser-side write
# can only ever touch the row. Any invariant that needs a second action — revoke
# a secret, notify a provider, write an audit row, cascade a soft-delete — is
# lost the moment the write bypasses its server-side owner. RLS does not save
# you here: RLS decides WHO may write WHICH ROW, and has nothing to say about
# what else was supposed to happen alongside.
#
# So: no `'use client'` module may call `.from('<guarded table>').update(`,
# `.insert(`, `.delete(` or `.upsert(`. Reads are fine — they carry no
# invariant. Server actions and route handlers are fine; they are where the
# paired logic lives.
#
# Adding a table here is cheap and is the right move whenever a write to it has
# a server-side counterpart that must not be skipped.
#
# Escape hatch: `// client-write-ok: <reason>` plus a Jira key, on the line or
# the line before. Use it only when the write genuinely carries no invariant.
#
# Run with --self-test to prove the detector still detects.
set -euo pipefail

# Tables whose writes carry a server-side invariant.
GUARDED_TABLES=(
  oauth_connections   # SEC-109: vault refresh-token revoke on disconnect
)

SEARCH_ROOT="${SEARCH_ROOT:-src}"

scan() {
  local root="$1"
  local -a hits=()
  local f table

  # Only 'use client' modules can issue a browser-side write.
  local -a client_files=()
  while IFS= read -r f || [ -n "$f" ]; do
    [ -z "$f" ] && continue
    if head -5 "$f" | grep -Eq "^[[:space:]]*['\"]use client['\"]"; then
      client_files+=("$f")
    fi
  done < <(find "$root" -type f \( -name '*.tsx' -o -name '*.ts' \) 2>/dev/null | sort)

  [ "${#client_files[@]}" -eq 0 ] && return 0

  for f in "${client_files[@]}"; do
    for table in "${GUARDED_TABLES[@]}"; do
      # `.from('table')` followed — possibly across a chained newline — by a
      # write verb. -A2 keeps it readable without a full parser.
      local matched
      matched="$(grep -n -A2 -E "\.from\(['\"]${table}['\"]\)" "$f" 2>/dev/null \
        | grep -E "\.(update|insert|delete|upsert)\(" || true)"
      [ -z "$matched" ] && continue

      # Allow-list: the marker may sit anywhere in the file's guarded block.
      if grep -Eq "client-write-ok:[[:space:]]*.*[A-Z][A-Z0-9]+-[0-9]+" "$f"; then
        continue
      fi
      hits+=("${f}: client-side write to '${table}'")
    done
  done

  if [ "${#hits[@]}" -gt 0 ]; then
    printf '%s\n' "${hits[@]}"
    return 1
  fi
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/src"

  # Fixture 1: the exact SEC-109 defect. MUST be detected.
  cat >"$tmp/src/bad-client.tsx" <<'EOF'
'use client';
import { createClient } from '@/lib/supabase-browser';
export function C({ id }: { id: string }) {
  async function go() {
    const sb = createClient();
    await sb
      .from('oauth_connections')
      .update({ deleted_at: new Date().toISOString(), status: 'revoked' })
      .eq('id', id);
  }
  return <button onClick={go}>x</button>;
}
EOF

  # Fixture 2: a server module doing the same write. MUST NOT be detected.
  cat >"$tmp/src/good-server.ts" <<'EOF'
'use server';
export async function go(id: string, sb: { from: (t: string) => never }) {
  await sb.from('oauth_connections').update({ status: 'revoked' }).eq('id', id);
}
EOF

  # Fixture 3: a client-side READ. MUST NOT be detected.
  cat >"$tmp/src/good-client-read.tsx" <<'EOF'
'use client';
export function R({ sb }: { sb: { from: (t: string) => never } }) {
  return sb.from('oauth_connections').select('id');
}
EOF

  # Fixture 4: allow-listed client write. MUST NOT be detected.
  cat >"$tmp/src/allowed-client.tsx" <<'EOF'
'use client';
// client-write-ok: SEC-109 no server-side invariant on this path
export function A({ sb, id }: { sb: { from: (t: string) => never }; id: string }) {
  return sb.from('oauth_connections').update({ status: 'revoked' }).eq('id', id);
}
EOF

  fail=0

  out="$(scan "$tmp/src" || true)"
  case "$out" in
    *bad-client.tsx*) ;;
    *) echo "SELF-TEST FAIL: did not detect the SEC-109 defect fixture"; fail=1 ;;
  esac
  for must_not in good-server.ts good-client-read.tsx allowed-client.tsx; do
    case "$out" in
      *"$must_not"*) echo "SELF-TEST FAIL: false positive on $must_not"; fail=1 ;;
    esac
  done

  # And the clean case must exit 0.
  rm "$tmp/src/bad-client.tsx"
  if ! scan "$tmp/src" >/dev/null; then
    echo "SELF-TEST FAIL: clean tree did not pass"
    fail=1
  fi

  if [ "$fail" -ne 0 ]; then
    echo "::error::check-client-side-privileged-writes self-test FAILED"
    exit 1
  fi
  echo "check-client-side-privileged-writes: self-test passed (4 fixtures)."
  exit 0
fi

echo "check-client-side-privileged-writes: scanning ${SEARCH_ROOT} for client-side writes to ${#GUARDED_TABLES[@]} guarded table(s)…"
if out="$(scan "$SEARCH_ROOT")"; then
  echo "No client-side writes to guarded tables. ✓"
  exit 0
fi

echo "::error::check-client-side-privileged-writes: a 'use client' module writes directly to a table whose invariant is enforced server-side."
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  echo "::error::  $line"
done <<EOF
$out
EOF
cat <<'MSG'

A browser-side write can only touch the row. Anything that must happen
alongside it — revoking a vaulted secret, notifying the provider, writing an
audit row — is silently skipped. RLS does not help: it governs which row you
may write, not what else was supposed to happen.

Route the write through the server action or API route that owns the
invariant. If this particular write genuinely carries none, allow-list it:

  // client-write-ok: <JIRA-KEY> <reason>

See SEC-109 for the original defect.
MSG
exit 1
