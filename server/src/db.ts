import { randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { LeaderboardEntry, RoundStanding } from "@wolfjam/shared";

const ADJECTIVES = ["Swift", "Quiet", "Brave", "Lucky", "Sly", "Bold", "Calm", "Wild", "Neon", "Iron"];
const NOUNS = ["Wolf", "Otter", "Falcon", "Lynx", "Raven", "Fox", "Badger", "Heron", "Moth", "Pike"];

const pick = (items: readonly string[]): string => items[randomInt(items.length)] ?? "Player";

/** Handles are generated, never typed, so there is no free text to moderate. */
export function generateHandle(): string {
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${randomInt(10, 100)}`;
}

interface PlayerRow {
  handle: string;
}

export class Store {
  private readonly db: Database.Database;
  private readonly selectPlayer: Database.Statement<[string], PlayerRow>;
  private readonly applyResult: Database.Statement<[string, string, number, number]>;
  private readonly topPlayers: Database.Statement<[number], LeaderboardEntry>;
  private readonly recordRoundTx: (standings: RoundStanding[], winners: Set<string>) => void;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        high_score INTEGER NOT NULL DEFAULT 0,
        rounds INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS players_rank ON players (wins DESC, high_score DESC);
    `);

    this.selectPlayer = this.db.prepare("SELECT handle FROM players WHERE id = ?");
    this.applyResult = this.db.prepare(`
      INSERT INTO players (id, handle, wins, high_score, rounds)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (id) DO UPDATE SET
        wins = wins + excluded.wins,
        high_score = MAX(high_score, excluded.high_score),
        rounds = rounds + 1
    `);
    this.topPlayers = this.db.prepare(`
      SELECT handle, wins, high_score AS highScore, rounds
      FROM players
      WHERE rounds > 0
      ORDER BY wins DESC, high_score DESC
      LIMIT ?
    `);
    this.recordRoundTx = this.db.transaction((standings, winners) => {
      for (const standing of standings) {
        if (standing.kind !== "human") continue;
        const wins = winners.has(standing.id) ? 1 : 0;
        this.applyResult.run(standing.id, standing.handle, wins, standing.score);
      }
    });
  }

  /**
   * Looks up a returning player, or makes up a handle for a new one. This writes
   * nothing: rows appear only after a finished round, so hammering the queue with
   * fresh ids cannot grow the database.
   */
  handleFor(id: string): string {
    return this.selectPlayer.get(id)?.handle ?? generateHandle();
  }

  /** Writes one round atomically. Bots and swarm clients are never stored. */
  recordRound(standings: RoundStanding[], winners: Set<string>): void {
    this.recordRoundTx(standings, winners);
  }

  leaderboard(limit = 10): LeaderboardEntry[] {
    return this.topPlayers.all(limit);
  }

  close(): void {
    this.db.close();
  }
}

export const store = new Store(process.env.DB_PATH ?? "./data/wolfjam.db");
