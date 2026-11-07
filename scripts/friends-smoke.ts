import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { NetworkSession } from '../client/src/network/NetworkSession.ts';
import { createColyseusConnector } from '../client/src/network/colyseus.ts';
import type { PartyState } from '@wolfjam/shared';

const endpoint = process.argv[2] ?? 'http://localhost:2567';
type Seat = Parameters<Client['consumeSeatReservation']>[0];
const client = new Client(endpoint);
const host = await client.create<PartyState>('party', { playerId: crypto.randomUUID() });
const guest = await client.joinById<PartyState>(host.roomId, { playerId: crypto.randomUUID() });
const hostSeats: Seat[] = []; const guestSeats: Seat[] = [];
host.onMessage<Seat>('matched', (seat) => hostSeats.push(seat)); guest.onMessage<Seat>('matched', (seat) => guestSeats.push(seat));
const sessions: NetworkSession[] = [];
const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 12000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Timed out waiting for private match'); await delay(25); }
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
async function connect(seat: Seat): Promise<NetworkSession> {
  const session = new NetworkSession(createColyseusConnector({ reservation: seat, sessionStore: storage() }), { endpoint, roomName: 'wait' }, 30000, undefined, false);
  sessions.push(session); await session.join(); return session;
}
try {
  await until(() => host.state.members.size === 2);
  for (let round = 0; round < 2; round++) {
    host.send('start');
    await until(() => hostSeats.length > round && guestSeats.length > round);
    const first = await connect(hostSeats[round]!);
    await delay(500); // Force a full snapshot while the second reserved friend has not arrived.
    assert.equal(first.status.phase, 'connected', first.status.message);
    assert.equal(first.round.phase, 'lobby');
    assert.equal(first.players.size, 1);
    const second = await connect(guestSeats[round]!);
    await until(() => first.round.phase === 'playing' && second.round.phase === 'playing');
    assert.equal(first.status.roomId, second.status.roomId);
    assert.equal(first.players.size, 4);
    first.disconnect(); second.disconnect();
    await until(() => host.state.phase === 'lobby');
  }
  console.log('PASS private slow joins: first player accepts complete waiting state; two friends play together; repeated rounds stay in the same lobby');
} finally {
  sessions.forEach((session) => session.destroy());
  await host.leave().catch(() => {}); await guest.leave().catch(() => {});
}
