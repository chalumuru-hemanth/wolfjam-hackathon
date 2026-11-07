import { test, expect } from '@playwright/test';

const url = process.env.ONLINE_URL;

/**
 * The real client against a real server, with nothing mocked:
 *   ONLINE_URL=http://localhost:2599 npx playwright test online --project=desktop
 */
test('the built client plays a live match against the real server', async ({ page }, info) => {
  test.skip(!url, 'Set ONLINE_URL to run against a live server.');
  test.setTimeout(110000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(url!);
  await page.getByRole('button', { name: 'Find match', exact: true }).click();
  // The countdown lasts 3 seconds, so a slow join can miss it. Wait for the round instead.
  await expect(page.locator('#visibility-chip')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('#visibility-label')).toHaveText('HIDDEN');
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('live-dark.png') });

  await page.keyboard.press('Space');
  await expect(page.locator('#visibility-label')).toHaveText('EXPOSED');
  await expect(page.locator('#visibility-eyes')).toHaveText('3');
  await page.waitForTimeout(100);
  await page.screenshot({ path: info.outputPath('live-flash.png') });

  await expect(page.locator('#visibility-label')).toHaveText('LAST LIGHT', { timeout: 60000 });
  await page.screenshot({ path: info.outputPath('live-last-light.png') });
  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: info.outputPath('live-results.png') });
  expect(errors).toEqual([]);
});
