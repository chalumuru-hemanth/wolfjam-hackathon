# Wolfjam 2026

A browser arena game for 2 to 6 players, with a server built like a live service. Colyseus 0.18, TypeScript, SQLite.

## Run it

```bash
npm install
npm run dev
```

| URL | What it is |
|---|---|
| http://localhost:2567/debug | Playable stand-in client |
| http://localhost:2567/ops | Live ops console |
| http://localhost:2567/api/leaderboard | Top 10 |

Open `/debug` in a few tabs to play each other, or in one tab to play bots.

## Add the theme

| To change | Edit |
|---|---|
| Game name and theme label | `GAME_IDENTITY` in `shared/src/config.ts` |
| **The verb** | `resolveAction` in `shared/src/sim.ts` |
| When bots use the verb | `action` in `server/src/bots/brain.ts` |
| Any tuning number | `shared/src/config.ts` |
| New data for clients | `shared/src/schema.ts`, set in `syncViews` in `server/src/rooms/ArenaRoom.ts` |

Then update the verb tests in `shared/src/sim.test.ts`, the fields in `docs/CONTRACT.md`, and the input if the verb needs more than one button.

## Check it

```bash
npm run typecheck
```

```bash
npm test
```

With the server running, in a second terminal:

```bash
npm run smoke
```

```bash
npm run abuse
```

`smoke` plays a full round and takes about a minute. `abuse` attacks the server as a hostile client and takes about 30 seconds. CI runs both against the production Docker image.

Use a current Node 22 or newer. Node 22.13 on Windows segfaulted when starting the server, while 22.23 on Linux and 26 on Windows both work.

## Docs

- [Client contract](docs/CONTRACT.md), for the Phaser client
- [Architecture](docs/ARCHITECTURE.md), for judges
- [Deploying to Railway](docs/DEPLOY.md)
- [Dev log](docs/DEVLOG.md)

## Credits

Built with [Colyseus](https://colyseus.io), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Express](https://expressjs.com) and [tsx](https://tsx.is). Add audio and art credits here.
