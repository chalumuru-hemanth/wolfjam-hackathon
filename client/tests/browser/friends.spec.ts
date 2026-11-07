import { test, expect } from '@playwright/test';

const url = process.env.ONLINE_URL;

test('a cached page detects an unavailable server and retry restores friend creation', async ({ page }) => {
  test.skip(!url, 'Set ONLINE_URL to test server recovery.');
  test.setTimeout(45000);
  let unavailable = true;
  let checks = 0;
  await page.route('**/healthz', async (route) => {
    checks++;
    if (unavailable) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    else await route.continue();
  });
  await page.goto(url!);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.locator('#connection-status')).toContainText('Multiplayer is unavailable');
  await expect(page.getByRole('button', { name: 'Quick match', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Play with friends', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create friend room', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeEnabled();
  const beforeRetry = checks;
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await expect.poll(() => checks).toBeGreaterThan(beforeRetry);
  unavailable = false;
  // Recovery can happen on the automatic probe as well as a manual retry.
  await expect(page.getByRole('button', { name: 'Create friend room', exact: true })).toBeEnabled({ timeout: 12000 });
  await page.getByRole('button', { name: 'Create friend room', exact: true }).click();
  await expect(page.locator('#party-code')).toHaveText(/^[A-Z2-9]{6}$/);
  await page.getByRole('button', { name: 'Exit game', exact: true }).click();
  await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
});
test('choosing quick or solo from an invite clears that invite', async ({ page }) => {
  test.skip(!url, 'Set ONLINE_URL to test online modes.');
  const invite = new URL('?party=ZZZZZZ', url!).href;
  await page.goto(invite);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('party')).toBe(false);
  await page.getByRole('button', { name: 'Exit game', exact: true }).click();
  await page.goto(invite);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Quick match', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('party')).toBe(false);
  await page.getByRole('button', { name: 'Exit game', exact: true }).click();
});

test('a different invite never restores the previous private arena', async ({ browser }) => {
  test.skip(!url, 'Set ONLINE_URL to test private reconnection.'); test.setTimeout(60000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [hostA, hostB, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    for (const host of [hostA!, hostB!]) {
      await host.goto(url!);
      await host.getByRole('button', { name: 'Play with friends', exact: true }).click();
      await host.getByRole('button', { name: 'Create friend room', exact: true }).click();
      await expect(host.locator('#party-code')).toHaveText(/^[A-Z2-9]{6}$/);
    }
    const inviteA = (await hostA!.locator('#party-invite').getAttribute('href'))!;
    const inviteB = (await hostB!.locator('#party-invite').getAttribute('href'))!;
    const codeB = await hostB!.locator('#party-code').textContent();
    await guest!.goto(inviteA);
    await guest!.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(hostA!.locator('#lobby-roster .player-card')).toHaveCount(2);
    await hostA!.getByRole('button', { name: 'Start round', exact: false }).click();
    await expect(guest!.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    await hostB!.getByRole('button', { name: 'Start with bots', exact: false }).click();
    await expect(hostB!.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    await guest!.goto(inviteB);
    await expect(guest!.locator('#party-code-input')).toHaveValue(codeB!);
    await guest!.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest!.locator('#party-code')).toHaveText(codeB!);
    await expect(guest!.locator('#lobby-screen')).toBeVisible();
    await expect(guest!.locator('#visibility-chip')).toBeHidden();
    await expect(guest!.locator('#lobby-note')).toContainText('round is in progress');
    for (const page of [guest!, hostA!, hostB!]) await page.getByRole('button', { name: 'Exit game', exact: true }).click();
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test('friends recover a reload and return to the same lobby for another round', async ({ browser }) => {
  test.skip(!url, 'Set ONLINE_URL to test full private rounds.'); test.setTimeout(115000);
  const a = await browser.newContext(); const b = await browser.newContext();
  const host = await a.newPage(); const guest = await b.newPage();
  try {
    await host.goto(url!);
    await host.getByRole('button', { name: 'Play with friends', exact: true }).click();
    await host.getByRole('button', { name: 'Create friend room', exact: true }).click();
    await expect(host.locator('#party-code')).toHaveText(/^[A-Z2-9]{6}$/);
    const code = await host.locator('#party-code').textContent();
    const invite = (await host.locator('#party-invite').getAttribute('href'))!;
    await guest.goto(invite);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(host.locator('#lobby-roster .player-card')).toHaveCount(2);
    await host.getByRole('button', { name: 'Start round', exact: false }).click();
    await expect(guest.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    const arena = await host.locator('#session-caption').textContent();
    await guest.reload();
    await expect(guest.locator('#visibility-chip')).toBeVisible({ timeout: 20000 });
    expect(await guest.locator('#session-caption').textContent()).toBe(arena);
    await expect(host.locator('#results-screen')).toBeVisible({ timeout: 70000 });
    await expect(host.locator('#lobby-screen')).toBeVisible({ timeout: 15000 });
    await expect(guest.locator('#lobby-screen')).toBeVisible({ timeout: 15000 });
    expect(await host.locator('#party-code').textContent()).toBe(code);
    expect(await guest.locator('#party-code').textContent()).toBe(code);
    await host.getByRole('button', { name: 'Start round', exact: false }).click();
    await expect(guest.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    await host.getByRole('button', { name: 'Exit game', exact: true }).click();
    await guest.getByRole('button', { name: 'Exit game', exact: true }).click();
  } finally { await a.close(); await b.close(); }
});
test('friends join by invite, host transfers, and both play in the same private arena', async ({ browser, request }, info) => {
  test.skip(!url, 'Set ONLINE_URL to use the real friend-room server.'); test.setTimeout(60000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({ viewport: info.project.name === 'landscape' ? { width: 844, height: 390 } : { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await hostContext.newPage(); const guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await host.goto(url!);
    await host.screenshot({ path: info.outputPath('home.png') });
    await host.getByRole('button', { name: 'Play with friends', exact: true }).click();
    await host.getByRole('button', { name: 'Create friend room', exact: true }).click();
    await expect(host.locator('#party-code')).toHaveText(/^[A-Z2-9]{6}$/, { timeout: 15000 });
    const code = (await host.locator('#party-code').textContent())!;
    const invite = (await host.locator('#party-invite').getAttribute('href'))!;
    expect(new URL(invite).searchParams.get('party')).toBe(code);
    await guest.goto(invite);
    await expect(guest.locator('#party-code-input')).toHaveValue(code);
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(host.locator('#lobby-roster .player-card')).toHaveCount(2);
    await expect(guest.locator('#ready-button')).toBeDisabled();
    await guest.screenshot({ path: info.outputPath('friend-lobby-phone.png') });
    await host.getByRole('button', { name: 'Exit game', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Start with bots', exact: false })).toBeEnabled();
    await host.goto(invite);
    await host.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(guest.locator('#lobby-roster .player-card')).toHaveCount(2);
    await guest.getByRole('button', { name: 'Start round', exact: false }).click();
    await expect(host.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    await expect(guest.locator('#visibility-chip')).toBeVisible({ timeout: 15000 });
    expect(await host.locator('#session-caption').textContent()).toBe(await guest.locator('#session-caption').textContent());
    await guest.keyboard.press('Space');
    await expect(guest.locator('#visibility-label')).toHaveText('EXPOSED');
    await guest.screenshot({ path: info.outputPath('friend-game-phone.png') });
    await host.getByRole('button', { name: 'Exit game', exact: true }).click();
    await guest.getByRole('button', { name: 'Exit game', exact: true }).click();
    await expect.poll(async () => (await request.get(new URL('/api/party/' + code, url!).href)).status()).toBe(404);
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'Quick match', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await hostContext.close(); await guestContext.close(); }
});

test('invalid friend codes explain recovery and solo is always available', async ({ page }) => {
  test.skip(!url, 'Set ONLINE_URL to use the real server.');
  await page.goto(url!);
  await page.getByRole('button', { name: 'Play with friends', exact: true }).click();
  await page.locator('#party-code-input').fill('bad');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.locator('#friend-error')).toContainText('six-character');
  await page.locator('#party-code-input').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.locator('#connection-status')).toContainText('closed', { timeout: 15000 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
  await expect(page.locator('#lobby-screen')).toBeVisible();
});

test('the cached production game reloads offline and starts solo play', async ({ page, context }) => {
  test.skip(!url, 'Set ONLINE_URL to test the production offline shell.'); test.setTimeout(45000);
  await page.goto(url!);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Quick match', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Solo practice', exact: true }).click();
    await page.getByRole('button', { name: 'Ready · Start practice', exact: false }).click();
    await expect(page.locator('#visibility-chip')).toBeVisible({ timeout: 8000 });
  } finally { await context.setOffline(false); }
});
