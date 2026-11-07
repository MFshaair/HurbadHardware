import { expect, test } from '@playwright/test';

test('category page renders products, facets and breadcrumbs', async ({ page }) => {
  await page.goto('/en/c/smartphones');
  await expect(page.getByRole('heading', { level: 1, name: 'Smartphones' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});
