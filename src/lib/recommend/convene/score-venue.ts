/**
 * scoreVenue — KAN-207 (Phase 3).
 *
 * Ranks a candidate venue for a gathering. Pure function — takes the
 * candidate + context and returns a 0..1 score with reasons + breakdown.
 * Candidate sourcing (Google Places, the venues table) is a separate concern
 * (see venue-candidates.ts in this folder, where the Places adapter lives).
 *
 * Hard filters (return hardFilterFailed):
 *   - capacity:     candidate.capacityEstimate < context.capacityRequired
 *   - accessibility: candidate doesn't satisfy ALL required accessibility flags
 *   - dietary:      candidate has zero overlap with required dietary flags
 *
 * Soft factors (each scored 0..1, weighted-averaged into final score):
 *   typeFit, distance, dietaryFit, capacity, openingHours, priceTier,
 *   accessibility, priorVisits, diversityPenalty, externalRating
 *
 * Distance scoring is approximate when only postcodes are available — proper
 * travel-time ranking arrives in a follow-up using Google Distance Matrix.
 */

import {
  type VenueCandidate,
  type VenueContext,
  type VenueScore,
  type GatheringType,
  clamp01,
  weightedAverage,
} from './types';

const WEIGHTS = {
  typeFit: 0.20,
  distance: 0.20,
  dietaryFit: 0.10,
  capacity: 0.05,
  openingHours: 0.05,
  priceTier: 0.05,
  accessibility: 0.05,
  priorVisits: 0.10,
  diversityPenalty: 0.10,
  externalRating: 0.10,
};

/** Map of intent → venue_type values that are a natural fit. */
const TYPE_FIT_BY_INTENT: Record<GatheringType, Set<string>> = {
  coffee: new Set(['cafe']),
  lunch: new Set(['cafe', 'restaurant']),
  dinner: new Set(['restaurant', 'home']),
  drinks: new Set(['bar', 'pub', 'restaurant']),
  party: new Set(['event_space', 'bar', 'home', 'restaurant']),
  kids_party: new Set(['soft_play', 'park', 'event_space', 'home']),
  meeting: new Set(['cafe', 'office', 'event_space']),
  date: new Set(['restaurant', 'bar', 'cafe', 'cinema']),
  walk: new Set(['park']),
  cinema: new Set(['cinema']),
  other: new Set([]),
};

function scoreTypeFit(candidate: VenueCandidate, intent: GatheringType): { score: number; reason: string | null } {
  const goodTypes = TYPE_FIT_BY_INTENT[intent];
  if (goodTypes.size === 0) return { score: 0.5, reason: null };
  if (goodTypes.has(candidate.venueType)) {
    return { score: 1.0, reason: `${candidate.venueType} suits "${intent}"` };
  }
  return { score: 0.25, reason: `${candidate.venueType} is unusual for "${intent}"` };
}

/**
 * Approximate distance score. If both candidate and anchor have lat/lng we
 * use the Haversine; otherwise we fall back to postcode prefix matching
 * (UK-centric — close enough for v1, replaced by Distance Matrix in v2).
 */
