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

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('KAN-342 gift visibility is not gated by paid_gift_links', () => {
  it('the public profile renders the recommendations section with no paid_gift_links visibility gate', () => {
    const page = read('src/app/[slug]/page.tsx');
    expect(page).toMatch(/RecommendationsSection/);
    // Visibility must not reference the monetisation entitlement.
    expect(page).not.toMatch(/paid_gift_links/);
  });

  it('paid_gift_links is consumed only by the monetisation gate, not visibility', () => {
    const svc = read('src/lib/features/entitlements-service.ts');
    expect(svc).toMatch(/isPaidLinksAllowedForRecipient/);
    // The v2 pipeline always runs; the entitlement only decides monetisation.
    const pipeline = read('src/lib/recommender/v2/pipeline.ts');
    expect(pipeline).toMatch(/isPaidLinksAllowedForRecipient/);
    expect(pipeline).toMatch(/monetised/);
  });

  it('the dashboard add-gifts widget (W3) does not require an entitlement', () => {
    // W3 is emitted in published_activate purely on "has no gifts" — no entitlement gate.
    const resolver = read('src/lib/dashboard/resolve-widgets.ts');
    expect(resolver).toMatch(/if \(!input\.hasGifts\) candidates\.push\('add_gifts'\)/);
    expect(resolver).not.toMatch(/paid_gift_links/);
  });
});
