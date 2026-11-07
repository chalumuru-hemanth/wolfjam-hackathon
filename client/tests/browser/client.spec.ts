import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const START = new Date('2026-11-06T22:00:00Z');
/** Friction lets a player coast briefly once input stops, so wait for that first. */
async function settledX(page: Page): Promise<number | undefined> {
  await page.waitForTimeout(350);
  return page.evaluate(() => window.__wolfjam?.().player?.x);
}

/** Steers toward the beacon like a player would, correcting after bots shove us. */
async function walkIntoTheLight(page: Page): Promise<void> {
  const held = new Set<string>();
  const hold = async (key: string, down: boolean): Promise<void> => {
    if (down === held.has(key)) return;
    if (down) { held.add(key); await page.keyboard.down(key); } else { held.delete(key); await page.keyboard.up(key); }
  };
  for (let step = 0; step < 150; step++) {
    const seen = await page.evaluate(() => { const v = window.__wolfjam?.(); return { player: v?.player, beacon: v?.beacon }; });
    if (seen.player && seen.player.score > 0) break;
    const dx = (seen.beacon?.x ?? 0) - (seen.player?.x ?? 0);
    const dy = (seen.beacon?.y ?? 0) - (seen.player?.y ?? 0);
    await hold('KeyA', dx < -30); await hold('KeyD', dx > 30);
    await hold('KeyW', dy < -30); await hold('KeyS', dy > 30);
    await page.waitForTimeout(80);
  }
  for (const key of [...held]) await hold(key, false);
}

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
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startPractice(page);
  await expect(page.locator('#hud-timer')).toHaveText('60');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().audioLoaded)).toBe(4);
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().audioState)).toBe('running');
  await expect(page.locator('#visibility-label')).toHaveText('HIDDEN');
  const before = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await walkIntoTheLight(page);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).not.toBe(before);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.score ?? 0)).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await expect(page.locator('#visibility-label')).toHaveText('EXPOSED');
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
  // Pushes right, away from the beacon, so no bot wanders in and knocks the player.
  const stick = { x: 134, y: viewport.height - 82, id: 1 };
  const action = { x: viewport.width - 84, y: viewport.height - 82, id: 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  const spawnX = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stick] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(spawnX + 5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick, action] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().flashes ?? 0)).toBeGreaterThan(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const stopped = await settledX(page);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(stopped);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stick] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan((stopped ?? 0) + 5);
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  const afterRotate = await settledX(page);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(afterRotate);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.locator('#game-header')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('focus loss clears held movement and requires a fresh key press', async ({ page }) => {
  await startPractice(page);
  const spawnX = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(spawnX + 10);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(false);
  const stopped = await settledX(page);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).toBe(stopped);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan((stopped ?? 0) + 5);
  await page.keyboard.up('KeyD');
});
