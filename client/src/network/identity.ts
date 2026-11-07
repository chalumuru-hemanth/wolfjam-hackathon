export interface BrowserStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const ID_KEY = 'wolfjam.playerId';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
let ephemeralId: string | undefined;

// HTTP LAN pages lack randomUUID(), while getRandomValues() remains available.
export function createPlayerId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = crypto): string {
  if (source.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function browserStore(kind: 'localStorage' | 'sessionStorage'): BrowserStore | undefined {
  try { return typeof window === 'undefined' ? undefined : window[kind]; } catch { return undefined; }
}

export function getStoredPlayerId(storage = browserStore('localStorage')): string {
  try { const saved = storage?.getItem(ID_KEY); if (saved && UUID.test(saved)) return saved; } catch { /* Storage may be disabled. */ }
  const id = ephemeralId ??= createPlayerId();
  try { storage?.setItem(ID_KEY, id); } catch { /* Keep the in-memory identity for this page. */ }
  return id;
}

export function reconnectKey(endpoint: string): string { return `wolfjam.reconnect:${endpoint.replace(/\/$/, '')}`; }
export function storedToken(endpoint: string, storage = browserStore('sessionStorage')): string | undefined {
  try { return storage?.getItem(reconnectKey(endpoint)) || undefined; } catch { return undefined; }
}
export function saveToken(endpoint: string, token: string | undefined, storage = browserStore('sessionStorage')): void {
  try { if (token) storage?.setItem(reconnectKey(endpoint), token); else storage?.removeItem(reconnectKey(endpoint)); } catch { /* Reconnect can still work within this page. */ }
}
