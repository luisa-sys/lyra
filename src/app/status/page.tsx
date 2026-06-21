/**
 * SEC-4: public service status page.
 *
 * A lightweight, honest status page: it does live server-side health probes
 * (no faked "all systems operational") and links to the deeper uptime history.
 * Server-side probing avoids CORS and keeps the MCP health URL off the client.
 *
 * Public on every environment: exempted from the beta gate in middleware.ts and
 * allow-listed in the Cloudflare maintenance worker so it's reachable even while
 * production shows the waitlist front door.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Check = { name: string; ok: boolean; detail: string };

async function probe(name: string, url: string): Promise<Check> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    return { name, ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message.slice(0, 80) : 'unreachable' };
  }
}

export default async function StatusPage() {
  const checkedAt = new Date().toISOString();

  // The website is operational by virtue of serving this page. The MCP API is
  // probed live. Add further components here as they gain health endpoints.
  const checks: Check[] = [
    { name: 'Website (checklyra.com)', ok: true, detail: 'Serving' },
    await probe('Agent API (mcp.checklyra.com)', 'https://mcp.checklyra.com/health'),
  ];

  const allOk = checks.every((c) => c.ok);

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50 px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-stone-800">Lyra status</h1>
        <div
          className={`mt-4 rounded-xl border px-5 py-4 text-sm font-medium ${
            allOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {allOk ? 'All systems operational' : 'Some systems are degraded — see below'}
        </div>

        <ul className="mt-6 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          {checks.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-4 px-5 py-3">
              <span className="text-sm text-stone-700">{c.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-stone-400">{c.detail}</span>
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    c.ok ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  aria-label={c.ok ? 'operational' : 'degraded'}
                />
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-stone-400">
          Checked {checkedAt}. Live probe — refresh to re-check. Detailed uptime history is tracked
          in UptimeRobot; incident handling follows the Incident Response Runbook.
        </p>
      </div>
    </main>
  );
}
