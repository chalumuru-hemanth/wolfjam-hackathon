import QRCode from 'qrcode';

export function phoneUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const local = host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]' ||
      /^127\./.test(host) || /^\[::ffff:7f[\da-f]{2}:[\da-f]{1,4}\]$/.test(host) ||
      host === '0.0.0.0' || host === '[::]';
    return ['http:', 'https:'].includes(url.protocol) && !local && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function joinUrl(raw: string): URL | null {
  const url = phoneUrl(raw);
  if (!url) return null;
  url.hash = '';
  url.searchParams.delete('room');
  return url;
}

export function resolveJoinUrl(current: string, configured: string | undefined): URL | null {
  return joinUrl(current) ?? (configured ? joinUrl(configured) : null);
}

export async function prepareJoin(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#join-qr');
  const message = document.querySelector<HTMLElement>('#qr-message');
  const link = document.querySelector<HTMLAnchorElement>('#join-url');
  const note = document.querySelector<HTMLElement>('#join-note');
  if (!canvas || !message || !link || !note) return;
  const configured = import.meta.env.VITE_JOIN_URL?.trim() as string | undefined;
  const url = resolveJoinUrl(window.location.href, configured);
  if (!url) {
    message.textContent = 'Phone join URL not set';
    note.textContent = 'Open this page using Vite’s Network URL, or set VITE_JOIN_URL in .env.local and restart Vite.';
    return;
  }
  try {
    await QRCode.toCanvas(canvas, url.href, {
      width: 224, margin: 3, errorCorrectionLevel: 'M',
      color: { dark: '#101827', light: '#F4F7FC' },
    });
    canvas.hidden = false;
    message.hidden = true;
    link.href = url.href;
    link.textContent = url.href.replace(/\/$/, '');
    link.hidden = false;
  } catch {
    message.textContent = 'QR unavailable — open the link below';
    link.href = url.href;
    link.textContent = url.href;
    link.hidden = false;
  }
}
