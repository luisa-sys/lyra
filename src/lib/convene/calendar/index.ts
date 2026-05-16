/**
 * Calendar adapter registry (KAN-206).
 *
 * `adapterFor(provider)` returns the canonical CalendarAdapter for a given
 * provider. P7 adds microsoft + caldav_generic.
 */

import type { CalendarAdapter } from './types';
import { googleCalendarAdapter } from './google';

const adapters: Partial<Record<string, CalendarAdapter>> = {
  google: googleCalendarAdapter,
};

export function adapterFor(provider: string): CalendarAdapter {
  const a = adapters[provider];
  if (!a) {
    throw new Error(
      `No calendar adapter for provider "${provider}" (supported: ${Object.keys(adapters).join(', ')})`
    );
  }
  return a;
}

export type { CalendarAdapter, TimeWindow, BusyBlock, GatheringEventData } from './types';
