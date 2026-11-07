import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkSession } from '../src/network/NetworkSession.ts';
import type { Every, RoomConnection } from '../src/network/NetworkSession.ts';
import type { WireInput } from '../src/network/contract.ts';
import { INPUT_INTERVAL_MS, readBeacon, readFx, readPlayers, readRoundResult, readWatchers } from '../src/network/contract.ts';
import { readNetworkConfig } from '../src/network/config.ts';
import { interpolate } from '../src/network/interpolation.ts';
import { createPlayerId, getStoredPlayerId, saveToken, storedToken } from '../src/network/identity.ts';
import { GAME } from '../src/game/config.ts';
import type { GameEvent } from '../src/game/types.ts';

const STOP = { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false };
const ZERO = { moveX: 0, moveY: 0, action: false };
const config = { endpoint: 'http://example.com:2567', roomName: 'wait' };
const player = (score = 0) => ({ score, handle: 'Copper Wolf', kind: 'human', connected: true });
const body = () => ({ x: 800, y: 450, actionReady: true, stunned: false, exposed: false, shielded: false });
const state = (phase = 'playing', secondsLeft = 60, score = 0) => ({
  players: new Map([['self', player(score)]]), bodies: new Map([['self', body()]]), phase, secondsLeft,
  beaconX: 500, beaconY: 400, beaconNextX: 500, beaconNextY: 400, beaconMovesIn: 8, lastLight: false,
});

class Signals<T extends unknown[]> {
  callbacks = new Set<(...args: T) => void>();
  add(callback: (...args: T) => void): () => void { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
  emit(...args: T): void { this.callbacks.forEach((callback) => callback(...args)); }
}
class FakeRoom implements RoomConnection {
  id = 'arena-one'; sessionId = 'self'; state: unknown = state(); leaves = 0;
  sent: WireInput[] = [];
  states = new Signals<[unknown]>(); errors = new Signals<[number, string?]>(); departures = new Signals<[number]>();
  drops = new Signals<[]>(); reconnects = new Signals<[]>(); fx = new Signals<[unknown]>(); results = new Signals<[unknown]>();
  onState(callback: (state: unknown) => void): () => void { return this.states.add(callback); }
  onError(callback: (code: number, message?: string) => void): () => void { return this.errors.add(callback); }
  onLeave(callback: (code: number) => void): () => void { return this.departures.add(callback); }
  onDrop(callback: () => void): () => void { return this.drops.add(callback); }
  onReconnect(callback: () => void): () => void { return this.reconnects.add(callback); }
  onFx(callback: (event: unknown) => void): () => void { return this.fx.add(callback); }
  onRoundResult(callback: (result: unknown) => void): () => void { return this.results.add(callback); }
  sendInput(payload: WireInput): void { this.sent.push({ ...payload }); }
  leave(): Promise<void> { this.leaves++; return Promise.resolve(); }
  patch(value: unknown): void { this.state = value; this.states.emit(value); }
}
class ManualTimer {
  callbacks = new Set<() => void>(); milliseconds = 0;
  every: Every = (callback, milliseconds) => { this.milliseconds = milliseconds; this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; };
  tick(): void { this.callbacks.forEach((callback) => callback()); }
}

test('reads supplied schema, server handles, bot flags, and removals after the first full state', async (t) => {
  const room = new FakeRoom(); room.state = undefined;
  const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every);
  t.after(() => network.destroy());
  await network.join(); assert.equal(network.status.phase, 'connecting');
  room.patch({ ...state(), players: new Map([['self', player()], ['bot', { ...player(), handle: 'Bot Wolf', kind: 'bot' }]]),
    bodies: new Map([['self', body()], ['bot', body()]]) });
  assert.equal(network.connected, true); assert.equal(network.status.count, 2);
  assert.equal(network.players.get('bot')?.kind, 'bot');
  assert.equal(network.players.get('self')?.handle, 'Copper Wolf');
  room.patch(state()); assert.equal(network.players.has('bot'), false);
});

