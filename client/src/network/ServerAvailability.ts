import { serverHttpUrl } from './config';

/** A cached page can load even when its game server has stopped. Probe the server itself. */
export class ServerAvailability {
  available = false;
  checking = false;
  private readonly endpoint: string | undefined;
  private pending: Promise<boolean> | undefined;
  private controller: AbortController | undefined;
  private destroyed = false;
  private checkedAt = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly refresh = (): void => { if (!document.hidden) void this.check(); };
  private readonly offline = (): void => { this.available = false; };
  get configured(): boolean { return Boolean(this.endpoint); }

  constructor(endpoint: string | undefined) {
    this.endpoint = endpoint;
    window.addEventListener('online', this.refresh);
    window.addEventListener('offline', this.offline);
    window.addEventListener('focus', this.refresh);
    document.addEventListener('visibilitychange', this.refresh);
    this.timer = setInterval(() => {
      if (!this.available || Date.now() - this.checkedAt > 15000) this.refresh();
    }, 5000);
  }

  check(): Promise<boolean> {
    if (!this.endpoint || this.destroyed) return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.checking = true;
    const controller = this.controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    this.pending = (async () => {
      let available = false;
      try {
        const response = await fetch(serverHttpUrl(this.endpoint!, '/healthz'), {
          cache: 'no-store', signal: controller.signal,
        });
        const health: unknown = await response.json();
        available = response.ok && typeof health === 'object' && health !== null &&
          'ok' in health && health.ok === true;
      } catch { /* The offline shell and solo practice remain usable. */ }
      finally {
        clearTimeout(timeout);
        if (!this.destroyed) this.available = available;
        this.checkedAt = Date.now(); this.checking = false; this.pending = undefined;
      }
      return !this.destroyed && available;
    })();
    return this.pending;
  }

  destroy(): void {
    this.destroyed = true; this.controller?.abort(); clearInterval(this.timer);
    window.removeEventListener('online', this.refresh);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('focus', this.refresh);
    document.removeEventListener('visibilitychange', this.refresh);
  }
}
