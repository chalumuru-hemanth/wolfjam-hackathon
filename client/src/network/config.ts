export interface NetworkConfig { endpoint?: string; roomName: string }
export interface NetworkEnv { VITE_COLYSEUS_URL?: string; VITE_PRACTICE?: string }

export function readNetworkConfig(env: NetworkEnv, pageUrl: string, production = false): NetworkConfig {
  const page = new URL(pageUrl);
  const endpoint = env.VITE_COLYSEUS_URL?.trim() || (production && env.VITE_PRACTICE !== 'true' ? page.origin : undefined);
  if (endpoint) {
    const server = new URL(endpoint);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(server.protocol)) throw new Error('The multiplayer server URL must use HTTP or WebSocket.');
    if (page.protocol === 'https:' && ['http:', 'ws:'].includes(server.protocol)) throw new Error('This page needs a secure multiplayer server (HTTPS or WSS).');
  }
  // Arena seats come only from the wait-room queue. Legacy room query parameters are not used.
  return { endpoint, roomName: 'wait' };
}
