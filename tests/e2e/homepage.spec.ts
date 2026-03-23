import { test, expect } from '@playwright/test';

test.describe('Lyra homepage', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Lyra|Next/);
  });
});