import Phaser from 'phaser';
import { InputState } from '../input/InputState';
import { readLayout } from '../layout';
import { GAME, COLORS } from '../game/config';
import type { GameSession, GameEvent, PlayerSnapshot } from '../game/types';
import { interpolate } from '../network/interpolation';
import { Juice, ensureLightTexture, LIGHT_TEXTURE } from '../effects/Juice';
import { glowRadius } from '@wolfjam/shared/sim';
import { AudioBus } from '../audio/AudioBus';

interface PlayerView {
  shape: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Image;
  shield: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  flashedUntil: number;
  /** Eased 0 to 1, so players fade in and out of the dark instead of popping. */
  fade: number;
  /** A player coming out of the dark snaps into place rather than sliding. */
  seen: boolean;
}

const FADE_MS = 160;
const ARROW_MARGIN = 28;

export class ArenaScene extends Phaser.Scene {
  private readonly controls: InputState;
  private readonly session: GameSession;
  private readonly audio: AudioBus;
  private readonly players = new Map<string, PlayerView>();
  private cameraTarget!: Phaser.GameObjects.Zone;
  private sight!: Phaser.GameObjects.Arc;
  private selfLight!: Phaser.GameObjects.Image;
  private beaconGlow!: Phaser.GameObjects.Image;
  private beaconRing!: Phaser.GameObjects.Arc;
  private nextRing!: Phaser.GameObjects.Arc;
  private lastLightWash!: Phaser.GameObjects.Rectangle;
  private arrow!: Phaser.GameObjects.Triangle;
  private juice!: Juice;
  private unsubscribe: (() => void) | undefined;

  constructor(controls: InputState, session: GameSession, audio: AudioBus) {
    super('arena'); this.controls = controls; this.session = session; this.audio = audio;
  }

  create(): void {
    const { width, height } = GAME.arena;
    ensureLightTexture(this);
    const floor = this.add.graphics();
    floor.fillStyle(COLORS.night).fillRect(0, 0, width, height);
    floor.lineStyle(1, COLORS.grid);
    for (let x = 0; x <= width; x += 80) floor.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 80) floor.lineBetween(0, y, width, y);
    floor.lineStyle(3, 0x2a3648).strokeRoundedRect(2, 2, width - 4, height - 4, 24);

    this.selfLight = this.add.image(0, 0, LIGHT_TEXTURE).setTint(COLORS.cyan).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(GAME.sightRadius * 2.6, GAME.sightRadius * 2.6).setAlpha(0.32).setDepth(1).setVisible(false);
    this.beaconGlow = this.add.image(0, 0, LIGHT_TEXTURE).setTint(COLORS.gold).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(GAME.beaconRadius * 3.1, GAME.beaconRadius * 3.1).setDepth(2).setVisible(false);
    this.beaconRing = this.add.circle(0, 0, GAME.beaconRadius).setStrokeStyle(2, COLORS.gold, 0.8).setDepth(2).setVisible(false);
    this.nextRing = this.add.circle(0, 0, GAME.beaconRadius).setStrokeStyle(2, COLORS.gold, 0.55).setDepth(2).setVisible(false);
    this.lastLightWash = this.add.rectangle(width / 2, height / 2, width, height, COLORS.gold, 0.1)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(1).setVisible(false);

