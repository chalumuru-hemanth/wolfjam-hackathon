import { Room, ServerError, matchMaker, type Client } from 'colyseus';
import { PartyState, PartyMember, type ArenaJoinOptions, type QueueJoinOptions } from '@wolfjam/shared';
import { store } from '../db.ts';
import { ROOM_KEY } from '../matchmaking.ts';
import { registerParty, removeParty } from '../parties.ts';

export class PartyRoom extends Room<{ state: PartyState }> {
  override maxClients = 6;
  override maxMessagesPerSecond = 10;
  override state = new PartyState();
  private readonly identities = new Map<string, string>();
  private arenaId = '';

  override async onCreate(): Promise<void> {
    this.state.phase = 'lobby';
    this.state.code = registerParty({ roomId: this.roomId, finished: (id) => {
      if (id === this.arenaId) { this.arenaId = ''; this.state.phase = 'lobby'; }
    } });
    await this.setPrivate(true);
    this.onMessage('start', (client) => { void this.startRound(client); });
  }
  override onAuth(_client: Client, options: QueueJoinOptions = {}): boolean {
    return typeof options.playerId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.playerId);
  }
  override onJoin(client: Client, options: QueueJoinOptions): void {
    const id = options.playerId!;
    if ([...this.identities.values()].includes(id)) throw new ServerError(409, 'You are already in this friend room. Return to your other tab.');
    this.identities.set(client.sessionId, id);
    const member = new PartyMember(); member.handle = store.handleFor(id); member.connected = true;
    this.state.members.set(client.sessionId, member);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }
  override onDrop(client: Client): void {
    const member = this.state.members.get(client.sessionId); if (member) member.connected = false;
    if (this.state.hostId === client.sessionId) this.chooseHost();
    this.allowReconnection(client, 10);
  }
  override onReconnect(client: Client): void {
    const member = this.state.members.get(client.sessionId); if (member) member.connected = true;
    this.chooseHost();
  }
  override onLeave(client: Client): void {
    this.state.members.delete(client.sessionId); this.identities.delete(client.sessionId); this.chooseHost();
  }
  override onDispose(): void { removeParty(this.state.code); }
  private chooseHost(): void {
    if (this.state.members.get(this.state.hostId)?.connected) return;
    this.state.hostId = [...this.state.members].find(([, member]) => member.connected)?.[0] ?? '';
  }
  private async startRound(client: Client): Promise<void> {
    if (client.sessionId !== this.state.hostId || this.state.phase !== 'lobby') return;
    const group = this.clients.filter((member) => this.state.members.get(member.sessionId)?.connected);
    if (!group.length) return;
    this.state.phase = 'starting';
    try {
      const arena = await matchMaker.createRoom('arena', { expected: group.length, roomKey: ROOM_KEY, partyCode: this.state.code });
      this.arenaId = arena.roomId;
      const seats = await Promise.all(group.map(async (member) => {
        const options: ArenaJoinOptions = { playerId: this.identities.get(member.sessionId)!,
          handle: this.state.members.get(member.sessionId)!.handle, kind: 'human', roomKey: ROOM_KEY };
        return { member, seat: await matchMaker.reserveSeatFor(arena, options) };
      }));
      this.state.phase = 'playing';
      seats.forEach(({ member, seat }) => member.send('matched', seat));
    } catch {
      this.state.phase = 'lobby'; this.arenaId = '';
      this.broadcast('notice', 'The round could not start. Try Start round again.');
    }
  }
}
