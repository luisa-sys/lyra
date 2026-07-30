/**
 * KAN-305 — constants, types and pure helpers for the Organise-event wizard.
 *
 * Sibling to the `'use server'` actions file (Gotcha #18): runtime values live
 * here so the action file can export async functions only.
 */

import type { GatheringType } from '@/lib/recommend/convene/types';

export const GATHERING_TYPES: GatheringType[] = [
  'coffee',
  'lunch',
  'dinner',
  'drinks',
  'party',
  'kids_party',
  'meeting',
  'date',
  'walk',
  'cinema',
  'other',
];

export const GATHERING_TYPE_LABELS: Record<GatheringType, string> = {
  coffee: 'Coffee',
  lunch: 'Lunch',
  dinner: 'Dinner',
  drinks: 'Drinks',
  party: 'Party',
  kids_party: "Kids' party",
  meeting: 'Meeting',
  date: 'Date',
  walk: 'Walk',
  cinema: 'Cinema',
  other: 'Other',
};

export const MAX_PROPOSED_SLOTS = 10;
export const MAX_ATTENDEES = 30;
export const MAX_AVAILABILITY_WINDOW_DAYS = 14;

export const DRAFT_LIMITS = { title: 200, description: 2000, dietary: 500, notes: 2000 } as const;

export interface ProposedSlotInput {
  slot_start_iso: string;
  slot_end_iso: string;
}

export interface CreateDraftInput {
  title: string;
  gathering_type: GatheringType;
  description?: string;
  invitee_contact_ids: string[];
  proposed_slots: ProposedSlotInput[];
  target_window_start_iso?: string;
  target_window_end_iso?: string;
  capacity_min?: number;
  capacity_max?: number;
  dietary_summary?: string;
  notes?: string;
}

export interface BusyBlockView {
  start: string;
  end: string;
}

export interface VenueSuggestion {
  venueId: string;
  name: string;
  venueType: string;
  city: string | null;
  score: number;
  reasons: string[];
}

export interface VenueSuggestContext {
  intent: GatheringType;
  anchor?: string | null;
  capacityRequired?: number;
}

/**
 * A contact as the organise wizard consumes it.
 *
 * Lives here rather than in `page.tsx` (BUGS-80 / KAN-414 F2). The wizard needs
 * the type and the page renders the wizard, so declaring it on the page made
 * `page.tsx` <-> `organise-wizard.tsx` the only import cycle left in the tree.
 * It was type-only, so it erased at build time and cost nothing at runtime —
 * which is exactly why it survived: nothing ever went red. `organise-fields.ts`
 * is the module both sides already depend on, so the cycle simply stops
 * existing rather than being suppressed.
 */
export interface WizardContact {
  id: string;
  display_name: string;
  city: string | null;
  has_linked_profile: boolean;
}

export function isGatheringType(v: string): v is GatheringType {
  return (GATHERING_TYPES as string[]).includes(v);
}

/** Coerce a Postgres numeric (which PostgREST may return as a string) to number|null. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
