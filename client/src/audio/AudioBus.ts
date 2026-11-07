type SoundName = 'action' | 'hit' | 'score' | 'win';
const FILES: Record<SoundName, string> = { action: 'action.wav', hit: 'hit.wav', score: 'score.wav', win: 'win.wav' };
const LIMITS: Record<SoundName, number> = { action: 80, hit: 60, score: 80, win: 1000 };

/** Four short CC0 samples. The first player gesture unlocks Web Audio on phones. */
export class AudioBus {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private buffers = new Map<SoundName, AudioBuffer>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private readonly lastPlayed = new Map<SoundName, number>();
  private readonly data: Promise<Array<{ name: SoundName; bytes: ArrayBuffer }>>;
  private decoding: Promise<void> | undefined;
  private destroyed = false;
  get loaded(): number { return this.buffers.size; }
  get state(): AudioContextState | 'locked' { return this.context?.state ?? 'locked'; }

  constructor() {
    this.data = Promise.allSettled(Object.entries(FILES).map(async ([name, file]) => {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/${file}`);
      if (!response.ok) throw new Error(`Audio unavailable: ${file}`);
      return { name: name as SoundName, bytes: await response.arrayBuffer() };
    })).then((results) => results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
  }

  async unlock(): Promise<void> {
    if (this.destroyed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.28;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      if (!this.decoding) {
        const context = this.context;
        this.decoding = this.data.then(async (files) => {
          await Promise.allSettled(files.map(async ({ name, bytes }) => {
            const buffer = await context.decodeAudioData(bytes);
            if (!this.destroyed) this.buffers.set(name, buffer);
          }));
        });
      }
      await this.decoding;
    } catch { /* Audio failure must never prevent a round from starting. */ }
  }

  play(name: SoundName): void {
    const context = this.context;
    const buffer = this.buffers.get(name);
    const now = performance.now();
    if (!context || !this.master || !buffer || context.state !== 'running' || this.voices.size >= 8 ||
      now - (this.lastPlayed.get(name) ?? -Infinity) < LIMITS[name]) return;
    this.lastPlayed.set(name, now);
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (name !== 'win') source.playbackRate.value = 0.97 + Math.random() * 0.06;
    source.connect(this.master);
    this.voices.add(source);
    source.onended = () => { this.voices.delete(source); source.disconnect(); };
    source.start();
  }

  suspend(): void {
    this.voices.forEach((source) => { try { source.stop(); } catch { /* Already stopped. */ } });
    this.voices.clear();
    if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
  }
  destroy(): void {
    this.destroyed = true;
    this.voices.forEach((source) => { try { source.stop(); } catch { /* Already stopped. */ } });
    this.voices.clear(); this.buffers.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
