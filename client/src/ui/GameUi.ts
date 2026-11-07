import type { GameSession } from '../game/types';
import { standings } from '../game/types';
import { GAME } from '../game/config';
import { AudioBus } from '../audio/AudioBus';
import { BEACON } from '@wolfjam/shared/config';
import type { ServerAvailability } from '../network/ServerAvailability';

const OBJECTIVE_MS = 8000;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

export class GameUi {
  titleVisible = true;
  private readonly session: GameSession;
  private readonly audio: AudioBus;
  private readonly configError: string;
  private readonly title = element('title-screen');
  private readonly header = element('game-header');
  private readonly lobby = element('lobby-screen');
  private readonly results = element('results-screen');
  private readonly countdown = element('countdown-screen');
  private readonly play = element<HTMLButtonElement>('play-button');
  private readonly ready = element<HTMLButtonElement>('ready-button');
  private readonly again = element<HTMLButtonElement>('again-button');
  private rosterKey = '';
  private resultsKey = '';
  private playedWin = '';
  private lastWatchers = 0;
  private wasLastLight = false;
  private toastUntil = 0;
  private stealAt = 0;
  private stealAmount = 0;
  private readonly stopEvents: () => void;
  private personalBest = 0;
  private bestRound = '';

  constructor(session: GameSession, audio: AudioBus, configError: string, private readonly availability: ServerAvailability) {
    this.session = session; this.audio = audio; this.configError = configError;
    try { const stored = Number(localStorage.getItem('nightlight.best')); if (Number.isFinite(stored)) this.personalBest = Math.max(0, stored); } catch {}
    this.stopEvents = session.onEvent((event) => {
      if (event.type !== 'hit' || !event.lost) return;
      if (event.sourceId === session.status.sessionId) {
        if (performance.now() - this.stealAt > 150) this.stealAmount = 0;
        this.stealAt = performance.now(); this.stealAmount += event.lost;
        this.toast('Stole ' + this.stealAmount + ' points', 1200);
      } else if (event.playerId === session.status.sessionId) this.toast('Lost ' + event.lost + ' · find the dark', 1100);
    });
    document.querySelectorAll<HTMLElement>('[data-objective]').forEach((node) => { node.textContent = GAME.objective; });
    if (session.mode === 'online') {
      document.querySelector<HTMLElement>('.join-description')!.textContent = 'Scan to enter the match queue.';
      element('join-note').textContent = 'Use the same Wi-Fi for local testing.';
    }
  }

  enter(): void { this.titleVisible = false; this.play.blur(); this.render(); }
  showTitle(): void { this.titleVisible = true; this.render(); }
  requestRematch(): void { this.session.rematch(); this.render(); }

