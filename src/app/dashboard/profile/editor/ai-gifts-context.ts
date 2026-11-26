'use client';

/**
 * KAN-489 — what the AI gift slot needs from the editor form, without
 * changing the `GiftsAiSlot` call site in section-gifts.tsx.
 *
 * Provided by `edit-profile-form.tsx`:
 *   - `configured`: ANTHROPIC_API_KEY is set (a boolean only; the value never
 *     reaches the browser);
 *   - `sessionId`: one random UUID per editor load (survives Saves, resets on
 *     reload) — the "profile-edit session" of spec v0.8 §03;
 *   - `savedApprovedIds`: AI suggestions approved in the SAVED state, so an
 *     approval made in this session reads "Approved, publishes when you save";
 *   - `onGenerated` / `onDismissed`: apply a change the SERVER has already
 *     committed to both the live state and the baseline.
 *
 * The default (no provider) is "not configured": nothing can be generated.
 */

import { createContext, useContext } from 'react';
import type { GeneratedSuggestion } from '@/modules/profile/ai-gifts/types';

export interface AiGiftsContextValue {
  configured: boolean;
  sessionId: string;
  savedApprovedIds: ReadonlySet<string> | null;
  onGenerated: (rows: readonly GeneratedSuggestion[]) => void;
  onDismissed: (id: string) => void;
}

export const DEFAULT_AI_GIFTS_CONTEXT: AiGiftsContextValue = {
  configured: false,
  sessionId: '',
  savedApprovedIds: null,
  onGenerated: () => {},
  onDismissed: () => {},
};

export const AiGiftsContext = createContext<AiGiftsContextValue>(DEFAULT_AI_GIFTS_CONTEXT);

export function useAiGifts(): AiGiftsContextValue {
  return useContext(AiGiftsContext);
}
