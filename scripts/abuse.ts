import { Client } from "@colyseus/sdk";
import {
  ARENA,
  MESSAGES,
  ROOMS,
  type ArenaState,
  type LeaderboardEntry,
  type PlayerInput,
} from "@wolfjam/shared";

/**
 * Attacks a running server the way a hostile client would:
 *   npx tsx scripts/abuse.ts http://localhost:2567
 *
 * Every check passes only if the attack fails and the server stays healthy.
 * Takes about 30 seconds.
 */

const endpoint = process.argv[2] ?? "http://localhost:2567";
const client = new Client(endpoint);

type Seat = Parameters<Client["consumeSeatReservation"]>[0];
type Arena = Awaited<ReturnType<typeof client.consumeSeatReservation<ArenaState>>>;

const FORGED_HANDLE = "ForgedHandle00";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(50);
  }
  return condition();
}

async function healthy(): Promise<boolean> {
  const response = await fetch(`${endpoint}/healthz`).catch(() => undefined);
  return response?.status === 200;
}

/**
 * True only if a live server turned the attacker away. A dead server also
 * throws, and that must not count as a successful defence.
 */
async function refused(attempt: () => Promise<{ leave: () => Promise<unknown> }>): Promise<boolean> {
  if (!(await healthy())) return false;
  try {
    const room = await attempt();
    await room.leave();
    return false;
  } catch {
    return healthy();
  }
}

async function joinMatch(): Promise<Arena> {
  const wait = await client.joinOrCreate(ROOMS.wait, { playerId: crypto.randomUUID() });
  const seat = await new Promise<Seat>((resolve) => wait.onMessage(MESSAGES.matched, resolve));
  const arena = await client.consumeSeatReservation<ArenaState>(seat);
  await wait.leave();
  arena.reconnection.enabled = false;
  arena.onMessage(MESSAGES.fx, () => undefined);
  arena.onMessage(MESSAGES.roundResult, () => undefined);
  return arena;
}

/**
 * The theme's security claim. Decoded state is exactly what crossed the wire, so
 * if a position is missing here, no modified client could have read it either.
 */
async function checkHiddenPlayersNeverArrive(): Promise<void> {
  const [a, b] = await Promise.all([joinMatch(), joinMatch()]);
  check("rivals share a room", a.roomId === b.roomId);
  await waitFor(() => a.state.phase === "countdown", 6000);
  check("the lights are on before the round", await waitFor(() => (a.state.bodies?.size ?? 0) >= 2, 2000));
  await waitFor(() => a.state.phase === "playing", 9000);

  let sawHidden = false;
  let sawRoster = false;
  let leak = false;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const hidden = [...a.state.players.keys()].filter((id) => !a.state.bodies.has(id));
    if (hidden.length > 0) sawHidden = true;
    if (a.state.players.size >= 2) sawRoster = true;
    for (const id of hidden) {
      const roster = a.state.players.get(id) as unknown as Record<string, unknown> | undefined;
      if (roster && ("x" in roster || "y" in roster)) leak = true;
    }
    await sleep(25);
  }
  check("the dark hides players from a client", sawHidden);
  check("hidden players stay on the public roster", sawRoster);
  check("the public roster carries no position", !leak);

  const selves = a.state.selves;
  check("a client knows how many players are watching it", typeof selves?.get(a.sessionId)?.watchers === "number");
  check("a client never learns how many are watching anyone else", selves?.size === 1 && !selves.has(b.sessionId));
  await a.leave().catch(() => undefined);
  await b.leave().catch(() => undefined);
}

const forged = {
  playerId: crypto.randomUUID(),
  handle: FORGED_HANDLE,
  kind: "human",
  expected: 1,
};

check("client cannot create an arena", await refused(() => client.create(ROOMS.arena, forged)));
check("client cannot joinOrCreate an arena", await refused(() => client.joinOrCreate(ROOMS.arena, forged)));

const victim = await joinMatch();
check("client cannot join a live arena by id", await refused(() => client.joinById(victim.roomId, forged)));

const garbage: Record<string, unknown>[] = [
  { playerId: { $ne: 1 } },
  { playerId: "x".repeat(50000) },
  { playerId: "'; DROP TABLE players; --" },
  { kind: "admin" },
];
for (const options of garbage) {
  const room = await client.joinOrCreate(ROOMS.wait, options).catch(() => undefined);
  await room?.leave();
}
check("malformed queue options do no harm", await healthy());

await waitFor(() => victim.state.phase === "playing", 8000);
const input = victim.input<PlayerInput>();
const me = () => victim.state.bodies.get(victim.sessionId);

for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1e308, -1e308]) {
  input.data.moveX = value;
  input.data.moveY = value;
  input.send();
  await sleep(40);
}
await sleep(500);
const x = me()?.x ?? Number.NaN;
const y = me()?.y ?? Number.NaN;
check(
  "hostile numbers cannot leave the arena",
  x >= 0 && x <= ARENA.width && y >= 0 && y <= ARENA.height,
  `${x}, ${y}`,
);

const flooder = await joinMatch();
let kicked = false;
flooder.onLeave(() => {
  kicked = true;
});
const flood = flooder.input<PlayerInput>();
for (let burst = 0; burst < 20; burst++) {
  for (let i = 0; i < 500; i++) {
    flood.data.moveX = i % 2;
    flood.send();
  }
  await sleep(50);
}
check("input flood gets the sender disconnected", await waitFor(() => kicked, 3000));

const metrics = (await (await fetch(`${endpoint}/api/metrics`)).json()) as {
  tick: { p95Ms: number; budgetMs: number };
};
check(
  "server keeps tick budget during the flood",
  metrics.tick.p95Ms < metrics.tick.budgetMs,
  `p95 ${metrics.tick.p95Ms.toFixed(2)} ms`,
);

await Promise.all(Array.from({ length: 300 }, () => fetch(`${endpoint}/api/metrics`).then((r) => r.text())));
check("hammering the public metrics route does no harm", await healthy());

const denied = await fetch(`${endpoint}/api/swarm/start`, { method: "POST" });
check("swarm start refuses a missing token", denied.status === 401, `${denied.status}`);

await checkHiddenPlayersNeverArrive();

// Queued together, so they share a room and one can watch the other's seat.
const [observer, dropped] = await Promise.all([joinMatch(), joinMatch()]);
check("two queued players share a room", observer.roomId === dropped.roomId);
const droppedId = dropped.sessionId;
await waitFor(() => observer.state.phase === "playing", 8000);
const heldAtFirst = observer.state.players.has(droppedId);
dropped.connection.close();
await sleep(5000);
check(
  "seat is held during the reconnect window",
  heldAtFirst && observer.state.players.get(droppedId)?.connected === false,
);
check(
  "abandoned seat is released after the hold",
  await waitFor(() => !observer.state.players.has(droppedId), 8000),
);
await observer.leave().catch(() => undefined);

const board = (await (await fetch(`${endpoint}/api/leaderboard`)).json()) as LeaderboardEntry[];
check("no forged handle reached the leaderboard", !board.some((row) => row.handle === FORGED_HANDLE));
check("server is still healthy", await healthy());

await victim.leave().catch(() => undefined);
console.log(failures === 0 ? "\nALL ATTACKS FAILED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
