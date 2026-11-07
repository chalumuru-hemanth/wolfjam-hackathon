interface ImportMetaEnv {
  readonly VITE_JOIN_URL?: string;
  readonly VITE_COLYSEUS_URL?: string;
  readonly VITE_PRACTICE?: string;
}

interface Window {
  __wolfjam?: () => {
    mode: 'practice' | 'online';
    phase: import('./game/types').RoundPhase;
    remainingMs: number;
    player?: import('./game/types').PlayerSnapshot;
    inputEnabled: boolean;
    input: Readonly<import('./input/InputState').InputFrame>;
    playerCount: number; flashes: number; beacon?: { x: number; y: number };
    audioState: AudioContextState | 'locked';
    audioLoaded: number;
  };
}
