# Affiliate monetisation — smoke monitor & triage runbook

Internal ops doc. Covers the hourly **Affiliate link smoke** monitor
(KAN-194) and what to do when it fires. Referenced by
`.github/workflows/affiliate-link-smoke.yml` and
`scripts/smoke-affiliate-links.ts`.

## What the monitor does

For every `(merchant × buyer-country)` in `SMOKE_PROBES`
(`src/modules/affiliate/smoke.ts`), the hourly workflow probes the merchant's
representative URL and asserts the final landing host is the correct
localised storefront for that country. It exits non-zero (red workflow +
admin email) when `shouldAlert` is true.

### Probe logic (BUGS-23)

Each probe is a **bounded HEAD with a single bounded GET fallback**
(`probeUrl()`), 5s per attempt:

| HEAD result | Action | Classified as |
|---|---|---|
| `2xx` | — | **reachable** (assert host) |
| `403` / `405` / `429` | retry with GET | see GET row |
| timeout (abort) | retry with GET | see GET row |
| `5xx`, `404`, `410`, other 4xx | — | **genuine failure** (pages) |
| DNS / connection / TLS error | — | **genuine failure** (pages) |

| GET result (only after a HEAD bot-wall/timeout) | Classified as |
|---|---|
| `2xx` | **reachable** (assert host) |
| `403` / `429` | **inconclusive — bot-walled** (does NOT page) |
| timeout (abort) | **inconclusive — bot-walled** (does NOT page) |
| `5xx` / `404` / `405` / other | **genuine failure** (pages) |
| wrong final host (any 2xx) | **genuine failure** (pages) |

**Why the inconclusive bucket exists.** GitHub Actions runner IPs are
data-centre IPs that some merchants (notably **John Lewis**, behind Akamai)
tarpit or 403 regardless of HTTP method — see gotcha #7. From such an IP we
cannot distinguish "merchant is down" from "merchant is refusing our bot".
Paging on that is a false positive, and (per the Workflow & Backup Integrity
Policy) a monitor that cries wolf destroys trust. So a merchant that
bot-walls **both** HEAD and GET is reported as `INCONCLUSIVE` and does **not**
page — while a *determinate* outage (5xx, connection refused, wrong host)
still pages. The monitor is not weakened; it is honest about what a
data-centre probe can prove.

## When the smoke monitor fires

The workflow only exits non-zero when `shouldAlert` is true, which now means
**a genuine failure** — never an inconclusive bot-wall. Triage:

1. **Open the run's artifact** (`smoke-summary.json`) or read the job log.
   - `Merchants fully down:` — a merchant with zero passes and ≥1 *genuine*
     failure. This is the real signal.
   - `INCONCLUSIVE (bot-walled, not alerting):` — merchants we couldn't
     verify from CI. These did **not** cause the alert; they're logged so a
     long-term merchant loss can't hide behind "bot-blocked" forever.
2. **For a fully-down merchant**, check the `failureReason`:
   - `head_http_5xx` / `get_http_5xx` → merchant outage. Confirm from a
     normal browser; if genuinely down, it's an upstream incident — no code
     change, note it and re-check next hour.
   - `unexpected_host` → the redirect chain landed on the wrong domain. This
     is a real monetisation defect (Sovrn misconfig, wrong representative
     URL, merchant domain change). Investigate the link service / probe URL.
   - `error:*` (DNS/connection/TLS) → DNS or cert problem at the merchant.
3. **For an inconclusive merchant that stays inconclusive for days**, decide
   with the founder whether that merchant is still worth carrying in the
   matrix, or whether it needs a residential-egress probe. Do **not** silence
   it by deleting the probe or treating timeouts as passes.

## What NOT to do

- Do **not** bump the per-attempt timeout to make johnlewis "pass".
- Do **not** treat a timeout or 403 as a success.
- Do **not** drop johnlewis (or any merchant) from `SMOKE_PROBES` to quiet
  the alert.
- Do **not** weaken or delete the smoke unit tests
  (`tests/unit/affiliate-smoke.test.ts`).

Any of the above would mask a real "merchant unreachable" condition — the
exact false-negative the Workflow & Backup Integrity Policy forbids.
