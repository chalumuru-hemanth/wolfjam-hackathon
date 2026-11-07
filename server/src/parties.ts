import { randomInt } from 'node:crypto';

interface PartyEntry { roomId: string; finished(arenaId: string): void }
const parties = new Map<string, PartyEntry>();
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function normalizePartyCode(value: string): string { return value.trim().toUpperCase().replace(/[\s-]/g, ''); }
export function registerParty(entry: PartyEntry): string {
  if (parties.size >= 1000) throw new Error('Friend rooms are busy. Try again shortly.');
  let code: string;
  do { code = Array.from({ length: 6 }, () => LETTERS[randomInt(LETTERS.length)]).join(''); } while (parties.has(code));
  parties.set(code, entry); return code;
}
export function findParty(raw: string): string | undefined {
  const code = normalizePartyCode(raw);
  return /^[A-Z2-9]{6}$/.test(code) ? parties.get(code)?.roomId : undefined;
}
export function removeParty(code: string): void { parties.delete(code); }
export function finishPartyRound(code: string, arenaId: string): void { parties.get(code)?.finished(arenaId); }