    this.cameraTarget = this.add.zone(800, 450, 1, 1);
    this.sight = this.add.circle(800, 450, GAME.sightRadius).setStrokeStyle(1, COLORS.cyan, 0.22).setDepth(3).setVisible(false);
    this.arrow = this.add.triangle(0, 0, 0, -13, 13, 11, -13, 11, COLORS.gold).setScrollFactor(0).setDepth(30).setVisible(false);
    this.juice = new Juice(this, this.audio);
    this.unsubscribe = this.session.onEvent(this.onGameEvent);
    this.resize();
    this.cameras.main.startFollow(this.cameraTarget, false, 0.15, 0.15);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this);
      this.unsubscribe?.(); this.juice.destroy();
      this.controls.reset(); this.session.stopInput();
      this.players.clear();
    });
  }

  private resize(): void {
    const layout = readLayout(this.scale.width, this.scale.height);
    this.cameras.main.setViewport(0, layout.arenaTop, layout.width, layout.arenaHeight);
    this.cameras.main.setBounds(-layout.width / 2, -layout.arenaHeight / 2,
      GAME.arena.width + layout.width, GAME.arena.height + layout.arenaHeight);
  }

  update(time: number, delta: number): void {
    const input = this.controls.sample();
    if (input.actionPressed && this.controls.active) this.game.events.emit('action-feedback');
    this.session.update(input, delta);
    const paused = this.juice.step(delta);
    const selfId = this.session.status.sessionId;

    this.session.players.forEach((player, id) => {
      let view = this.players.get(id);
      if (!view) { view = this.makePlayer(id === selfId, id); this.players.set(id, view); }
      this.syncPlayer(view, player, id, id === selfId, paused, delta, time);
    });
    this.players.forEach((view, id) => {
      if (!this.session.players.has(id)) { view.shape.destroy(true); view.label.destroy(); this.players.delete(id); }
    });

    const self = this.players.get(selfId ?? '');
    const showSelf = Boolean(self) && this.session.round.phase === 'playing';
    this.sight.setVisible(showSelf);
    this.selfLight.setVisible(Boolean(self));
    if (self) {
      this.cameraTarget.setPosition(self.shape.x, self.shape.y);
      // With the glow on, the ring grows with your score: it shows how far away you can be seen.
      const reach = glowRadius({ score: this.session.players.get(selfId ?? '')?.score ?? 0 });
      this.sight.setPosition(self.shape.x, self.shape.y).setRadius(reach);
      this.selfLight.setPosition(self.shape.x, self.shape.y).setDisplaySize(reach * 2.6, reach * 2.6);
      this.sight.setStrokeStyle(1, this.session.watchers > 0 ? COLORS.coral : COLORS.cyan, this.session.watchers > 0 ? 0.6 : 0.22);
    }
    this.syncLight(time);
    this.cameras.main.setLerp(1 - Math.exp(-Math.min(delta, 50) / 90));
  }

  private syncPlayer(view: PlayerView, player: PlayerSnapshot, id: string, self: boolean, paused: boolean, delta: number, time: number): void {
    const goal = player.visible ? 1 : 0;
    view.fade = Phaser.Math.Clamp(view.fade + (goal > view.fade ? 1 : -1) * delta / FADE_MS, 0, 1);

    if (player.visible) {
      if (!view.seen) { view.shape.setPosition(player.x, player.y); view.seen = true; }
      if (!paused) {
        const before = { x: view.shape.x, y: view.shape.y };
        const after = self && this.session.mode === 'practice' ? player : interpolate(before, player, delta);
        if (Math.hypot(after.x - before.x, after.y - before.y) > 0.05) {
          view.shape.rotation = Math.atan2(after.y - before.y, after.x - before.x);
        }
        view.shape.setPosition(after.x, after.y);
      }
    } else if (view.fade === 0) {
      view.seen = false;
    }

    view.label.setPosition(view.shape.x, view.shape.y - 40);
    const presence = (player.connected === false ? 0.3 : 1) * view.fade;
    view.shape.setAlpha(presence).setVisible(view.fade > 0);
    view.label.setAlpha(presence).setVisible(view.fade > 0);
    view.label.setText(self ? 'YOU' : player.handle || id.slice(0, 4).toUpperCase());

    view.body.setFillStyle(player.stunned || Date.now() < view.flashedUntil ? COLORS.white : self ? COLORS.cyan : COLORS.coral);
    view.glow.setVisible(player.exposed === true).setAlpha(0.45 + Math.sin(time / 130) * 0.12);
    view.shield.setVisible(player.shielded === true).setAlpha(0.5 + Math.sin(time / 70) * 0.3);
  }

  private makePlayer(self: boolean, id: string): PlayerView {
    const color = self ? COLORS.cyan : COLORS.coral;
    const glow = this.add.image(0, 0, LIGHT_TEXTURE).setTint(COLORS.gold).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(150, 150).setVisible(false);
    const shadow = this.add.ellipse(0, 9, 62, 52, 0x000000, 0.35);
    const shield = this.add.circle(0, 0, 37).setStrokeStyle(2, COLORS.white, 0.7).setVisible(false);
    const body = this.add.circle(0, 0, GAME.arena.radius, color);
    const direction = this.add.triangle(6, 0, 0, 0, 9, 5, 0, 10, COLORS.navy).setOrigin(0.5);
    const shape = this.add.container(0, 0, [glow, shadow, shield, body, direction]).setDepth(5).setVisible(false);
    const label = this.add.text(0, 0, self ? 'YOU' : id.slice(0, 4).toUpperCase(), {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: self ? '#36D6D0' : '#F4F7FC',
      backgroundColor: '#05070D', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6).setVisible(false);
    return { shape, body, glow, shield, label, flashedUntil: 0, fade: 0, seen: false };
  }

  private syncLight(time: number): void {
    const beacon = this.session.beacon;
    const shown = beacon !== undefined;
    this.beaconGlow.setVisible(shown);
    this.beaconRing.setVisible(shown);
    this.lastLightWash.setVisible(this.session.lastLight);
    if (!beacon) { this.nextRing.setVisible(false); this.arrow.setVisible(false); return; }

    const pulse = 1 + Math.sin(time / 240) * 0.05;
    const size = GAME.beaconRadius * 3.1 * pulse;
    this.beaconGlow.setPosition(beacon.x, beacon.y).setDisplaySize(size, size);
    this.beaconRing.setPosition(beacon.x, beacon.y);
    this.nextRing.setPosition(beacon.nextX, beacon.nextY).setVisible(beacon.warning)
      .setScale(1 + Math.sin(time / 110) * 0.04).setAlpha(0.5 + Math.sin(time / 110) * 0.3);

    // The arena is bigger than a phone screen, so point at where to go next.
    const goalX = beacon.warning ? beacon.nextX : beacon.x;
    const goalY = beacon.warning ? beacon.nextY : beacon.y;
    this.pointArrow(goalX, goalY, this.session.round.phase === 'playing');
  }

  private pointArrow(worldX: number, worldY: number, active: boolean): void {
    const camera = this.cameras.main;
    const view = camera.worldView;
    // Hide the arrow as soon as the light itself has come into view.
    const reach = GAME.beaconRadius * 0.6;
    const onScreen = worldX > view.left - reach && worldX < view.right + reach && worldY > view.top - reach && worldY < view.bottom + reach;
    if (!active || onScreen) { this.arrow.setVisible(false); return; }
    const centerX = camera.width / 2;
    const centerY = camera.height / 2;
    const dx = worldX - view.centerX;
    const dy = worldY - view.centerY;
    const scale = Math.min((centerX - ARROW_MARGIN) / Math.max(Math.abs(dx), 1), (centerY - ARROW_MARGIN) / Math.max(Math.abs(dy), 1));
    this.arrow.setVisible(true).setPosition(centerX + dx * scale, centerY + dy * scale).setRotation(Math.atan2(dy, dx) + Math.PI / 2);
  }

  private readonly onGameEvent = (event: GameEvent): void => {
    const selfId = this.session.status.sessionId;
    const local = event.playerId === selfId || (event.type === 'hit' && event.sourceId === selfId);
    if (local || this.cameras.main.worldView.contains(event.x, event.y)) this.juice.event(event, local);
    if (event.type === 'hit') {
      const view = this.players.get(event.playerId);
      if (view) view.flashedUntil = Date.now() + 120;
    }
  };
}
