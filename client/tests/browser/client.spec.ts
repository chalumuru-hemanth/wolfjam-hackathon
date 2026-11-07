import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const START = new Date('2026-11-06T22:00:00Z');
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
  await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
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
  // Flash before entering the beacon, where bots can stun us. Read the short-lived UI together.
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => ({
    flashes: window.__wolfjam?.().flashes,
    visibility: document.querySelector('#visibility-label')?.textContent,
    watchers: document.querySelector('#visibility-eyes')?.textContent,
  }))).toEqual({ flashes: 1, visibility: 'EXPOSED', watchers: '3' });
  const before = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await walkIntoTheLight(page);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.x)).not.toBe(before);
  expect(await page.evaluate(() => window.__wolfjam?.().player?.score ?? 0)).toBeGreaterThan(0);
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
  // Knockback can move a player with no input. Check the frame actually sent to the simulation.
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveX)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveY)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stick] });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveX ?? 0)).toBeGreaterThan(0);
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveX)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveY)).toBe(0);
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
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveX)).toBe(0);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().input.moveX ?? 0)).toBeGreaterThan(0);
  await page.keyboard.up('KeyD');
});

test('Exit clears held movement, ends practice, and allows a fresh session', async ({ page }) => {
  const viewport = page.viewportSize()!;
  if (viewport.width < 480) await page.setViewportSize({ width: 320, height: viewport.height });
  await startPractice(page);
  const spawnX = await page.evaluate(() => window.__wolfjam?.().player?.x ?? 0);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().player?.x ?? 0)).toBeGreaterThan(spawnX + 10);
  const exit = page.getByRole('button', { name: 'Exit game', exact: true });
  const target = await exit.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect((target?.x ?? 0) + (target?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await exit.click();
  await expect(page.locator('#title-screen')).toBeVisible();
  await expect(page.locator('#game-header')).toBeHidden();
  expect(await page.evaluate(() => window.__wolfjam?.().playerCount)).toBe(0);
  expect(await page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__wolfjam?.().audioState)).toBe('suspended');
  const flashes = await page.evaluate(() => window.__wolfjam?.().flashes);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__wolfjam?.().flashes)).toBe(flashes);
  await page.keyboard.up('KeyD');
  await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  expect(await page.evaluate(() => window.__wolfjam?.().player?.score)).toBe(0);
  expect(await page.evaluate(() => window.__wolfjam?.().inputEnabled)).toBe(false);
});
