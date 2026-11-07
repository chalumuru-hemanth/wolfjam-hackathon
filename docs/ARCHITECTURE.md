# Architecture

Nightlight is a browser arena game for 2 to 6 players, with 60-second rounds, built like a small live service. The server owns all game state. Clients send input and render what they are told. The rules and reasoning are in [DESIGN.md](DESIGN.md).

The theme is Visibility, and it is enforced by the network layer rather than by the art. **The server never sends a client the position of a player it cannot see.**

```mermaid
flowchart LR
  P["Phones and browsers"] -- "input over WSS" --> A
  A -- "filtered state, 20 Hz" --> P
  P -- "joins queue" --> W["WaitRoom"]
  W --> M["Matchmaking loop, 4 Hz"]
  M -- "creates room, reserves seats" --> A["ArenaRoom, 30 Hz fixed tick"]
  B["Bot brain, 10 Hz"] -- "same input path" --> A
  A --> S["shared/sim.ts"]
  A -- "one transaction per round" --> D[("SQLite on volume")]
  D --> L["/api/leaderboard"]
  A -- "tick timings" --> O["metrics"]
  O -- "SSE, 1 Hz" --> C["/ops console"]
  C -- "token required" --> X["Swarm process"]
  X -- "real client connections" --> W
```

## How a round works

1. A client joins `WaitRoom`, and the server gives it a generated handle.
2. Every 250 ms the matchmaking loop looks for a ready group: 6 waiting, or someone has waited 5 seconds.
3. The loop creates a private `ArenaRoom`, reserves a seat per player, and sends each client its reservation.
4. The room tops up timed-out groups with bots, then runs countdown, 60 seconds of play, and results.
5. The results are written to SQLite in one transaction, and the room closes.

## Visibility on the wire

Most games with fog of war send every position to every client, then hide them with graphics. A modified client can simply read them, which is how map hacks work.

Nightlight splits a player in two. `PlayerState` holds the handle and score, goes to everyone, and contains no position. `BodyState` holds the position. Each client has a Colyseus `StateView`, and every tick the server adds or removes bodies from that view using `canSee` from `shared/sim.ts`.

A hidden player's position is never encoded for that client, so no client modification can reveal it. `scripts/abuse.ts` checks this over a real connection, and `/ops` shows the share of positions withheld live.

Bots read the world through the same `canSee`, so they cannot see through the dark either.

The rules also run on the client in practice mode. That is safe because practice has no server and no opponent to cheat against.

## Decisions worth explaining

**One rule set for humans and bots.** Bots produce an ordinary `PlayerInput` that passes through the same `applyInput`, so they cannot do anything a person cannot. `shared/sim.ts` has no network imports, so it can be tested alone.

**Server authority without client prediction.** Inputs are clamped by the Colyseus sanitizer and again in the sim. NaN, oversized values and fast cooldown abuse have no effect. Prediction was left out on purpose: short rounds and interpolation hide the latency, and the risk was not worth it.

**A small custom queue.** The queue is about 100 lines and exposes depth and wait times directly on the console. Load-test clients have their own pool and never land in a room with people.

**The swarm runs in a separate process.** Inside the server it would share the event loop with the game and distort the numbers it is measuring. It uses the real client SDK and the real queue, so it exercises matchmaking too.

**Two timing metrics.** Sim tick time excludes state encoding and network work. Event loop delay includes them. Quoting tick time alone would flatter the server.

**Database writes happen outside the tick.** They run on the next turn of the event loop, and their time is tracked separately.

**Whole-pixel positions.** Positions sync as 16-bit integers, because interpolation does not need more precision and it shrinks every patch.

## Reliability

- A dropped player keeps their seat for 10 seconds and then rejoins the same session.
- A player who leaves still counts in the final standings, and ties share the win.
- A failed match start returns players to the queue.
- A server that cannot bind its port exits, so the host restarts it.
- `/ops` is public to read. Starting a swarm needs a token, and swarms are capped and stop themselves after 2 minutes.

## Measured load

Measured in the production Docker image on Linux and Node 22, on an 8-core machine, with per-client filtering active. The swarm shared the container, and there was no real network between clients and server. Run again on Railway before quoting these numbers, because hosted CPU allocation and real networks will differ.

| Clients | Rooms | Tick p95 | Event loop p95 | Positions withheld | Ticks over budget | Memory |
|---|---|---|---|---|---|---|
| 150 swarm | 25 | 0.15 ms | 5.8 ms | 64% | 2 of 19,845 | 168 MB |
| 600 swarm | 100 | 0.10 ms | 8.2 ms | 68% | 2 of 107,459 | 205 MB |
| 1,200 swarm | 200 | 0.05 ms | 25.1 ms | 56% | 3 of 358,876 | 315 MB |

The tick budget at 30 Hz is 33.3 ms. The 1,200 run was the highest tested, not a proven ceiling, and event loop delay starting to climb there is the first sign of pressure. Over-budget counts are cumulative across the run. Tick p95 reads lower at higher counts because its 2,048-sample window covers less time as rooms increase, so read it alongside event loop delay.

## Hostile clients

`scripts/abuse.ts` runs as a test against a live server. Before the fixes it broke in: any client could create an arena with an invented identity, and input floods were never stopped.

- Arenas only accept rooms and seats carrying a per-process key that clients never see.
- Clients over 120 messages a second are disconnected.
- Hidden positions are never sent, and the public roster carries no position.
- Input values are clamped twice, and NaN or infinite values have no effect.
- Queue joins write nothing to the database, so random ids cannot grow it.
- Metrics are built once a second on a timer, so requests cannot trigger the work.
- An exception inside a room closes that room only. With faults injected into 16 rooms, the server stayed up and every client requeued.

## Limits and next steps

This runs as a single process, because a Railway volume attaches to one instance. To scale out, move presence and matchmaking state to the Colyseus Redis packages, and replace SQLite with Postgres.

The queue is first come, first served, with no skill rating. Player identity is a client-held UUID, which is good enough for a jam leaderboard but spoofable.
