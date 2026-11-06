import { ACTION, BOTS, type PlayerInput, type SimPlayer } from "@wolfjam/shared";

export type Random = () => number;

/**
 * One bot decision. The output is an ordinary PlayerInput, which goes through
 * the same applyInput as a human's, so bots cannot do anything humans cannot.
 *
 * Swap the action line here when the verb changes.
 */
export function decide(bot: SimPlayer, players: readonly SimPlayer[], random: Random): PlayerInput {
  let target: SimPlayer | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of players) {
    if (other.id === bot.id) continue;
    const distance = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (distance < nearest) {
      nearest = distance;
      target = other;
    }
  }

  if (!target || nearest === 0) return { moveX: 0, moveY: 0, action: false };

  const toX = (target.x - bot.x) / nearest;
  const toY = (target.y - bot.y) / nearest;
  const jitter = (random() - 0.5) * BOTS.wanderJitter * 2;

  return {
    // Rotating the heading slightly keeps bots from walking in straight lines.
    moveX: toX - toY * jitter,
    moveY: toY + toX * jitter,
    action:
      nearest <= ACTION.radius &&
      bot.cooldown <= 0 &&
      random() < BOTS.actionChancePerDecision,
  };
}
