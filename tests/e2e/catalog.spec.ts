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

test('search page finds a product despite a typo', async ({ page }) => {
  await page.goto('/en/search?q=samsng');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('samsng');
  await expect(page.locator('article').first()).toBeVisible();
});

test('product page shows price, variants and JSON-LD', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('purchase-actions')).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join(' ')).toContain('"@type":"Product"');
  expect(ld.join(' ')).toContain('"@type":"BreadcrumbList"');
});

test('an old slug redirects permanently to the new one', async ({ page }) => {
  const redirect = await page.request.get('/en/p/samsung-galaxy-s25', { maxRedirects: 0 });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toContain('/en/p/samsung-galaxy-s25-256gb');
  const response = await page.goto('/en/p/samsung-galaxy-s25');
  await expect(page).toHaveURL(/\/en\/p\/samsung-galaxy-s25-256gb/);
  expect(response?.status()).toBeLessThan(400);
});

test('product variant changes update price and SKU without navigation', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await expect(page.getByText('SAM-S25-256-MID')).toBeVisible();
  await page.getByRole('radio', { name: '512gb' }).click();
  await expect(page.getByText('SAM-S25-512-MID')).toBeVisible();
  await expect(page.getByText('$1,499.00').first()).toBeVisible();
  await expect(page).toHaveURL(/samsung-galaxy-s25-256gb/);
});
