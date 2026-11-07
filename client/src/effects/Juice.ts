import Phaser from 'phaser';
import { COLORS, GAME } from '../game/config';
import type { GameEvent } from '../game/types';
import { AudioBus } from '../audio/AudioBus';

export function ensureParticleTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('spark')) return;
  const graphics = scene.add.graphics();
  graphics.fillStyle(0xffffff).fillCircle(4, 4, 4).generateTexture('spark', 8, 8);
  graphics.destroy();
}

export class Juice {
  private readonly scene: Phaser.Scene;
  private readonly audio: AudioBus;
  private readonly particles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly popups = new Set<Phaser.GameObjects.Text>();
  private readonly rings = new Set<Phaser.GameObjects.Arc>();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pauseMs = 0;
  private lastShake = 0;

  constructor(scene: Phaser.Scene, audio: AudioBus) {
    this.scene = scene; this.audio = audio;
    ensureParticleTexture(scene);
    this.particles = scene.add.particles(0, 0, 'spark', {
      emitting: false, maxParticles: 160, lifespan: 320, speed: { min: 35, max: 200 },
      scale: { start: 0.8, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [COLORS.cyan, COLORS.coral, COLORS.white],
    }).setDepth(8);
  }

  step(delta: number): boolean { this.pauseMs = Math.max(0, this.pauseMs - delta); return this.pauseMs > 0; }

  event(event: GameEvent, local: boolean): void {
    if (event.type === 'action') {
      this.audio.play('action');
      if (this.rings.size < 12) {
        const ring = this.scene.add.circle(event.x, event.y, 18).setStrokeStyle(3, COLORS.cyan).setDepth(5);
        this.rings.add(ring);
        this.scene.tweens.add({ targets: ring, scale: GAME.actionRadius / 18, alpha: 0, duration: 280,
          ease: 'Cubic.Out', onComplete: () => { this.rings.delete(ring); ring.destroy(); } });
      }
      this.particles.explode(this.reducedMotion ? 4 : 12, event.x, event.y);
    } else if (event.type === 'hit') {
      this.audio.play('hit');
      this.particles.explode(this.reducedMotion ? 5 : 20, event.x, event.y);
      if (local) this.pauseMs = Math.max(this.pauseMs, 45);
      if (local && !this.reducedMotion && performance.now() - this.lastShake > 90) {
        this.scene.cameras.main.shake(90, 0.003);
        this.lastShake = performance.now();
      }
    } else {
      if (local) this.audio.play('score');
      if (this.popups.size >= 12) return;
      const label = `${event.amount >= 0 ? '+' : ''}${Math.trunc(event.amount)}`;
      const popup = this.scene.add.text(event.x, event.y - 26, label, {
        fontFamily: 'system-ui, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#F4F7FC',
        stroke: '#101827', strokeThickness: 5,
      }).setOrigin(0.5).setDepth(15);
      this.popups.add(popup);
      this.scene.tweens.add({ targets: popup, y: popup.y - (this.reducedMotion ? 15 : 55), alpha: 0,
        scale: 1.15, duration: 650, ease: 'Cubic.Out', onComplete: () => { this.popups.delete(popup); popup.destroy(); } });
    }
  }

  destroy(): void {
    this.particles.destroy();
    for (const object of [...this.popups, ...this.rings]) { this.scene.tweens.killTweensOf(object); object.destroy(); }
    this.popups.clear(); this.rings.clear();
  }
}
