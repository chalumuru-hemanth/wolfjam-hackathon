import Phaser from 'phaser';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import './style.css';
import './home.css';
import { InputState } from './input/InputState';
import { KeyboardInput } from './input/KeyboardInput';
import { ArenaScene } from './scenes/ArenaScene';
import { TouchHudScene } from './scenes/TouchHudScene';
import { prepareJoin } from './join';
import { readNetworkConfig } from './network/config';
import type { NetworkConfig } from './network/config';
import { NetworkSession } from './network/NetworkSession';
import { connectColyseus } from './network/colyseus';
import { storedToken } from './network/identity';
import { PracticeSession } from './game/PracticeSession';
import type { GameSession } from './game/types';
import { AudioBus } from './audio/AudioBus';
import { GameUi } from './ui/GameUi';
import { SessionRouter } from './game/SessionRouter';
import { PartySession } from './network/PartySession';
import { browserStore } from './network/identity';
import { PlayMenu } from './ui/PlayMenu';
import { ServerAvailability } from './network/ServerAvailability';

let config: NetworkConfig = { roomName: 'wait' };
let configError = '';
try { config = readNetworkConfig(import.meta.env, window.location.href, import.meta.env.PROD); }
catch (error) { configError = error instanceof Error ? error.message : 'Invalid multiplayer configuration.'; }
let savedParty = '';
try { savedParty = browserStore('sessionStorage')?.getItem('wolfjam.party.code:' + config.endpoint) ?? ''; } catch {}
const invitedParty = new URL(location.href).searchParams.get('party')?.trim().toUpperCase();
if (invitedParty && invitedParty !== savedParty) savedParty = '';
const session = new SessionRouter(savedParty ? new PartySession(config, savedParty) :
  config.endpoint ? new NetworkSession(connectColyseus, config) : new PracticeSession());
