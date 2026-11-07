import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const START = new Date('2026-11-06T22:00:00Z');
async function startPractice(page: Page): Promise<void> {
  await page.clock.setFixedTime(START);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play practice', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Ready · Start practice', exact: true }).click();
  await expect(page.locator('#countdown-screen')).toBeVisible();
  await page.clock.setFixedTime(new Date(START.getTime() + 3100));
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().phase)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(true);
}

test('full round, keyboard, scoring, audio unlock, results, and rematch', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startPractice(page);
  await expect(page.locator('#hud-timer')).toHaveText('60');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().audioLoaded)).toBe(4);
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().audioState)).toBe('running');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.score ?? 0)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(before + 40);
  await page.keyboard.up('KeyD');
  await page.screenshot({ path: info.outputPath('play.png') });
  await page.getByRole('button', { name: 'Join QR ↗', exact: true }).click();
  await expect(page.locator('#title-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(false);
  await page.getByRole('button', { name: 'Back to arena', exact: true }).click();
  await page.clock.setFixedTime(new Date(START.getTime() + 63001));
  await expect(page.locator('#results-screen')).toBeVisible();
  await expect(page.locator('#results-score')).not.toHaveText('0');
  await page.screenshot({ path: info.outputPath('results.png') });
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__wolfjam?.().player?.score)).toBe(0);
  expect(errors).toEqual([]);
});

test('simultaneous touch movement/action, cancellation, and rotation', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'Multi-touch is checked in the phone layouts.');
  await startPractice(page);
  const viewport = page.viewportSize()!;
  const cdp = await context.newCDPSession(page);
  const stick = { x: 114, y: viewport.height - 82, id: 1 };
  const action = { x: viewport.width - 84, y: viewport.height - 82, id: 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(805);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick, action] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.score ?? 0)).toBeGreaterThan(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const stopped = await page.evaluate(() => window.__wolfjam?.().player?.x);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(stopped);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan((stopped ?? 0) + 5);
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await page.waitForTimeout(150);
  const afterRotate = await page.evaluate(() => window.__wolfjam?.().player?.x);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(afterRotate);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('#game-header')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('focus loss clears held movement and requires a fresh key press', async ({ page }) => {
  await startPractice(page);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(810);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(false);
  const stopped = await page.evaluate(() => window.__wolfjam?.().player?.x);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(stopped);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan((stopped ?? 0) + 5);
  await page.keyboard.up('KeyD');
});
