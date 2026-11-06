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

## Theme and verb

_To fill in once the theme is out._
