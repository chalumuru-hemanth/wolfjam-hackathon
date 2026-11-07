import { ACTION, BEACON, BOTS } from "./config.ts";
import { announcedSpot, canSee, type PlayerInput, type SimPlayer, type World } from "./sim.ts";

export type Random = () => number;

/** Holders go for the light. Lurkers wait in the dark to punish whoever does. */
export type BotStyle = "holder" | "lurker";

export const botStyle = (index: number): BotStyle => (index % 2 === 0 ? "holder" : "lurker");

function steer(bot: SimPlayer, x: number, y: number, random: Random): { moveX: number; moveY: number } {
  const dx = x - bot.x;
  const dy = y - bot.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 8) return { moveX: 0, moveY: 0 };
  const toX = dx / distance;
  const toY = dy / distance;
  const jitter = (random() - 0.5) * BOTS.wanderJitter * 2;
  // Rotating the heading slightly keeps bots from walking in straight lines.
  return { moveX: toX - toY * jitter, moveY: toY + toX * jitter };
}

/**
 * One bot decision. Bots read the world only through canSee, the same rule that
 * filters what human clients receive, so they cannot see through the dark.
 * Their output is an ordinary PlayerInput, so they cannot break any other rule.
 */
export function decide(bot: SimPlayer, world: World, style: BotStyle, random: Random): PlayerInput {
  let target: SimPlayer | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  let prey: SimPlayer | undefined;
  for (const other of world.players) {
    if (other.id === bot.id || other.immune > 0 || !canSee(world, bot, other)) continue;
    const distance = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (distance < nearest) {
      nearest = distance;
      target = other;
    }
    // Lurkers stalk whoever is worth the most, which a glowing leader makes easy.
    if (!prey || other.score > prey.score) prey = other;
  }

  const goal = announcedSpot(world.beacon);
  const action =
    target !== undefined &&
    nearest <= ACTION.radius &&
    bot.cooldown <= 0 &&
    random() < BOTS.actionChancePerDecision;

  if (style === "holder" || !target) {
    if (style === "holder") return { ...steer(bot, goal.x, goal.y, random), action };

    // A lurker with nothing in sight circles just outside the light.
    const fromGoal = Math.atan2(bot.y - goal.y, bot.x - goal.x) + 0.35;
    const ring = BEACON.radius + BOTS.lurkDistance;
    const x = goal.x + Math.cos(fromGoal) * ring;
    const y = goal.y + Math.sin(fromGoal) * ring;
    return { ...steer(bot, x, y, random), action };
  }

  const chase = prey ?? target;
  return { ...steer(bot, chase.x, chase.y, random), action };
}
