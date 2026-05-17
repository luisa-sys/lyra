/**
 * Convene recommendation types — KAN-207 (Phase 3).
 *
 * Two recommenders:
 *   scoreAttendee(candidate, intent, host, existingInvitees)
 *   scoreVenue(candidate, intent, attendees, anchor, constraints)
 *
 * Both return a normalised score in [0, 1] plus a `reasons[]` array surfaced
 * to the agent ("why this person", "why this venue") and a `breakdown` map
 * keyed by factor name for debugging + admin UI.
 *
 * Alignment with KAN-199 (v2 gift recommender): same structural pattern —
 * score + breakdown + reasons — but a different domain (people/places vs.
 * products). When the holistic ranker design from KAN-199 lands, this module
 * will adopt its weights/normalisation helpers.
 */

export type GatheringType =
  | 'coffee'
  | 'lunch'
  | 'dinner'
  | 'drinks'
  | 'party'
  | 'kids_party'
  | 'meeting'
  | 'date'
  | 'walk'
  | 'cinema'
  | 'other';

// ─── Attendee scoring ────────────────────────────────────────────────────

export interface AttendeeContext {
  intent: GatheringType;
  /** ISO timestamp of the start of the proposed gathering window. */
  gatheringStartISO?: string;
  /** Other contacts already on the invite list (so we don't re-suggest them). */
  existingInviteeContactIds: string[];
}

export interface AttendeeCandidate {
  contactId: string;
  displayName: string;
  city: string | null;
  /** Whether this contact has a linked Lyra profile (signals MCP-reachability). */
  hasLinkedProfile: boolean;
  /** Tribes the host has assigned this contact to. */
  tribeNames: string[];
  /** Signals from public.relationship_signals (per (host, contact)). */
  signals?: RelationshipSignals;
}

export interface RelationshipSignals {
  totalInvites: number;
  totalAccepted: number;
  totalAttended: number;
  totalDeclined: number;
  totalSilent: number;
  totalNoShows: number;
  lastAttendedAt: string | null;
  lastInvitedAt: string | null;
  gatheringTypeDiversity: number;
  gatheringTypesSeen: string[];
}

export interface AttendeeScore {
  contactId: string;
  score: number;
  reasons: string[];
  breakdown: {
    tribeFit: number;
    recency: number;
    responseHistory: number;
    typeFit: number;
    diversity: number;
  };
  /** When true, candidate is hard-excluded (already on invite list, etc.). */
  excluded?: boolean;
  excludedReason?: string;
}

// ─── Venue scoring ───────────────────────────────────────────────────────

export interface VenueContext {
  intent: GatheringType;
  /** Postcode or "lat,lng" string anchoring the search. */
  anchor: string | null;
  /** Max travel time minutes (host-level pref; default 30 if unset). */
  maxTravelMinutes?: number;
  /** Required headcount (min). */
  capacityRequired: number;
  /** Hard requirements that filter out non-matching venues. */
  required: {
    accessibility?: string[];
    dietary?: string[];
  };
  /** Soft preferences (boost only). */
  preferred: {
    priceTier?: 1 | 2 | 3 | 4;
    cuisine?: string;
  };
}

export interface VenueCandidate {
  venueId: string;
  name: string;
  venueType: string;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  priceTier: number | null;
  capacityEstimate: number | null;
  accessibilityFlags: string[];
  dietaryFlags: string[];
  externalRating: number | null;
  /** Whether the host has visited this venue for a similar gathering before. */
  priorVisits?: number;
  /** Most recent visit timestamp — used for diversity damping. */
  lastVisitedAt?: string | null;
  /** Host's own rating, if any. */
  hostRating?: number | null;
}

export interface VenueScore {
  venueId: string;
  score: number;
  reasons: string[];
  breakdown: {
    typeFit: number;
    distance: number;
    dietaryFit: number;
    capacity: number;
    openingHours: number;
    priceTier: number;
    accessibility: number;
    priorVisits: number;
    diversityPenalty: number;
    externalRating: number;
  };
  /** When set, candidate is hard-filtered out (caller should skip it). */
  hardFilterFailed?: 'accessibility' | 'capacity' | 'dietary';
}

// ─── Shared utilities ────────────────────────────────────────────────────

/** Clamp a number to [0, 1]. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Weighted-average a breakdown into a single 0..1 score. */
export function weightedAverage(
  breakdown: Record<string, number>,
  weights: Record<string, number>
): number {
  let totalWeight = 0;
  let totalScore = 0;
  for (const key of Object.keys(breakdown)) {
    const w = weights[key] ?? 0;
    totalWeight += w;
    totalScore += clamp01(breakdown[key]) * w;
  }
  return totalWeight > 0 ? clamp01(totalScore / totalWeight) : 0;
}

