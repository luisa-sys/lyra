/**
 * KAN-195: affiliate reporting dashboard.
 *
 * Single page in the admin area showing:
 *   - Headline summary card (last 30 days): clicks, conversions, total
 *     commission GBP, EPC
 *   - Provider split (sovrn / amazon_direct / raw)
 *   - Source split (web / mcp / email)
 *   - Daily merchant rollup table (last 30 days, paginated visually by
 *     showing the top 50 rows; the full export is via the reconciliation
 *     cron's CSV output in a future ticket)
 *
 * Reads from `affiliate_clicks` (KAN-189 schema). Until Sovrn is live
 * (KAN-184) and the nightly reconciliation cron (this PR) has populated
 * conversion data, the numbers are clicks-only and `commissionGbp` is 0.
 * That's correct behaviour — the dashboard isn't lying, it's reflecting
 * the un-monetised state.
 *
 * Auth: admin-only via getCurrentAdmin() — same pattern as the rest of
 * the /admin pages (KAN-141).
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentAdmin, getAdminServiceClient } from '@/lib/admin';
import {
  rollupByDailyMerchant,
  splitByProvider,
  splitBySource,
  type DailyMerchantRollup,
  type ProviderSplit,
  type SourceSplit,
} from '@/lib/affiliate/reporting';
import type { AffiliateClickRow } from '@/lib/affiliate/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Affiliate reporting — Lyra admin',
};

async function getClicksLast30Days(): Promise<AffiliateClickRow[]> {
  const supabase = getAdminServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('affiliate_clicks')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10000); // safety cap; if we ever hit this we move to a streaming aggregation
  return (data ?? []) as AffiliateClickRow[];
}

function fmtGbp(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export default async function AffiliateReportingPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect('/login');

  const rows = await getClicksLast30Days();

  // Headline summary
  const totalClicks = rows.length;
  const totalConversions = rows.filter((r) => r.converted_at).length;
  const totalCommissionGbp = rows.reduce((sum, r) => {
    const v = r.commission_gbp;
    if (v == null) return sum;
    const n = typeof v === 'number' ? v : Number(v);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;
  const epc = totalClicks > 0 ? totalCommissionGbp / totalClicks : 0;

  const dailyRollups = rollupByDailyMerchant(rows).slice(0, 50);
  const providerSplits = splitByProvider(rows);
  const sourceSplits = splitBySource(rows);

  const hasAnyConversions = totalConversions > 0;

  return (
    <main className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200/60 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/admin" className="text-sm text-stone-600 hover:text-stone-800">
            &larr; Admin
          </Link>
          <h1 className="text-base font-medium">Affiliate reporting</h1>
          <span className="text-xs text-[var(--color-muted)]">Last 30 days</span>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {!hasAnyConversions && (
          <div className="rounded-lg border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700">
            No conversions yet. This is expected until <code>SOVRN_API_KEY</code> is set
            (<a href="https://checklyra.atlassian.net/browse/KAN-184" className="underline">KAN-184</a>)
            and the nightly reconciliation cron has run at least once. Clicks are still
            being logged — see the daily breakdown below.
          </div>
        )}

        {/* Headline */}
        <section aria-labelledby="headline-heading">
          <h2 id="headline-heading" className="text-sm font-medium uppercase tracking-wider text-stone-500 mb-3">
            Headline
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Clicks" value={totalClicks.toString()} />
            <SummaryCard label="Conversions" value={totalConversions.toString()} secondary={fmtPct(conversionRate)} />
            <SummaryCard label="Commission" value={fmtGbp(totalCommissionGbp)} />
            <SummaryCard label="EPC" value={fmtGbp(epc)} secondary="per click" />
          </div>
        </section>

        {/* Provider split */}
        <section aria-labelledby="provider-heading">
          <h2 id="provider-heading" className="text-sm font-medium uppercase tracking-wider text-stone-500 mb-3">
            By provider
          </h2>
          <ProviderSplitTable rows={providerSplits} />
        </section>

        {/* Source split */}
        <section aria-labelledby="source-heading">
          <h2 id="source-heading" className="text-sm font-medium uppercase tracking-wider text-stone-500 mb-3">
            By source surface
          </h2>
          <SourceSplitTable rows={sourceSplits} />
        </section>

        {/* Daily merchant breakdown */}
        <section aria-labelledby="daily-heading">
          <h2 id="daily-heading" className="text-sm font-medium uppercase tracking-wider text-stone-500 mb-3">
            Daily &times; merchant &times; country (top 50 rows)
          </h2>
          <DailyMerchantTable rows={dailyRollups} />
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wider text-stone-500">{label}</p>
      <p className="text-2xl font-medium text-stone-900 mt-1">{value}</p>
      {secondary ? <p className="text-xs text-stone-500 mt-0.5">{secondary}</p> : null}
    </div>
  );
}

function ProviderSplitTable({ rows }: { rows: ProviderSplit[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">No clicks yet.</p>;
  }
  return (
    <table className="w-full text-sm border border-stone-200 rounded-lg overflow-hidden">
      <thead className="bg-stone-100">
        <tr>
          <th className="text-left px-3 py-2">Provider</th>
          <th className="text-right px-3 py-2">Clicks</th>
          <th className="text-right px-3 py-2">Conversions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.provider} className="border-t border-stone-100">
            <td className="px-3 py-2 font-mono text-xs">{r.provider}</td>
            <td className="px-3 py-2 text-right">{r.clicks}</td>
            <td className="px-3 py-2 text-right">{r.conversions}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceSplitTable({ rows }: { rows: SourceSplit[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">No clicks yet.</p>;
  }
  return (
    <table className="w-full text-sm border border-stone-200 rounded-lg overflow-hidden">
      <thead className="bg-stone-100">
        <tr>
          <th className="text-left px-3 py-2">Source</th>
          <th className="text-right px-3 py-2">Clicks</th>
          <th className="text-right px-3 py-2">Conversions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.source} className="border-t border-stone-100">
            <td className="px-3 py-2 font-mono text-xs">{r.source}</td>
            <td className="px-3 py-2 text-right">{r.clicks}</td>
            <td className="px-3 py-2 text-right">{r.conversions}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DailyMerchantTable({ rows }: { rows: DailyMerchantRollup[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">No clicks yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-stone-200 rounded-lg overflow-hidden">
        <thead className="bg-stone-100">
          <tr>
            <th className="text-left px-3 py-2">Date</th>
            <th className="text-left px-3 py-2">Merchant</th>
            <th className="text-left px-3 py-2">Buyer country</th>
            <th className="text-right px-3 py-2">Clicks</th>
            <th className="text-right px-3 py-2">Conv.</th>
            <th className="text-right px-3 py-2">CR</th>
            <th className="text-right px-3 py-2">Commission</th>
            <th className="text-right px-3 py-2">EPC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.date}-${r.merchantId}-${r.buyerCountry}`} className="border-t border-stone-100">
              <td className="px-3 py-2 font-mono text-xs">{r.date}</td>
              <td className="px-3 py-2">{r.merchantId ?? '(unknown)'}</td>
              <td className="px-3 py-2">{r.buyerCountry ?? '?'}</td>
              <td className="px-3 py-2 text-right">{r.clicks}</td>
              <td className="px-3 py-2 text-right">{r.conversions}</td>
              <td className="px-3 py-2 text-right">{fmtPct(r.conversionRate)}</td>
              <td className="px-3 py-2 text-right">{fmtGbp(r.commissionGbp)}</td>
              <td className="px-3 py-2 text-right">{fmtGbp(r.epc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
