/**
 * KAN-306 — initiate (send invites) + RSVP surface UI structural tests.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const base = 'src/app/dashboard/convene/gatherings/[id]';
const actionsPath = path.join(ROOT, base, 'actions.ts');
const islandPath = path.join(ROOT, base, 'invite-actions.tsx');
const pagePath = path.join(ROOT, base, 'page.tsx');

describe('Convene initiate + RSVP surface (KAN-306)', () => {
  describe('server actions', () => {
    const src = fs.readFileSync(actionsPath, 'utf8');
    test('exports the four initiate actions', () => {
      for (const fn of ['finaliseGathering', 'sendInvites', 'resendInvite', 'cancelInvite']) {
        expect(src).toMatch(new RegExp(`export async function ${fn}\\b`));
      }
    });
    test('sendInvites requires a finalised gathering', () =>
      expect(src).toMatch(/Finalise a time before sending invites/));
    test('dedups against existing queued/sent messages', () => {
      expect(src).toMatch(/\.from\(['"]gathering_invite_messages['"]\)/);
      expect(src).toMatch(/alreadyLive/);
    });
    test('queues via the repository helpers and drains via the dispatcher', () => {
      expect(src).toMatch(/persistQueuedInvite\(/);
      expect(src).toMatch(/setInviteeRsvpToken\(/);
      expect(src).toMatch(/dispatchQueuedInvites\(\{\s*hostUserId/);
    });
    test('finalise uses the state machine', () => expect(src).toMatch(/applyTransition\([^,]+,\s*['"]finalise['"]/));
    test('cancelInvite invalidates the RSVP token', () =>
      expect(src).toMatch(/rsvp_token:\s*null/));
    test('host-scoped reads/writes carry ownership-ok comments', () => {
      expect((src.match(/ownership-ok:/g) || []).length).toBeGreaterThanOrEqual(8);
    });
    test('every initiate path filters by host_user_id', () =>
      expect((src.match(/\.eq\(['"]host_user_id['"],\s*userId\)/g) || []).length).toBeGreaterThanOrEqual(4));
  });

  describe('client island', () => {
    const src = fs.readFileSync(islandPath, 'utf8');
    test("'use client' directive at top", () => expect(src).toMatch(/^['"]use client['"]/m));
    test('exports FinalisePanel + InviteManager', () => {
      expect(src).toMatch(/export function FinalisePanel\(/);
      expect(src).toMatch(/export function InviteManager\(/);
    });
    test('wires the initiate actions', () => {
      expect(src).toMatch(/finaliseGathering|sendInvites|resendInvite|cancelInvite/);
    });
    test('confirms before cancelling an invite', () => expect(src).toMatch(/confirm\(/));
  });

  describe('detail page', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    test('reads per-invitee delivery status from gathering_invite_messages', () =>
      expect(src).toMatch(/\.from\(['"]gathering_invite_messages['"]\)/));
    test('renders the finalise panel for a draft with proposed slots', () =>
      expect(src).toMatch(/FinalisePanel/));
    test('renders the interactive invite manager', () => expect(src).toMatch(/InviteManager/));
    test('computes canSend from the finalised state', () => expect(src).toMatch(/const canSend =/));
  });
});
