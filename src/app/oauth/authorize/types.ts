/**
 * Type-only sibling module for the authorize server action — KAN-88 P3.
 *
 * BUGS-12 / CLAUDE.md gotcha #18: a 'use server' file can only export
 * async functions. The DecideInput interface lives here so actions.ts
 * stays pure.
 */

export interface DecideInput {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  decision: 'allow' | 'deny';
}
