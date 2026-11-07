import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeSession } from '../src/game/PracticeSession.ts';
import { GAME } from '../src/game/config.ts';
import { standings } from '../src/game/types.ts';
import type { GameEvent } from '../src/game/types.ts';

const STOP = { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false };

test('practice progresses lobby → countdown → exactly 60 seconds → results', async () => {
  let now = 0;
  const session = new PracticeSession(() => now);
  await session.join();
  assert.equal(session.round.phase, 'lobby');
  assert.equal(session.remainingMs, 60000);
  session.ready(true);
  now = 2999; session.update(STOP, 16);
  assert.equal(session.round.phase, 'countdown');
  now = 3000; session.update(STOP, 16);
  assert.equal(session.round.phase, 'playing');
  assert.equal(session.remainingMs, 60000);
  now = 62999; session.update(STOP, 16);
  assert.equal(session.round.phase, 'playing');
  assert.equal(session.remainingMs, 1);
  now = 63000; session.update(STOP, 16);
  assert.equal(session.round.phase, 'results');
  assert.equal(session.remainingMs, 0);
});

test('backgrounding across both deadlines cannot extend a practice round', async () => {
  let now = 0;
  const session = new PracticeSession(() => now);
  await session.join(); session.ready(true);
  now = 90000;
  session.update({ ...STOP, actionPressed: true, moveX: 1 }, 90000);
  assert.equal(session.round.phase, 'results');
  assert.equal(session.players.get('you')?.x, 800);
  assert.equal(session.players.get('you')?.score, 0);
});

test('pulse scores in-range sparks once, respects cooldown, and preserves held-action semantics', async () => {
  let now = 0;
  const session = new PracticeSession(() => now);
  const events: GameEvent[] = [];
  session.onEvent((event) => events.push(event));
  await session.join(); session.ready(true);
  now = 3000; session.update({ ...STOP, actionPressed: true }, 16);
  assert.equal(session.players.get('you')?.score, 2);
  assert.equal(events.filter((event) => event.type === 'action').length, 1);
  assert.equal(events.filter((event) => event.type === 'hit').length, 2);
  assert.equal(events.filter((event) => event.type === 'score').length, 2);
  now += 50; session.update({ ...STOP, actionPressed: true }, 16);
  assert.equal(events.filter((event) => event.type === 'action').length, 1);
  now += GAME.actionCooldownMs; session.update({ ...STOP, actionHeld: true }, 16);
  assert.equal(events.filter((event) => event.type === 'action').length, 1);
  now = 5300; session.update({ ...STOP, actionPressed: true }, 16);
  assert.equal(session.players.get('you')?.score, 4);
});

test('lobby and results input is ignored; movement is bounded and stalls are capped', async () => {
  let now = 0;
  const session = new PracticeSession(() => now);
  await session.join();
  session.update({ ...STOP, moveX: 1, actionPressed: true }, 1000);
  assert.equal(session.players.get('you')?.x, 800);
  session.ready(true); now = 3000;
  session.update({ ...STOP, moveX: 1 }, 1000);
  assert.equal(session.players.get('you')?.x, 812);
  for (let index = 0; index < 200; index++) session.update({ ...STOP, moveX: 1, moveY: 1 }, 50);
  assert.equal(session.players.get('you')?.x, GAME.arena.width - GAME.arena.radius);
  assert.equal(session.players.get('you')?.y, GAME.arena.height - GAME.arena.radius);
  now = 63000; session.update({ ...STOP, moveX: -1 }, 50);
  assert.equal(session.players.get('you')?.x, GAME.arena.width - GAME.arena.radius);
});

test('rematch resets points, positions, targets, readiness, cooldown, and round identity', async () => {
  let now = 0;
  const session = new PracticeSession(() => now);
  await session.join(); session.ready(true);
  now = 3000; session.update({ ...STOP, actionPressed: true }, 16);
  const previous = session.round.roundId;
  now = 63000; session.update(STOP, 16); session.rematch();
  assert.equal(session.round.phase, 'lobby');
  assert.notEqual(session.round.roundId, previous);
  assert.deepEqual(session.players.get('you'), { x: 800, y: 450, score: 0, ready: false });
  assert.equal(session.targets.size, 8);
  assert.equal([...session.targets.values()].every((target) => target.active), true);
  assert.equal(session.cooldownMs, 0);
});

test('standings sort scores and preserve ties deterministically', () => {
  const players = new Map([
    ['b', { x: 0, y: 0, score: 5, ready: false }],
    ['a', { x: 0, y: 0, score: 5, ready: false }],
    ['c', { x: 0, y: 0, score: 1, ready: false }],
  ]);
  assert.deepEqual(standings(players), [{ id: 'a', score: 5 }, { id: 'b', score: 5 }, { id: 'c', score: 1 }]);
});