function scoreDistance(
  candidate: VenueCandidate,
  context: VenueContext
): { score: number; reason: string | null } {
  if (!context.anchor) return { score: 0.5, reason: null };

  // Lat/lng anchor support: "51.5074,-0.1278"
  const latlng = context.anchor.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (latlng && candidate.lat != null && candidate.lng != null) {
    const aLat = parseFloat(latlng[1]);
    const aLng = parseFloat(latlng[2]);
    const km = haversineKm(aLat, aLng, candidate.lat, candidate.lng);
    if (km < 1) return { score: 1.0, reason: 'Walking distance' };
    if (km < 3) return { score: 0.9, reason: `${km.toFixed(1)}km from anchor` };
    if (km < 8) return { score: 0.7, reason: `${km.toFixed(1)}km from anchor` };
    if (km < 20) return { score: 0.45, reason: `${km.toFixed(0)}km — a journey` };
    return { score: 0.15, reason: `${km.toFixed(0)}km — quite far` };
  }

  // Postcode-prefix fallback (UK). Compare outward codes.
  const candidateOut = (candidate.postcode || '').split(' ')[0]?.toUpperCase() ?? '';
  const anchorOut = context.anchor.split(' ')[0]?.toUpperCase() ?? '';
  if (candidateOut && anchorOut) {
    if (candidateOut === anchorOut) return { score: 0.95, reason: `Same postcode (${candidateOut})` };
    // Same area prefix (first 2 chars): SW, NW, EC, etc.
    if (candidateOut.slice(0, 2) === anchorOut.slice(0, 2)) {
      return { score: 0.65, reason: `Same postcode area (${candidateOut.slice(0, 2)})` };
    }
  }
  return { score: 0.4, reason: null };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function scoreDietary(candidate: VenueCandidate, context: VenueContext): { score: number; reason: string | null } {
  const required = context.required.dietary ?? [];
  if (required.length === 0) return { score: 1.0, reason: null };
  const matches = required.filter((r) => candidate.dietaryFlags.includes(r));
  if (matches.length === required.length) {
    return { score: 1.0, reason: `Caters to ${required.join(' + ')}` };
  }
  if (matches.length === 0) {
    return { score: 0.2, reason: `Doesn't advertise ${required.join(', ')} options` };
  }
  return { score: 0.3 + (0.7 * matches.length) / required.length, reason: null };
}

function scoreCapacity(candidate: VenueCandidate, context: VenueContext): { score: number; reason: string | null } {
  if (candidate.capacityEstimate == null) return { score: 0.6, reason: null };
  const slack = candidate.capacityEstimate - context.capacityRequired;
  if (slack < 0) return { score: 0, reason: 'Too small' };
  if (slack < 3) return { score: 0.7, reason: 'Just-right size' };
  if (slack < 20) return { score: 1.0, reason: 'Comfortable size' };
  return { score: 0.6, reason: 'Might feel empty' };
}

function scoreOpeningHours(): { score: number; reason: string | null } {
  // Placeholder: real implementation will consult opening_hours JSON against
  // the proposed slot. For v1 we treat as neutral.
  return { score: 0.6, reason: null };
}

function scorePriceTier(candidate: VenueCandidate, context: VenueContext): { score: number; reason: string | null } {
  const preferred = context.preferred.priceTier;
  if (preferred == null || candidate.priceTier == null) {
    return { score: 0.6, reason: null };
  }
  const diff = Math.abs(candidate.priceTier - preferred);
  if (diff === 0) return { score: 1.0, reason: `Price tier matches (${'£'.repeat(preferred)})` };
  if (diff === 1) return { score: 0.7, reason: null };
  return { score: 0.35, reason: 'Off-budget price tier' };
}

function scoreAccessibilityFit(candidate: VenueCandidate, context: VenueContext): { score: number; reason: string | null } {
  const required = context.required.accessibility ?? [];
  if (required.length === 0) return { score: 1.0, reason: null };
  const missing = required.filter((r) => !candidate.accessibilityFlags.includes(r));
  if (missing.length === 0) return { score: 1.0, reason: `Accessibility: ${required.join(', ')} ✓` };
  // Hard filter is handled in scoreVenue; this only fires if caller chose
  // to keep the candidate anyway.
  return { score: 0.0, reason: `Missing: ${missing.join(', ')}` };
}

function scorePriorVisits(candidate: VenueCandidate): { score: number; reason: string | null } {
  const visits = candidate.priorVisits ?? 0;
  if (visits === 0) return { score: 0.6, reason: null };
  if (visits === 1) return { score: 0.85, reason: "You've been here before" };
  if (visits < 4) return { score: 1.0, reason: `Familiar — ${visits} past visits` };
  return { score: 0.7, reason: `Frequent (${visits} past visits) — consider somewhere new` };
}

function scoreDiversityPenalty(candidate: VenueCandidate, nowMs: number): { score: number; reason: string | null } {
  if (!candidate.lastVisitedAt) return { score: 1.0, reason: null };
  const daysSince = (nowMs - new Date(candidate.lastVisitedAt).getTime()) / 86400_000;
  if (daysSince < 7) return { score: 0.3, reason: `Visited ${Math.round(daysSince)} days ago — try somewhere new` };
  if (daysSince < 21) return { score: 0.6, reason: `Recent (${Math.round(daysSince)} days ago)` };
  return { score: 1.0, reason: null };
}

function scoreExternalRating(candidate: VenueCandidate): { score: number; reason: string | null } {
  if (candidate.hostRating != null) {
    // Host's own rating dominates if present.
    return {
      score: clamp01(candidate.hostRating / 5),
      reason: candidate.hostRating >= 4 ? `Your rating: ${candidate.hostRating}/5` : null,
    };
  }
  if (candidate.externalRating == null) return { score: 0.55, reason: null };
  return {
    score: clamp01(candidate.externalRating / 5),
    reason: candidate.externalRating >= 4.5 ? `Highly rated (${candidate.externalRating}/5)` : null,
  };
}

export function scoreVenue(
  candidate: VenueCandidate,
  context: VenueContext,
  nowMs: number = Date.now()
): VenueScore {
  // Hard filters — return early with hardFilterFailed set.
  if (candidate.capacityEstimate != null && candidate.capacityEstimate < context.capacityRequired) {
    return {
      venueId: candidate.venueId,
      score: 0,
      reasons: [`Capacity ${candidate.capacityEstimate} < required ${context.capacityRequired}`],
      breakdown: zeroBreakdown(),
      hardFilterFailed: 'capacity',
    };
  }

  const requiredAccessibility = context.required.accessibility ?? [];
  const missingAcc = requiredAccessibility.filter((r) => !candidate.accessibilityFlags.includes(r));
  if (missingAcc.length > 0) {
    return {
      venueId: candidate.venueId,
      score: 0,
      reasons: [`Missing accessibility: ${missingAcc.join(', ')}`],
      breakdown: zeroBreakdown(),
      hardFilterFailed: 'accessibility',
    };
  }

  // Dietary hard-filter: zero overlap with required = hard fail.
  const requiredDietary = context.required.dietary ?? [];
  if (requiredDietary.length > 0) {
    const overlap = requiredDietary.filter((r) => candidate.dietaryFlags.includes(r));
    if (overlap.length === 0) {
      return {
        venueId: candidate.venueId,
        score: 0,
        reasons: [`No dietary match for ${requiredDietary.join(', ')}`],
        breakdown: zeroBreakdown(),
        hardFilterFailed: 'dietary',
      };
    }
  }

  const factors = {
    typeFit: scoreTypeFit(candidate, context.intent),
    distance: scoreDistance(candidate, context),
    dietaryFit: scoreDietary(candidate, context),
    capacity: scoreCapacity(candidate, context),
    openingHours: scoreOpeningHours(),
    priceTier: scorePriceTier(candidate, context),
    accessibility: scoreAccessibilityFit(candidate, context),
    priorVisits: scorePriorVisits(candidate),
    diversityPenalty: scoreDiversityPenalty(candidate, nowMs),
    externalRating: scoreExternalRating(candidate),
  };

  const breakdown = {
    typeFit: factors.typeFit.score,
    distance: factors.distance.score,
    dietaryFit: factors.dietaryFit.score,
    capacity: factors.capacity.score,
    openingHours: factors.openingHours.score,
    priceTier: factors.priceTier.score,
    accessibility: factors.accessibility.score,
    priorVisits: factors.priorVisits.score,
    diversityPenalty: factors.diversityPenalty.score,
    externalRating: factors.externalRating.score,
  };

  const reasons = Object.values(factors)
    .map((f) => f.reason)
    .filter((r): r is string => Boolean(r));

  return {
    venueId: candidate.venueId,
    score: weightedAverage(breakdown, WEIGHTS),
    reasons,
    breakdown,
  };
}

function zeroBreakdown() {
  return {
    typeFit: 0,
    distance: 0,
    dietaryFit: 0,
    capacity: 0,
    openingHours: 0,
    priceTier: 0,
    accessibility: 0,
    priorVisits: 0,
    diversityPenalty: 0,
    externalRating: 0,
  };
}

export const _internal = { WEIGHTS, TYPE_FIT_BY_INTENT, haversineKm };
