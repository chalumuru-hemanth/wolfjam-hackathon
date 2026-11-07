import { Client } from "@colyseus/sdk";
import {
  MESSAGES,
  ROOMS,
  type ArenaState,
  type LeaderboardEntry,
  type PlayerInput,
  type RoundResult,
} from "@wolfjam/shared";

/**
 * End-to-end check against a running server, local or deployed:
 *   npx tsx scripts/smoke.ts http://localhost:2567
 *
 * Plays one full bot-filled round as a human, then drops and reconnects a
 * second client. Takes a little over a minute.
 */

const endpoint = process.argv[2] ?? "http://localhost:2567";
const client = new Client(endpoint);
const playerId = crypto.randomUUID();

type Seat = Parameters<Client["consumeSeatReservation"]>[0];
type Arena = Awaited<ReturnType<typeof client.consumeSeatReservation<ArenaState>>>;

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

async function joinMatch(id: string): Promise<{ arena: Arena; waitedMs: number }> {
  const started = Date.now();
  const wait = await client.joinOrCreate(ROOMS.wait, { playerId: id });
  const seat = await new Promise<Seat>((resolve) => wait.onMessage(MESSAGES.matched, resolve));
  const arena = await client.consumeSeatReservation<ArenaState>(seat);
  await wait.leave();
  return { arena, waitedMs: Date.now() - started };
}

async function playFullRound(): Promise<void> {
  const health = await fetch(`${endpoint}/healthz`);
  check("healthz returns 200", health.status === 200);

  const { arena, waitedMs } = await joinMatch(playerId);
  check("solo human matched after the queue timeout", waitedMs >= 4500 && waitedMs < 8000, `${waitedMs} ms`);

  check("bots fill the room to 4", await waitFor(() => arena.state.players?.size === 4, 3000));

  const me = () => arena.state.bodies.get(arena.sessionId);
  check("round reaches playing", await waitFor(() => arena.state.phase === "playing", 6000));

  const startX = me()?.x ?? 0;
  const input = arena.input<PlayerInput>();
  let fxCount = 0;
  let result: RoundResult | undefined;
  arena.onMessage(MESSAGES.fx, () => fxCount++);
  arena.onMessage(MESSAGES.roundResult, (message: RoundResult) => {
    result = message;
  });

  const moveRight = setInterval(() => {
    input.data.moveX = (me()?.x ?? 0) < 1200 ? 1 : -1;
    input.data.moveY = 0;
    input.data.action = true;
    input.send();
  }, 33);

  check("input moves the player", await waitFor(() => (me()?.x ?? 0) !== startX, 2000));
  check("the action fires", await waitFor(() => fxCount > 0, 15000), `${fxCount} events`);

  const left = new Promise<void>((resolve) => arena.onLeave(() => resolve()));
  check("round produces a result", await waitFor(() => result !== undefined, 66000));
  clearInterval(moveRight);

  const standings = result?.standings ?? [];
  check("standings include all 4 players", standings.length === 4);
  check("server ends the room after results", await Promise.race([left.then(() => true), sleep(12000).then(() => false)]));

  await sleep(300);
  const board = (await (await fetch(`${endpoint}/api/leaderboard`)).json()) as LeaderboardEntry[];
  const myHandle = standings.find((entry) => entry.id === arena.sessionId)?.handle;
  check("leaderboard lists the human", board.some((entry) => entry.handle === myHandle), myHandle);
  const botHandles = new Set(standings.filter((entry) => entry.kind === "bot").map((entry) => entry.handle));
  check("leaderboard has no bots", !board.some((entry) => botHandles.has(entry.handle)));
}

async function dropAndReconnect(): Promise<void> {
  const { arena } = await joinMatch(crypto.randomUUID());
  arena.reconnection.minUptime = 0;
  await waitFor(() => arena.state.phase === "playing", 8000);

  const session = arena.sessionId;
  const input = arena.input<PlayerInput>();
  const me = () => arena.state.bodies.get(session);
  const presence = () => arena.state.players.get(session);
  const reconnected = new Promise<boolean>((resolve) => {
    arena.onReconnect(() => resolve(true));
    setTimeout(() => resolve(false), 9000);
  });
  // A non-consented close looks exactly like a network failure to the server.
  arena.connection.close();
  check("dropped client reconnects inside the hold", await reconnected);
  check("server marks the player connected again", await waitFor(() => presence()?.connected === true, 2000));

  // The real proof: after reconnecting, input must still drive the same player.
  const beforeX = me()?.x ?? 0;
  const direction = beforeX < 800 ? 1 : -1;
  const pushing = setInterval(() => {
    input.data.moveX = direction;
    input.send();
  }, 33);
  check("input still works after reconnecting", await waitFor(() => (me()?.x ?? 0) !== beforeX, 3000));
  clearInterval(pushing);
  await arena.leave();
}

await playFullRound();
await dropAndReconnect();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
