import {
  applyInput,
  BOTS,
  botStyle,
  canSee,
  createPlayer,
  createWorld,
  decide,
  IDLE_INPUT,
  inBeacon,
  NET,
  ROUND,
  seededRandom,
  spawnPoint,
  stepWorld,
  type BotStyle,
  type PlayerInput,
} from "@wolfjam/shared";

/**
 * Plays thousands of rounds with no server, using the real rules and bot brain,
 * to check the design holds up before anyone tunes it by feel:
 *   npx tsx scripts/balance.ts [rounds] [players] [mixed|holder|lurker]
 *
 * Use a single style to test seat fairness, since mixed seats differ by style.
 */

const rounds = Number(process.argv[2] ?? 3000);
const seats = Number(process.argv[3] ?? 4);
const mix = process.argv[4] ?? "mixed";
const styleFor = (seat: number): BotStyle =>
  mix === "holder" || mix === "lurker" ? mix : botStyle(seat);
const dt = 1 / NET.tickRate;
const decisionTicks = Math.max(1, Math.round(NET.tickRate / BOTS.decisionsPerSecond));

const tally = {
  winsByStyle: { holder: 0, lurker: 0 } as Record<string, number>,
  winsBySeat: Array.from({ length: seats }, () => 0),
  scoreTotal: 0,
  topScore: 0,
  flashes: 0,
  hits: 0,
  hiddenPairs: 0,
  allPairs: 0,
  darkHidden: 0,
  darkPairs: 0,
  litTicks: 0,
  playerTicks: 0,
  leadChanges: 0,
  noWinner: 0,
  decidedInLastLight: 0,
};

for (let round = 0; round < rounds; round++) {
  const random = seededRandom(round + 1);
  const world = createWorld(random);
  world.players = Array.from({ length: seats }, (_, seat) => {
    const spawn = spawnPoint(seat, seats);
    return createPlayer(`p${seat}`, spawn.x, spawn.y);
  });
  const inputs: PlayerInput[] = world.players.map(() => ({ ...IDLE_INPUT }));
  const totalTicks = NET.tickRate * ROUND.playSeconds;
  let leader = "";
  let leaderBeforeLastLight = "";

  for (let tick = 0; tick < totalTicks; tick++) {
    if (tick % decisionTicks === 0) {
      world.players.forEach((player, seat) => {
        inputs[seat] = decide(player, world, styleFor(seat), random);
      });
    }
    world.players.forEach((player, seat) => {
      const input = inputs[seat] ?? IDLE_INPUT;
      applyInput(player, input, dt);
      inputs[seat] = { ...input, action: false };
    });

    for (const event of stepWorld(world, dt)) {
      tally.flashes++;
      tally.hits += event.hits.length;
    }

    for (const viewer of world.players) {
      tally.playerTicks++;
      if (inBeacon(world, viewer)) tally.litTicks++;
      for (const target of world.players) {
        if (viewer === target) continue;
        const hidden = !canSee(world, viewer, target);
        tally.allPairs++;
        if (hidden) tally.hiddenPairs++;
        if (!world.lastLight) {
          tally.darkPairs++;
          if (hidden) tally.darkHidden++;
        }
      }
    }

    const top = [...world.players].sort((a, b) => b.score - a.score)[0];
    if (top && top.score > 0 && top.id !== leader) {
      leader = top.id;
      tally.leadChanges++;
    }
    if (!world.lastLight) leaderBeforeLastLight = leader;
  }

  const ranked = [...world.players].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner || winner.score === 0) {
    tally.noWinner++;
    continue;
  }
  const seat = world.players.indexOf(winner);
  tally.winsByStyle[styleFor(seat)] = (tally.winsByStyle[styleFor(seat)] ?? 0) + 1;
  tally.winsBySeat[seat] = (tally.winsBySeat[seat] ?? 0) + 1;
  tally.scoreTotal += world.players.reduce((sum, player) => sum + player.score, 0);
  tally.topScore += winner.score;
  if (winner.id !== leaderBeforeLastLight) tally.decidedInLastLight++;
}

const percent = (part: number, whole: number): string => `${((part / whole) * 100).toFixed(1)}%`;
const perRound = (value: number): string => (value / rounds).toFixed(1);

console.log(`${rounds} rounds, ${seats} players`);
console.log(`Wins by style     holder ${percent(tally.winsByStyle.holder ?? 0, rounds)}, lurker ${percent(tally.winsByStyle.lurker ?? 0, rounds)}`);
console.log(`Wins by seat      ${tally.winsBySeat.map((wins) => percent(wins, rounds)).join(", ")}`);
console.log(`Flashes per round ${perRound(tally.flashes)}, hit rate ${percent(tally.hits, tally.flashes)}`);
console.log(`Top score         ${perRound(tally.topScore)} avg, mean player ${(tally.scoreTotal / rounds / seats).toFixed(1)}`);
console.log(`Positions hidden  ${percent(tally.hiddenPairs, tally.allPairs)} overall, ${percent(tally.darkHidden, tally.darkPairs)} before Last Light`);
console.log(`Time in the light ${percent(tally.litTicks, tally.playerTicks)}`);
console.log(`Lead changes      ${perRound(tally.leadChanges)} per round`);
console.log(`Comebacks         ${percent(tally.decidedInLastLight, rounds)} of rounds change hands in Last Light`);
console.log(`No winner         ${percent(tally.noWinner, rounds)}`);
