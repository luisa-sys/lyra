/**
 * scoreAttendee — KAN-207 (Phase 3).
 *
 * Ranks a candidate contact for inclusion in a gathering based on:
 *   tribe fit          — does the contact belong to a tribe whose name matches
 *                        the gathering's vibe? ("coffee" → "uni friends" boosts;
 *                        "kids_party" → "school parents" boosts)
 *   recency            — time since last attended together (sweet spot: 1-6
 *                        months ago; very recent dampens to avoid over-asking,
 *                        very old re-engages)
 *   response history   — accept/attend rate boosts; silent/no-show dampens
 *   type fit           — has the contact attended this gathering_type before?
 *   diversity          — don't keep proposing the same person across all
 *                        gathering types this week
 *
 * V1: relationship_signals is the primary signal source. Tribe-fit uses a
 * simple keyword map (intent → tribe-name keywords). Future iterations can
 * incorporate profile-level data (dietary, mobility, distance) once invitees
 * routinely have linked Lyra profiles.
 *
 * Weights chosen for clarity, not science. Tune as evidence accumulates.
 */

import {
  type AttendeeCandidate,
  type AttendeeContext,
  type AttendeeScore,
  type RelationshipSignals,
  type GatheringType,
  clamp01,
  weightedAverage,
} from './types';

const WEIGHTS = {
  tribeFit: 0.30,
  recency: 0.20,
  responseHistory: 0.25,
  typeFit: 0.15,
  diversity: 0.10,
};

/**
 * Map of intent → keywords that match tribe names. Multiple keywords per intent
 * give a boost if any one matches (case-insensitive substring).
 */
const TRIBE_KEYWORDS_BY_INTENT: Record<GatheringType, string[]> = {
  coffee: ['friends', 'colleagues', 'uni', 'school', 'book', 'mums', 'parents'],
  lunch: ['friends', 'colleagues', 'team'],
  dinner: ['friends', 'family', 'date'],
  drinks: ['friends', 'colleagues', 'uni'],
  party: ['friends', 'family', 'birthday'],
  kids_party: ['parents', 'school', 'class', 'mums', 'dads'],
  meeting: ['colleagues', 'team', 'mentors'],
  date: ['date'],
  walk: ['friends', 'family', 'dog'],
  cinema: ['friends', 'family', 'date'],
  other: [],
};

function scoreTribeFit(candidate: AttendeeCandidate, intent: GatheringType): { score: number; reason: string | null } {
  if (candidate.tribeNames.length === 0) {
    return { score: 0.3, reason: null }; // neutral — no tribe info
  }
  const keywords = TRIBE_KEYWORDS_BY_INTENT[intent];
  if (keywords.length === 0) {
    return { score: 0.4, reason: null };
  }
  const hitTribes = candidate.tribeNames.filter((t) =>
    keywords.some((k) => t.toLowerCase().includes(k))
  );
  if (hitTribes.length === 0) return { score: 0.25, reason: null };
  return {
    score: clamp01(0.6 + 0.2 * Math.min(hitTribes.length, 2)),
    reason: `In tribe(s) ${hitTribes.join(', ')} — fits the "${intent}" intent`,
  };
}

function scoreRecency(
  signals: RelationshipSignals | undefined,
  nowMs: number
): { score: number; reason: string | null } {
  if (!signals || !signals.lastAttendedAt) {
    return { score: 0.5, reason: 'Never attended together — neutral baseline' };
  }
  const lastMs = new Date(signals.lastAttendedAt).getTime();
  const daysSince = (nowMs - lastMs) / (1000 * 60 * 60 * 24);

  // Sweet spot: 30-180 days ago = 1.0
  // Very recent (<14 days) = 0.4 (avoid over-asking)
  // 180-365 days = 0.8 (re-engagement)
  // >365 days = 0.6 (long gap — uncertain)
  if (daysSince < 7) return { score: 0.3, reason: `Seen ${Math.round(daysSince)} days ago — recent, avoid over-asking` };
  if (daysSince < 14) return { score: 0.5, reason: 'Seen within the last fortnight' };
  if (daysSince < 30) return { score: 0.85, reason: `Seen ${Math.round(daysSince)} days ago — sweet spot for follow-up` };
  if (daysSince < 180) return { score: 1.0, reason: `Last gathered ${Math.round(daysSince)} days ago` };
  if (daysSince < 365) return { score: 0.75, reason: `Haven't gathered in ${Math.round(daysSince)} days — overdue` };
  return { score: 0.55, reason: `Last gathered >1 year ago — long gap` };
}

