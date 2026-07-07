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

/**
 * SEC-58 busy-time consent context. Passed to `getFreeBusy` so the adapter can
 * enforce the SEC-18 sharing opt-in before disclosing another user's calendar.
 *
 * Omit it only when the caller is reading its OWN calendar; supplying it (with
 * `viewerUserId === ownerUserId`) is the safe default and always permitted.
 * When `viewerUserId !== ownerUserId` the adapter refuses unless the owner has
 * consented (fail-closed).
 */
export interface BusyTimeViewer {
  /** The user requesting the busy-times (the "viewer"). */
  viewerUserId: string;
  /** The user who OWNS the calendar connection being read (the "target"). */
  ownerUserId: string;
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
  /**
   * Read busy/free blocks for the user's primary calendar in a window.
   *
   * When `viewer` is supplied and `viewer.viewerUserId !== viewer.ownerUserId`,
   * the adapter enforces the SEC-58 busy-time consent gate before fetching and
   * throws `BusyTimeConsentError` if the owner has not opted in. Omitting
   * `viewer` (or passing viewer === owner) reads the caller's own calendar.
   */
  getFreeBusy(
    connectionId: string,
    window: TimeWindow,
    viewer?: BusyTimeViewer
  ): Promise<BusyBlock[]>;

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
