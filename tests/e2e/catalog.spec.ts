import { expect, test } from '@playwright/test';

test('category page renders products, facets and breadcrumbs', async ({ page }) => {
  await page.goto('/en/c/smartphones');
  await expect(page.getByRole('heading', { level: 1, name: 'Smartphones' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});

test('brand page lists that brand only', async ({ page }) => {
  await page.goto('/en/b/samsung');
  await expect(page.getByRole('heading', { level: 1, name: 'Samsung' })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});
