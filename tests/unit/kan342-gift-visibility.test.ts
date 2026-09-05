/**
 * KAN-342 (epic KAN-349) — gift recommendations are visible WITHOUT the
 * `paid_gift_links` entitlement; that entitlement governs MONETISATION only.
 *
 * The rec engine already renders the unpaid/plain-link path: the v2 pipeline
 * always produces recommendations and `isPaidLinksAllowedForRecipient` only flips
 * `monetised` (raw merchant URL + no affiliate tracking when off). So Phase 1
 * ("show gifts via the unpaid path, de-gated from paid_gift_links") is the
 * implemented behaviour. This is a STRUCTURAL GUARD so a future change can't
 * accidentally re-gate gift VISIBILITY behind the entitlement.
 */
import fs from 'fs';
import path from 'path';
import { SRC } from '../support/source-paths';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('KAN-342 gift visibility is not gated by paid_gift_links', () => {
  it('the public profile renders the recommendations section with no paid_gift_links visibility gate', () => {
    const page = read(SRC.slugPage);
    expect(page).toMatch(/RecommendationsSection/);
    // Visibility must not reference the monetisation entitlement.
    expect(page).not.toMatch(/paid_gift_links/);
  });

  it('paid_gift_links is consumed only by the monetisation gate, not visibility', () => {
    const svc = read(SRC.entitlementsService);
    expect(svc).toMatch(/isPaidLinksAllowedForRecipient/);
    // The v2 pipeline always runs; the entitlement only decides monetisation.
    // ⚠️ SRC.pipeline USED to mean the recommender pipeline. It now means the
    // ACCESS pipeline: the generator derives key names by widening leftwards
    // until unique, so when KAN-415 moved the recommender's v2 pipeline out of
    // the old library tree, the collision set changed and the bare name was
    // reassigned to a different file. This assertion silently changed subject,
    // and caught it only because it looks for a specific symbol. Named
    // explicitly now.
    //
    // The old path is described rather than spelled: the KAN-428 stale-refs
    // sweep greps for moved paths across the estate and cannot tell a live
    // reference that must be updated from prose explaining that the path moved.
    // Writing it out failed the gate on the very comment documenting the fix.
    const pipeline = read(SRC.v2Pipeline);
    expect(pipeline).toMatch(/isPaidLinksAllowedForRecipient/);
    expect(pipeline).toMatch(/monetised/);
  });

  it('the dashboard add-gifts widget (W3) does not require an entitlement', () => {
    // W3 is emitted in published_activate purely on "has no gifts" — no entitlement gate.
    const resolver = read(SRC.resolveWidgets);
    expect(resolver).toMatch(/if \(!input\.hasGifts\) candidates\.push\('add_gifts'\)/);
    expect(resolver).not.toMatch(/paid_gift_links/);
  });
});
