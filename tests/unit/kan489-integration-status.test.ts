/**
 * KAN-489 — the admin monitoring row for the AI provider: "configured" when
 * members can use it (ANTHROPIC_API_KEY set AND LYRA_AI_GIFTS_ENABLED='1'),
 * never the key's value. The SEC-96 list (`getMonitoringIntegrations`) is
 * untouched; the AI row is a separate list the page appends.
 *
 * Review fix (CTL-037 in spirit): getAiIntegrations no longer reads
 * process.env through a default parameter; it takes the boolean from
 * env.aiGiftsConfigured(). The default is exercised through process.env.
 * (Previously asserted getAiIntegrations({ ANTHROPIC_API_KEY: KEY }) → true.)
 */
import { getAiIntegrations, getMonitoringIntegrations } from '@/app/admin/monitoring/integration-status';

const KEY = 'sk-ant-test-KAN489-monitoring-VALUE';

const saved = { key: process.env.ANTHROPIC_API_KEY, sw: process.env.LYRA_AI_GIFTS_ENABLED };
function setEnv(key: string | undefined, sw: string | undefined) {
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  if (sw === undefined) delete process.env.LYRA_AI_GIFTS_ENABLED;
  else process.env.LYRA_AI_GIFTS_ENABLED = sw;
}
afterAll(() => setEnv(saved.key, saved.sw));

describe('getAiIntegrations (KAN-489)', () => {
  it('one row: name, console link, and the boolean it is given', () => {
    expect(getAiIntegrations(true)).toEqual([
      { name: 'Anthropic (AI gift suggestions)', href: 'https://console.anthropic.com', configured: true },
    ]);
    expect(getAiIntegrations(false)[0].configured).toBe(false);
  });

  it('default: configured only with the key AND the switch exactly "1"', () => {
    setEnv(KEY, '1');
    expect(getAiIntegrations()[0].configured).toBe(true);
  });

  it.each([
    ['key absent, switch on', undefined, '1'],
    ['key empty, switch on', '', '1'],
    ['key whitespace, switch on', '  ', '1'],
    ['key set, switch absent', KEY, undefined],
    ['key set, switch "true"', KEY, 'true'],
    ['key set, switch "0"', KEY, '0'],
  ])('default: %s → not configured', (_l, key, sw) => {
    setEnv(key, sw);
    expect(getAiIntegrations()[0].configured).toBe(false);
  });

  it('the key value never appears in the output', () => {
    setEnv(KEY, '1');
    expect(JSON.stringify(getAiIntegrations())).not.toContain(KEY);
    expect(JSON.stringify(getMonitoringIntegrations({ ANTHROPIC_API_KEY: KEY }))).not.toContain(KEY);
  });

  it('the SEC-96 monitoring list is unchanged by the key', () => {
    expect(getMonitoringIntegrations({ ANTHROPIC_API_KEY: KEY }).map((i) => i.name)).toEqual([
      'Sentry (errors)',
      'UptimeRobot (uptime)',
      'Public status page',
    ]);
  });
});