test('fixed 30Hz timer sends independently of render frames, preserving short presses', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join();
  assert.equal(timer.milliseconds, INPUT_INTERVAL_MS);
  network.update({ ...STOP, moveX: 1, actionPressed: true }, 1);
  network.update({ ...STOP, moveY: -1 }, 1);
  assert.equal(room.sent.length, 0);
  timer.tick(); assert.deepEqual(room.sent[0], { moveX: 0, moveY: -1, action: true });
  timer.tick(); assert.deepEqual(room.sent[1], { moveX: 0, moveY: -1, action: false });
  timer.tick(); assert.equal(room.sent.length, 3, 'unchanged input still transmits every timer tick');
});

test('blur/cancellation stop sends zero immediately and clears pending actions', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join(); network.update({ ...STOP, moveX: 1, actionPressed: true }, 16);
  network.stopInput(); assert.deepEqual(room.sent[0], ZERO);
  timer.tick(); assert.deepEqual(room.sent[1], ZERO);
});

test('reconnection holds views, pauses sends, and resumes with zero fresh intent', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join(); network.update({ ...STOP, moveX: 1 }, 16);
  room.errors.emit(Number.NaN);
  assert.equal(network.status.phase, 'reconnecting', 'transport errors must not cancel SDK reconnection');
  room.drops.emit();
  assert.equal(network.status.phase, 'reconnecting'); assert.equal(network.players.size, 1);
  assert.equal(timer.callbacks.size, 0);
  network.update({ ...STOP, actionPressed: true }, 16);
  room.reconnects.emit();
  assert.equal(network.status.phase, 'connected'); assert.deepEqual(room.sent.at(-1), ZERO);
  timer.tick(); assert.deepEqual(room.sent.at(-1), ZERO);
  assert.equal(timer.callbacks.size, 1);
});

test('secondsLeft anchors do not restart on unrelated patches; online phase stays authoritative', async (t) => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join(); now += 1000; room.patch(state());
  assert.equal(network.remainingMs, 59000);
  now += 70000; assert.equal(network.remainingMs, 0); assert.equal(network.round.phase, 'playing');
  room.patch(state('waiting', 5)); assert.equal(network.round.phase, 'lobby');
  network.ready(true); timer.tick(); assert.deepEqual(room.sent.at(-1), ZERO);
});

test('fx uses by/hits; authoritative score deltas create popups without awarding client points', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  const events: unknown[] = []; network.onEvent((event) => events.push(event));
  await network.join(); room.fx.emit({ by: 'self', x: 800, y: 450, hits: [{ id: 'bot', x: 900, y: 450, gain: 5, lost: 3 }] });
  assert.equal(events.length, 2); assert.equal(network.players.get('self')?.score, 0);
  room.patch(state('playing', 59, 2));
  assert.equal(events.length, 3); assert.equal(network.players.get('self')?.score, 2);
  room.fx.emit({ by: 'self', x: Number.NaN, y: 1, hits: [] }); assert.equal(events.length, 3);
});

