/**
 * KAN-208 — gathering state machine tests.
 *
 * Covers every valid transition and a representative sample of invalid
 * ones. Static — pure functions, no DB.
 */

import {
  applyTransition,
  canTransition,
  availableTransitions,
  isFieldEditable,
  InvalidTransitionError,
  type GatheringStatus,
  type GatheringTransition,
} from '@/lib/convene/gatherings/state-machine';

describe('gathering state machine (KAN-208)', () => {
  describe('valid transitions', () => {
    const cases: Array<[GatheringStatus, GatheringTransition, GatheringStatus]> = [
      ['draft', 'finalise', 'live'],
      ['draft', 'cancel', 'cancelled'],
      ['awaiting_responses', 'mark_live', 'live'],
      ['awaiting_responses', 'cancel', 'cancelled'],
      ['live', 'reschedule', 'rescheduled'],
      ['live', 'cancel', 'cancelled'],
      ['live', 'complete', 'completed'],
      ['rescheduled', 'reopen', 'live'],
      ['rescheduled', 'cancel', 'cancelled'],
    ];
    test.each(cases)('%s --%s--> %s', (from, t, expected) => {
      expect(applyTransition(from, t)).toBe(expected);
      expect(canTransition(from, t)).toBe(true);
    });
  });

  describe('terminal states reject all transitions', () => {
    const terminals: GatheringStatus[] = ['cancelled', 'completed'];
    const allTransitions: GatheringTransition[] = [
      'finalise',
      'mark_live',
      'reschedule',
      'cancel',
      'complete',
      'reopen',
    ];
    for (const s of terminals) {
      for (const t of allTransitions) {
        test(`${s} rejects ${t}`, () => {
          expect(canTransition(s, t)).toBe(false);
          expect(() => applyTransition(s, t)).toThrow(InvalidTransitionError);
        });
      }
    }
  });

  describe('invalid transitions throw structured errors', () => {
    test('draft cannot complete', () => {
      try {
        applyTransition('draft', 'complete');
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidTransitionError);
        expect((e as InvalidTransitionError).from).toBe('draft');
        expect((e as InvalidTransitionError).transition).toBe('complete');
      }
    });

    test('live cannot finalise twice', () => {
      expect(canTransition('live', 'finalise')).toBe(false);
    });

    test('rescheduled cannot complete directly (must reopen first)', () => {
      expect(canTransition('rescheduled', 'complete')).toBe(false);
    });

    test('error message includes both from-state and attempted transition', () => {
      try {
        applyTransition('cancelled', 'reopen');
        fail('expected throw');
      } catch (e) {
        expect((e as Error).message).toContain('reopen');
        expect((e as Error).message).toContain('cancelled');
      }
    });
  });

  describe('availableTransitions', () => {
    test('returns the right set for draft', () => {
      expect(availableTransitions('draft').sort()).toEqual(['cancel', 'finalise']);
    });
    test('returns the right set for live', () => {
      expect(availableTransitions('live').sort()).toEqual(['cancel', 'complete', 'reschedule']);
    });
    test('terminals return empty', () => {
      expect(availableTransitions('cancelled')).toEqual([]);
      expect(availableTransitions('completed')).toEqual([]);
    });
  });

  describe('isFieldEditable', () => {
    test('editable in draft / live / awaiting_responses', () => {
      expect(isFieldEditable('draft')).toBe(true);
      expect(isFieldEditable('live')).toBe(true);
      expect(isFieldEditable('awaiting_responses')).toBe(true);
    });
    test('locked in rescheduled / cancelled / completed', () => {
      expect(isFieldEditable('rescheduled')).toBe(false);
      expect(isFieldEditable('cancelled')).toBe(false);
      expect(isFieldEditable('completed')).toBe(false);
    });
  });
});
