#!/usr/bin/env bash
#
# security-alert-email.sh — send a daily-security-check FAIL alert via Resend.
# Called by the cloud routine (docs/DAILY_SECURITY_CHECK_ROUTINE.md) ONLY when a
# run has a FAIL/🔴. It just sends an email; it does not touch the app.
#
# Usage:
#   echo "summary text" | bash scripts/security-alert-email.sh "Subject line"
#   bash scripts/security-alert-email.sh "Subject" < summary.txt
#
# Env:
#   RESEND_API_KEY   (required) — fails LOUD if missing (never silent-skip)
#   ALERT_TO         (default luisa@santos-stephens.com)
#   ALERT_FROM       (default security@checklyra.com — must be Resend-verified)
#
# Exit: 0 on a 2xx from Resend; 1 on any misconfig or non-2xx (fail loud).
#
# NB: `set -e` is off; we handle each step explicitly and never swallow an error.
set -uo pipefail

SUBJECT="${1:-Lyra daily security check: FAIL}"
TO="${ALERT_TO:-luisa@santos-stephens.com}"
FROM="${ALERT_FROM:-security@checklyra.com}"

if [ -z "${RESEND_API_KEY:-}" ]; then
  echo "::error:: RESEND_API_KEY not set — cannot send the security alert. Failing loud (no silent-skip)." >&2
  exit 1
fi

BODY="$(cat)"
[ -z "$BODY" ] && BODY="(no body provided)"

# Build the JSON payload safely (python3 is pre-installed; avoids quoting bugs).
payload="$(BODY="$BODY" SUBJECT="$SUBJECT" TO="$TO" FROM="$FROM" python3 - <<'PY'
import json, os
print(json.dumps({
    "from": os.environ["FROM"],
    "to": [os.environ["TO"]],
    "subject": os.environ["SUBJECT"],
    "text": os.environ["BODY"],
}))
PY
)" || { echo "::error:: failed to build email payload" >&2; exit 1; }

resp="$(curl -sS -w '\n%{http_code}' --max-time 30 \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer ${RESEND_API_KEY}" \
  -H 'Content-Type: application/json' \
  --data "$payload" 2>/dev/null)" || { echo "::error:: Resend request failed (network)" >&2; exit 1; }

code="$(printf '%s' "$resp" | tail -n1)"
out="$(printf '%s' "$resp" | sed '$d')"

if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  echo "alert sent (HTTP $code): $out"
  exit 0
fi

echo "::error:: Resend returned HTTP $code: $out" >&2
exit 1
