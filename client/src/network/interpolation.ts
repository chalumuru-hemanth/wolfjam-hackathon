import type { Point } from '../game/types.ts';

/** Frame-rate-independent lerp only. No prediction, extrapolation, or input replay. */
export function interpolate(current: Point, target: Point, deltaMs: number): Point {
  const distance = Math.hypot(target.x - current.x, target.y - current.y);
  if (distance > 300) return { ...target };
  const alpha = 1 - Math.exp(-Math.max(0, deltaMs) / 80);
  return { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha };
}
