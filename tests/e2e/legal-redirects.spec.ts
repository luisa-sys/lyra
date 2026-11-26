import { test, expect } from '@playwright/test';

/**
 * KAN-493: the folded-in legal pages redirect permanently (308) to the
 * section that now holds their content, and the site footer shows four links.
 * Anon-only pages, so these run in the chromium / mobile-safari projects.
 */

const REDIRECTS: ReadonlyArray<[string, string]> = [
  ['/cookies', '/privacy#cookies'],
  ['/guidelines', '/about#guidelines'],
  ['/safe', '/about#safety'],
  ['/help', '/about#help'],
  ['/complaints', '/contact#complaints'],
  ['/partners', '/privacy'],
  ['/accessibility', '/about'],
];

test.describe('KAN-493 legal page redirects', () => {
  for (const [from, to] of REDIRECTS) {
    test(`${from} → ${to} (308)`, async ({ request }) => {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      const location = res.headers()['location'] ?? '';
      expect(new URL(location, 'http://x').pathname + new URL(location, 'http://x').hash).toBe(to);
    });
  }
});

test.describe('KAN-493 footer', () => {
  test('homepage footer shows exactly About, Privacy, Terms, Contact', async ({ page }) => {
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Footer' }).getByRole('link');
    await expect(links).toHaveText(['About', 'Privacy', 'Terms', 'Contact']);
  });
});
