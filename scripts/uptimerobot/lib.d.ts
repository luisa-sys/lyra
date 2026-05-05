/**
 * KAN-163: TypeScript declarations for the UptimeRobot bootstrap library.
 *
 * The runtime is plain JavaScript (CommonJS) so `node scripts/uptimerobot/
 * bootstrap.js` works without compilation. These declarations exist purely
 * so jest + ESLint can typecheck the test file. Keep in sync with lib.js.
 */

export const API_BASE: string;

export const MONITOR_TYPE: {
  readonly HTTP: 1;
  readonly KEYWORD: 2;
  readonly PING: 3;
  readonly PORT: 4;
  readonly HEARTBEAT: 5;
};

export const ALERT_CONTACT_TYPE: {
  readonly SMS: 1;
  readonly EMAIL: 2;
  readonly TWITTER: 3;
  readonly WEBHOOK: 5;
  readonly PUSHBULLET: 6;
  readonly ZAPIER: 7;
  readonly PUSHOVER: 9;
  readonly HTTP_NOTIFICATION: 10;
  readonly VOICE_CALL: 11;
  readonly SLACK: 11;
};

export const FIVE_MINUTES: 300;

export interface MonitorSpec {
  readonly friendlyName: string;
  readonly url: string;
}
export const LYRA_MONITORS: readonly MonitorSpec[];

export function makeFormBody(obj: Record<string, unknown>): string;

export interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<MockResponse>;

export interface MakeClientArgs {
  apiKey?: string;
  httpClient?: HttpClient;
}

export interface UptimeRobotClient {
  getAccountDetails(): Promise<{
    stat: 'ok';
    account: {
      email?: string;
      monitor_limit?: number;
      up_monitors?: number;
      down_monitors?: number;
      paused_monitors?: number;
    };
  }>;
  getAlertContacts(): Promise<{
    stat: 'ok';
    alert_contacts?: Array<{ id: number; type: number; value: string; status: number }>;
  }>;
  newAlertContact(input: {
    friendlyName: string;
    type: number;
    value: string;
  }): Promise<{ stat: 'ok'; alertcontact?: { id: number } }>;
  getMonitors(search?: string): Promise<{
    stat: 'ok';
    monitors?: Array<{ id: number; friendly_name: string; url: string; status?: number }>;
  }>;
  newMonitor(input: {
    friendlyName: string;
    url: string;
    alertContacts: string;
    type?: number;
    interval?: number;
    sslExpirationReminder?: number;
    timeout?: number;
    httpMethodType?: number;
  }): Promise<{ stat: 'ok'; monitor?: { id: number } }>;
  editMonitor(input: {
    id: number;
    alertContacts?: string;
    interval?: number;
    sslExpirationReminder?: number;
  }): Promise<{ stat: 'ok' }>;
}

export function makeClient(args: MakeClientArgs): UptimeRobotClient;

export interface ExistingMonitor {
  id: number;
  friendly_name: string;
  url: string;
}

export interface MonitorDiff {
  toCreate: MonitorSpec[];
  toUpdate: Array<{
    id: number;
    friendlyName: string;
    currentUrl: string;
    desiredUrl: string;
    reason: 'url-mismatch';
  }>;
  unchanged: Array<{ id: number; friendlyName: string }>;
}

export function planMonitorDiff(
  existing: ExistingMonitor[] | null | undefined,
  desired: readonly MonitorSpec[]
): MonitorDiff;

export interface ExistingContact {
  id: number;
  type: number;
  value: string;
  status: number;
}

export interface ContactDiff {
  toCreate: Array<{ value: string }>;
  present: Array<{ id: number; value: string; status: number }>;
}

export function planContactDiff(
  existing: ExistingContact[] | null | undefined,
  desiredEmails: string[]
): ContactDiff;