test('round_result preserves authoritative ties/empty winners and triggers automatic requeue only after results close', async (t) => {
  const first = new FakeRoom(); const second = new FakeRoom(); second.id = 'arena-two';
  let joins = 0; const timer = new ManualTimer();
  const network = new NetworkSession(async () => ++joins === 1 ? first : second, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join();
  first.patch(state('results', 8, 3));
  first.results.emit({ winners: [], standings: [{ id: 'self', handle: 'Copper Wolf', kind: 'human', score: 3 }] });
  assert.deepEqual(network.roundResult?.winners, []);
  first.results.emit({ bad: true }); assert.equal(network.roundResult?.standings[0]?.score, 3);
  first.departures.emit(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(joins, 2); assert.equal(network.status.roomId, 'arena-two'); assert.equal(network.roundResult, undefined);
});

test('failed mid-round reconnect clears stale players and offers retry instead of auto-queueing', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join(); room.departures.emit(1006);
  assert.equal(network.status.phase, 'disconnected'); assert.equal(network.players.size, 0);
  assert.equal(timer.callbacks.size, 0);
});

test('disconnect aborts matchmaking and disposes a seat that arrives late', async () => {
  let resolve!: (room: RoomConnection) => void; let signal: AbortSignal | undefined;
  const pending = new Promise<RoomConnection>((done) => { resolve = done; });
  const room = new FakeRoom();
  const network = new NetworkSession((_config, options) => { signal = options?.signal; return pending; }, config);
  const joining = network.join(); network.disconnect(); assert.equal(signal?.aborted, true);
  resolve(room); await joining; assert.equal(room.leaves, 1); assert.equal(network.status.phase, 'idle');
});

test('timeout race cannot overwrite a successful retry', async (t) => {
  let resolve!: (room: RoomConnection) => void;
  const pending = new Promise<RoomConnection>((done) => { resolve = done; });
  const old = new FakeRoom(); const current = new FakeRoom(); current.id = 'current';
  let calls = 0; const timer = new ManualTimer();
  const network = new NetworkSession(() => ++calls === 1 ? pending : Promise.resolve(current), config, 15, timer.every); t.after(() => network.destroy());
  const joining = network.join(); await new Promise((done) => setTimeout(done, 35));
  assert.equal(network.status.phase, 'error'); await network.join();
  resolve(old); await joining; assert.equal(old.leaves, 1); assert.equal(network.status.roomId, 'current');
});

test('schema mismatch clears state and every room listener/timer', async () => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every);
  await network.join(); room.patch({ ...state(), bodies: new Map([['self', { ...body(), x: Number.NaN }]]) });
  assert.equal(network.status.phase, 'error'); assert.equal(network.players.size, 0);
  assert.equal(timer.callbacks.size, 0);
  assert.equal([room.states, room.errors, room.departures, room.drops, room.reconnects, room.fx, room.results].every((signal) => signal.callbacks.size === 0), true);
  network.destroy();
});

test('production uses same-origin queue; standalone practice and explicit dev endpoints remain supported', () => {
  assert.deepEqual(readNetworkConfig({}, 'http://example.com/'), { endpoint: undefined, roomName: 'wait' });
  assert.equal(readNetworkConfig({}, 'https://example.com/', true).endpoint, 'https://example.com');
  assert.equal(readNetworkConfig({ VITE_PRACTICE: 'true' }, 'https://example.com/', true).endpoint, undefined);
  assert.equal(readNetworkConfig({ VITE_COLYSEUS_URL: 'wss://server.example.com' }, 'https://example.com/?room=ignored').roomName, 'wait');
  assert.throws(() => readNetworkConfig({ VITE_COLYSEUS_URL: 'ws://example.com' }, 'https://example.com/'), /secure/);
});

test('HTTP LAN pages can create distinct UUIDs without the secure-context randomUUID API', () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const first = createPlayerId(source); const second = createPlayerId(source);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});

test('identity persists as a UUID and reconnect tokens remain scoped to session storage/endpoint', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const id = getStoredPlayerId(storage);
  assert.match(id, /^[0-9a-f-]{36}$/); assert.equal(getStoredPlayerId(storage), id);
  saveToken('https://a.example', 'room:token', storage);
  assert.equal(storedToken('https://a.example', storage), 'room:token');
  assert.equal(storedToken('https://b.example', storage), undefined);
  saveToken('https://a.example', undefined, storage); assert.equal(storedToken('https://a.example', storage), undefined);
});

test('interpolation remains frame-rate independent with large-jump snapping', () => {
  const origin = { x: 0, y: 0 }; const target = { x: 100, y: 50 };
  const a = interpolate(origin, target, 100); const b = interpolate(interpolate(origin, target, 50), target, 50);
  assert.ok(Math.abs(a.x - b.x) < 1e-10); assert.ok(a.x > 0 && a.x < 100);
  assert.deepEqual(interpolate(origin, { x: 800, y: 450 }, 16), { x: 800, y: 450 });
});

