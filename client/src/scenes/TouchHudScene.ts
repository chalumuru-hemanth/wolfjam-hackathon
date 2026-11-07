import Phaser from 'phaser';
import { InputState } from '../input/InputState';
import { readLayout } from '../layout';
import type { Layout } from '../layout';
import { COLORS, GAME } from '../game/config';
import type { GameSession } from '../game/types';
import { ensureParticleTexture } from '../effects/Juice';

const RADIUS = 56;

export class TouchHudScene extends Phaser.Scene {
  private layout!: Layout;
  private graphics!: Phaser.GameObjects.Graphics;
  private moveLabel!: Phaser.GameObjects.Text;
  private actionLabel!: Phaser.GameObjects.Text;
  private keyLabel!: Phaser.GameObjects.Text;
  private stickPointer: number | null = null;
  private actionPointer: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private readonly session: GameSession;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly controls: InputState, session: GameSession) { super('touch-hud'); this.session = session; }

  create(): void {
    this.graphics = this.add.graphics();
    const textStyle = { fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: '#8e9fb5', letterSpacing: 2 };
    this.moveLabel = this.add.text(0, 0, 'MOVE', textStyle).setOrigin(0.5);
    this.actionLabel = this.add.text(0, 0, GAME.actionLabel, { ...textStyle, fontSize: '13px', color: '#101827' }).setOrigin(0.5).setDepth(2);
    this.keyLabel = this.add.text(0, 0, 'WASD + SPACE', { ...textStyle, fontSize: '10px', letterSpacing: 1 }).setOrigin(0.5);
    this.resize();
    ensureParticleTexture(this);
    this.sparks = this.add.particles(0, 0, 'spark', {
      emitting: false, maxParticles: 80, lifespan: 300, speed: { min: 70, max: 180 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 }, gravityY: 200,
      tint: [COLORS.gold, COLORS.white],
    }).setDepth(3);
    this.game.events.on('action-feedback', this.onAction, this);
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('gameout', this.onGameOut, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this.onDown, this);
      this.input.off('pointermove', this.onMove, this);
      this.input.off('pointerup', this.onUp, this);
      this.input.off('pointerupoutside', this.onUp, this);
      this.input.off('gameout', this.onGameOut, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this);
      this.game.events.off('action-feedback', this.onAction, this);
      this.releaseAll();
    });
  }

  private onAction(): void {
    const self = this.session.players.get(this.session.status.sessionId ?? '');
    if (self?.stunned || this.session.cooldownMs > 0) return;
    this.sparks.explode(10, this.layout.actionX, this.layout.controlY);
  }

  releaseAll(): void {
    this.stickPointer = null;
    this.actionPointer = null;
    this.stickX = 0;
    this.stickY = 0;
    this.controls.reset();
  }

  private resize(): void {
    this.releaseAll();
    this.layout = readLayout(this.scale.width, this.scale.height);
    const { joystickX, actionX, controlY } = this.layout;
    this.moveLabel.setPosition(joystickX, controlY + 70);
    this.actionLabel.setPosition(actionX, controlY);
    this.keyLabel.setPosition(this.layout.width / 2, controlY + 3).setVisible(this.layout.width >= 600);
  }

  private readonly onDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.controls.active || pointer.button > 0) return;
    const { joystickX, actionX, controlY } = this.layout;
    if (this.stickPointer === null && Math.hypot(pointer.x - joystickX, pointer.y - controlY) <= RADIUS + 12) {
      this.stickPointer = pointer.id;
      this.updateStick(pointer);
    } else if (this.actionPointer === null && Math.hypot(pointer.x - actionX, pointer.y - controlY) <= RADIUS + 8) {
      this.actionPointer = pointer.id;
      this.controls.setTouchAction(true);
    }
  };

  private readonly onMove = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id === this.stickPointer) this.updateStick(pointer);
  };

  private readonly onUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.id === this.stickPointer) {
      this.stickPointer = null;
      this.stickX = 0;
      this.stickY = 0;
      this.controls.setJoystick(0, 0);
    }
    if (pointer.id === this.actionPointer) {
      this.actionPointer = null;
      this.controls.setTouchAction(false);
    }
  };

  private readonly onGameOut = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.wasTouch || !pointer.isDown) this.onUp(pointer);
  };

  private updateStick(pointer: Phaser.Input.Pointer): void {
    const dx = pointer.x - this.layout.joystickX;
    const dy = pointer.y - this.layout.controlY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > RADIUS ? RADIUS / distance : 1;
    this.stickX = dx * scale;
    this.stickY = dy * scale;
    this.controls.setJoystick(dx / RADIUS, dy / RADIUS);
  }

  update(): void {
    const { width, height, controlsTop, joystickX, actionX, controlY } = this.layout;
    const graphics = this.graphics;
    const active = this.controls.active;
    graphics.clear().fillStyle(COLORS.navy).fillRect(0, controlsTop, width, height - controlsTop);
    graphics.lineStyle(1, 0x253247).lineBetween(20, controlsTop, width - 20, controlsTop);
    graphics.fillStyle(0x172337).fillCircle(joystickX, controlY, RADIUS);
    graphics.lineStyle(2, active && this.stickPointer !== null ? COLORS.cyan : 0x35485f)
      .strokeCircle(joystickX, controlY, RADIUS);
    graphics.lineStyle(1, 0x35485f, 0.65).strokeCircle(joystickX, controlY, 32);
    graphics.lineBetween(joystickX - 40, controlY, joystickX + 40, controlY)
      .lineBetween(joystickX, controlY - 40, joystickX, controlY + 40);
    graphics.fillStyle(COLORS.cyan, active ? 1 : 0.3).fillCircle(joystickX + this.stickX, controlY + this.stickY, 22);
    graphics.lineStyle(1, COLORS.white, 0.35).strokeCircle(joystickX + this.stickX, controlY + this.stickY, 22);
    const held = this.controls.actionHeld;
    graphics.lineStyle(1, COLORS.gold, 0.25).strokeCircle(actionX, controlY, RADIUS + 6);
    graphics.fillStyle(0x9a7420).fillCircle(actionX, controlY + (held ? 2 : 5), RADIUS);
    const self = this.session.players.get(this.session.status.sessionId ?? '');
    const available = self?.actionReady !== false && !self?.stunned && this.session.cooldownMs === 0;
    this.actionLabel.setText(self?.stunned ? 'STUNNED' : available ? GAME.actionLabel : 'WAIT');
    graphics.fillStyle(held && available ? COLORS.white : available ? COLORS.gold : 0x738197, active ? 1 : 0.3)
      .fillCircle(actionX, controlY + (held ? 3 : 0), held ? RADIUS - 3 : RADIUS);
    this.actionLabel.setY(controlY + (held ? 3 : 0));
    const cooldown = Math.min(1, this.session.cooldownMs / GAME.actionCooldownMs);
    if (cooldown > 0 && active) {
      graphics.lineStyle(4, COLORS.white, 0.85).beginPath()
        .arc(actionX, controlY, RADIUS + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cooldown)).strokePath();
    }
  }
}
