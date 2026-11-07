import { test, expect } from '@playwright/test';

/** Captures what the game looks like, for review and the submission page. */
test('captures the key moments of a round', async ({ page }, info) => {
  test.setTimeout(100000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: info.outputPath('title.png') });
  await page.getByRole('button', { name: 'Play practice', exact: true }).click();
  await page.getByRole('button', { name: 'Ready · Start practice', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().phase), { timeout: 6000 }).toBe('playing');
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath('dark.png') });

  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1100);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(700);
  await page.screenshot({ path: info.outputPath('beacon.png') });

  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  await page.screenshot({ path: info.outputPath('flash.png') });

  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().remainingMs ?? 60000), { timeout: 60000, intervals: [500] }).toBeLessThan(8000);
  await page.screenshot({ path: info.outputPath('last-light.png') });
  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 12000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: info.outputPath('results.png') });
  expect(errors).toEqual([]);
});
