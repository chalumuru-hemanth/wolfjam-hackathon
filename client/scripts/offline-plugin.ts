import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Cache only the game shell and assets, never matchmaking or player state. */
export function offlinePlugin(): Plugin {
  let directory = '';
  return {
    name: 'nightlight-offline', apply: 'build',
    configResolved(config) { directory = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const files: string[] = [];
      const walk = (base: string, prefix = ''): void => {
        for (const entry of readdirSync(base, { withFileTypes: true })) {
          const name = prefix + entry.name;
          if (entry.isDirectory()) walk(join(base, entry.name), name + '/');
          else if (name !== 'sw.js') files.push('/' + name);
        }
      };
      walk(directory); files.sort();
      const digest = createHash('sha256');
      for (const file of files) digest.update(file).update(readFileSync(join(directory, file.slice(1))));
      const hash = digest.digest('hex').slice(0, 12);
      files.push('/');
      const worker = [
        'const CACHE = ' + JSON.stringify('nightlight-' + hash) + ';',
        'const FILES = ' + JSON.stringify(files) + ';',
        "self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });",
        "self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nightlight-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });",
        "self.addEventListener('fetch', e => {",
        " const url = new URL(e.request.url); if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;",
        " if (e.request.mode === 'navigate' && url.pathname === '/') { e.respondWith(fetch(e.request).then(r => { if (r.status >= 500) throw Error('Gateway unavailable'); return r; }).catch(() => caches.match('/').then(r => r || Response.error()))); return; }",
        " if (FILES.includes(url.pathname)) e.respondWith(caches.match(url.pathname).then(r => r || fetch(e.request)));",
        '});',
      ].join('\n');
      writeFileSync(join(directory, 'sw.js'), worker);
    },
  };
}
