/**
 * Canonical calendar adapter interface (KAN-206).
 *
 * Every calendar provider (Google, Microsoft Graph, Apple CalDAV, generic
 * CalDAV) implements this. Higher-level Convene code consumes only this
 * interface — provider-specific logic stays in the adapter file.
 *
 * P2 ships the Google implementation. Microsoft + CalDAV in P7.
 */

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface BusyBlock {
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  optional?: boolean;
}

export interface GatheringEventData {
  title: string;
  description?: string;
  startISO: string; // ISO 8601 UTC
  endISO: string; // ISO 8601 UTC
  location?: string;
  attendees?: CalendarAttendee[];
}

export interface CalendarAdapter {
  /** Read busy/free blocks for the user's primary calendar in a window. */
  getFreeBusy(connectionId: string, window: TimeWindow): Promise<BusyBlock[]>;

  /** Create a calendar event on the user's primary calendar. */
  createEvent(
    connectionId: string,
    data: GatheringEventData
  ): Promise<{ providerEventId: string }>;

  /** Update an existing event. providerEventId is the value returned by createEvent. */
  updateEvent(
    connectionId: string,
    providerEventId: string,
    data: GatheringEventData
  ): Promise<void>;

  /** Delete an event. Idempotent — silently ignores already-deleted events. */
  deleteEvent(connectionId: string, providerEventId: string): Promise<void>;

  /** Revoke OAuth refresh + access tokens at the provider. Best-effort. */
  revokeAtProvider(connectionId: string): Promise<void>;
}

export interface AdapterError extends Error {
  /** Network/transient — caller may retry with backoff. */
  retryable?: boolean;
  /** Provider HTTP status (if any). */
  status?: number;
}
