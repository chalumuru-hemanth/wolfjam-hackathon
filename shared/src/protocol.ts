/** Everything both sides must agree on. docs/CONTRACT.md explains how to use it. */

export const ROOMS = { wait: "wait", arena: "arena" } as const;

export const PHASES = ["waiting", "countdown", "playing", "results"] as const;
export type Phase = (typeof PHASES)[number];

export const PLAYER_KINDS = ["human", "bot", "swarm"] as const;
export type PlayerKind = (typeof PLAYER_KINDS)[number];

export const MESSAGES = {
  /** Server to client, in the wait room. Payload is a seat reservation. */
  matched: "matched",
  /** Server to client, in the arena. Payload is ActionFx. */
  fx: "fx",
  /** Server to client, in the arena. Payload is RoundResult. */
  roundResult: "round_result",
} as const;

/** Options the client passes when joining the wait room. */
export interface QueueJoinOptions {
  /** A UUID the client generated and kept in localStorage. */
  playerId?: string;
  /** Used by the load tester. Humans leave it out. */
  kind?: "swarm";
}

/** Options the server places in the seat reservation for the arena. */
export interface ArenaJoinOptions {
  playerId: string;
  handle: string;
  kind: PlayerKind;
  /** Proves the seat came from the matchmaker. Never sent to clients. */
  roomKey: string;
}

export interface ActionFx {
  by: string;
  x: number;
  y: number;
  hits: string[];
}

export interface RoundStanding {
  id: string;
  handle: string;
  kind: PlayerKind;
  score: number;
}

export interface RoundResult {
  /** Empty when nobody scored. More than one entry means a tie. */
  winners: string[];
  standings: RoundStanding[];
}

export interface LeaderboardEntry {
  handle: string;
  wins: number;
  highScore: number;
  rounds: number;
}
