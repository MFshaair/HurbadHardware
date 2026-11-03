import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home renders the shell in both locales', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hurbad Hardware' }).first()).toBeVisible();
  await page.goto('/so');
  await expect(page.getByRole('link', { name: 'Gal' })).toBeVisible();
});

test('health endpoint is green', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, db: true, redis: true });
});

test('home has no serious accessibility violations', async ({ page }) => {
  await page.goto('/en');
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious).toEqual([]);
});