function scoreResponseHistory(signals: RelationshipSignals | undefined): {
  score: number;
  reason: string | null;
} {
  if (!signals || signals.totalInvites === 0) {
    return { score: 0.5, reason: null };
  }
  const accepts = signals.totalAccepted + signals.totalAttended;
  const negatives = signals.totalDeclined + signals.totalSilent + signals.totalNoShows;
  const ratio = accepts / Math.max(1, accepts + negatives);
  if (signals.totalNoShows > 2) {
    return { score: 0.2, reason: `${signals.totalNoShows} no-shows — flaky reputation` };
  }
  if (ratio > 0.8 && signals.totalInvites >= 3) {
    return { score: 1.0, reason: `Reliable — accepted ${Math.round(ratio * 100)}% of past invites` };
  }
  if (ratio > 0.5) {
    return { score: 0.7 + (ratio - 0.5) * 0.6, reason: null };
  }
  return { score: clamp01(0.3 + ratio * 0.4), reason: `Lower attendance rate (${Math.round(ratio * 100)}%)` };
}

function scoreTypeFit(signals: RelationshipSignals | undefined, intent: GatheringType): { score: number; reason: string | null } {
  if (!signals || signals.gatheringTypesSeen.length === 0) {
    return { score: 0.4, reason: null };
  }
  if (signals.gatheringTypesSeen.includes(intent)) {
    return {
      score: 0.95,
      reason: `You've done "${intent}" together before`,
    };
  }
  if (signals.gatheringTypesSeen.length >= 2) {
    return { score: 0.7, reason: 'Range of past gathering types' };
  }
  return { score: 0.5, reason: null };
}

function scoreDiversity(signals: RelationshipSignals | undefined): { score: number; reason: string | null } {
  if (!signals || signals.totalInvites === 0) {
    return { score: 1.0, reason: null }; // new candidates are diverse by definition
  }
  if (signals.totalInvites > 5) {
    // The host already over-relies on this contact. Damp slightly.
    return { score: 0.55, reason: `Invited ${signals.totalInvites} times before — consider mixing it up` };
  }
  return { score: 0.85, reason: null };
}

export function scoreAttendee(
  candidate: AttendeeCandidate,
  context: AttendeeContext,
  nowMs: number = Date.now()
): AttendeeScore {
  // Hard exclusion: already invited to this gathering.
  if (context.existingInviteeContactIds.includes(candidate.contactId)) {
    return {
      contactId: candidate.contactId,
      score: 0,
      reasons: ['Already on the invite list'],
      breakdown: { tribeFit: 0, recency: 0, responseHistory: 0, typeFit: 0, diversity: 0 },
      excluded: true,
      excludedReason: 'already_invited',
    };
  }

  const tribeFit = scoreTribeFit(candidate, context.intent);
  const recency = scoreRecency(candidate.signals, nowMs);
  const responseHistory = scoreResponseHistory(candidate.signals);
  const typeFit = scoreTypeFit(candidate.signals, context.intent);
  const diversity = scoreDiversity(candidate.signals);

  const breakdown = {
    tribeFit: tribeFit.score,
    recency: recency.score,
    responseHistory: responseHistory.score,
    typeFit: typeFit.score,
    diversity: diversity.score,
  };

  const reasons = [tribeFit.reason, recency.reason, responseHistory.reason, typeFit.reason, diversity.reason]
    .filter((r): r is string => Boolean(r));

  return {
    contactId: candidate.contactId,
    score: weightedAverage(breakdown, WEIGHTS),
    reasons,
    breakdown,
  };
}

export const _internal = { WEIGHTS, TRIBE_KEYWORDS_BY_INTENT };