const controls = new InputState();
const keyboard = new KeyboardInput(controls);
const audio = new AudioBus();
const arena = new ArenaScene(controls, session, audio);
const hud = new TouchHudScene(controls, session);
const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#05070d', antialias: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 3, keyboard: false, touch: { capture: true } },
  scene: [arena, hud],
});
game.events.once(Phaser.Core.Events.READY, () => { game.scene.start('touch-hud'); });
const availability = new ServerAvailability(config.endpoint);
const ui = new GameUi(session, audio, configError, availability);
let foreground = document.hasFocus();
let animation = 0;
const reset = (): void => {
  controls.reset();
  if (game.scene.isActive('touch-hud')) hud.releaseAll();
  session.stopInput();
};
const syncInput = (): void => {
  const self = session.players.get(session.status.sessionId ?? '');
  const active = session.status.phase === 'connected' && self?.connected !== false && session.round.phase === 'playing' && !ui.titleVisible && foreground && !document.hidden;
  if (controls.active !== active) { reset(); controls.setEnabled(active); }
};
const wake = (): void => { foreground = true; syncInput(); void audio.unlock(); };
const launch = (driver: GameSession): void => {
  reset(); controls.setEnabled(false); session.use(driver); ui.enter(); wake(); void session.join();
};
const onPlay = (): void => {
  wake();
  if (configError) return;
  if (session.connected) ui.enter();
  else if (config.endpoint && availability.available) { menu.clearInvite(); launch(new NetworkSession(connectColyseus, config)); }
};
const showTitle = (): void => { reset(); controls.setEnabled(false); ui.showTitle(); };
const onExit = (): void => {
  showTitle();
  session.disconnect();
  menu.clearInvite();
  audio.suspend();
  document.querySelector<HTMLElement>('#game-title')!.focus({ preventScroll: true });
};
const readyButton = document.querySelector<HTMLButtonElement>('#ready-button')!;
const againButton = document.querySelector<HTMLButtonElement>('#again-button')!;
const onReady = (): void => {
  wake(); readyButton.blur();
  session.ready(!session.players.get(session.status.sessionId ?? '')?.ready);
  ui.render();
};
const onAgain = (): void => { wake(); againButton.blur(); reset(); ui.requestRematch(); };
const onBlur = (): void => { foreground = false; reset(); audio.suspend(); };
const onFocus = (): void => { foreground = true; reset(); };
const onVisibility = (): void => { if (document.hidden) onBlur(); else { foreground = document.hasFocus(); reset(); } };
const onPageHide = (): void => { showTitle(); if (session.mode === 'practice') session.disconnect(); audio.suspend(); };
const onCancel = (): void => reset();
let previousPhase = session.status.phase;
const unsubscribe = session.subscribe((status) => {
  if (status.phase === 'error' || status.phase === 'disconnected') showTitle();
  if (status.phase === 'connected' && (previousPhase === 'idle' || previousPhase === 'connecting')) ui.enter();
  previousPhase = status.phase;
  ui.render(); syncInput();
});
const play = document.querySelector<HTMLButtonElement>('#play-button')!;
const join = document.querySelector<HTMLButtonElement>('#join-button')!;
const exit = document.querySelector<HTMLButtonElement>('#exit-button')!;
const back = document.querySelector<HTMLButtonElement>('#results-back')!;
play.addEventListener('click', onPlay);
join.addEventListener('click', showTitle);
exit.addEventListener('click', onExit);
back.addEventListener('click', onExit);
readyButton.addEventListener('click', onReady);
againButton.addEventListener('click', onAgain);
const menu = new PlayMenu(session, config, availability, launch);
window.addEventListener('blur', onBlur);
window.addEventListener('focus', onFocus);
window.addEventListener('pagehide', onPageHide);
window.addEventListener('orientationchange', reset);
window.addEventListener('pointerdown', wake, true);
window.addEventListener('keydown', wake, true);
document.addEventListener('visibilitychange', onVisibility);
game.canvas.addEventListener('touchcancel', onCancel, { passive: true });
game.canvas.addEventListener('pointercancel', onCancel, { passive: true });
game.scale.on(Phaser.Scale.Events.RESIZE, reset);
void prepareJoin();
const initialRound = session.round.roundId;
void availability.check().then((available) => {
  // A pending startup check must never interrupt a mode the player has already chosen.
  if (available && config.endpoint && session.round.roundId === initialRound && session.status.phase === 'idle' &&
    (savedParty || (!invitedParty && storedToken(config.endpoint)))) {
    ui.enter(); void session.join();
  }
});
let flashes = 0;
session.onEvent((event) => { if (event.type === 'action' && event.playerId === session.status.sessionId) flashes++; });
const render = (): void => { ui.render(); menu.render(); syncInput(); animation = requestAnimationFrame(render); };
animation = requestAnimationFrame(render);

if (import.meta.env.PROD && isSecureContext && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => { /* The loaded game still supports solo play. */ });
}

// Read-only development seam for end-to-end checks; removed from production builds.
if (import.meta.env.DEV) {
  window.__wolfjam = () => ({
    mode: session.mode, phase: session.round.phase, remainingMs: session.remainingMs,
    player: session.players.get(session.status.sessionId ?? ''), inputEnabled: controls.active,
    input: arena.currentInput,
    playerCount: session.players.size, audioState: audio.state, audioLoaded: audio.loaded, flashes, beacon: session.beacon,
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(animation);
    play.removeEventListener('click', onPlay); join.removeEventListener('click', showTitle);
    exit.removeEventListener('click', onExit);
    back.removeEventListener('click', onExit); readyButton.removeEventListener('click', onReady);
    againButton.removeEventListener('click', onAgain);
    window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
    window.removeEventListener('pagehide', onPageHide); window.removeEventListener('orientationchange', reset);
    window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true);
    document.removeEventListener('visibilitychange', onVisibility);
    game.canvas.removeEventListener('touchcancel', onCancel); game.canvas.removeEventListener('pointercancel', onCancel);
    game.scale.off(Phaser.Scale.Events.RESIZE, reset);
    menu.destroy(); ui.destroy(); availability.destroy(); unsubscribe(); session.destroy(); keyboard.destroy(); audio.destroy();
    delete window.__wolfjam;
    game.destroy(true);
  });
}
