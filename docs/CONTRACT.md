# Client Contract

Everything the Phaser client needs. The source of truth is `shared/src/protocol.ts` and `shared/src/schema.ts`. `server/public/debug.html` is a complete working client in about 200 lines, so copy from it freely.

## Setup

```bash
npm install @colyseus/sdk
```

Use `npm install`, not `npm ci`, on your own machine. `npm ci` tries to compile better-sqlite3.

Run the server locally with `npm run dev` at the repo root. It listens on `http://localhost:2567`.

The client is served from the same origin as the server in production, so connect to `location.origin` there. To be included in the build:

1. Put the app in `client/` with a `build` script that outputs to `client/dist`.
2. Add `"client"` to `workspaces` in the root `package.json`.

The Dockerfile then builds it automatically.

## Join flow

Players queue in the `wait` room and the server hands them a seat in an `arena` room. Do not call `joinOrCreate("arena")` directly.

```ts
import { Client } from "@colyseus/sdk";

const client = new Client(location.origin);

async function findMatch() {
  const wait = await client.joinOrCreate("wait", { playerId: getStoredUuid() });

  wait.onMessage("matched", async (reservation) => {
    const room = await client.consumeSeatReservation(reservation);
    wait.leave();
    room.reconnection.minUptime = 0; // see Reconnecting
    startGame(room);
  });
}
```

`playerId` is a UUID you generate once and keep in `localStorage`. It is how wins follow a player between rounds. The server assigns the display name, so there is no name entry screen.

A solo player is matched after 5 seconds, with bots filling the room to 4. Six queued players start immediately.

## Sending input

Send on a fixed timer of around 30 times a second, not only when something changes.

```ts
const input = room.input();

setInterval(() => {
  input.data.moveX = moveX; // -1 to 1
  input.data.moveY = moveY; // -1 to 1
  input.data.action = pressed; // true to use the verb
  input.send();
}, 33);
```

The server clamps these, normalises diagonals and enforces the cooldown. There is no client prediction: send input, render state.

Do not send from `requestAnimationFrame`, and stay well under 120 messages a second. Above that the server disconnects the client as a flood, and a 144 Hz display would get close.

## Reading state

`room.state` updates 20 times a second. Interpolate positions between updates, and keep rendering at full frame rate.

| Field | Type | Meaning |
|---|---|---|
| `phase` | string | `waiting`, `countdown`, `playing`, `results` |
| `secondsLeft` | number | Whole seconds left in the phase |
| `players` | map | Keyed by session id. Your own entry is `room.sessionId` |

Each player:

| Field | Type | Meaning |
|---|---|---|
| `handle` | string | Display name |
| `kind` | string | `human`, `bot` or `swarm` |
| `x`, `y` | int | Pixels. Arena is 1600 by 900, player radius 28 |
| `score` | int | Points this round |
| `actionReady` | boolean | Verb is off cooldown |
| `stunned` | boolean | Player cannot act right now |
| `connected` | boolean | False during a reconnect hold, so show them dimmed |

## Messages

| Message | When | Payload |
|---|---|---|
| `fx` | Someone used the verb | `{ by, x, y, hits: string[] }` |
| `round_result` | Round ended | `{ winners: string[], standings: [{ id, handle, kind, score }] }` |

Register a handler for both. `winners` contains session ids, is empty if nobody scored, and has several entries on a tie.

## End of a round

The `results` phase lasts 8 seconds, then the server closes the room. `room.onLeave` fires, and you call `findMatch()` again.

## Reconnecting

The server holds a dropped player's seat for 10 seconds, and the SDK retries by itself. Set `room.reconnection.minUptime = 0`, because by default the SDK refuses to reconnect in a room's first 5 seconds.

```ts
room.onDrop(() => showReconnecting());
room.onReconnect(() => hideReconnecting());
```

If the page reloads, the `room` object is gone. Keep `room.reconnectionToken` in `sessionStorage` and call `client.reconnect(token)` on load.

## HTTP

`GET /api/leaderboard` returns the top 10 as `[{ handle, wins, highScore, rounds }]`. CORS is open on this route.
