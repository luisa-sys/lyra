# Affiliate reconciliation playbook (KAN-195)

> Monthly checklist Luisa runs to make sure Lyra is being paid the commission Sovrn (and future affiliate networks) owe us. Don't skip the variance check — that's where networks "lose" small commissions and never report them unless we push back.

The reconciliation cron at `scripts/reconcile-affiliate-clicks.ts` runs nightly and patches the per-click conversion fields in `affiliate_clicks`. This playbook is what you do once a month on top of that.

---

## Monthly checklist

### 1. Pull the dashboard headline

Visit `https://checklyra.com/admin/affiliate-reporting` (or `dev.checklyra.com` if you're sanity-checking outside prod). Note:

- **Last 30 days clicks** — should track roughly with site traffic. Big spikes warrant a look at the daily breakdown.
- **Conversions** — should appear within 24-48h of a real click on a monetised link. If you see 0 with non-zero clicks for >3 days **AND** Sovrn shows non-zero in their dashboard, the reconciliation cron is broken — open a BUGS ticket.
- **EPC** — Lyra's per-click value. Use this to prioritise merchants in the curated catalogue (KAN-200) and to spot under-performing recommendations.

### 2. Compare against Sovrn's dashboard

Log into Sovrn Commerce (https://commerce.sovrn.com). Look at the same 30-day window:

- **Sovrn clicks** vs **our affiliate_clicks count for provider=sovrn**: they should match to within ~2%. Sovrn drops clicks where the redirect failed or the bot heuristic kicked in. **A delta >5% means something is structurally wrong** — likely on our side (SubID mismatch, double-counting, click logging not reaching Supabase).
- **Sovrn commission** vs **our `commission_gbp` sum**: should match to within FX rounding (~0.5%). If the gap is bigger, check:
  - Are any conversions in Sovrn that aren't in our `affiliate_clicks`? (Likely cause: click logging dropped the row but the user still completed a purchase.)
  - Are any conversions in our log that Sovrn doesn't have? (Likely cause: the user clicked a link with our SubID but Sovrn's tracking failed.)

### 3. Investigate variances > 5%

For each merchant where the delta exceeds 5%:

1. Pull the Sovrn report CSV for that merchant for the period.
2. Run a join query against our `affiliate_clicks`:

    ```sql
    SELECT
      ac.click_id,
      ac.merchant_id,
      ac.created_at AS our_click_time,
      ac.converted_at AS our_converted_at,
      ac.commission_gbp AS our_commission_gbp
    FROM public.affiliate_clicks ac
    WHERE ac.merchant_id = '<merchant>'
      AND ac.provider = 'sovrn'
      AND ac.created_at >= NOW() - INTERVAL '40 days'
    ORDER BY ac.created_at DESC;
    ```

3. Identify rows missing from either side. Patterns:
   - **Sovrn-only**: rows where Sovrn reports a click that we don't have → our logging dropped. Check Sentry for `[affiliate-link-service] click log failed` warnings around that time.
   - **Ours-only**: rows we have a click for but Sovrn doesn't → Sovrn's tracking failed. Common cause: the redirect was blocked by ad-blockers / browser tracking protection. No action; this is the cost of doing business.
   - **Both, different amounts**: usually FX drift between our daily-rate conversion and Sovrn's. Tolerated up to ~1%; investigate beyond.

### 4. Email Sovrn if needed

If you find a structural issue (e.g. Sovrn isn't tracking a specific merchant), email `publishers@sovrn.com` with:
- Lyra's publisher ID
- The merchant in question
- An example SubID from our log that they should have but don't
- The expected click count from your CSV

Average reply time: 2-3 business days.

### 5. Update the catalogue

After each monthly review, update the curated catalogue in `recommender_catalogue` (KAN-200):
- Bump `weight` for the top 5 merchants by EPC
- Reduce `weight` or set `is_active=false` for any merchant with anomalously low EPC + high click count (signals the recommendations don't convert)

### 6. Archive the dashboard snapshot

Take a screenshot (or export the page as PDF) of `/admin/affiliate-reporting` at month-end. File it under the company's accounting records. Required for VAT / corporation-tax filing once Lyra is a registered business.

---

## Edge cases

### Sovrn is down or returning empty for >24h

The reconciliation cron will silently produce zero updates. The dashboard will show last-known-good conversion data. **This is not a bug** — the cron is idempotent and will catch up once Sovrn returns. If Sovrn is down for >7 days, the overlap window (also 7 days) starts dropping rows. At that point: raise with Sovrn support immediately and increase the cron's lookback window manually for a one-off catch-up run.

### FX rate API is down

`convertToGbp` falls back to the hardcoded approximate rates in `src/lib/affiliate/fx.ts`. The variance check (step 2 above) will catch any material drift. If the API is down for >30 days, update the hardcoded rates from a current ECB snapshot.

### A new affiliate network goes live (Phase 2: Amazon direct, KAN-196)

Add the new network's report fetch to `scripts/reconcile-affiliate-clicks.ts`. Each network needs:
- Its own SubID prefix parser (e.g. `lyra-amzn-<id>` for Amazon direct)
- Its own API client
- Its own row in `affiliate_clicks.provider`

The dashboard's provider-split table will auto-pick up the new value once the first click is logged.

---

## When this playbook needs updating

- New affiliate network goes live → add a new section under "When a new affiliate network goes live"
- We pass meaningful revenue (£10k+/month) → upgrade to formal monthly close instead of ad-hoc review
- We register as a UK Ltd → archive procedure becomes a statutory requirement, not a nice-to-have
