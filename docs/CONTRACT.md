# Client Contract

## Private friends and solo modes

Public matching below is unchanged. Friends use `client.create("party", { playerId })`, then the synchronized `PartyState` supplies `code`, `hostId`, `phase` and `members` (handles/connected status, keyed by party session ID). `GET /api/party/:code` resolves a normalized six-character code to a party room ID; clients may `joinById` **that party room only**, never an arena.

Only the party host may send `start`. The party server creates a protected arena and sends each member a `matched` seat reservation, consumed exactly as in the public queue. Keep the party socket open while playing. Arena disposal returns the persistent lobby to `lobby`; do not enter the public queue after a private round. Host ownership transfers when the host leaves/drops. Both party and arena support the ten-second reconnect hold. Client session storage scopes the party reconnect token by endpoint and code. Reload reconnects the party and its existing arena, without falling through into public matchmaking.

Invite links carry only `?party=CODE`, never seat reservations or reconnect tokens. Closing the last party connection removes its code. Full rooms and expired codes have recoverable UI errors. Solo mode uses the existing shared simulation and bots independently of Colyseus.

An arena must send complete initial roster/body fields and secondsLeft even while waiting for the other reserved friends. The strict client reads the first snapshot before countdown. `npm run smoke:friends` deliberately delays a second friend, checks that first snapshot, and repeats a round in the same lobby. It is included in CI against the production image.

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
| `players` | map | The public roster, keyed by session id. Everyone is always listed |
| `bodies` | map | Positions you are allowed to know. A hidden player has no entry here |
| `beaconX`, `beaconY` | int | Centre of the light |
| `beaconNextX`, `beaconNextY` | int | Where it goes next. Equal to the current spot until announced |
| `beaconMovesIn` | number | Whole seconds until it jumps |
| `lastLight` | boolean | Final stretch: everyone is revealed |

Each entry in `players`:

| Field | Type | Meaning |
|---|---|---|
| `handle` | string | Display name |
| `kind` | string | `human`, `bot` or `swarm` |
| `score` | int | Points this round. Public, even for hidden players |
| `connected` | boolean | False during a reconnect hold, so show them dimmed |

Each entry in `bodies`:

| Field | Type | Meaning |
|---|---|---|
| `x`, `y` | int | Pixels. Arena is 1600 by 900, player radius 28 |
| `actionReady` | boolean | Flash is off cooldown |
| `stunned` | boolean | Player cannot act right now |
| `exposed` | boolean | Lit up for the whole arena right now |
| `shielded` | boolean | Recently tagged, and cannot be tagged again yet |

`room.state.selves.get(room.sessionId).watchers` is how many players can see you right now. `selves` only ever contains your own entry.

`room.state.bodies.get(id)` being undefined is not an error. It means that player is in the dark. The server sends no position at all, so there is nothing for the client to reveal. Bodies appear and disappear constantly during play, and everyone is present before and after the round.

## Messages

| Message | When | Payload |
|---|---|---|
| `fx` | Someone flashed | `{ by, x, y, hits: [{ id, x, y, gain, lost }] }` |
| `round_result` | Round ended | `{ winners: string[], standings: [{ id, handle, kind, score }] }` |

A flash is sent to everyone, because it gives away the flasher. Each hit carries its own position, since the victim may be hidden from you. Register a handler for both messages. `winners` contains session ids, is empty if nobody scored, and has several entries on a tie.

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
