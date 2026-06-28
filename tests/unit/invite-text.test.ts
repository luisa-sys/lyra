/**
 * KAN-154-B: buildInviteText behaviour guards.
 *
 * Invite text is user-facing — small changes (wrong link, missing
 * personalisation, broken newline structure when pasted into WhatsApp)
 * are visible and trust-damaging. These tests pin the contract.
 */

import { buildInviteText } from '@/lib/invite-text';

describe('KAN-154-B buildInviteText', () => {
  test('includes the inviter profile URL when provided', () => {
    const out = buildInviteText({
      profileUrl: 'https://checklyra.com/luisa',
    });
    expect(out).toContain('https://checklyra.com/luisa');
  });

  test('always includes the public landing URL as the create-yours CTA', () => {
    const out = buildInviteText({
      profileUrl: 'https://checklyra.com/luisa',
    });
    // The CTA line points recipients at the homepage; this is THE
    // call-to-action and must always appear.
    expect(out).toMatch(/Here['']s where you can create yours: https?:\/\//);
  });

  test('KAN-337: a betaLink becomes the create-yours CTA (skips the waitlist)', () => {
    const out = buildInviteText({
      profileUrl: 'https://checklyra.com/luisa',
      betaLink: 'https://checklyra.com/join?code=ABC',
    });
    expect(out).toContain('https://checklyra.com/join?code=ABC');
    expect(out).toContain('skips the waitlist');
  });

  test('KAN-337: omits the join link when no betaLink is provided (back-compat)', () => {
    const out = buildInviteText({ profileUrl: 'https://checklyra.com/luisa' });
    expect(out).not.toContain('/join?code=');
  });

  test('falls back to default greeting when none is provided', () => {
    const out = buildInviteText({ profileUrl: null });
    // The default opener has to keep working for users who copy the
    // textarea without editing it.
    expect(out.split('\n')[0]).toBe('Hi!');
  });

  test('uses provided greeting verbatim when supplied', () => {
    const out = buildInviteText({
      profileUrl: null,
      greeting: "Hi! It's Luisa.",
    });
    expect(out.split('\n')[0]).toBe("Hi! It's Luisa.");
  });

  test('omits the "mine is here" line when no profileUrl', () => {
    // Users who haven't picked a slug yet should still get a useful
    // invite — just one without a profile preview.
    const out = buildInviteText({ profileUrl: undefined });
    expect(out).not.toContain("Mine's here");
  });

  test('keeps blank-line structure intact for WhatsApp / SMS readability', () => {
    // Pasting into WhatsApp respects newlines — losing them would turn
    // the message into a single dense paragraph. Lock the structure.
    const out = buildInviteText({
      profileUrl: 'https://checklyra.com/luisa',
      greeting: 'Hi Sarah!',
    });
    const lines = out.split('\n');
    // Greeting, blank, blurb, blank, commitment, blank, mine-line, cta
    expect(lines[0]).toBe('Hi Sarah!');
    expect(lines[1]).toBe('');
    expect(lines[3]).toBe('');
    expect(lines[5]).toBe('');
    // The last two non-empty lines are the profile + landing URLs.
    expect(lines[lines.length - 2]).toContain('https://checklyra.com/luisa');
    expect(lines[lines.length - 1]).toMatch(/Here['']s where you can create yours:/);
  });

  test('mentions gift ideas in the body (commitment to the low-friction onboarding promise)', () => {
    // KAN-154 ticket explicitly calls out "even just adding a few gift
    // ideas helps" as the low-friction commitment. If a future refactor
    // changes this to something heavier ("set up your full profile"),
    // we want to know.
    const out = buildInviteText({ profileUrl: null });
    expect(out.toLowerCase()).toContain('gift idea');
  });
});
