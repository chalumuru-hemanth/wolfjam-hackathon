import Phaser from 'phaser';
import { InputState } from '../input/InputState';
import { readLayout } from '../layout';
import { GAME, COLORS } from '../game/config';
import type { GameSession, GameEvent, PlayerSnapshot } from '../game/types';
import { interpolate } from '../network/interpolation';
import { Juice } from '../effects/Juice';
import { AudioBus } from '../audio/AudioBus';

interface PlayerView {
  shape: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  flashedUntil: number;
}

export class ArenaScene extends Phaser.Scene {
  private readonly controls: InputState;
  private readonly session: GameSession;
  private readonly audio: AudioBus;
  private readonly players = new Map<string, PlayerView>();
  private readonly targets = new Map<string, Phaser.GameObjects.Polygon>();
  private cameraTarget!: Phaser.GameObjects.Zone;
  private range!: Phaser.GameObjects.Arc;
  private juice!: Juice;
  private unsubscribe: (() => void) | undefined;

  constructor(controls: InputState, session: GameSession, audio: AudioBus) {
    super('arena'); this.controls = controls; this.session = session; this.audio = audio;
  }

  create(): void {
    const { width, height } = GAME.arena;
    const floor = this.add.graphics();
    floor.fillStyle(COLORS.navy).fillRect(0, 0, width, height);
    floor.lineStyle(1, 0x1c293b);
    for (let x = 0; x <= width; x += 80) floor.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 80) floor.lineBetween(0, y, width, y);
    floor.lineStyle(3, 0x35465d).strokeRoundedRect(2, 2, width - 4, height - 4, 24);
    floor.lineStyle(1, COLORS.cyan, 0.14).strokeCircle(800, 450, 100).strokeCircle(800, 450, 104);
    floor.lineBetween(780, 450, 820, 450).lineBetween(800, 430, 800, 470);
    this.cameraTarget = this.add.zone(800, 450, 1, 1);
    this.range = this.add.circle(800, 450, GAME.actionRadius).setStrokeStyle(1, COLORS.cyan, 0.15).setVisible(false);
    this.juice = new Juice(this, this.audio);
    this.unsubscribe = this.session.onEvent(this.onGameEvent);
    this.resize();
    this.cameras.main.startFollow(this.cameraTarget, false, 0.15, 0.15);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this);
      this.unsubscribe?.(); this.juice.destroy();
      this.controls.reset(); this.session.stopInput();
      this.players.clear(); this.targets.clear();
    });
  }

  private resize(): void {
    const layout = readLayout(this.scale.width, this.scale.height);
    this.cameras.main.setViewport(0, layout.arenaTop, layout.width, layout.arenaHeight);
    this.cameras.main.setBounds(-layout.width / 2, -layout.arenaHeight / 2,
      GAME.arena.width + layout.width, GAME.arena.height + layout.arenaHeight);
  }

  update(_time: number, delta: number): void {
    const input = this.controls.sample();
    if (input.actionPressed && this.controls.active) this.game.events.emit('action-feedback');
    this.session.update(input, delta);
    const paused = this.juice.step(delta);
    const selfId = this.session.status.sessionId;
    this.session.players.forEach((player, id) => {
      let view = this.players.get(id);
      if (!view) { view = this.makePlayer(player, id === selfId, id); this.players.set(id, view); }
      if (!paused) {
        const before = { x: view.shape.x, y: view.shape.y };
        const after = id === selfId && this.session.mode === 'practice' ? player : interpolate(before, player, delta);
        if (Math.hypot(after.x - before.x, after.y - before.y) > 0.05) {
          view.shape.rotation = Math.atan2(after.y - before.y, after.x - before.x);
        }
        view.shape.setPosition(after.x, after.y);
        view.label.setPosition(after.x, after.y - 34);
      }
      const dim = player.connected === false ? 0.3 : 1;
      view.shape.setAlpha(dim); view.label.setAlpha(dim);
      view.label.setText(id === selfId ? 'YOU' + (player.handle ? ' · ' + player.handle : '') : player.handle || id.slice(0, 4).toUpperCase());
      view.body.setFillStyle(player.stunned || Date.now() < view.flashedUntil ? COLORS.white : id === selfId ? COLORS.cyan : COLORS.coral);
      if (id === selfId) {
        this.cameraTarget.setPosition(view.shape.x, view.shape.y);
        this.range.setPosition(view.shape.x, view.shape.y).setVisible(this.session.round.phase === 'playing');
        this.range.setAlpha(this.session.cooldownMs > 0 ? 0.3 : 1);
      }
    });
    this.players.forEach((view, id) => {
      if (!this.session.players.has(id)) { view.shape.destroy(true); view.label.destroy(); this.players.delete(id); }
    });
    if (!selfId || !this.session.players.has(selfId)) this.range.setVisible(false);
    this.syncTargets(_time);
    this.cameras.main.setLerp(1 - Math.exp(-Math.min(delta, 50) / 90));
  }

  private makePlayer(player: PlayerSnapshot, self: boolean, id: string): PlayerView {
    const color = self ? COLORS.cyan : COLORS.coral;
    const shadow = this.add.ellipse(0, 9, 62, 52, 0x000000, 0.35);
    const outline = this.add.circle(0, 0, 35).setStrokeStyle(1, color, 0.25);
    const body = this.add.circle(0, 0, GAME.arena.radius, color);
    const direction = this.add.triangle(6, 0, 0, 0, 9, 5, 0, 10, COLORS.navy).setOrigin(0.5);
    const shape = this.add.container(player.x, player.y, [shadow, outline, body, direction]).setDepth(4);
    const label = this.add.text(player.x, player.y - 34, self ? 'YOU' : id.slice(0, 4).toUpperCase(), {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: self ? '#36D6D0' : '#F4F7FC',
      backgroundColor: '#101827', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(4);
    return { shape, body, label, flashedUntil: 0 };
  }

  private syncTargets(time: number): void {
    const self = this.session.players.get(this.session.status.sessionId ?? '');
    this.session.targets.forEach((target, id) => {
      let view = this.targets.get(id);
      if (!view) {
        view = this.add.polygon(target.x, target.y, [0, -14, 11, 0, 0, 14, -11, 0], COLORS.coral)
          .setStrokeStyle(2, COLORS.white, 0.75).setDepth(2);
        this.targets.set(id, view);
      }
      const inRange = self && Math.hypot(target.x - self.x, target.y - self.y) <= GAME.actionRadius;
      view.setPosition(target.x, target.y).setVisible(target.active)
        .setScale(1 + Math.sin(time / 220 + target.x) * 0.08).setAlpha(inRange ? 1 : 0.65);
      view.setStrokeStyle(inRange ? 3 : 1, inRange ? COLORS.white : COLORS.coral, inRange ? 1 : 0.5);
    });
    this.targets.forEach((view, id) => { if (!this.session.targets.has(id)) { view.destroy(); this.targets.delete(id); } });
  }

  private readonly onGameEvent = (event: GameEvent): void => {
    const local = event.playerId === this.session.status.sessionId || (event.type === 'hit' && event.sourceId === this.session.status.sessionId);
    if (local || this.cameras.main.worldView.contains(event.x, event.y)) this.juice.event(event, local);
    if (event.type === 'hit') {
      const view = this.players.get(event.playerId);
      if (view) view.flashedUntil = Date.now() + 120;
    }
  };
}
