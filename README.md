# Nightlight

**To score, you must be seen.** A multiplayer game of light and dark for 2 to 6 players, built for Wolfjam 2026 on the theme of Visibility.

The arena is dark. A moving beacon pays points but lights you up for everyone. Hidden players can creep close and flash you to steal your score, but flashing gives them away too. The server never sends a position you are not allowed to see, so the dark cannot be hacked.

Move with WASD or the left stick. Flash with Space or the right button.

## Run it

```bash
npm install
npm run build
npm run dev
```

| URL | What it is |
|---|---|
| http://localhost:2567/ | Phaser game client with matchmaking, touch controls, and QR access |
| http://localhost:2567/debug | Playable stand-in client |
| http://localhost:2567/ops | Live ops console |
| http://localhost:2567/api/leaderboard | Top 10 |

Open `/debug` in a few tabs to play each other, or in one tab to play bots.

The Phaser 4.1.0 client lives in [client/](client/README.md). The production Docker image builds it automatically. For local client development, run `npm run dev:client` in a second terminal. Set `VITE_COLYSEUS_URL=http://localhost:2567` in `client/.env.local` to connect Vite to the server; without it the development client runs solo practice. For phones, use the laptop's LAN address in that endpoint and open Vite's Network URL. Production connects to the server's own origin without an override.

## Tune the game

Every rule number is in `shared/src/config.ts`, and both server and client read from it. The rules are in `shared/src/sim.ts`. To check that a change has not broken the balance:

```bash
npx tsx scripts/balance.ts 1000 4
```

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

- [Game design](docs/DESIGN.md), including the research and tuning
- [Client contract](docs/CONTRACT.md), for the Phaser client
- [Architecture](docs/ARCHITECTURE.md), for judges
- [Deploying to Railway](docs/DEPLOY.md)
- [Dev log](docs/DEVLOG.md)

## Credits

Built with [Colyseus](https://colyseus.io), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Express](https://expressjs.com), [tsx](https://tsx.is), [Phaser](https://phaser.io), Vite, and node-qrcode. Client visuals are code-drawn shapes. Four short sound effects use Kenney Interface Sounds (CC0); Barlow Condensed and DM Sans are bundled under SIL OFL 1.1. See [client audio credits](client/public/audio/CREDITS.md) and [dependency licenses](client/public/licenses/).