  render(): void {
    const session = this.session;
    const phase = session.round.phase;
    const self = session.players.get(session.status.sessionId ?? '');
    const connected = session.connected;
    const personalBest = document.getElementById('personal-best');
    if (personalBest) { personalBest.hidden = this.personalBest === 0; personalBest.textContent = 'Personal best ' + this.personalBest; }
    document.body.classList.toggle('friend-room', Boolean(session.party));
    const inLight = phase === 'playing' && self !== undefined && session.beacon !== undefined &&
      Math.hypot(self.x - session.beacon.x, self.y - session.beacon.y) <= GAME.beaconRadius;
    element('light-income').hidden = !inLight || this.titleVisible;
    this.text('light-income', '+' + BEACON.pointsPerSecond * (session.lastLight ? BEACON.lastLightMultiplier : 1) + ' / sec · everyone can see you');
    if (phase === 'playing' && session.lastLight && !this.wasLastLight) this.toast('Last Light · everyone is visible', 1800);
    this.wasLastLight = session.lastLight;
    element('moment-toast').hidden = this.titleVisible || phase !== 'playing' || performance.now() >= this.toastUntil;
    this.title.hidden = !this.titleVisible;
    this.header.hidden = this.titleVisible;
    this.lobby.hidden = this.titleVisible || (session.status.phase !== 'connecting' && (!connected || phase !== 'lobby'));
    this.countdown.hidden = this.titleVisible || !connected || phase !== 'countdown';
    this.results.hidden = this.titleVisible || !connected || phase !== 'results';
    // The rule is on screen for the opening seconds, then the arena is left clear.
    const opening = session.remainingMs > GAME.roundMs - OBJECTIVE_MS;
    element('play-objective').hidden = this.titleVisible || !connected || phase !== 'playing' || !opening;
    document.body.classList.toggle('playing', !this.titleVisible && phase === 'playing');
    const online = this.availability.available;
    const checking = this.availability.checking;
    this.play.disabled = session.status.phase === 'connecting' || Boolean(this.configError) || (!connected && !online);
    this.text('play-label', session.status.phase === 'connecting' ? 'Connecting…' : connected ? 'Back to arena' :
      'Quick match');
    const error = this.configError || session.status.message;
    this.text('connection-status', !connected && !online && !this.configError ?
      checking ? 'Checking multiplayer… Solo practice is ready.' : 'Multiplayer is unavailable. Retry or choose Solo practice.' :
      error || '2–6 players. Friends welcome. No account needed.');
    const retry = element<HTMLButtonElement>('retry-connection');
    retry.hidden = !this.availability.configured || online || connected || Boolean(this.configError);
    retry.disabled = checking;
    retry.textContent = checking ? 'Checking…' : 'Retry connection';
    element('connection-status').dataset.error = String(Boolean(this.configError) || ['error', 'disconnected'].includes(session.status.phase));
    this.text('connection-label', session.mode === 'practice' ? 'PRACTICE' : session.status.phase === 'reconnecting' ? 'RETRY…' : connected ? `${session.status.count} / 6` : 'QUEUE');
    this.text('network-banner', session.status.phase === 'reconnecting' ? 'Reconnecting… Your seat is held for 10 seconds.' : '');
    this.text('session-caption', session.mode === 'practice' ? 'SOLO PRACTICE' : connected ? `ROOM ${session.status.roomId}` : '2–6 PLAYERS');
    this.text('lobby-mode', session.mode === 'practice' ? 'SOLO PRACTICE' : session.status.phase === 'connecting' ? 'MATCHMAKING' : `${session.status.count} / 6 PLAYERS`);
    if (session.mode === 'online') this.text('lobby-title', session.party ? 'Your crew. Your dark.' : session.status.phase === 'connecting' ? 'Finding players.' : 'Match found.');
    else this.text('lobby-title', 'Find your edge.');
    this.text('lobby-note', session.mode === 'practice' ? 'A quick practice round on this device.' : session.status.phase === 'connecting' ?
      'A solo match fills with bots after 5 seconds. Six players start immediately.' : 'Your round starts automatically.');
    this.text('hud-score', String(self?.score ?? 0));
    this.renderVisibility(phase === 'playing' ? self?.exposed === true : undefined);
    this.pulseWhenSpotted(phase === 'playing' ? session.watchers : 0);
    const seconds = Math.ceil(session.remainingMs / 1000);
    this.text('hud-timer', phase === 'lobby' ? '60' : String(seconds).padStart(2, '0'));
    element('hud-timer').classList.toggle('urgent', phase === 'playing' && seconds <= 10);
    this.text('countdown-number', String(Math.max(1, seconds)));
    this.text('ready-label', session.mode === 'practice' ? 'Ready · Start practice' : self?.ready ? 'Ready ✓ · Tap to undo' : 'Ready up');
    this.ready.disabled = !connected;
    this.ready.hidden = session.mode === 'online';
    if (session.party) {
      const host = session.party.hostId === session.party.selfId;
      const available = session.party.phase === 'lobby';
      this.text('lobby-mode', 'Friend room · ' + session.party.members.length + ' / 6');
      this.text('lobby-note', available ? host ? 'Share the code, then start when your friends are here. Empty places fill with bots.' :
        'Waiting for the host to start. You will play every round together.' : 'A round is in progress. Your place is saved for the next one.');
      this.ready.hidden = false; this.ready.disabled = !host || !available;
      this.text('ready-label', host ? available ? session.party.members.length === 1 ? 'Start with bots' : 'Start round' : 'Round in progress' : 'Waiting for host');
    }
    this.again.disabled = session.mode === 'online';
    this.text('again-label', session.mode === 'online' ? seconds > 0 ? `Next match in ${seconds}s` : 'Finding next match…' : 'Play again');
    if (session.party) this.text('again-label', `Back to friends in ${seconds}s`);
    this.renderRoster();
    if (phase === 'results') this.renderResults();
  }

  /** The most important fact in the game: can everyone see you right now? */
  private renderVisibility(exposed: boolean | undefined): void {
    const chip = element('visibility-chip');
    chip.hidden = exposed === undefined || this.titleVisible;
    const watchers = this.session.watchers;
    const state = this.session.lastLight ? 'last' : exposed ? 'exposed' : watchers > 0 ? 'watched' : 'hidden';
    const label = { last: 'LAST LIGHT', exposed: 'EXPOSED', watched: 'SEEN', hidden: 'HIDDEN' }[state];
    this.text('visibility-label', label);
    this.text('visibility-eyes', watchers > 0 ? String(watchers) : '');
    element('visibility-eyes').hidden = watchers === 0;
    chip.dataset.state = state;
    chip.setAttribute('aria-label', watchers > 0 ? `${label}. ${watchers} ${watchers === 1 ? 'player can' : 'players can'} see you.` : label);
    const leader = [...this.session.players.values()].sort((a, b) => b.score - a.score)[0];
    const self = this.session.players.get(this.session.status.sessionId ?? '');
    const leading = leader !== undefined && leader === self;
    this.text('hud-leader', leader && leader.score > 0 ? `${leading ? 'YOU' : leader.handle ?? 'LEADER'} ${leader.score}` : '–');
  }

