import { Client } from "@colyseus/sdk";
import {
  MESSAGES,
  NET,
  ROOMS,
  type ArenaState,
  type PlayerInput,
  type QueueJoinOptions,
} from "@wolfjam/shared";

/**
 * Headless load-test clients. Each one uses the real public path: join the
 * queue, take a reservation, play with random input, then queue again.
 */

const [endpoint = "http://127.0.0.1:2567", countArg = "25"] = process.argv.slice(2);
const count = Number(countArg);
const JOIN_STAGGER_MS = 40;
const REQUEUE_DELAY_MS = 1000;
const INPUT_INTERVAL_MS = Math.round(1000 / NET.tickRate);

// If the server dies, this process must not linger and reconnect forever.
process.on("disconnect", () => process.exit(0));

const client = new Client(endpoint);
let connected = 0;

type Seat = Parameters<Client["consumeSeatReservation"]>[0];
type ArenaConnection = Awaited<ReturnType<typeof client.consumeSeatReservation<ArenaState>>>;

const report = (): void => {
  process.send?.({ connected });
};

function playArena(room: ArenaConnection): Promise<void> {
  const input = room.input<PlayerInput>();
  // Receive these like a real client would. Unhandled types log on every message.
  room.onMessage(MESSAGES.fx, () => undefined);
  room.onMessage(MESSAGES.roundResult, () => undefined);
  let moveX = 0;
  let moveY = 0;
  let ticks = 0;

  const timer = setInterval(() => {
    // Change heading every second or so, as a person roughly would.
    if (ticks++ % NET.tickRate === 0) {
      const angle = Math.random() * Math.PI * 2;
      moveX = Math.cos(angle);
      moveY = Math.sin(angle);
    }
    input.data.moveX = moveX;
    input.data.moveY = moveY;
    input.data.action = Math.random() < 0.05;
    input.send();
  }, INPUT_INTERVAL_MS);

  return new Promise((resolve) => {
    room.onLeave(() => {
      clearInterval(timer);
      resolve();
    });
  });
}

function queueForMatch(): Promise<ArenaConnection> {
  return new Promise((resolve, reject) => {
    const options: QueueJoinOptions = { kind: "swarm" };
    client
      .joinOrCreate(ROOMS.wait, options)
      .then((wait) => {
        wait.onMessage(MESSAGES.matched, (reservation: Seat) => {
          client
            .consumeSeatReservation<ArenaState>(reservation)
            .then(resolve)
            .catch(reject)
            .finally(() => void wait.leave());
        });
      })
      .catch(reject);
  });
}

async function runClient(): Promise<void> {
  for (;;) {
    try {
      connected++;
      report();
      await playArena(await queueForMatch());
    } catch (error) {
      console.error("[swarm] client failed", error);
    } finally {
      connected--;
      report();
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEUE_DELAY_MS));
  }
}

for (let i = 0; i < count; i++) {
  setTimeout(() => void runClient(), i * JOIN_STAGGER_MS);
}
