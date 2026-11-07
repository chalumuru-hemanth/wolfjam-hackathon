# Dev Log

Short notes as we go: what we built, what we cut, and why.

## Backend first pass

Built the authoritative server, custom queue, bots, SQLite leaderboard, ops console and load tester. The theme was not out yet, so the verb is a placeholder.

**Found by testing**

- `npm ci` tried to compile better-sqlite3, which would have failed in the slim Docker image. Fixed with `--ignore-scripts`.
- Kill Swarm left 150 players on the console for 10 seconds, because the server was holding reconnect seats for clients that would never return. Swarm clients now skip the hold.
- A server that could not bind its port stayed alive and did nothing. It now exits, so the host restarts it.
- The SDK refuses to auto-reconnect in a room's first 5 seconds. Clients now set `minUptime` to 0.

**Found by attacking our own server**

- Any client could call `create("arena")` and invent its identity, skipping the matchmaker. Arenas now need a server-only key.
- Input floods were never stopped, because the Colyseus limit defaults to infinity. Floods now get the client disconnected.
- One room's exception would have taken down every match. Now it closes only that room.
- Late arrivals spawned in the corner, queue joins wrote database rows, and any metrics request reset the event loop histogram. All fixed.
- We also tested the crash handler, and it had its own bug: refused clients counted as room errors. Fixed.

**Cut on purpose**

- Client prediction, skill ratings, and AI balance testing. The game has to be fun first, and these would all have competed with that.

## Theme: Visibility

The game became **Nightlight**, built on one rule: to score, you must be seen. A moving beacon pays points but exposes you, and your one verb, Flash, steals from others but lights you up. See [DESIGN.md](DESIGN.md).

The important decision was enforcing the theme in the netcode. Hidden positions never leave the server, so a modified client cannot read where hidden players are.

**Found by simulating and testing**

- The first tuning barely had a dark at all: only 18% of positions were hidden. Being hit exposed you for as long as flashing did, which was most of the problem.
- Flashes resolved in join order, so joining first was an advantage. Now they land together.
- The beacon could make a short jump, because the search kept its last attempt instead of its best.
- Screenshots caught what tests could not: a thick hatched flash ring, and the status label covering the objective on phones.
- The load test proved per-client filtering is cheap: 1,200 clients with 3 ticks over budget out of 358,876.

**Cut on purpose**

- Walls and line of sight. Distance alone gives the same tension, and costs far less to build and to read on a phone.
- Footstep sounds and other partial clues. They could be added if the dark feels too blind.

## Seen by, and an idea the data rejected

**Seen by** shows each player how many others can see them right now. Only the server knows this, and it sends each client its own number privately. It also fixed a quiet lie: the status could say hidden while someone nearby was watching.

**Fame is light**, making a high score visible from further away, was meant to pair with it. It was built in full, then switched off. Across 1,000 simulated rounds it favoured leaders (58.5% vs 52.7% wins for light-holding bots) and thinned the dark, which was the opposite of its purpose. Our first 300-round runs had suggested it helped underdogs; at a larger sample that disappeared. It stays one config number away, for a human playtest to settle.

