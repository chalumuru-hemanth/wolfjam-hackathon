import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { MATCH, type RoundStanding } from "@wolfjam/shared";

process.env.DB_PATH = ":memory:";
const { Store, generateHandle } = await import("./db.ts");
const { takeGroup } = await import("./matchmaking.ts");

type Queued = Parameters<typeof takeGroup>[0][number];

const queued = (queuedAt: number): Queued =>
  ({ playerId: "x", handle: "x", kind: "human", queuedAt }) as Queued;

const standing = (id: string, score: number, kind: RoundStanding["kind"] = "human"): RoundStanding => ({
  id,
  handle: id,
  kind,
  score,
});

test("a lone player waits until the queue timeout", () => {
  const pool = [queued(0)];
  assert.equal(takeGroup(pool, MATCH.queueTimeoutMs - 1).length, 0);
  assert.equal(takeGroup(pool, MATCH.queueTimeoutMs).length, 1);
});

test("a full group starts immediately, and the rest stay queued", () => {
  const pool = Array.from({ length: MATCH.maxPlayers + 2 }, () => queued(0));
  assert.equal(takeGroup(pool, 0).length, MATCH.maxPlayers);
  assert.equal(pool.length, 2);
});

test("the database keeps the best score and adds up wins", () => {
  const store = new Store(":memory:");
  store.recordRound([standing("p1", 9)], new Set(["p1"]));
  store.recordRound([standing("p1", 4)], new Set());
  assert.deepEqual(store.leaderboard(), [{ handle: "p1", wins: 1, highScore: 9, rounds: 2 }]);
  store.close();
});

test("a returning player keeps their first handle", () => {
  const store = new Store(":memory:");
  store.recordRound([{ ...standing("p1", 1), handle: "First" }], new Set());
  store.recordRound([{ ...standing("p1", 1), handle: "Second" }], new Set());
  assert.equal(store.handleFor("p1"), "First");
  store.close();
});

test("looking up a new player writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "wolfjam-"));
  const path = join(dir, "test.db");
  const store = new Store(path);
  for (let i = 0; i < 25; i++) assert.ok(store.handleFor(`stranger-${i}`).length > 0);
  store.close();

  const direct = new Database(path, { readonly: true });
  const row = direct.prepare("SELECT COUNT(*) AS total FROM players").get() as { total: number };
  direct.close();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(row.total, 0);
});

test("bots and swarm clients never reach the leaderboard", () => {
  const store = new Store(":memory:");
  store.recordRound(
    [standing("p1", 1), standing("bot_1", 50, "bot"), standing("s1", 50, "swarm")],
    new Set(["bot_1", "s1"]),
  );
  const board = store.leaderboard();
  assert.equal(board.length, 1);
  assert.equal(board[0]?.wins, 0);
  store.close();
});

test("handles match the expected safe shape", () => {
  assert.match(generateHandle(), /^[A-Za-z]+\d{2}$/);
});
