/**
 * Convene gathering state machine — KAN-208 (Phase 4).
 *
 * Canonical states + transitions for a gathering. Used by:
 *   - lyra_create_gathering (initial state: draft)
 *   - lyra_update_gathering (must be in draft|live to edit fields)
 *   - lyra_finalise_gathering (draft → live, with slot + venue locked)
 *   - lyra_reschedule_gathering (P6: live → live with new slot)
 *   - lyra_cancel_gathering (P6: any non-terminal → cancelled)
 *   - post-event reconciliation (P8: live → completed)
 *
 * Reject invalid transitions with a structured error so the agent gets a
 * clear "you can't do X from state Y" instead of a corrupted DB.
 */

export type GatheringStatus =
  | 'draft'
  | 'awaiting_responses'
  | 'live'
  | 'rescheduled'
  | 'cancelled'
  | 'completed';

export type GatheringTransition =
  | 'finalise' //  draft → awaiting_responses | live
  | 'mark_live' //  awaiting_responses → live (when invite threshold hit / P5)
  | 'reschedule' //  live → rescheduled  (P6)
  | 'cancel' //    any non-terminal → cancelled
  | 'complete' //  live → completed (P8, after the event)
  | 'reopen' //    rescheduled → live (after new slot accepted, P6);

const VALID: Record<GatheringStatus, Partial<Record<GatheringTransition, GatheringStatus>>> = {
  draft: {
    finalise: 'live', // P4: skip awaiting_responses; P5 will introduce it
    cancel: 'cancelled',
  },
  awaiting_responses: {
    mark_live: 'live',
    cancel: 'cancelled',
  },
  live: {
    reschedule: 'rescheduled',
    cancel: 'cancelled',
    complete: 'completed',
  },
  rescheduled: {
    reopen: 'live',
    cancel: 'cancelled',
  },
  cancelled: {}, // terminal
  completed: {}, // terminal
};

export class InvalidTransitionError extends Error {
  readonly from: GatheringStatus;
  readonly transition: GatheringTransition;

  constructor(from: GatheringStatus, transition: GatheringTransition) {
    super(`Invalid transition "${transition}" from state "${from}"`);
    this.from = from;
    this.transition = transition;
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Apply a transition. Returns the next status, or throws InvalidTransitionError.
 */
export function applyTransition(
  current: GatheringStatus,
  transition: GatheringTransition
): GatheringStatus {
  const next = VALID[current]?.[transition];
  if (!next) throw new InvalidTransitionError(current, transition);
  return next;
}

/**
 * Whether a transition is allowed from a given state (no exception).
 */
export function canTransition(
  current: GatheringStatus,
  transition: GatheringTransition
): boolean {
  return VALID[current]?.[transition] !== undefined;
}

/**
 * Which transitions are available from this state. Useful for UI button-enable.
 */
export function availableTransitions(current: GatheringStatus): GatheringTransition[] {
  return Object.keys(VALID[current] ?? {}) as GatheringTransition[];
}

/**
 * Whether the gathering's *fields* can still be edited via lyra_update_gathering.
 * Terminal states (cancelled, completed) and rescheduled lock the record.
 */
export function isFieldEditable(current: GatheringStatus): boolean {
  return current === 'draft' || current === 'live' || current === 'awaiting_responses';
}
