/**
 * KAN-282: Didit age-verification client core — decision mapping, normalisation,
 * and webhook signature verification (the security-critical, pure pieces).
 */
import crypto from 'node:crypto';
import {
  mapDecisionToAgeStatus,
  normaliseDecision,
  verifyWebhookSignature,
  CHALLENGE_AGE,
} from '@/lib/age/didit';

describe('mapDecisionToAgeStatus (KAN-282)', () => {
  it('explicit decline → failed', () => {
    expect(mapDecisionToAgeStatus({ status: 'declined' })).toBe('failed');
    expect(mapDecisionToAgeStatus({ status: 'rejected' })).toBe('failed');
    expect(mapDecisionToAgeStatus({ status: 'failed' })).toBe('failed');
  });
  it('estimate under 18 → failed (even if status looks ok)', () => {
    expect(mapDecisionToAgeStatus({ status: 'approved', estimatedAge: 16 })).toBe('failed');
  });
  it('estimate >= challenge age (23) → passed', () => {
    expect(mapDecisionToAgeStatus({ estimatedAge: CHALLENGE_AGE })).toBe('passed');
    expect(mapDecisionToAgeStatus({ estimatedAge: 40 })).toBe('passed');
  });
  it('estimate 18..<23 → manual_review (no near-18 auto-pass)', () => {
    expect(mapDecisionToAgeStatus({ estimatedAge: 18 })).toBe('manual_review');
    expect(mapDecisionToAgeStatus({ estimatedAge: 22 })).toBe('manual_review');
  });
  it('approved with no estimate → passed; in_review → pending; empty → manual_review', () => {
    expect(mapDecisionToAgeStatus({ status: 'approved' })).toBe('passed');
    expect(mapDecisionToAgeStatus({ status: 'in_review' })).toBe('pending');
    expect(mapDecisionToAgeStatus({})).toBe('manual_review');
  });
});

describe('normaliseDecision (KAN-282)', () => {
  it('extracts status + age from nested age_estimation', () => {
    expect(normaliseDecision({ age_estimation: { age: 30, status: 'Approved' } })).toEqual({
      status: 'approved',
      estimatedAge: 30,
    });
  });
  it('handles top-level status + missing age', () => {
    expect(normaliseDecision({ status: 'DECLINED' })).toEqual({ status: 'declined', estimatedAge: null });
  });
  it('handles empty/garbage defensively', () => {
    expect(normaliseDecision(null)).toEqual({ status: null, estimatedAge: null });
    expect(normaliseDecision('nonsense')).toEqual({ status: null, estimatedAge: null });
  });
});

describe('verifyWebhookSignature (KAN-282)', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ vendor_data: 'p1', decision: { age_estimation: { age: 30 } } });
  const good = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  it('accepts a valid signature (raw + prefixed)', () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${good}`, secret)).toBe(true);
  });
  it('rejects a wrong/tampered signature', () => {
    expect(verifyWebhookSignature(body, good.replace(/.$/, '0'), secret)).toBe(false);
    expect(verifyWebhookSignature(body + 'x', good, secret)).toBe(false);
  });
  it('rejects when secret or header is missing', () => {
    expect(verifyWebhookSignature(body, good, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });
});
