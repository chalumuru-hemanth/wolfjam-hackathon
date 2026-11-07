import assert from 'node:assert/strict';
import test from 'node:test';
import { seededRandom } from '@wolfjam/shared/sim';
import { PracticeSession } from '../src/game/PracticeSession.ts';
import { GAME } from '../src/game/config.ts';
import { standings } from '../src/game/types.ts';
import type { GameEvent } from '../src/game/types.ts';

const STOP = { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false };

function playing(now: { value: number }): PracticeSession {
  return new PracticeSession(() => now.value, seededRandom(11));
}
async function start(session: PracticeSession, now: { value: number }): Promise<void> {
  await session.join(); session.ready(true);
  now.value = 3000; session.update(STOP, 16);
}

test('practice progresses lobby → countdown → exactly 60 seconds → results', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await session.join();
  assert.equal(session.round.phase, 'lobby');
  assert.equal(session.remainingMs, 60000);
  session.ready(true);
  now.value = 2999; session.update(STOP, 16);
  assert.equal(session.round.phase, 'countdown');
  now.value = 3000; session.update(STOP, 16);
  assert.equal(session.round.phase, 'playing');
  assert.equal(session.remainingMs, 60000);
  now.value = 62999; session.update(STOP, 16);
  assert.equal(session.round.phase, 'playing');
  assert.equal(session.remainingMs, 1);
  now.value = 63000; session.update(STOP, 16);
  assert.equal(session.round.phase, 'results');
  assert.equal(session.remainingMs, 0);
});

test('backgrounding across both deadlines cannot extend or play a practice round', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await session.join(); session.ready(true);
  const startX = session.players.get('you')?.x;
  now.value = 90000;
  session.update({ ...STOP, actionPressed: true, moveX: 1 }, 90000);
  assert.equal(session.round.phase, 'results');
  assert.equal(session.players.get('you')?.x, startX);
  assert.equal(session.players.get('you')?.score, 0);
});

test('the lights are on before the round, then rivals vanish into the dark', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await session.join();
  assert.equal(session.players.size, 4);
  assert.equal([...session.players.values()].every((player) => player.visible), true);
  session.ready(true);
  now.value = 3000; session.update(STOP, 40);
  const rivals = [...session.players].filter(([id]) => id !== 'you').map(([, player]) => player);
  assert.equal(rivals.every((player) => !player.visible), true);
  assert.equal(rivals.every((player) => player.x === 0 && player.y === 0), true, 'hidden means no position at all');
  assert.equal(session.players.get('you')?.visible, true);
});

test('walking into the beacon pays points and marks you exposed', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await start(session, now);
  assert.equal(session.players.get('you')?.exposed, false);
  for (let tick = 0; tick < 200 && (session.players.get('you')?.score ?? 0) === 0; tick++) {
    const self = session.players.get('you')!;
    const beacon = session.beacon!;
    const distance = Math.max(1, Math.hypot(beacon.x - self.x, beacon.y - self.y));
    session.update({ ...STOP, moveX: (beacon.x - self.x) / distance, moveY: (beacon.y - self.y) / distance }, 33.4);
  }
  assert.ok((session.players.get('you')?.score ?? 0) > 0);
  assert.equal(session.players.get('you')?.exposed, true);
});

test('a flash is an event, exposes you, and starts a cooldown even when it misses', async () => {
  const now = { value: 0 };
  const session = playing(now);
  const events: GameEvent[] = [];
  session.onEvent((event) => events.push(event));
  await start(session, now);
  session.update({ ...STOP, actionPressed: true }, 34);
  assert.equal(events.filter((event) => event.type === 'action' && event.playerId === 'you').length, 1);
  assert.equal(session.players.get('you')?.exposed, true);
  assert.ok(session.cooldownMs > 0 && session.cooldownMs <= GAME.actionCooldownMs);
  assert.equal(session.players.get('you')?.actionReady, false);
  session.update({ ...STOP, actionPressed: true }, 34);
  assert.equal(events.filter((event) => event.type === 'action' && event.playerId === 'you').length, 1);
});

test('a held key does not fire twice', async () => {
  const now = { value: 0 };
  const session = playing(now);
  const events: GameEvent[] = [];
  session.onEvent((event) => events.push(event));
  await start(session, now);
  session.update({ ...STOP, actionPressed: true, actionHeld: true }, 34);
  for (let tick = 0; tick < 200; tick++) session.update({ ...STOP, actionHeld: true }, 34);
  assert.equal(events.filter((event) => event.type === 'action' && event.playerId === 'you').length, 1);
});

test('bots really play: they reach the beacon and score without any input from you', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await start(session, now);
  for (let tick = 0; tick < 900; tick++) session.update(STOP, 33.4);
  const rivals = [...session.players].filter(([id]) => id !== 'you').map(([, player]) => player.score);
  assert.ok(Math.max(...rivals) > 0, `rival scores ${rivals.join(',')}`);
});

test('input before the round is ignored, and movement stays inside the arena', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await session.join();
  const startX = session.players.get('you')?.x;
  session.update({ ...STOP, moveX: 1, actionPressed: true }, 1000);
  assert.equal(session.players.get('you')?.x, startX);
  session.ready(true); now.value = 3000;
  for (let tick = 0; tick < 400; tick++) session.update({ ...STOP, moveX: 1, moveY: 1 }, 34);
  assert.equal(session.players.get('you')?.x, GAME.arena.width - GAME.arena.radius);
  assert.equal(session.players.get('you')?.y, GAME.arena.height - GAME.arena.radius);
});

test('a long stall advances the world by one capped step, not by the whole gap', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await start(session, now);
  const startX = session.players.get('you')!.x;
  session.update({ ...STOP, moveX: -1 }, 5000);
  assert.ok(Math.abs(session.players.get('you')!.x - startX) < 30);
});

test('rematch resets points, positions, readiness, cooldown, and round identity', async () => {
  const now = { value: 0 };
  const session = playing(now);
  await start(session, now);
  session.update({ ...STOP, actionPressed: true }, 34);
  const previous = session.round.roundId;
  now.value = 63000; session.update(STOP, 16); session.rematch();
  assert.equal(session.round.phase, 'lobby');
  assert.notEqual(session.round.roundId, previous);
  assert.equal(session.players.get('you')?.score, 0);
  assert.equal(session.players.get('you')?.ready, false);
  assert.equal(session.cooldownMs, 0);
});

test('standings sort scores and preserve ties deterministically', () => {
  const players = new Map([
    ['b', { x: 0, y: 0, score: 5, ready: false, visible: true }],
    ['a', { x: 0, y: 0, score: 5, ready: false, visible: true }],
    ['c', { x: 0, y: 0, score: 1, ready: false, visible: false }],
  ]);
  assert.deepEqual(standings(players), [{ id: 'a', score: 5 }, { id: 'b', score: 5 }, { id: 'c', score: 1 }]);
});