  /** A short buzz on phones the moment someone starts watching you. */
  private pulseWhenSpotted(watchers: number): void {
    if (watchers > this.lastWatchers && this.lastWatchers === 0 && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(30); } catch { /* Some browsers block vibration. That is fine. */ }
    }
    this.lastWatchers = watchers;
  }

  private text(id: string, value: string): void { const node = element(id); if (node.textContent !== value) node.textContent = value; }
  private toast(message: string, duration: number): void { this.text('moment-toast', message); this.toastUntil = performance.now() + duration; }
  destroy(): void { this.stopEvents(); }

  private renderRoster(): void {
    const entries = [...this.session.players];
    const key = JSON.stringify(entries.map(([id, player]) => [id, player.ready, player.handle, player.kind, player.connected]));
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    const roster = element('lobby-roster');
    roster.replaceChildren();
    for (const [id, player] of entries) {
      const self = id === this.session.status.sessionId;
      const card = document.createElement('div'); card.className = 'player-card';
      const avatar = document.createElement('span'); avatar.className = `player-avatar${self ? ' self' : ''}`; avatar.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'player-name'; name.textContent = self ? player.handle ? `YOU · ${player.handle}` : 'YOU' : player.handle || `PLAYER ${id.slice(0, 4).toUpperCase()}`;
      const ready = document.createElement('span'); ready.className = `ready-badge${player.ready ? ' is-ready' : ''}`;
      ready.textContent = this.session.party ? player.connected === false ? 'AWAY' : id === this.session.party.hostId ? 'HOST' : 'IN' :
        this.session.mode === 'practice' ? player.ready ? 'READY ✓' : '…' : player.connected === false ? 'AWAY' : player.kind === 'human' ? 'IN' : player.kind?.toUpperCase() || 'IN';
      card.append(avatar, name, ready); roster.append(card);
    }
  }

  private renderResults(): void {
    const result = this.session.roundResult;
    const rows = result?.standings ?? standings(this.session.players).map((row) => ({ ...row, handle: this.session.players.get(row.id)?.handle, kind: this.session.players.get(row.id)?.kind }));
    const key = `${this.session.round.roundId}:${JSON.stringify(rows)}:${JSON.stringify(result?.winners)}`;
    if (key === this.resultsKey) return;
    this.resultsKey = key;
    const top = rows[0]?.score ?? 0;
    const winners = this.session.mode === 'online' ? result?.winners ?? [] : top > 0 ? rows.filter((row) => row.score === top).map((row) => row.id) : [];
    const own = rows.find((row) => row.id === this.session.status.sessionId);
    if (own && own.score > this.personalBest) {
      this.personalBest = own.score; this.bestRound = this.session.round.roundId;
      try { localStorage.setItem('nightlight.best', String(this.personalBest)); } catch {}
    }
    const win = own !== undefined && winners.includes(own.id);
    this.text('results-title', win ? winners.length > 1 ? 'Shared win.' : 'Nicely done.' : 'Round complete.');
    this.text('results-score', String(own?.score ?? 0));
    this.text('results-caption', this.session.mode === 'online' && !result ? 'Final scores incoming…' : win ? 'Seen at exactly the right moments.' : 'The dark is waiting. One more round?');
    if (this.bestRound === this.session.round.roundId) this.text('results-caption', 'New personal best. Can you steal the next round too?');
    const board = element('results-list'); board.replaceChildren();
    rows.forEach((row) => {
      const item = document.createElement('li'); item.className = row.id === own?.id ? 'result-row self' : 'result-row';
      const place = document.createElement('span'); place.className = 'result-place'; place.textContent = String(rows.findIndex((candidate) => candidate.score === row.score) + 1).padStart(2, '0');
      const name = document.createElement('span'); name.textContent = row.id === own?.id ? row.handle ? `YOU · ${row.handle}` : 'YOU' : row.handle || `PLAYER ${row.id.slice(0, 4).toUpperCase()}`;
      const score = document.createElement('strong'); score.textContent = String(row.score);
      item.append(place, name, score); board.append(item);
    });
    const winKey = `${this.session.status.roomId ?? 'practice'}:${this.session.round.roundId}`;
    if (win && this.playedWin !== winKey) { this.playedWin = winKey; this.audio.play('win'); }
  }
}