test('a roster entry with no body is a hidden player with no position', () => {
  const players = readPlayers({
    players: new Map([['self', player()], ['rival', { ...player(7), handle: 'Rival' }]]),
    bodies: new Map([['self', body()]]),
  });
  assert.equal(players.get('self')?.visible, true);
  const rival = players.get('rival')!;
  assert.equal(rival.visible, false);
  assert.equal(rival.score, 7, 'the scoreboard stays public');
  assert.equal(rival.actionReady, undefined);
  assert.deepEqual([rival.x, rival.y], [0, 0]);
});

test('a first patch with no bodies at all is not an error', () => {
  assert.equal(readPlayers({ players: new Map([['self', player()]]) }).get('self')?.visible, false);
});

test('a hit carries its own position, because the victim may be hidden from this client', () => {
  const events = readFx({ by: 'self', x: 800, y: 450, hits: [{ id: 'unseen', x: 950, y: 450, gain: 4, lost: 2 }] });
  assert.deepEqual(events[1], { type: 'hit', playerId: 'unseen', sourceId: 'self', x: 950, y: 450, lost: 2 });
});

test('the beacon reads as a warning only once its next spot is announced', () => {
  const quiet = readBeacon(state());
  assert.equal(quiet.beacon?.warning, false);
  assert.equal(quiet.lastLight, false);
  const warned = readBeacon({ ...state(), beaconNextX: 1200, beaconNextY: 300, lastLight: true });
  assert.equal(warned.beacon?.warning, true);
  assert.equal(warned.beacon?.nextX, 1200);
  assert.equal(warned.lastLight, true);
  assert.equal(readBeacon({ phase: 'waiting' }).beacon, undefined);
});

test('hidden scores never produce a popup, because there is nowhere to put one', async (t) => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  const events: GameEvent[] = []; network.onEvent((event) => events.push(event));
  await network.join();
  room.patch({ ...state(), players: new Map([['self', player()], ['rival', player()]]) });
  room.patch({ ...state(), players: new Map([['self', player()], ['rival', player(9)]]) });
  assert.equal(events.filter((event) => event.type === 'score').length, 0);
});

test('session exposes the beacon and clears it when leaving', async () => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every);
  await network.join();
  assert.equal(network.beacon?.x, 500);
  network.destroy();
  assert.equal(network.beacon, undefined);
});

test('the flash cooldown counts down from the moment the server reports it', async (t) => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every); t.after(() => network.destroy());
  await network.join();
  assert.equal(network.cooldownMs, 0);
  room.patch({ ...state(), bodies: new Map([['self', { ...body(), actionReady: false }]]) });
  assert.equal(network.cooldownMs, GAME.actionCooldownMs);
  now += 1000;
  assert.equal(network.cooldownMs, GAME.actionCooldownMs - 1000);
});

test('the watcher count is read from this client\'s own private entry only', () => {
  const state = { selves: new Map([['self', { watchers: 2 }]]) };
  assert.equal(readWatchers(state, 'self'), 2);
  assert.equal(readWatchers(state, 'someone-else'), 0);
  assert.equal(readWatchers({}, 'self'), 0);
  assert.equal(readWatchers({ selves: new Map([['self', { watchers: Number.NaN }]]) }, 'self'), 0);
});

test('session exposes the watcher count and clears it when leaving', async () => {
  const room = new FakeRoom(); const timer = new ManualTimer();
  const network = new NetworkSession(async () => room, config, 30000, timer.every);
  await network.join();
  room.patch({ ...state(), selves: new Map([['self', { watchers: 3 }]]) });
  assert.equal(network.watchers, 3);
  network.destroy();
  assert.equal(network.watchers, 0);
});

test('contract rejects malformed actors/fx/results', () => {
  assert.equal(readPlayers(state()).size, 1);
  assert.throws(() => readPlayers({ users: [] }), /MapSchema/);
  assert.deepEqual(readFx({ by: 'self', x: 0, y: 0, hits: [4] }), []);
  assert.equal(readRoundResult({ winners: ['self'], standings: [{ id: 'self' }] }), undefined);
});
