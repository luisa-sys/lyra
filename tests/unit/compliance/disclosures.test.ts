/**
 * KAN-408: which legal disclosures are active, driven by the global switch table.
 */
import { disclosuresFromSwitches } from '@/modules/marketing-legal/disclosures';

const base = { mcp: true, convene: true, paid_gift_links: true, age_verification: false };

describe('disclosuresFromSwitches (KAN-408)', () => {
  it('affiliate disclosure follows the paid_gift_links switch', () => {
    expect(disclosuresFromSwitches({ ...base, paid_gift_links: true }).affiliate).toBe(true);
    expect(disclosuresFromSwitches({ ...base, paid_gift_links: false }).affiliate).toBe(false);
  });

  it('other switches do not affect the affiliate disclosure', () => {
    expect(disclosuresFromSwitches({ ...base, convene: false, mcp: false }).affiliate).toBe(true);
  });
});
