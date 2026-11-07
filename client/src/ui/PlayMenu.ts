import QRCode from 'qrcode';
import { PracticeSession } from '../game/PracticeSession';
import { PartySession } from '../network/PartySession';
import { prepareJoin, resolveJoinUrl } from '../join';
import type { SessionRouter } from '../game/SessionRouter';
import type { GameSession } from '../game/types';
import type { NetworkConfig } from '../network/config';
import type { ServerAvailability } from '../network/ServerAvailability';

const node = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
export class PlayMenu {
  private activeCode = '';
  private inviteUrl = '';
  private friendMode = false;
  private readonly removers: Array<() => void> = [];
  constructor(private readonly session: SessionRouter, private readonly config: NetworkConfig,
    private readonly availability: ServerAvailability, launch: (driver: GameSession) => void) {
    const listen = (id: string, event: string, handler: (event: Event) => void): void => {
      node(id).addEventListener(event, handler); this.removers.push(() => node(id).removeEventListener(event, handler));
    };
    listen('solo-button', 'click', () => { this.clearInvite(); launch(new PracticeSession()); });
    listen('friends-button', 'click', () => { this.friendMode = true; void availability.check(); this.render(); node<HTMLInputElement>('party-code-input').focus(); });
    listen('friends-back', 'click', () => { this.friendMode = false; this.render(); node('friends-button').focus(); });
    listen('retry-connection', 'click', () => { void availability.check(); });
    listen('host-button', 'click', () => {
      if (!availability.available) return;
      node('friend-error').textContent = ''; launch(new PartySession(config));
    });
    listen('join-party-form', 'submit', (event) => {
      event.preventDefault();
      if (!availability.available) return;
      const code = node<HTMLInputElement>('party-code-input').value.trim().toUpperCase().replace(/[\s-]/g, '');
      if (!/^[A-Z2-9]{6}$/.test(code)) { node('friend-error').textContent = 'Enter the six-character code from your friend.'; return; }
      node('friend-error').textContent = ''; launch(new PartySession(config, code));
    });
    listen('copy-code', 'click', () => { void this.copy(this.session.party?.code ?? ''); });
    listen('share-invite', 'click', () => { void this.share(); });
    const invited = new URL(location.href).searchParams.get('party');
    if (invited) { node<HTMLInputElement>('party-code-input').value = invited.slice(0, 12); this.friendMode = true; }
  }
  render(): void {
    const party = this.session.party;
    const connected = this.session.connected;
    node('mode-buttons').hidden = this.friendMode && !connected;
    node('friend-form').hidden = !this.friendMode || connected;
    node('solo-button').hidden = connected;
    node('friends-button').hidden = connected;
    const unavailable = !this.config.endpoint || !this.availability.available || this.session.status.phase === 'connecting';
    node<HTMLButtonElement>('host-button').disabled = unavailable;
    node<HTMLButtonElement>('join-party-button').disabled = unavailable;
    node('party-panel').hidden = !party;
    if (party && party.code !== this.activeCode) {
      this.activeCode = party.code;
      node('share-status').textContent = '';
      const address = new URL(location.href); address.searchParams.set('party', party.code); history.replaceState(null, '', address);
      const invite = resolveJoinUrl(address.href, import.meta.env.VITE_JOIN_URL);
      invite?.searchParams.set('party', party.code);
      this.inviteUrl = invite?.href ?? ''; node('party-code').textContent = party.code;
      const link = node<HTMLAnchorElement>('party-invite');
      if (invite) {
        link.href = invite.href; link.textContent = invite.href.replace('https://', '').replace('http://', '');
        void QRCode.toCanvas(node<HTMLCanvasElement>('party-qr'), invite.href, { width: 144, margin: 3, color: { dark: '#101827', light: '#F4F7FC' } })
          .catch(() => { node('party-qr').hidden = true; node('share-status').textContent = 'QR unavailable. Share the code or link instead.'; });
      } else { link.removeAttribute('href'); link.textContent = 'Use the network address to invite phones.'; }
      node('party-qr').hidden = !invite; node<HTMLButtonElement>('share-invite').disabled = !invite;
      void prepareJoin();
    } else if (!party && this.activeCode) {
      this.activeCode = ''; this.inviteUrl = ''; this.friendMode = false;
      const address = new URL(location.href); address.searchParams.delete('party'); history.replaceState(null, '', address); void prepareJoin();
    }
  }
  private async copy(text: string): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text); node('share-status').textContent = 'Copied. Send it to your friends.';
    } catch { node('share-status').textContent = 'Select the code or link above to copy it.'; }
  }
  clearInvite(): void {
    this.friendMode = false; this.activeCode = ''; this.inviteUrl = '';
    const address = new URL(location.href); address.searchParams.delete('party'); history.replaceState(null, '', address);
    void prepareJoin();
  }
  private async share(): Promise<void> {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'Play Nightlight with me', text: 'Get rich in the light. Rob them in the dark.', url: this.inviteUrl }); return; }
      catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
    }
    await this.copy(this.inviteUrl);
  }
  destroy(): void { this.removers.forEach((remove) => remove()); }
}
